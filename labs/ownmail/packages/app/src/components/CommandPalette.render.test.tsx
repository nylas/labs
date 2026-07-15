// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, useCommandPaletteShortcut } from './CommandPalette.js'
import { THEME_STORAGE_KEY } from './theme.js'

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigateSpy,
}))

beforeEach(() => {
	navigateSpy.mockClear()
})

afterEach(() => {
	cleanup()
	localStorage.clear()
	document.documentElement.className = ''
})

describe('CommandPalette', () => {
	it('renders nothing while closed', () => {
		render(<CommandPalette open={false} onClose={vi.fn()} />)
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('focuses the filter input when opened', async () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		await waitFor(() => expect(screen.getByLabelText('Filter commands')).toHaveFocus())
	})

	it('filters commands by label and shows an empty state when nothing matches', async () => {
		const user = userEvent.setup()
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		const input = screen.getByLabelText('Filter commands')

		await user.type(input, 'calendar')
		expect(screen.getByText('Open calendar')).toBeInTheDocument()
		expect(screen.queryByText('Compose new message')).toBeNull()

		await user.clear(input)
		await user.type(input, 'zzznope')
		expect(screen.getByText('No matching commands')).toBeInTheDocument()
		// Enter with no match must not navigate or throw.
		fireEvent.keyDown(document, { key: 'Enter' })
		expect(navigateSpy).not.toHaveBeenCalled()
	})

	it('navigates through commands with arrow keys, clamping at both ends', () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		const rows = () => screen.getAllByRole('button').filter((b) => b.className.includes('command-row'))

		// First row is active by default.
		expect(rows()[0]).toHaveAttribute('aria-current', 'true')

		fireEvent.keyDown(document, { key: 'ArrowDown' })
		expect(rows()[1]).toHaveAttribute('aria-current', 'true')

		// Clamp at the top.
		fireEvent.keyDown(document, { key: 'ArrowUp' })
		fireEvent.keyDown(document, { key: 'ArrowUp' })
		expect(rows()[0]).toHaveAttribute('aria-current', 'true')

		// Clamp at the bottom.
		for (let i = 0; i < 40; i += 1) fireEvent.keyDown(document, { key: 'ArrowDown' })
		const list = rows()
		expect(list[list.length - 1]).toHaveAttribute('aria-current', 'true')
	})

	it('scrolls the active command into view when navigating with arrow keys', () => {
		const originalScrollIntoView = Element.prototype.scrollIntoView
		const scrollIntoView = vi.fn()
		Element.prototype.scrollIntoView = scrollIntoView
		try {
			render(<CommandPalette open={true} onClose={vi.fn()} />)

			fireEvent.keyDown(document, { key: 'ArrowDown' })

			expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
		} finally {
			Element.prototype.scrollIntoView = originalScrollIntoView
		}
	})

	it('runs the active command on Enter and closes the palette', () => {
		const onClose = vi.fn()
		render(<CommandPalette open={true} onClose={onClose} />)
		// Index 0 is "Compose new message".
		fireEvent.keyDown(document, { key: 'Enter' })
		expect(navigateSpy).toHaveBeenCalledWith({ to: '/mail/compose' })
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('closes on Escape', () => {
		const onClose = vi.fn()
		render(<CommandPalette open={true} onClose={onClose} />)
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('navigates to the inbox folder with a real URL (no mask)', () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		fireEvent.click(screen.getByText('Go to Inbox'))
		expect(navigateSpy).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
		})
	})

	it('navigates to non-inbox folders with a real URL (no mask)', () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		fireEvent.click(screen.getByText('Go to Sent'))
		expect(navigateSpy).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'sent' },
		})
	})

	it('opens the calendar via its command', () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		fireEvent.click(screen.getByText('Open calendar'))
		expect(navigateSpy).toHaveBeenCalledWith({ to: '/calendar' })
	})

	it('opens contacts via its command', () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		fireEvent.click(screen.getByText('Open contacts'))
		expect(navigateSpy).toHaveBeenCalledWith({ to: '/contacts' })
	})

	it('toggles the theme both directions and persists the choice', () => {
		const { rerender } = render(<CommandPalette open={true} onClose={vi.fn()} />)
		// From light -> dark.
		fireEvent.click(screen.getByText('Toggle light / dark theme'))
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
		expect(document.documentElement.classList.contains('dark')).toBe(true)

		// Reopen and go dark -> light.
		rerender(<CommandPalette open={true} onClose={vi.fn()} />)
		fireEvent.click(screen.getByText('Toggle light / dark theme'))
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
		expect(document.documentElement.classList.contains('light')).toBe(true)
	})

	it('delegates the search command to the focus-search handler when provided', () => {
		const onFocusSearch = vi.fn()
		render(<CommandPalette open={true} onClose={vi.fn()} onFocusSearch={onFocusSearch} />)
		fireEvent.click(screen.getByText('Search mail'))
		expect(onFocusSearch).toHaveBeenCalledTimes(1)
	})

	it('handles the search command gracefully when no focus-search handler is given', () => {
		const onClose = vi.fn()
		render(<CommandPalette open={true} onClose={onClose} />)
		fireEvent.click(screen.getByText('Search mail'))
		// No handler: nothing to call, but the palette still closes.
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('activates a row on hover', () => {
		render(<CommandPalette open={true} onClose={vi.fn()} />)
		const calendarRow = screen.getByText('Open calendar').closest('button')
		if (!calendarRow) throw new Error('expected calendar row')
		fireEvent.mouseEnter(calendarRow)
		expect(calendarRow).toHaveAttribute('aria-current', 'true')
	})

	it('closes on Escape via the dialog dismiss layer', () => {
		const onClose = vi.fn()
		render(<CommandPalette open={true} onClose={onClose} />)
		fireEvent.keyDown(document.body, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe('useCommandPaletteShortcut', () => {
	it('opens on Cmd+K and Ctrl+K when not typing in a field', () => {
		const onOpen = vi.fn()
		renderHook(() => useCommandPaletteShortcut(onOpen))

		fireEvent.keyDown(window, { key: 'k', metaKey: true })
		expect(onOpen).toHaveBeenCalledTimes(1)

		fireEvent.keyDown(window, { key: 'K', ctrlKey: true })
		expect(onOpen).toHaveBeenCalledTimes(2)
	})

	it('ignores the shortcut without a modifier or on a different key', () => {
		const onOpen = vi.fn()
		renderHook(() => useCommandPaletteShortcut(onOpen))

		fireEvent.keyDown(window, { key: 'k' })
		fireEvent.keyDown(window, { key: 'j', metaKey: true })
		expect(onOpen).not.toHaveBeenCalled()
	})

	it('does not steal the shortcut while typing in an input', () => {
		const onOpen = vi.fn()
		renderHook(() => useCommandPaletteShortcut(onOpen))

		const input = document.createElement('input')
		document.body.appendChild(input)
		fireEvent.keyDown(input, { key: 'k', metaKey: true })
		expect(onOpen).not.toHaveBeenCalled()
		input.remove()
	})
})
