import { createFileRoute } from '@tanstack/react-router'
import { Check, KeyRound, LogOut, Menu, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav } from '#app/components/AppRail'
import { CHROME_ROW_CLASS, CHROME_ROW_SHELL_CLASS } from '#app/config/layout'
import {
	availableTimezones,
	isSupportedTimezone,
	USER_PREFERENCES_STORAGE_KEY,
	type UserPreferences,
	useUserPreferences,
} from '#app/preferences/user-preferences'
import {
	getAccountCapabilities,
	getMailboxInfo,
	resetMailboxPassword,
	updateMailboxDisplayName,
} from '#server/fns'
import { Sheet } from '#shared/components/Sheet'
import { Button } from '#shared/components/ui/button'
import { cn } from '#shared/lib/utils'
import { OWNMAIL_VERSION } from '#shared/lib/version'

export const Route = createFileRoute('/settings')({
	loader: async () => {
		const [info, capabilities] = await Promise.all([getMailboxInfo(), getAccountCapabilities()])
		return { info, capabilities }
	},
	component: SettingsPage,
})

type PasswordFeedback = { kind: 'success' | 'error'; message: string }
type SettingsFeedback = { kind: 'success' | 'error'; message: string }

function normalizeSettingsPreferences(
	displayName: string,
	draft: UserPreferences,
	fallbackPrimaryTimezone: string,
): UserPreferences {
	const primaryTimezone = isSupportedTimezone(draft.primaryTimezone)
		? draft.primaryTimezone
		: fallbackPrimaryTimezone
	const secondaryTimezone =
		draft.secondaryTimezone &&
		isSupportedTimezone(draft.secondaryTimezone) &&
		draft.secondaryTimezone !== primaryTimezone
			? draft.secondaryTimezone
			: ''
	return {
		...draft,
		displayName: displayName.trim(),
		primaryTimezone,
		secondaryTimezone,
	}
}

function preferencesMatch(left: UserPreferences, right: UserPreferences): boolean {
	return (
		left.displayName === right.displayName &&
		left.autoSaveContacts === right.autoSaveContacts &&
		left.emailDarkMode === right.emailDarkMode &&
		left.primaryTimezone === right.primaryTimezone &&
		left.secondaryTimezone === right.secondaryTimezone
	)
}

function SettingsPage() {
	const { info, capabilities } = Route.useLoaderData()
	const [preferences, savePreferences] = useUserPreferences()
	const [draft, setDraft] = useState<UserPreferences>(preferences)
	const [displayName, setDisplayName] = useState(info.displayName ?? '')
	const [persistedDisplayName, setPersistedDisplayName] = useState(info.displayName ?? '')
	const [saveStatus, setSaveStatus] = useState<SettingsFeedback | null>(null)
	const [saving, setSaving] = useState(false)
	const savePendingRef = useRef(false)
	const settingsRevisionRef = useRef(0)
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordStatus, setPasswordStatus] = useState<PasswordFeedback | null>(null)
	const [resettingPassword, setResettingPassword] = useState(false)
	const passwordPendingRef = useRef(false)
	const [navigationOpen, setNavigationOpen] = useState(false)
	const timezones = useMemo(availableTimezones, [])

	useEffect(() => {
		settingsRevisionRef.current += 1
		setDraft(preferences)
	}, [preferences])

	useEffect(() => {
		const invalidatePendingSave = (event: Event) => {
			if (event instanceof StorageEvent && event.key !== null && event.key !== USER_PREFERENCES_STORAGE_KEY)
				return
			settingsRevisionRef.current += 1
		}
		window.addEventListener('storage', invalidatePendingSave)
		window.addEventListener('ownmail:user-preferences', invalidatePendingSave)
		return () => {
			window.removeEventListener('storage', invalidatePendingSave)
			window.removeEventListener('ownmail:user-preferences', invalidatePendingSave)
		}
	}, [])

	const normalizedDraft = normalizeSettingsPreferences(displayName, draft, preferences.primaryTimezone)
	const persistedSettings = normalizeSettingsPreferences(
		persistedDisplayName,
		{ ...preferences, displayName: persistedDisplayName },
		preferences.primaryTimezone,
	)
	const hasSettingsChanges = !preferencesMatch(normalizedDraft, persistedSettings)

	function update(next: Partial<UserPreferences>) {
		/* v8 ignore next -- Disabled preference controls make this guard defense-in-depth. @preserve */
		if (savePendingRef.current) return
		settingsRevisionRef.current += 1
		setDraft((current) => ({ ...current, ...next }))
		setSaveStatus(null)
	}

	async function save() {
		if (savePendingRef.current || !normalizedDraft.displayName || !hasSettingsChanges) return
		savePendingRef.current = true
		const revision = settingsRevisionRef.current
		const snapshot = { ...normalizedDraft }
		setSaveStatus(null)
		setSaving(true)
		try {
			const account =
				snapshot.displayName === persistedDisplayName
					? { displayName: persistedDisplayName }
					: await updateMailboxDisplayName({ data: { displayName: snapshot.displayName } })
			if (settingsRevisionRef.current !== revision) return
			savePreferences({
				...snapshot,
				displayName: account.displayName,
			})
			setDisplayName(account.displayName)
			setPersistedDisplayName(account.displayName)
			setSaveStatus({ kind: 'success', message: 'Settings saved.' })
		} catch {
			if (settingsRevisionRef.current === revision) {
				setSaveStatus({
					kind: 'error',
					message: 'We could not save your settings. Check the display name and try again.',
				})
			}
		} finally {
			savePendingRef.current = false
			setSaving(false)
		}
	}

	async function changePassword(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (passwordPendingRef.current || !password || !confirmPassword) return
		setPasswordStatus(null)
		if (password !== confirmPassword) {
			setPasswordStatus({ kind: 'error', message: 'The passwords do not match.' })
			return
		}
		passwordPendingRef.current = true
		const passwordSnapshot = password
		setResettingPassword(true)
		try {
			await resetMailboxPassword({ data: { password: passwordSnapshot } })
			setPassword('')
			setConfirmPassword('')
			setPasswordStatus({ kind: 'success', message: 'Password updated.' })
		} catch {
			setPasswordStatus({
				kind: 'error',
				message: 'We could not update your password. Check the requirements and try again.',
			})
		} finally {
			passwordPendingRef.current = false
			setResettingPassword(false)
		}
	}

	const preview = (timezone: string) =>
		new Intl.DateTimeFormat(undefined, {
			timeZone: isSupportedTimezone(timezone) ? timezone : preferences.primaryTimezone,
			weekday: 'short',
			hour: 'numeric',
			minute: '2-digit',
		}).format(new Date())

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={CHROME_ROW_SHELL_CLASS}>
				<AppRailLogo appName={info.appName} className="hidden md:flex" />
				<header
					className={cn(
						'flex min-w-0 flex-1 items-center border-b border-border bg-background px-4',
						CHROME_ROW_CLASS,
					)}
				>
					<button
						type="button"
						onClick={() => setNavigationOpen(true)}
						className="flex h-11 w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:hidden"
						aria-label="Open navigation"
					>
						<Menu className="h-4 w-4" />
					</button>
					<h1 className="font-display text-base font-semibold">Settings</h1>
				</header>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppRailNav
					email={info.email}
					displayName={persistedDisplayName || info.displayName}
					accounts={info.accounts}
					active="settings"
				/>
				<main className="min-w-0 flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-2xl space-y-7 px-5 py-7 sm:px-8">
						<section>
							<div className="flex items-center gap-2">
								<UserRound className="h-5 w-5 text-muted-foreground" />
								<h2 className="font-display text-lg font-semibold">Profile</h2>
							</div>
							<p className="mt-1 text-sm text-muted-foreground">
								Set the account name shown in {info.appName} and on messages you send.
							</p>
							<label className="mt-4 block text-sm font-medium" htmlFor="settings-display-name">
								Display name
							</label>
							<input
								id="settings-display-name"
								value={displayName}
								onChange={(event) => {
									/* v8 ignore next -- A disabled input cannot emit a user change. @preserve */
									if (savePendingRef.current) return
									settingsRevisionRef.current += 1
									setDisplayName(event.target.value)
									setSaveStatus(null)
								}}
								disabled={saving}
								minLength={1}
								maxLength={120}
								autoComplete="name"
								required
								className="mt-1 h-11 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
							/>
						</section>

						<section className="border-t border-border pt-6">
							<div className="flex items-center gap-2">
								<SettingsIcon className="h-5 w-5 text-muted-foreground" />
								<h2 className="font-display text-lg font-semibold">Mail preferences</h2>
							</div>
							<label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
								<input
									type="checkbox"
									aria-label="Darken email content automatically"
									checked={draft.emailDarkMode}
									disabled={saving}
									onChange={(event) => update({ emailDarkMode: event.target.checked })}
									className="mt-0.5 h-4 w-4 accent-primary"
								/>
								<span>
									<span className="block text-sm font-medium">Darken email content automatically</span>
									<span className="mt-0.5 block text-sm text-muted-foreground">
										When OwnMail uses its dark theme, adapt email bodies that would otherwise stay light.
									</span>
								</span>
							</label>
							<label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
								<input
									type="checkbox"
									aria-label="Save recipients to contacts automatically"
									checked={draft.autoSaveContacts}
									disabled={saving}
									onChange={(event) => update({ autoSaveContacts: event.target.checked })}
									className="mt-0.5 h-4 w-4 accent-primary"
								/>
								<span>
									<span className="block text-sm font-medium">Save recipients to contacts automatically</span>
									<span className="mt-0.5 block text-sm text-muted-foreground">
										Recipients are saved after a message sends successfully.
									</span>
								</span>
							</label>
							<div className="mt-5 grid gap-4 sm:grid-cols-2">
								<TimezoneField
									id="settings-primary-timezone"
									label="Primary timezone"
									value={draft.primaryTimezone}
									disabled={saving}
									onChange={(primaryTimezone) => update({ primaryTimezone })}
									timezones={timezones}
									preview={preview(draft.primaryTimezone)}
								/>
								<TimezoneField
									id="settings-secondary-timezone"
									label="Secondary timezone"
									value={draft.secondaryTimezone}
									disabled={saving}
									onChange={(secondaryTimezone) => update({ secondaryTimezone })}
									timezones={timezones}
									preview={draft.secondaryTimezone ? preview(draft.secondaryTimezone) : 'Not shown'}
									includeNone
								/>
							</div>
							<div className="mt-5 flex items-center gap-3">
								<Button
									type="button"
									onClick={save}
									aria-disabled={saving || !normalizedDraft.displayName || !hasSettingsChanges}
									aria-busy={saving || undefined}
									className="min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50"
								>
									<Check className="h-4 w-4" />
									{saving ? 'Saving…' : 'Save settings'}
								</Button>
								{saveStatus ? (
									<span
										className={cn(
											'text-sm',
											saveStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
										)}
										role={saveStatus.kind === 'error' ? 'alert' : 'status'}
									>
										{saveStatus.message}
									</span>
								) : null}
							</div>
						</section>

						<section className="border-t border-border pt-6">
							<div className="flex items-center gap-2">
								<KeyRound className="h-5 w-5 text-muted-foreground" />
								<h2 className="font-display text-lg font-semibold">Password</h2>
							</div>
							{capabilities.passwordResetEnabled ? (
								<form className="mt-4 space-y-4" onSubmit={changePassword}>
									<p className="text-sm text-muted-foreground">
										Use 18–40 characters with uppercase, lowercase, a number, and a symbol. Changing it signs
										in new clients with the new password.
									</p>
									<PasswordField
										id="settings-password"
										label="New password"
										value={password}
										disabled={resettingPassword}
										onChange={(value) => {
											/* v8 ignore next -- A disabled password input cannot emit a user change. @preserve */
											if (passwordPendingRef.current) return
											setPassword(value)
											setPasswordStatus(null)
										}}
									/>
									<PasswordField
										id="settings-confirm-password"
										label="Confirm new password"
										value={confirmPassword}
										disabled={resettingPassword}
										onChange={(value) => {
											/* v8 ignore next -- A disabled password input cannot emit a user change. @preserve */
											if (passwordPendingRef.current) return
											setConfirmPassword(value)
											setPasswordStatus(null)
										}}
									/>
									<div className="flex items-center gap-3">
										<Button
											type="submit"
											aria-disabled={resettingPassword || !password || !confirmPassword}
											aria-busy={resettingPassword || undefined}
											className="min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50"
										>
											{resettingPassword ? 'Updating…' : 'Update password'}
										</Button>
										{passwordStatus ? (
											<span
												className={cn(
													'text-sm',
													passwordStatus.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
												)}
												role={passwordStatus.kind === 'error' ? 'alert' : 'status'}
											>
												{passwordStatus.message}
											</span>
										) : null}
									</div>
								</form>
							) : (
								<p className="mt-2 text-sm text-muted-foreground">
									Password changes are disabled by your administrator.
								</p>
							)}
						</section>

						<p className="border-t border-border pt-6 text-xs text-muted-foreground">
							OwnMail v{OWNMAIL_VERSION}
						</p>

						<section className="border-t border-border pt-6">
							<h2 className="font-display text-lg font-semibold">Sign out</h2>
							<p className="mt-1 text-sm text-muted-foreground">
								End your session on this device. Your connected inboxes and settings will be preserved.
							</p>
							<form action="/logout" method="post" className="mt-4">
								<Button type="submit" variant="destructive">
									<LogOut className="h-4 w-4" />
									Sign out
								</Button>
							</form>
						</section>
					</div>
				</main>
			</div>

			<Sheet open={navigationOpen} onClose={() => setNavigationOpen(false)} title="Navigation">
				<AppRailMobileNav
					email={info.email}
					displayName={persistedDisplayName || info.displayName}
					accounts={info.accounts}
					active="settings"
					onNavigate={() => setNavigationOpen(false)}
				/>
			</Sheet>
		</div>
	)
}

function TimezoneField({
	id,
	label,
	value,
	disabled,
	onChange,
	timezones,
	preview,
	includeNone = false,
}: {
	id: string
	label: string
	value: string
	disabled: boolean
	onChange: (value: string) => void
	timezones: string[]
	preview: string
	includeNone?: boolean
}) {
	return (
		<label className="block text-sm font-medium" htmlFor={id}>
			{label}
			<select
				id={id}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				className="mt-1 h-11 w-full rounded-md border border-border bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
			>
				{includeNone ? <option value="">None</option> : null}
				{timezones.map((timezone) => (
					<option key={timezone} value={timezone}>
						{timezone}
					</option>
				))}
			</select>
			<span className="mt-1 block text-xs font-normal text-muted-foreground">{preview}</span>
		</label>
	)
}

function PasswordField({
	id,
	label,
	value,
	disabled,
	onChange,
}: {
	id: string
	label: string
	value: string
	disabled: boolean
	onChange: (value: string) => void
}) {
	return (
		<label className="block text-sm font-medium" htmlFor={id}>
			{label}
			<input
				id={id}
				type="password"
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				minLength={18}
				maxLength={40}
				autoComplete="new-password"
				required
				className="mt-1 min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
			/>
		</label>
	)
}
