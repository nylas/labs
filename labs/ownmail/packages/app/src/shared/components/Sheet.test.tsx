// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet.js'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

function stubMatchMedia(matches = false) {
	const addEventListener = vi.fn()
	const removeEventListener = vi.fn()
	const media = {
		matches,
		addEventListener,
		removeEventListener,
	} as unknown as MediaQueryList
	const matchMedia = vi.fn(() => media)
	vi.stubGlobal('matchMedia', matchMedia)
	return { addEventListener, matchMedia, media, removeEventListener }
}

function renderSheet(overrides: Partial<Parameters<typeof Sheet>[0]> = {}) {
	const onClose = vi.fn()
	const utils = render(
		<Sheet open onClose={onClose} title="Navigation" {...overrides}>
			<a href="/inbox">Inbox</a>
		</Sheet>,
	)
	return { onClose, ...utils }
}

describe('Sheet', () => {
	it('renders nothing while closed so it stays out of the tab order', () => {
		const { container } = render(
			<Sheet open={false} onClose={vi.fn()} title="Navigation">
				<span>hidden</span>
			</Sheet>,
		)
		expect(container.firstChild).toBeNull()
		// A closed sheet must not lock body scroll.
		expect(document.body.style.overflow).not.toBe('hidden')
	})

	it('renders an accessible dialog with its title and content when open', () => {
		renderSheet()
		const dialog = screen.getByRole('dialog', { name: 'Navigation' })
		expect(dialog).toBeInTheDocument()
		expect(dialog).toHaveClass('h-dvh', 'w-[min(20rem,calc(100%_-_2rem))]')
		expect(screen.getByText('Inbox')).toBeInTheDocument()
	})

	it('locks body scroll while open and restores it on close', () => {
		const { rerender } = renderSheet()
		expect(document.body).toHaveAttribute('data-scroll-locked', '1')
		rerender(
			<Sheet open={false} onClose={vi.fn()} title="Navigation">
				<a href="/inbox">Inbox</a>
			</Sheet>,
		)
		expect(document.body).not.toHaveAttribute('data-scroll-locked')
	})

	it('moves focus inside the panel when it opens', () => {
		renderSheet()
		expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
	})

	it('closes on the Escape key', () => {
		const { onClose } = renderSheet()
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('ignores other keys', () => {
		const { onClose } = renderSheet()
		fireEvent.keyDown(document, { key: 'Enter' })
		expect(onClose).not.toHaveBeenCalled()
	})

	it('closes when the backdrop is clicked', () => {
		const { onClose } = renderSheet()
		fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement)
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('closes when the header close button is clicked', () => {
		const { onClose } = renderSheet()
		const close = screen.getByRole('button', { name: 'Close navigation' })
		expect(close).toHaveClass('h-11', 'w-11')
		fireEvent.click(close)
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('anchors to the left edge by default', () => {
		renderSheet()
		const dialog = screen.getByRole('dialog')
		expect(dialog.className).toContain('left-0')
		expect(dialog.className).toContain('border-r')
	})

	it('anchors to the right edge when side is right', () => {
		renderSheet({ side: 'right' })
		const dialog = screen.getByRole('dialog')
		expect(dialog.className).toContain('right-0')
		expect(dialog.className).toContain('border-l')
	})

	it('lets calendar utility sheets remain available through the large breakpoint', () => {
		const { matchMedia } = stubMatchMedia()
		renderSheet({ hideAt: 'lg' })
		expect(matchMedia).toHaveBeenCalledWith('(min-width: 64rem)')
		const dialog = screen.getByRole('dialog')
		expect(dialog).toHaveClass('lg:hidden')
		expect(dialog).not.toHaveClass('md:hidden')
		expect(dialog.lastElementChild).toHaveClass('pb-[var(--safe-area-bottom)]')
	})

	it('closes and releases its breakpoint listener when a default sheet becomes desktop-only', () => {
		const { addEventListener, matchMedia, media, removeEventListener } = stubMatchMedia()
		const { onClose, unmount } = renderSheet()
		expect(matchMedia).toHaveBeenCalledWith('(min-width: 48rem)')
		const changeListener = addEventListener.mock.calls[0]?.[1]
		expect(changeListener).toBeTypeOf('function')
		changeListener({ ...media, matches: true })
		expect(onClose).toHaveBeenCalledTimes(1)
		unmount()
		expect(removeEventListener).toHaveBeenCalledWith('change', changeListener)
	})

	it('closes immediately if it mounts beyond its responsive breakpoint', () => {
		stubMatchMedia(true)
		const { onClose } = renderSheet()
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})
