// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRailLogo, AppRailMobileNav, AppRailNav } from './AppRail.js'
import { THEME_STORAGE_KEY } from './theme.js'

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to, ...rest }: any) => (
		<a href={typeof to === 'string' ? to : '#'} {...rest}>
			{children}
		</a>
	),
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

	it('invokes the command palette opener from the search button', () => {
		const onOpen = vi.fn()
		render(<AppRailNav email="ada@ownmail.com" active="mail" onOpenCommandPalette={onOpen} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
		expect(onOpen).toHaveBeenCalledTimes(1)
	})

	it('combines display name and email into the account settings label when a name is provided', () => {
		render(<AppRailNav email="ada@ownmail.com" displayName="Ada Lovelace" active="mail" />)
		expect(
			screen.getByRole('link', { name: 'Account settings for Ada Lovelace · ada@ownmail.com' }),
		).toBeInTheDocument()
	})

	it('falls back to the bare email for the account settings label without a display name', () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		expect(screen.getByRole('link', { name: 'Account settings for ada@ownmail.com' })).toBeInTheDocument()
	})

	it('exposes a sign-out submit control inside a logout form', () => {
		render(<AppRailNav email="ada@ownmail.com" active="mail" />)
		const signOut = screen.getByRole('button', { name: 'Sign out' })
		expect(signOut).toHaveAttribute('type', 'submit')
		expect(signOut.closest('form')).toHaveAttribute('action', '/logout')
		expect(signOut.closest('form')).toHaveAttribute('method', 'post')
	})

	it('submits only the opaque handle when switching between verified inboxes', () => {
		const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {})
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

		const switcher = screen.getByRole('combobox', { name: 'Switch inbox' })
		expect(switcher.closest('form')).toHaveAttribute('action', '/auth')
		expect(switcher.closest('form')).toHaveAttribute('method', 'post')
		fireEvent.change(switcher, { target: { value: 'b'.repeat(43) } })
		expect(requestSubmit).toHaveBeenCalledOnce()
		expect(screen.queryByDisplayValue('grant-b')).toBeNull()
		requestSubmit.mockRestore()
	})

	it('offers the Hosted Auth proof flow for adding another inbox', () => {
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
		expect(screen.queryByRole('combobox', { name: 'Switch inbox' })).toBeNull()
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
})
