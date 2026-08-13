// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { Route } from './settings.js'

const info = { email: 'ada@example.com', displayName: 'Ada', appName: 'OwnMail' }
const password = 'StrongPassword123!More'

function renderSettings(
	passwordResetEnabled = false,
	loaderInfo: { email: string; displayName?: string; appName: string } = info,
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
	Route.useLoaderData = vi.fn(() => ({ info: loaderInfo, capabilities: { passwordResetEnabled } }))
	const Component = Route.options.component
	return render(
		<QueryClientProvider client={queryClient}>
			<Component />
		</QueryClientProvider>,
	)
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

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

describe('/settings', () => {
	it('loads account information and the server-owned password capability', async () => {
		await expect(Route.options.loader()).resolves.toEqual({
			info,
			capabilities: { passwordResetEnabled: false },
		})
	})

	it('opens the app navigation as a temporary sheet', () => {
		renderSettings()
		const navigationButton = screen.getByRole('button', { name: 'Open navigation' })
		expect(navigationButton).toHaveClass('h-11', 'w-11', 'rounded-lg', 'disabled:pointer-events-none')
		expect(navigationButton).not.toHaveClass('border-r')
		expect(screen.getByRole('heading', { name: 'Settings' }).parentElement).toHaveClass('gap-2', 'px-3')

		fireEvent.click(navigationButton)
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
		expect(screen.getByRole('button', { name: 'Save settings' })).toHaveAttribute('aria-disabled', 'true')
	})

	it('does not save when settings have no meaningful changes', () => {
		renderSettings()
		const save = screen.getByRole('button', { name: 'Save settings' })
		expect(save).toHaveAttribute('aria-disabled', 'true')

		fireEvent.click(save)

		expect(updateMailboxDisplayName).not.toHaveBeenCalled()
		expect(window.localStorage.getItem('ownmail:user-preferences:v1')).toBeNull()
	})

	it('gives every editable text and select field a touch-friendly height', () => {
		renderSettings(true)

		const fixedHeightFields = [
			screen.getByLabelText('Display name'),
			screen.getByRole('combobox', { name: /Primary timezone/ }),
			screen.getByRole('combobox', { name: /Secondary timezone/ }),
		]
		for (const field of fixedHeightFields) {
			expect(field).toHaveClass('h-11')
			expect(field).not.toHaveClass('h-9')
		}
		for (const field of [
			screen.getByLabelText('New password'),
			screen.getByLabelText('Confirm new password'),
		]) {
			expect(field).toHaveClass('min-h-11')
			expect(field).not.toHaveClass('h-9')
		}
	})

	it('accepts a later display-name save when preference storage is unavailable', async () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage unavailable')
		})
		renderSettings()
		fireEvent.click(screen.getByLabelText('Darken email content automatically'))
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.')
		expect(screen.getByLabelText('Darken email content automatically')).not.toBeChecked()
		expect(window.localStorage.getItem('ownmail:user-preferences:v1')).toBeNull()

		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Grace' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.')
		expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1)
		expect(updateMailboxDisplayName).toHaveBeenCalledWith({ data: { displayName: 'Grace' } })
		expect(screen.getByLabelText('Display name')).toHaveValue('Grace')
		setItem.mockRestore()
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
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		queryClient.setQueryData(mailboxInfoQueryOptions().queryKey, info)
		renderSettings(false, info, queryClient)
		expect(screen.getByLabelText('Darken email content automatically')).toBeChecked()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: ' Ada Lovelace ' } })
		fireEvent.click(screen.getByLabelText('Save recipients to contacts automatically'))
		fireEvent.click(screen.getByLabelText('Darken email content automatically'))
		const [primaryTimezone, secondaryTimezone] = screen.getAllByRole('combobox')
		fireEvent.change(primaryTimezone, { target: { value: 'UTC' } })
		fireEvent.change(secondaryTimezone, { target: { value: 'America/Toronto' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

		expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
		expect(updateMailboxDisplayName).toHaveBeenCalledWith({ data: { displayName: 'Ada Lovelace' } })
		expect(queryClient.getQueryData(mailboxInfoQueryOptions().queryKey)).toMatchObject({
			email: 'ada@example.com',
			displayName: 'Ada Lovelace',
			appName: 'OwnMail',
		})
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

	it('keeps the saved timezone when the selected zone cannot be resolved', async () => {
		// A stored zone can be dropped from the tz database, and the value can be edited by
		// hand or by a browser autofill heuristic. Neither may blank out the clock preview
		// nor be written back to preferences, or the settings page becomes unusable.
		renderSettings()
		const savedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
		const [primaryTimezone] = screen.getAllByRole('combobox')
		expect(primaryTimezone).toHaveValue(savedTimezone)

		primaryTimezone.append(new Option('Stale zone', 'Mars/Olympus_Mons'))
		fireEvent.change(primaryTimezone, { target: { value: 'Mars/Olympus_Mons' } })
		// Guard: without this the fallback below could silently never run.
		expect(primaryTimezone).toHaveValue('Mars/Olympus_Mons')
		// The preview keeps showing a real clock (rendered from the saved zone) instead of
		// throwing out of render.
		expect(primaryTimezone.parentElement?.lastElementChild).toHaveTextContent(/\d{1,2}:\d{2}/)

		// Edit a real field too: the unresolvable zone alone normalizes back to the saved
		// value, so on its own it is not a change and the save short-circuits. Pairing it
		// with a genuine edit forces the save to run and persist the normalized zone.
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada Lovelace' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
		await waitFor(() =>
			expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
				primaryTimezone: savedTimezone,
			}),
		)
		// The unresolvable zone never reaches storage, so a later load still finds a usable zone.
		expect(window.localStorage.getItem('ownmail:user-preferences:v1')).not.toContain('Mars/Olympus_Mons')
		expect(primaryTimezone.parentElement?.lastElementChild).toHaveTextContent(/\d{1,2}:\d{2}/)
	})

	it('does not adopt an account name when the server mutation fails', async () => {
		updateMailboxDisplayName.mockRejectedValue(new Error('upstream detail'))
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Changed' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'We could not save your settings. Check the display name and try again.',
		)
		expect(window.localStorage.getItem('ownmail:user-preferences:v1')).toBeNull()
		expect(screen.getByLabelText('Display name')).toHaveValue('Changed')
	})

	it('keeps settings saves single-flight, focus-safe, and locked while pending', async () => {
		let resolveSave: (value: { displayName: string }) => void = () => {}
		updateMailboxDisplayName.mockReturnValue(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada B.' } })
		const save = screen.getByRole('button', { name: 'Save settings' })
		save.focus()

		fireEvent.click(save)
		fireEvent.click(save)

		expect(await screen.findByRole('button', { name: 'Saving…' })).toBe(save)
		expect(save).toHaveFocus()
		expect(save).toHaveAttribute('aria-busy', 'true')
		expect(save).toHaveClass('min-h-11')
		expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1)
		expect(screen.getByLabelText('Display name')).toBeDisabled()
		expect(screen.getByLabelText('Darken email content automatically')).toBeDisabled()
		expect(screen.getByLabelText('Save recipients to contacts automatically')).toBeDisabled()
		for (const timezone of screen.getAllByRole('combobox')) expect(timezone).toBeDisabled()

		resolveSave({ displayName: 'Ada B.' })
		expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.')
		expect(save).toHaveFocus()
		expect(save).not.toHaveAttribute('aria-busy')
	})

	it('keeps a pending settings save active across unrelated storage changes', async () => {
		let resolveSave: (value: { displayName: string }) => void = () => {}
		updateMailboxDisplayName.mockReturnValue(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada B.' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
		await waitFor(() => expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1))

		act(() => {
			window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }))
		})
		resolveSave({ displayName: 'Ada B.' })

		expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.')
		expect(screen.getByLabelText('Display name')).toHaveValue('Ada B.')
		expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1)
	})

	it('treats another tab clearing storage as an external settings revision', async () => {
		// `localStorage.clear()` emits a storage event with a null key and wipes the preferences entry,
		// so the pending save is working from preferences that no longer exist and must be discarded.
		let resolveSave: (value: { displayName: string }) => void = () => {}
		updateMailboxDisplayName.mockReturnValue(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada B.' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
		await waitFor(() => expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1))

		act(() => {
			window.localStorage.clear()
			window.dispatchEvent(new StorageEvent('storage', { key: null }))
		})
		resolveSave({ displayName: 'Ada B.' })

		await waitFor(() =>
			expect(screen.getByRole('button', { name: 'Save settings' })).not.toHaveAttribute('aria-busy'),
		)
		expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument()
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('keeps a failed settings revision available for retry', async () => {
		updateMailboxDisplayName
			.mockRejectedValueOnce(new Error('private provider detail'))
			.mockResolvedValueOnce({ displayName: 'Grace' })
		renderSettings()
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Grace' } })
		const save = screen.getByRole('button', { name: 'Save settings' })
		fireEvent.click(save)

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'We could not save your settings. Check the display name and try again.',
		)
		expect(save).toHaveAttribute('aria-disabled', 'false')
		expect(screen.getByLabelText('Display name')).toHaveValue('Grace')

		fireEvent.click(save)
		expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.')
		expect(updateMailboxDisplayName).toHaveBeenCalledTimes(2)
	})

	it.each(['success', 'failure'] as const)(
		'ignores a stale settings %s after external preferences replace the revision',
		async (outcome) => {
			let resolveSave: (value: { displayName: string }) => void = () => {}
			let rejectSave: (reason: Error) => void = () => {}
			updateMailboxDisplayName.mockReturnValue(
				new Promise((resolve, reject) => {
					resolveSave = resolve
					rejectSave = reject
				}),
			)
			renderSettings()
			fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada B.' } })
			fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
			await waitFor(() => expect(updateMailboxDisplayName).toHaveBeenCalledTimes(1))

			window.localStorage.setItem(
				'ownmail:user-preferences:v1',
				JSON.stringify({
					displayName: 'External',
					autoSaveContacts: false,
					emailDarkMode: false,
					primaryTimezone: 'UTC',
					secondaryTimezone: '',
				}),
			)
			window.dispatchEvent(new StorageEvent('storage', { key: 'ownmail:user-preferences:v1' }))
			if (outcome === 'success') resolveSave({ displayName: 'Ada B.' })
			else rejectSave(new Error('private provider detail'))
			await waitFor(() =>
				expect(screen.getByRole('button', { name: 'Save settings' })).not.toHaveAttribute('aria-busy'),
			)

			await waitFor(() =>
				expect(screen.getByLabelText('Darken email content automatically')).not.toBeChecked(),
			)
			expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument()
			expect(screen.queryByRole('alert')).not.toBeInTheDocument()
			expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
				displayName: 'External',
				autoSaveContacts: false,
				emailDarkMode: false,
			})
		},
	)

	it('validates confirmation and submits an enabled password change', async () => {
		renderSettings(true)
		expect(screen.getByRole('button', { name: 'Update password' })).toHaveAttribute('aria-disabled', 'true')
		fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
		fireEvent.change(screen.getByLabelText('Confirm new password'), {
			target: { value: 'different-password' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
		expect(resetMailboxPassword).not.toHaveBeenCalled()

		fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'We could not update your password. Check the requirements and try again.',
		)
		fireEvent.change(screen.getByLabelText('New password'), { target: { value: `${password}!` } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('keeps password updates single-flight, focus-safe, and locked while pending', async () => {
		let resolveReset: (value: { ok: true }) => void = () => {}
		resetMailboxPassword.mockReturnValue(
			new Promise((resolve) => {
				resolveReset = resolve
			}),
		)
		renderSettings(true)
		const newPassword = screen.getByLabelText('New password')
		const confirmPassword = screen.getByLabelText('Confirm new password')
		fireEvent.change(newPassword, { target: { value: password } })
		fireEvent.change(confirmPassword, { target: { value: password } })
		const update = screen.getByRole('button', { name: 'Update password' })
		update.focus()

		fireEvent.click(update)
		fireEvent.submit(update.closest('form') as HTMLFormElement)

		expect(await screen.findByRole('button', { name: 'Updating…' })).toBe(update)
		expect(update).toHaveFocus()
		expect(update).toHaveAttribute('aria-busy', 'true')
		expect(update).toHaveClass('min-h-11')
		expect(resetMailboxPassword).toHaveBeenCalledTimes(1)
		expect(newPassword).toBeDisabled()
		expect(confirmPassword).toBeDisabled()

		resolveReset({ ok: true })
		expect(await screen.findByRole('status')).toHaveTextContent('Password updated.')
		expect(update).toHaveFocus()
		expect(update).not.toHaveAttribute('aria-busy')
		expect(newPassword).toHaveValue('')
		expect(confirmPassword).toHaveValue('')
	})

	it('preserves a failed password update for an immediate retry', async () => {
		resetMailboxPassword
			.mockRejectedValueOnce(new Error('private provider detail'))
			.mockResolvedValueOnce({ ok: true })
		renderSettings(true)
		const newPassword = screen.getByLabelText('New password')
		const confirmPassword = screen.getByLabelText('Confirm new password')
		fireEvent.change(newPassword, { target: { value: password } })
		fireEvent.change(confirmPassword, { target: { value: password } })
		const update = screen.getByRole('button', { name: 'Update password' })

		fireEvent.click(update)
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'We could not update your password. Check the requirements and try again.',
		)
		expect(newPassword).toHaveValue(password)
		expect(confirmPassword).toHaveValue(password)
		expect(update).toHaveAttribute('aria-disabled', 'false')

		fireEvent.click(update)
		expect(await screen.findByRole('status')).toHaveTextContent('Password updated.')
		expect(resetMailboxPassword).toHaveBeenCalledTimes(2)
	})
})
