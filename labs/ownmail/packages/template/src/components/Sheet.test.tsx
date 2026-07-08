// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet.js'

afterEach(cleanup)

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
		expect(screen.getByText('Inbox')).toBeInTheDocument()
	})

	it('locks body scroll while open and restores it on close', () => {
		const { rerender } = renderSheet()
		expect(document.body.style.overflow).toBe('hidden')
		rerender(
			<Sheet open={false} onClose={vi.fn()} title="Navigation">
				<a href="/inbox">Inbox</a>
			</Sheet>,
		)
		expect(document.body.style.overflow).not.toBe('hidden')
	})

	it('moves focus to the panel when it opens', () => {
		renderSheet()
		expect(document.activeElement).toBe(screen.getByRole('dialog'))
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
		fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('closes when the header close button is clicked', () => {
		const { onClose } = renderSheet()
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
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
})
