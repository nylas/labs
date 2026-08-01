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
const updateMailboxDisplayName = vi.fn()
vi.mock('#server/fns', () => ({
	getAccountCapabilities: () => getAccountCapabilities(),
	getMailboxInfo: () => getMailboxInfo(),
	resetMailboxPassword: (input: unknown) => resetMailboxPassword(input),
	updateMailboxDisplayName: (input: unknown) => updateMailboxDisplayName(input),
}))

vi.mock('#app/components/AppRail', () => ({
	AppRailLogo: ({ appName }: { appName: string }) => <div>{appName}</div>,
	AppRailNav: () => <nav aria-label="App navigation" />,
	AppRailMobileNav: ({ onNavigate }: { onNavigate: () => void }) => (
		<button type="button" onClick={onNavigate}>
			close-mobile-navigation
		</button>
	),
}))

vi.mock('#shared/components/Sheet', () => ({
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

function renderSettings(
	passwordResetEnabled = false,
	loaderInfo: { email: string; displayName?: string; appName: string } = info,
) {
	Route.useLoaderData = vi.fn(() => ({ info: loaderInfo, capabilities: { passwordResetEnabled } }))
	const Component = Route.options.component
	return render(<Component />)
}

beforeEach(() => {
	vi.clearAllMocks()
	window.localStorage.clear()
	getMailboxInfo.mockResolvedValue(info)
	getAccountCapabilities.mockResolvedValue({ passwordResetEnabled: false })
	resetMailboxPassword.mockResolvedValue({ ok: true })
	updateMailboxDisplayName.mockImplementation(async ({ data }) => ({
		displayName: data.displayName.trim(),
	}))
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

	it('starts with an empty required name when the account has no persisted name', () => {
		renderSettings(false, { email: 'ada@example.com', appName: 'OwnMail' })

		expect(screen.getByLabelText('Display name')).toHaveValue('')
		expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
	})

	it('shows the running OwnMail version', () => {
		renderSettings()

		expect(screen.getByText(/^OwnMail v[0-9A-Za-z][0-9A-Za-z.-]*$/)).toBeInTheDocument()
	})

	it('places sign out last in settings as a destructive POST action', () => {
		renderSettings()

		const headings = screen.getAllByRole('heading', { level: 2 })
		expect(headings.at(-1)).toHaveTextContent('Sign out')
		const signOut = screen.getByRole('button', { name: 'Sign out' })
		expect(signOut).toHaveAttribute('type', 'submit')
		expect(signOut).toHaveClass('bg-destructive')
		expect(signOut.closest('form')).toHaveAttribute('action', '/logout')
		expect(signOut.closest('form')).toHaveAttribute('method', 'post')
	})

	it('persists the account name before saving device preferences', async () => {
		renderSettings()
		expect(screen.getByLabelText('Darken email content automatically')).toBeChecked()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' Ada Lovelace ' } })
		fireEvent.click(screen.getByLabelText('Save recipients to contacts automatically'))
		fireEvent.click(screen.getByLabelText('Darken email content automatically'))
		const [primaryTimezone, secondaryTimezone] = screen.getAllByRole('combobox')
		fireEvent.change(primaryTimezone, { target: { value: 'UTC' } })
		fireEvent.change(secondaryTimezone, { target: { value: 'America/Toronto' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

		expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
		expect(updateMailboxDisplayName).toHaveBeenCalledWith({ data: { displayName: ' Ada Lovelace ' } })
		expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toEqual({
			displayName: 'Ada Lovelace',
			autoSaveContacts: false,
			emailDarkMode: false,
			primaryTimezone: 'UTC',
			secondaryTimezone: 'America/Toronto',
		})
		const invalidTimezone = new Option('Invalid', 'not/a-timezone')
		primaryTimezone.append(invalidTimezone)
		fireEvent.change(primaryTimezone, { target: { value: 'not/a-timezone' } })
		fireEvent.change(secondaryTimezone, { target: { value: '' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
		await waitFor(() =>
			expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
				primaryTimezone: 'UTC',
				secondaryTimezone: '',
			}),
		)
		expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1)
		expect(screen.getByText('Password changes are disabled by your administrator.')).toBeInTheDocument()
	})

	it('does not adopt an account name when the server mutation fails', async () => {
		updateMailboxDisplayName.mockRejectedValue(new Error('upstream detail'))
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Changed' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

		expect(await screen.findByRole('status')).toHaveTextContent(
			'We could not save your settings. Check the display name and try again.',
		)
		expect(window.localStorage.getItem('ownmail:user-preferences:v1')).toBeNull()
		expect(screen.getByLabelText('Display name')).toHaveValue('Changed')
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
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
		await waitFor(() => expect(resetMailboxPassword).toHaveBeenCalledWith({ data: { password } }))
		expect(screen.getByRole('status')).toHaveTextContent('Password updated.')
		expect(screen.getByLabelText('New password')).toHaveValue('')
		fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
		fireEvent.change(screen.getByLabelText('New password'), { target: { value: `${password}!` } })
		expect(screen.queryByRole('status')).not.toBeInTheDocument()
	})

	it.each(['success', 'failure'] as const)(
		'ignores stale %s feedback when password fields change during the request',
		async (outcome) => {
			let resolveReset: (value: { ok: true }) => void = () => {}
			let rejectReset: (reason: Error) => void = () => {}
			resetMailboxPassword.mockReturnValue(
				new Promise((resolve, reject) => {
					resolveReset = resolve
					rejectReset = reject
				}),
			)
			renderSettings(true)
			const newPassword = screen.getByLabelText('New password')
			const confirmPassword = screen.getByLabelText('Confirm new password')
			fireEvent.change(newPassword, { target: { value: password } })
			fireEvent.change(confirmPassword, { target: { value: password } })
			fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
			await waitFor(() => expect(resetMailboxPassword).toHaveBeenCalledTimes(1))

			const revisedPassword = `${password}!`
			fireEvent.change(newPassword, { target: { value: revisedPassword } })
			fireEvent.change(confirmPassword, { target: { value: revisedPassword } })
			if (outcome === 'success') resolveReset({ ok: true })
			else rejectReset(new Error('provider detail'))

			await waitFor(() => expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled())
			expect(newPassword).toHaveValue(revisedPassword)
			expect(confirmPassword).toHaveValue(revisedPassword)
			expect(screen.queryByRole('status')).not.toBeInTheDocument()
		},
	)
})
