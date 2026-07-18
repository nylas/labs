// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

		expect(screen.getByLabelText('Thread conversation')).toHaveAttribute('data-slot', 'scroll-area-viewport')
		expect(screen.getByLabelText('Thread conversation')).toHaveClass('size-full', 'min-w-0')
		expect(screen.getByLabelText('Thread conversation')).toHaveAttribute('tabindex', '0')
		expect(screen.getByLabelText('Thread conversation')).toHaveClass('overflow-x-hidden', 'overflow-y-auto')
		expect(screen.getByLabelText('Thread conversation').parentElement).toHaveAttribute(
			'data-slot',
			'scroll-area',
		)
		expect(screen.getByText(/Scrollable content/)).toHaveClass('sr-only')
	})

	it('keeps background fades by default and accepts a caller-scoped overflow surface', () => {
		const { rerender } = render(
			<ScrollArea aria-label="Default fades">
				<div>Default content</div>
			</ScrollArea>,
		)

		const overflowSlots = () => [
			document.querySelector('[data-slot="scroll-area-overflow-top"]'),
			document.querySelector('[data-slot="scroll-area-overflow-bottom"]'),
		]
		for (const slot of overflowSlots()) expect(slot).toHaveClass('from-background/80')

		rerender(
			<ScrollArea aria-label="Muted fades" overflowIndicatorClassName="from-muted/80 dark:from-background/80">
				<div>Muted content</div>
			</ScrollArea>,
		)

		for (const slot of overflowSlots()) {
			expect(slot).toHaveClass('from-muted/80', 'dark:from-background/80')
			expect(slot).not.toHaveClass('from-background/80')
		}
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
		expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveAttribute(
			'data-scrolling',
			'true',
		)
		expect(document.querySelector('[data-slot="scroll-area-thumb"]')).toHaveStyle({
			height: '31px',
			transform: 'translateY(0px)',
		})
		await waitFor(() =>
			expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveAttribute(
				'data-scrolling',
				'false',
			),
		)
		expect(document.querySelector('[data-overflow-top]')).not.toBeInTheDocument()

		act(() => {
			viewport.scrollTop = 200
			viewport.dispatchEvent(new Event('scroll'))
		})

		await waitFor(() => expect(document.querySelector('[data-overflow-top]')).toBeInTheDocument())
		expect(document.querySelector('[data-slot="scroll-area-thumb"]')).toHaveStyle({
			transform: 'translateY(61px)',
		})
		expect(document.querySelector('[data-overflow-bottom]')).not.toBeInTheDocument()
	})

	it('drags the overlay thumb without changing the viewport layout', async () => {
		render(
			<ScrollArea aria-label="Thread list" className="h-24">
				<div>Thread content</div>
			</ScrollArea>,
		)

		const viewport = screen.getByLabelText<HTMLElement>('Thread list')
		Object.defineProperties(viewport, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 300 },
			scrollTop: { configurable: true, value: 0, writable: true },
		})
		act(() => viewport.dispatchEvent(new Event('scroll')))
		await waitFor(() => expect(document.querySelector('[data-slot="scroll-area-thumb"]')).toBeInTheDocument())

		const thumb = document.querySelector<HTMLElement>('[data-slot="scroll-area-thumb"]')
		expect(thumb).not.toBeNull()
		if (!thumb) throw new Error('Scroll thumb was not rendered')
		thumb.setPointerCapture = vi.fn()
		thumb.releasePointerCapture = vi.fn()

		fireEvent.pointerDown(thumb, { button: 1, clientY: 10, pointerId: 7 })
		expect(thumb.setPointerCapture).not.toHaveBeenCalled()
		fireEvent.pointerDown(thumb, { button: 0, clientY: 10, pointerId: 7 })
		expect(thumb.setPointerCapture).toHaveBeenCalledWith(7)
		expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveAttribute(
			'data-dragging',
			'true',
		)

		fireEvent.pointerMove(thumb, { clientY: 71, pointerId: 7 })
		expect(viewport.scrollTop).toBe(200)
		fireEvent.pointerUp(thumb, { pointerId: 7 })
		expect(thumb.releasePointerCapture).toHaveBeenCalledWith(7)
		expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveAttribute(
			'data-dragging',
			'false',
		)

		fireEvent.pointerDown(thumb, { button: 0, clientY: 71, pointerId: 8 })
		fireEvent.pointerCancel(thumb, { pointerId: 8 })
		expect(thumb.releasePointerCapture).not.toHaveBeenCalledWith(8)
		expect(document.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveAttribute(
			'data-dragging',
			'false',
		)
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

		expect(viewportRef.current).toHaveAttribute('data-slot', 'scroll-area-viewport')
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
