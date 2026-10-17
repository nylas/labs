// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	defaultUserPreferences,
	readUserPreferences,
	type UserPreferences,
	userPreferencesTestApi,
	writeUserPreferences,
} from '#app/preferences/user-preferences'
import { ReadingPaneDivider } from './ReadingPaneDivider.js'

const rect = (value: Partial<DOMRect>) => ({ left: 0, top: 0, width: 0, height: 0, ...value }) as DOMRect

function savePreferences(next: Partial<UserPreferences>) {
	act(() => {
		writeUserPreferences({ ...defaultUserPreferences(), primaryTimezone: 'UTC', ...next })
	})
}

/** The divider between a list and a reader, in panes of the given size. */
function renderPanes({
	panes = { width: 1200, height: 800 },
	list = { left: 100, top: 50, width: 352, height: 320 },
	style,
}: {
	panes?: Partial<DOMRect>
	list?: Partial<DOMRect>
	style?: CSSProperties
} = {}) {
	render(
		<div data-testid="panes" style={style}>
			<section data-testid="list" />
			<ReadingPaneDivider />
			<section />
		</div>,
	)
	const container = screen.getByTestId('panes')
	const listElement = screen.getByTestId('list')
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(panes))
	vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue(rect(list))
	return { container, list: listElement, handle: screen.getByRole('separator') }
}

function drag(handle: HTMLElement, points: Array<{ clientX?: number; clientY?: number }>, end = 'up') {
	fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
	for (const point of points) fireEvent.pointerMove(handle, { pointerId: 1, ...point })
	act(() => {
		if (end === 'up') fireEvent.pointerUp(handle, { pointerId: 1 })
		else fireEvent.pointerCancel(handle, { pointerId: 1 })
	})
}

beforeEach(() => {
	localStorage.clear()
	userPreferencesTestApi.reset()
	HTMLElement.prototype.setPointerCapture = vi.fn()
	savePreferences({ readingPane: 'vertical' })
})
afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('ReadingPaneDivider', () => {
	it('is absent when conversations replace the list', () => {
		savePreferences({ readingPane: 'none' })
		render(<ReadingPaneDivider />)
		expect(screen.queryByRole('separator')).toBeNull()
	})

	it('is a focusable separator that reports the saved size until the list is laid out', () => {
		render(<ReadingPaneDivider />)
		const handle = screen.getByRole('separator')
		expect(handle).toHaveAccessibleName('Resize conversation list')
		expect(handle).toHaveAttribute('tabindex', '0')
		expect(handle).toHaveAttribute('aria-orientation', 'vertical')
		expect(handle).toHaveAttribute('aria-valuenow', '352')
		expect(handle).toHaveAttribute('aria-valuetext', '352 pixels wide')
		expect(handle).toHaveClass('cursor-col-resize')
		expect(handle.parentElement).toHaveClass('hidden', 'xl:block', 'w-0')

		savePreferences({ readingPane: 'vertical', readingPaneListWidth: 420 })
		expect(handle).toHaveAttribute('aria-valuenow', '420')

		savePreferences({ readingPane: 'horizontal' })
		const horizontal = screen.getByRole('separator')
		expect(horizontal).toHaveAttribute('aria-orientation', 'horizontal')
		expect(horizontal).toHaveAttribute('aria-valuenow', '40')
		expect(horizontal).toHaveAttribute('aria-valuetext', '40% of the height')
		expect(horizontal).toHaveClass('cursor-row-resize')
		savePreferences({ readingPane: 'horizontal', readingPaneListHeight: 60 })
		expect(horizontal).toHaveAttribute('aria-valuenow', '60')
	})

	it('reports the list size as laid out, re-measured when the panes resize', () => {
		// The Condensed default (26rem) and the reader's reserved room both change the real width.
		const sizes = new Map<string, Partial<DOMRect>>([
			['panes', { width: 1200, height: 800 }],
			['list', { width: 416, height: 320 }],
		])
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			return rect(sizes.get(this.dataset.testid ?? '') ?? {})
		})
		const observed: Element[] = []
		let notify = () => {}
		const disconnect = vi.fn()
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: () => void) {
					notify = callback
				}
				observe(element: Element) {
					observed.push(element)
				}
				disconnect = disconnect
			},
		)
		render(
			<div data-testid="panes">
				<section data-testid="list" />
				<ReadingPaneDivider />
			</div>,
		)
		const handle = screen.getByRole('separator')
		expect(handle).toHaveAttribute('aria-valuenow', '416')

		expect(observed).toEqual([screen.getByTestId('panes'), screen.getByTestId('list')])

		// The window shrinks: no render, but the observer reports the capped list.
		sizes.set('list', { width: 500, height: 320 })
		act(() => notify())
		expect(handle).toHaveAttribute('aria-valuenow', '500')

		savePreferences({ readingPane: 'horizontal' })
		expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '40')
		expect(screen.getByRole('separator')).toHaveAttribute('aria-valuetext', '40% of the height')
		// Switching splits observes afresh.
		expect(disconnect).toHaveBeenCalledTimes(1)
	})

	it('resizes the list live while dragging and saves the size once released', () => {
		const { container, list, handle } = renderPanes()
		fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
		expect(handle).toHaveAttribute('data-dragging')
		expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(1)

		fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })
		expect(container.style.getPropertyValue('--mail-list-width')).toBe('500px')
		expect(readUserPreferences().readingPaneListWidth).toBeNull()

		// Near zero, the list fades to show it is about to collapse; dragging back restores it.
		fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 })
		expect(list.style.opacity).toBe('0.4')
		fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })
		expect(list.style.opacity).toBe('')

		act(() => {
			fireEvent.pointerUp(handle, { pointerId: 1 })
		})
		expect(handle).not.toHaveAttribute('data-dragging')
		expect(readUserPreferences()).toMatchObject({ readingPane: 'vertical', readingPaneListWidth: 500 })
		expect(container.style.getPropertyValue('--mail-list-width')).toBe('500px')
	})

	it('switches to no split when the list is dragged to near zero, keeping the saved size', () => {
		const { container, list, handle } = renderPanes({
			style: { '--mail-list-width': '420px' } as CSSProperties,
		})
		savePreferences({ readingPane: 'vertical', readingPaneListWidth: 420 })
		drag(handle, [{ clientX: 140 }])
		expect(readUserPreferences()).toMatchObject({ readingPane: 'none', readingPaneListWidth: 420 })
		expect(container.style.getPropertyValue('--mail-list-width')).toBe('420px')
		expect(list.style.opacity).toBe('')
		expect(screen.queryByRole('separator')).toBeNull()
	})

	it('collapses a horizontal split too, removing a size that was never saved', () => {
		savePreferences({ readingPane: 'horizontal' })
		const { container, handle } = renderPanes()
		drag(handle, [{ clientY: 60 }])
		expect(readUserPreferences()).toMatchObject({ readingPane: 'none', readingPaneListHeight: null })
		expect(container.style.getPropertyValue('--mail-list-height')).toBe('')
	})

	it('saves a dragged horizontal split as a percentage of the panes', () => {
		savePreferences({ readingPane: 'horizontal' })
		const { container, handle } = renderPanes()
		drag(handle, [{ clientY: 450 }])
		expect(readUserPreferences()).toMatchObject({ readingPane: 'horizontal', readingPaneListHeight: 50 })
		expect(container.style.getPropertyValue('--mail-list-height')).toBe('50%')
	})

	it('changes nothing for a click, a cancelled drag, or another pointer', () => {
		const { container, handle } = renderPanes({ style: { '--mail-list-width': '420px' } as CSSProperties })
		drag(handle, [])
		drag(handle, [{ clientX: 700 }], 'cancel')
		expect(container.style.getPropertyValue('--mail-list-width')).toBe('420px')

		fireEvent.pointerDown(handle, { button: 2, pointerId: 1 })
		expect(handle).not.toHaveAttribute('data-dragging')
		fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 })
		fireEvent.pointerUp(handle, { pointerId: 1 })

		fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
		// A second pointer neither restarts nor moves nor ends the drag in progress.
		fireEvent.pointerDown(handle, { button: 0, pointerId: 2 })
		fireEvent.pointerMove(handle, { pointerId: 2, clientX: 700 })
		fireEvent.pointerUp(handle, { pointerId: 2 })
		expect(handle).toHaveAttribute('data-dragging')
		expect(container.style.getPropertyValue('--mail-list-width')).toBe('420px')
		drag(handle, [], 'cancel')
		expect(readUserPreferences().readingPaneListWidth).toBeNull()
	})

	it('resizes from the keyboard, collapsing when shrunk past the smallest list', () => {
		const { list, handle } = renderPanes()
		act(() => {
			fireEvent.keyDown(handle, { key: 'ArrowRight' })
		})
		expect(readUserPreferences().readingPaneListWidth).toBe(368)
		act(() => {
			fireEvent.keyDown(handle, { key: 'ArrowLeft' })
		})
		expect(readUserPreferences().readingPaneListWidth).toBe(336)
		// Keys across the split change nothing.
		fireEvent.keyDown(handle, { key: 'ArrowDown' })
		expect(readUserPreferences().readingPaneListWidth).toBe(336)

		vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect({ width: 250 }))
		act(() => {
			fireEvent.keyDown(handle, { key: 'ArrowLeft' })
		})
		expect(readUserPreferences().readingPaneListWidth).toBe(240)
		vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect({ width: 240 }))
		act(() => {
			fireEvent.keyDown(handle, { key: 'ArrowLeft' })
		})
		expect(readUserPreferences()).toMatchObject({ readingPane: 'none', readingPaneListWidth: 240 })
	})

	it('uses the vertical arrows for a horizontal split', () => {
		savePreferences({ readingPane: 'horizontal' })
		const { handle } = renderPanes()
		act(() => {
			fireEvent.keyDown(handle, { key: 'ArrowDown' })
		})
		// 320px + 16px of 800px panes.
		expect(readUserPreferences().readingPaneListHeight).toBe(42)
		act(() => {
			fireEvent.keyDown(handle, { key: 'ArrowUp' })
		})
		expect(readUserPreferences().readingPaneListHeight).toBe(38)
	})

	it('restores the default size on double-click', () => {
		savePreferences({ readingPane: 'vertical', readingPaneListWidth: 500, readingPaneListHeight: 60 })
		const { handle } = renderPanes()
		act(() => {
			fireEvent.doubleClick(handle)
		})
		expect(readUserPreferences()).toMatchObject({ readingPaneListWidth: null, readingPaneListHeight: 60 })
		savePreferences({ readingPane: 'horizontal', readingPaneListWidth: 500, readingPaneListHeight: 60 })
		act(() => {
			fireEvent.doubleClick(screen.getByRole('separator'))
		})
		expect(readUserPreferences()).toMatchObject({ readingPaneListWidth: 500, readingPaneListHeight: null })
	})

	it('does nothing until it sits after a list', () => {
		render(<ReadingPaneDivider />)
		const handle = screen.getByRole('separator')
		fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
		expect(handle).not.toHaveAttribute('data-dragging')
		fireEvent.keyDown(handle, { key: 'ArrowRight' })
		expect(readUserPreferences().readingPaneListWidth).toBeNull()
	})
})
