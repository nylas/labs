// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from '../config/theme.js'
import { AppRailLogo, AppRailMobileNav, AppRailNav } from './AppRail.js'
import { CommandPalette } from './CommandPalette.js'

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to, ...rest }: any) => (
		<a href={typeof to === 'string' ? to : '#'} {...rest}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
}))

afterEach(() => {
	cleanup()
	localStorage.clear()
	document.documentElement.className = ''
})

describe('AppRailLogo', () => {
	it('labels the home link with a humanized org name derived from the app name', () => {
		render(<AppRailLogo appName="acme-corp_mail" />)
		// formatOrgLabel splits on separators and title-cases each word.
		const link = screen.getByRole('link', { name: 'Acme Corp Mail home' })
		expect(link).toHaveAttribute('href', '/')
		expect(link).toHaveAttribute('title', 'Acme Corp Mail')
	})
})

describe('AppRailNav', () => {
	it('marks the active section and reflects it in aria-current', () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
		expect(screen.getByRole('link', { name: 'Contacts' })).not.toHaveAttribute('aria-current')
	})

	it('marks the contacts section as active and links it to the contacts home', () => {
		render(<AppRailNav email="ada@ownmail.com" active="contacts" />)
		const contacts = screen.getByRole('link', { name: 'Contacts' })
		expect(contacts).toHaveAttribute('aria-current', 'page')
		expect(contacts).toHaveAttribute('href', '/contacts')
		expect(screen.getByRole('link', { name: 'Mail' })).not.toHaveAttribute('aria-current')
	})

	it('uses the account avatar as the settings link and marks it active', () => {
		render(<AppRailNav email="ada@ownmail.com" active="settings" />)
		const account = screen.getByRole('link', { name: 'Account settings for ada@ownmail.com' })
		expect(account).toHaveAttribute('href', '/settings')
		expect(account).toHaveAttribute('aria-current', 'page')
		expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
	})

	it('shows the moon (offer dark mode) when the saved theme is light and toggles to dark', () => {
		render(<AppRailNav email="ada@ownmail.com" active="calendar" />)
		// No saved theme -> mounts light -> toggle button offers switching to dark mode.
		const toggle = screen.getByRole('button', { name: 'Switch to dark mode' })
		fireEvent.click(toggle)
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
		expect(document.documentElement.classList.contains('dark')).toBe(true)
		// Now it offers switching back to light.
		expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument()
	})

	it('restores a saved dark theme on mount and toggles back to light', () => {
		localStorage.setItem(THEME_STORAGE_KEY, 'dark')
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		const toggle = screen.getByRole('button', { name: 'Switch to light mode' })
		expect(document.documentElement.classList.contains('dark')).toBe(true)
		fireEvent.click(toggle)
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
		expect(document.documentElement.classList.contains('light')).toBe(true)
		expect(document.documentElement.classList.contains('dark')).toBe(false)
	})

	it('invokes the command palette opener from the command button', () => {
		const onOpen = vi.fn()
		render(<AppRailNav email="ada@ownmail.com" active="mail" onOpenCommandPalette={onOpen} />)
		const commandButton = screen.getByRole('button', { name: 'Open command palette' })
		expect(commandButton.querySelector('svg')).toHaveClass('lucide-command')
		fireEvent.click(commandButton)
		expect(onOpen).toHaveBeenCalledTimes(1)
	})

	it('shows accessible shadcn tooltips for rail icons and surfaces command shortcuts', async () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)

		fireEvent.focus(screen.getByRole('link', { name: 'Calendar' }))
		await waitFor(() =>
			expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('Calendar'),
		)

		fireEvent.blur(screen.getByRole('link', { name: 'Calendar' }))
		fireEvent.focus(screen.getByRole('button', { name: 'Open command palette' }))
		await waitFor(() => {
			const tooltip = document.querySelector('[data-slot="tooltip-content"]')
			expect(tooltip).toHaveTextContent('Open command palette')
			expect(tooltip).toHaveTextContent('⌘K')
		})
	})

	it('combines display name and email into the account settings label when a name is provided', () => {
		render(<AppRailNav email="ada@ownmail.com" displayName="Ada Lovelace" active="mail" />)
		expect(
			screen.getByRole('link', { name: 'Account settings for Ada Lovelace · ada@ownmail.com' }),
		).toBeInTheDocument()
	})

	it('prefers the server account name over a stale browser-only name', async () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({
				displayName: 'Stale Browser Name',
				autoSaveContacts: true,
				primaryTimezone: 'UTC',
				secondaryTimezone: '',
			}),
		)
		render(<AppRailNav email="ada@ownmail.com" displayName="Persisted Name" active="mail" />)

		expect(
			await screen.findByRole('link', {
				name: 'Account settings for Persisted Name · ada@ownmail.com',
			}),
		).toBeInTheDocument()
		expect(screen.queryByText(/Stale Browser Name/)).toBeNull()
	})

	it('falls back to the bare email for the account settings label without a display name', () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		expect(screen.getByRole('link', { name: 'Account settings for ada@ownmail.com' })).toBeInTheDocument()
	})

	it('keeps sign out out of the global rail so it can live under settings', () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
	})

	it('offers touch-sized full inbox labels while submitting only opaque handles on desktop', () => {
		render(
			<AppRailNav
				email="support-europe-long@ownmail.com"
				active="mail"
				accounts={[
					{ email: 'support-europe-long@ownmail.com', handle: 'a'.repeat(43), active: true },
					{ email: 'support-americas-long@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)

		const switcher = screen.getByLabelText('Switch inbox. Current inbox: support-europe-long@ownmail.com')
		expect(switcher).not.toHaveAttribute('title')
		expect(switcher).toHaveClass('min-h-11', 'w-11')
		const target = screen.getByRole('button', { name: 'support-americas-long@ownmail.com' })
		expect(target).toHaveAttribute('name', 'account')
		expect(target).toHaveAttribute('value', 'b'.repeat(43))
		expect(target).toHaveClass('min-h-11', 'min-w-0')
		const avatar = target.querySelector('[data-slot="account-switcher-avatar"]')
		expect(avatar).toHaveClass('app-rail-account', 'shrink-0')
		expect(avatar?.querySelector('.app-rail-account-inner')).toBeInTheDocument()
		const email = screen.getByText('support-americas-long@ownmail.com')
		expect(email).toHaveClass('min-w-0', 'flex-1', 'truncate')
		expect(email).toHaveAttribute('title', 'support-americas-long@ownmail.com')
		expect(target.closest('form')).toHaveAttribute('action', '/auth')
		expect(target.closest('form')).toHaveAttribute('method', 'post')
		expect(screen.queryByDisplayValue('grant-b')).toBeNull()
	})

	it('describes the current inbox in the desktop switcher tooltip', async () => {
		render(
			<AppRailNav
				email="ada@ownmail.com"
				active="mail"
				accounts={[
					{ email: 'ada@ownmail.com', handle: 'a'.repeat(43), active: true },
					{ email: 'grace@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)

		fireEvent.focus(screen.getByLabelText('Switch inbox. Current inbox: ada@ownmail.com'))
		await waitFor(() =>
			expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
				'Switch inbox · Current: ada@ownmail.com',
			),
		)
	})

	it('dismisses the desktop inbox switcher on outside interaction and after selection', () => {
		render(
			<AppRailNav
				email="ada@ownmail.com"
				active="mail"
				accounts={[
					{ email: 'ada@ownmail.com', handle: 'a'.repeat(43), active: true },
					{ email: 'grace@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)
		const summary = screen.getByLabelText('Switch inbox. Current inbox: ada@ownmail.com')
		const details = summary.closest('details')
		expect(details).not.toHaveAttribute('open')

		fireEvent.click(summary)
		expect(details).toHaveAttribute('open')
		fireEvent.pointerDown(summary)
		expect(details).toHaveAttribute('open')
		fireEvent.pointerDown(document.body)
		expect(details).not.toHaveAttribute('open')

		fireEvent.click(summary)
		expect(details).toHaveAttribute('open')
		const outsideControl = document.createElement('button')
		document.body.appendChild(outsideControl)
		fireEvent.focusIn(outsideControl)
		expect(details).not.toHaveAttribute('open')
		outsideControl.remove()

		fireEvent.click(summary)
		const target = screen.getByRole('button', { name: 'grace@ownmail.com' })
		target.closest('form')?.addEventListener('submit', (event) => event.preventDefault())
		fireEvent.click(target)
		expect(details).not.toHaveAttribute('open')
	})

	it('offers the Nylas Connect proof flow for adding another inbox', () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		expect(screen.getByRole('link', { name: 'Add inbox' })).toHaveAttribute('href', '/auth')
	})

	it('hides the switch control if session account data has no active account', () => {
		render(
			<AppRailNav
				email="ada@ownmail.com"
				active="mail"
				accounts={[
					{ email: 'ada@ownmail.com', handle: 'a'.repeat(43), active: false },
					{ email: 'grace@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)
		expect(screen.queryByLabelText(/Switch inbox\. Current inbox:/)).toBeNull()
	})

	it('keeps the current inbox identifiable when its address has no local part', () => {
		render(
			<AppRailNav
				email="@ownmail.com"
				active="mail"
				accounts={[
					{ email: '@ownmail.com', handle: 'a'.repeat(43), active: true },
					{ email: 'other@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)

		expect(screen.getByLabelText('Switch inbox. Current inbox: @ownmail.com')).toHaveTextContent(
			'@ownmail.com',
		)
	})
})

describe('theme control synchronization', () => {
	it('updates the desktop rail after the command palette changes theme', () => {
		const onClose = vi.fn()
		const view = render(
			<>
				<AppRailNav email="ada@ownmail.com" active="mail" />
				<CommandPalette open onClose={onClose} />
			</>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
		expect(onClose).toHaveBeenCalledTimes(1)
		view.rerender(
			<>
				<AppRailNav email="ada@ownmail.com" active="mail" />
				<CommandPalette open={false} onClose={onClose} />
			</>,
		)
		const lightModeControl = screen.getByRole('button', { name: 'Switch to light mode' })
		expect(lightModeControl.querySelector('svg')).toHaveClass('lucide-sun')

		fireEvent.click(lightModeControl)
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
		expect(document.documentElement.classList.contains('light')).toBe(true)
		expect(screen.getByRole('button', { name: 'Switch to dark mode' }).querySelector('svg')).toHaveClass(
			'lucide-moon',
		)
	})

	it('updates the mounted command palette after a rail theme change', () => {
		const onClose = vi.fn()
		const view = render(
			<>
				<AppRailNav email="ada@ownmail.com" active="mail" />
				<CommandPalette open={false} onClose={onClose} />
			</>,
		)
		const railControl = screen.getByRole('button', { name: 'Switch to dark mode' })

		view.rerender(
			<>
				<AppRailNav email="ada@ownmail.com" active="mail" />
				<CommandPalette open onClose={onClose} />
			</>,
		)
		expect(screen.getByRole('button', { name: 'Switch to dark mode' }).querySelector('svg')).toHaveClass(
			'lucide-moon',
		)

		fireEvent.click(railControl)

		const paletteControl = screen.getByRole('button', { name: 'Switch to light mode' })
		expect(paletteControl.querySelector('svg')).toHaveClass('lucide-sun')
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
		expect(onClose).not.toHaveBeenCalled()
	})

	it('keeps mounted desktop and mobile theme controls in sync', () => {
		render(
			<>
				<AppRailNav email="ada@ownmail.com" active="mail" />
				<AppRailMobileNav email="ada@ownmail.com" active="mail" onNavigate={vi.fn()} />
			</>,
		)

		const darkModeControls = screen.getAllByRole('button', { name: 'Switch to dark mode' })
		expect(darkModeControls).toHaveLength(2)
		expect(
			darkModeControls.every((control) => control.querySelector('svg')?.classList.contains('lucide-moon')),
		).toBe(true)
		fireEvent.click(darkModeControls[0])
		const lightModeControls = screen.getAllByRole('button', { name: 'Switch to light mode' })
		expect(lightModeControls).toHaveLength(2)
		expect(
			lightModeControls.every((control) => control.querySelector('svg')?.classList.contains('lucide-sun')),
		).toBe(true)

		fireEvent.click(lightModeControls[1])
		const restoredDarkModeControls = screen.getAllByRole('button', { name: 'Switch to dark mode' })
		expect(restoredDarkModeControls).toHaveLength(2)
		expect(
			restoredDarkModeControls.every((control) =>
				control.querySelector('svg')?.classList.contains('lucide-moon'),
			),
		).toBe(true)
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
	})

	it('removes the same-window theme subscription on unmount', () => {
		const removeEventListener = vi.spyOn(window, 'removeEventListener')
		const view = render(<AppRailNav email="ada@ownmail.com" active="mail" />)

		view.unmount()

		expect(removeEventListener).toHaveBeenCalledWith(THEME_CHANGE_EVENT, expect.any(Function))
		removeEventListener.mockRestore()
	})
})

describe('AppRailMobileNav', () => {
	it('uses labelled links in the temporary navigation panel and closes it after navigation', () => {
		const onNavigate = vi.fn()
		render(<AppRailMobileNav email="ada@ownmail.com" active="calendar" onNavigate={onNavigate} />)

		const calendar = screen.getByRole('link', { name: 'Calendar' })
		expect(calendar).toHaveAttribute('href', '/calendar')
		expect(calendar).toHaveAttribute('aria-current', 'page')
		fireEvent.click(screen.getByRole('link', { name: 'Mail' }))
		expect(onNavigate).toHaveBeenCalledTimes(1)
	})

	it('closes the panel before opening the command palette', () => {
		const onNavigate = vi.fn()
		const onOpen = vi.fn()
		render(
			<AppRailMobileNav
				email="ada@ownmail.com"
				active="mail"
				onNavigate={onNavigate}
				onOpenCommandPalette={onOpen}
			/>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
		expect(onNavigate).toHaveBeenCalledTimes(1)
		expect(onOpen).toHaveBeenCalledTimes(1)
	})

	it('toggles the theme from the mobile navigation panel', () => {
		render(<AppRailMobileNav email="ada@ownmail.com" active="mail" onNavigate={vi.fn()} />)

		fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
		fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))
		expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
	})

	it('marks settings active and keeps the command control safe when no handler is supplied', () => {
		const onNavigate = vi.fn()
		render(
			<AppRailMobileNav
				email="ada@ownmail.com"
				displayName="Ada Lovelace"
				active="settings"
				onNavigate={onNavigate}
			/>,
		)

		expect(
			screen.getByRole('link', { name: 'Account settings for Ada Lovelace · ada@ownmail.com' }),
		).toHaveAttribute('aria-current', 'page')
		fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
		expect(onNavigate).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
		expect(screen.getByRole('button', { name: 'Open command palette' }).querySelector('svg')).toHaveClass(
			'lucide-command',
		)
	})

	it('shows the verified inbox switcher in mobile navigation', () => {
		const onNavigate = vi.fn()
		const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {})
		render(
			<AppRailMobileNav
				email="ada@ownmail.com"
				active="mail"
				onNavigate={onNavigate}
				accounts={[
					{ email: 'ada@ownmail.com', handle: 'a'.repeat(43), active: true },
					{ email: 'grace@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)

		fireEvent.change(screen.getByRole('combobox', { name: 'Switch inbox' }), {
			target: { value: 'b'.repeat(43) },
		})
		expect(onNavigate).toHaveBeenCalledOnce()
		expect(requestSubmit).toHaveBeenCalledOnce()
		requestSubmit.mockRestore()
	})

	it('hides the mobile switcher if session account data has no active account', () => {
		render(
			<AppRailMobileNav
				email="ada@ownmail.com"
				active="mail"
				onNavigate={vi.fn()}
				accounts={[
					{ email: 'ada@ownmail.com', handle: 'a'.repeat(43), active: false },
					{ email: 'grace@ownmail.com', handle: 'b'.repeat(43), active: false },
				]}
			/>,
		)

		expect(screen.queryByRole('combobox', { name: 'Switch inbox' })).toBeNull()
	})
})
