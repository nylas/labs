// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScrollArea } from './scroll-area.js'

afterEach(cleanup)

describe('ScrollArea', () => {
	it('labels the scrollable region and provides an accessible instruction', () => {
		render(
			<ScrollArea aria-label="Thread conversation" className="h-24">
				<div>Message content</div>
			</ScrollArea>,
		)

		expect(screen.getByLabelText('Thread conversation')).toHaveAttribute('data-slot', 'scroll-area')
		expect(screen.getByLabelText('Thread conversation')).toHaveClass('size-full', 'min-w-0')
		expect(screen.getByLabelText('Thread conversation')).toHaveAttribute('tabindex', '0')
		expect(screen.getByLabelText('Thread conversation')).toHaveClass('overflow-x-hidden', 'overflow-y-auto')
		expect(screen.getByText(/Scrollable content/)).toHaveClass('sr-only')
	})

	it('only displays directional overflow indicators when content is available in that direction', async () => {
		render(
			<ScrollArea aria-label="Thread list" className="h-24">
				<div>Thread content</div>
			</ScrollArea>,
		)

		const viewport = screen.getByLabelText<HTMLElement>('Thread list')
		expect(viewport).not.toBeNull()
		if (!viewport) throw new Error('Scroll area viewport was not rendered')

		Object.defineProperties(viewport, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 300 },
			scrollTop: { configurable: true, value: 0, writable: true },
		})
		act(() => viewport.dispatchEvent(new Event('scroll')))
		await waitFor(() => expect(document.querySelector('[data-overflow-bottom]')).toBeInTheDocument())
		expect(document.querySelector('[data-overflow-top]')).not.toBeInTheDocument()

		act(() => {
			viewport.scrollTop = 200
			viewport.dispatchEvent(new Event('scroll'))
		})

		await waitFor(() => expect(document.querySelector('[data-overflow-top]')).toBeInTheDocument())
		expect(document.querySelector('[data-overflow-bottom]')).not.toBeInTheDocument()
	})

	it('forwards its viewport ref and observes size changes when supported', () => {
		const viewportRef = { current: null as HTMLElement | null }
		const observe = vi.fn()
		const disconnect = vi.fn()
		class ResizeObserverStub {
			observe = observe
			disconnect = disconnect
			unobserve = vi.fn()
		}
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)

		render(
			<ScrollArea aria-label="Thread list" viewportRef={viewportRef}>
				<div>Thread content</div>
			</ScrollArea>,
		)

		expect(viewportRef.current).toHaveAttribute('data-slot', 'scroll-area')
		expect(observe).toHaveBeenCalled()
		cleanup()
		expect(disconnect).toHaveBeenCalled()
		vi.unstubAllGlobals()
	})

	it('supports callback refs when observers are unavailable', () => {
		const viewportRef = vi.fn()
		vi.stubGlobal('ResizeObserver', undefined)
		vi.stubGlobal('MutationObserver', undefined)

		render(
			<ScrollArea aria-label="Thread list" viewportRef={viewportRef}>
				<div>Thread content</div>
			</ScrollArea>,
		)

		expect(viewportRef).toHaveBeenCalledWith(expect.any(HTMLElement))
		vi.unstubAllGlobals()
	})
})
