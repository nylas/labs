// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useHorizontalSwipe } from './use-horizontal-swipe.js'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
function setup(feedback = true, standalone = false, wide = false) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: query.includes('standalone') ? standalone : wide,
	}))
	const back = vi.fn()
	function Reader() {
		const handlers = useHorizontalSwipe(back, feedback)
		return (
			<div data-mail-panes>
				<section data-testid="list" data-mail-list />
				<div data-testid="reader" {...handlers}>
					<button type="button">
						Action
						<svg data-testid="icon" />
					</button>
				</div>
			</div>
		)
	}
	const view = render(<Reader />)
	return { ...view, back, reader: screen.getByTestId('reader'), list: screen.getByTestId('list') }
}
const touches = (x: number, y = 50) => ({ touches: [{ clientX: x, clientY: y }] })
const end = (x: number, y = 50) => ({ touches: [], changedTouches: [{ clientX: x, clientY: y }] })
it('follows the finger without rerendering content, previews an inert list, and commits immediately', () => {
	const { reader, list, back } = setup()
	fireEvent.touchStart(reader, touches(40))
	fireEvent.touchMove(reader, touches(45))
	expect(reader).not.toHaveAttribute('data-swipe-active')
	fireEvent.touchMove(reader, touches(95))
	expect(reader.style.getPropertyValue('--reader-swipe-x')).toBe('55px')
	expect(list.inert).toBe(true)
	fireEvent.touchMove(reader, touches(130))
	fireEvent.touchEnd(reader, end(130))
	expect(back).toHaveBeenCalledOnce()
	expect(reader).not.toHaveAttribute('data-swipe-active')
	expect(list.inert).toBe(false)
})
it('reserves Safari browser edges but permits them in standalone mode', () => {
	const first = setup()
	fireEvent.touchStart(first.reader, touches(5))
	fireEvent.touchMove(first.reader, touches(100))
	fireEvent.touchEnd(first.reader, end(100))
	expect(first.back).not.toHaveBeenCalled()
	first.unmount()
	const second = setup(true, true)
	fireEvent.touchStart(second.reader, touches(5))
	fireEvent.touchEnd(second.reader, end(100))
	expect(second.back).toHaveBeenCalledOnce()
})
it('permanently cancels vertical, leftward, multi-touch and interactive gestures', () => {
	const { reader, back } = setup()
	for (const point of [touches(42, 90), touches(10)]) {
		fireEvent.touchStart(reader, touches(40))
		fireEvent.touchMove(reader, point)
		fireEvent.touchEnd(reader, end(160))
	}
	fireEvent.touchStart(screen.getByTestId('icon'), touches(40))
	fireEvent.touchMove(reader, touches(130))
	fireEvent.touchEnd(reader, end(130))
	fireEvent.touchStart(reader, touches(40))
	fireEvent.touchMove(reader, { touches: [] })
	fireEvent.touchEnd(reader, end(130))
	fireEvent.touchStart(reader, { touches: [] })
	fireEvent.touchEnd(reader, end(130))
	fireEvent.touchStart(reader, touches(40))
	fireEvent.touchEnd(reader, { touches: [], changedTouches: [] })
	expect(back).not.toHaveBeenCalled()
})
it('cancels selection and small gestures and cleans up on unmount', () => {
	const { reader, list, back, unmount } = setup()
	const selection = vi
		.spyOn(document, 'getSelection')
		.mockReturnValue({ toString: () => 'selected' } as Selection)
	fireEvent.touchStart(reader, touches(40))
	fireEvent.touchEnd(reader, end(140))
	selection.mockReturnValue(null)
	fireEvent.touchStart(reader, touches(40))
	selection.mockReturnValue({ toString: () => 'selected' } as Selection)
	fireEvent.touchMove(reader, touches(140))
	selection.mockReturnValue(null)
	fireEvent.touchStart(reader, touches(40))
	fireEvent.touchMove(reader, touches(60))
	fireEvent.touchEnd(reader, end(60))
	expect(back).not.toHaveBeenCalled()
	fireEvent.touchStart(reader, touches(40))
	fireEvent.touchMove(reader, touches(100))
	unmount()
	expect(list.inert).toBe(false)
	expect(reader.style.getPropertyValue('--reader-swipe-x')).toBe('')
})
it('does not transform wide panes or feedback-disabled readers, and tolerates absent media APIs', () => {
	const first = setup(true, false, true)
	fireEvent.touchStart(first.reader, touches(40))
	fireEvent.touchMove(first.reader, touches(130))
	expect(first.reader).not.toHaveAttribute('data-swipe-active')
	first.unmount()
	const second = setup(false)
	vi.stubGlobal('matchMedia', undefined)
	fireEvent.touchStart(second.reader, touches(40))
	fireEvent.touchMove(second.reader, touches(130))
	expect(second.reader).not.toHaveAttribute('data-swipe-active')
	second.unmount()
	const third = setup()
	vi.stubGlobal('matchMedia', undefined)
	fireEvent.touchStart(third.reader, touches(40))
	fireEvent.touchMove(third.reader, touches(130))
	expect(third.reader).toHaveAttribute('data-swipe-active')
})
