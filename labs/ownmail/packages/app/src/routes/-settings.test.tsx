// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: any) => ({ options }),
	Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

const getAccountCapabilities = vi.fn()
const getMailboxInfo = vi.fn()
const resetMailboxPassword = vi.fn()
vi.mock('../server/fns.js', () => ({
	getAccountCapabilities: () => getAccountCapabilities(),
	getMailboxInfo: () => getMailboxInfo(),
	resetMailboxPassword: (input: unknown) => resetMailboxPassword(input),
}))

vi.mock('../components/AppRail.js', () => ({
	AppRailLogo: ({ appName }: { appName: string }) => <div>{appName}</div>,
	AppRailNav: () => <nav aria-label="App navigation" />,
	AppRailMobileNav: ({ onNavigate }: { onNavigate: () => void }) => (
		<button type="button" onClick={onNavigate}>
			close-mobile-navigation
		</button>
	),
}))

vi.mock('../components/Sheet.js', () => ({
	Sheet: (props: any) =>
		props.open ? (
			<div data-testid="sheet">
				<button type="button" onClick={props.onClose}>
					close-sheet
				</button>
				{props.children}
			</div>
		) : null,
}))

import { Route } from './settings.js'

const info = { email: 'ada@example.com', displayName: 'Ada', appName: 'OwnMail' }
const password = 'StrongPassword123!More'

function renderSettings(passwordResetEnabled = false) {
	Route.useLoaderData = vi.fn(() => ({ info, capabilities: { passwordResetEnabled } }))
	const Component = Route.options.component
	return render(<Component />)
}

beforeEach(() => {
	vi.clearAllMocks()
	window.localStorage.clear()
	getMailboxInfo.mockResolvedValue(info)
	getAccountCapabilities.mockResolvedValue({ passwordResetEnabled: false })
	resetMailboxPassword.mockResolvedValue({ ok: true })
})

afterEach(cleanup)

describe('/settings', () => {
	it('loads account information and the server-owned password capability', async () => {
		await expect(Route.options.loader()).resolves.toEqual({
			info,
			capabilities: { passwordResetEnabled: false },
		})
	})

	it('opens the app navigation as a temporary sheet', () => {
		renderSettings()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		expect(screen.getByTestId('sheet')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'close-mobile-navigation' }))
		expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getByRole('button', { name: 'close-sheet' }))
		expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
	})

	it('saves local profile, compose, and timezone preferences', async () => {
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' Ada Lovelace ' } })
		fireEvent.click(screen.getByLabelText('Save recipients to contacts automatically'))
		const [primaryTimezone, secondaryTimezone] = screen.getAllByRole('combobox')
		fireEvent.change(primaryTimezone, { target: { value: 'UTC' } })
		fireEvent.change(secondaryTimezone, { target: { value: 'America/Toronto' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

		expect(await screen.findByText('Saved on this device.')).toBeInTheDocument()
		expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toEqual({
			displayName: 'Ada Lovelace',
			autoSaveContacts: false,
			primaryTimezone: 'UTC',
			secondaryTimezone: 'America/Toronto',
		})
		const invalidTimezone = new Option('Invalid', 'not/a-timezone')
		primaryTimezone.append(invalidTimezone)
		fireEvent.change(primaryTimezone, { target: { value: 'not/a-timezone' } })
		fireEvent.change(secondaryTimezone, { target: { value: '' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
		expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
			secondaryTimezone: '',
		})
		expect(screen.getByText('Password changes are disabled by your administrator.')).toBeInTheDocument()
	})

	it('validates confirmation and submits an enabled password change', async () => {
		renderSettings(true)
		fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
		fireEvent.change(screen.getByLabelText('Confirm new password'), {
			target: { value: 'different-password' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
		expect(await screen.findByRole('status')).toHaveTextContent('The passwords do not match.')
		expect(resetMailboxPassword).not.toHaveBeenCalled()

		fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } })
		fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
		await waitFor(() => expect(resetMailboxPassword).toHaveBeenCalledWith({ data: { password } }))
		expect(screen.getByRole('status')).toHaveTextContent('Password updated.')
		expect(screen.getByLabelText('New password')).toHaveValue('')
	})

	it('keeps password failures generic', async () => {
		resetMailboxPassword.mockRejectedValue(new Error('provider detail'))
		renderSettings(true)
		fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
		fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } })
		fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
		expect(await screen.findByRole('status')).toHaveTextContent(
			'We could not update your password. Check the requirements and try again.',
		)
	})
})
