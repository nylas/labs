import { createFileRoute } from '@tanstack/react-router'
import { Check, KeyRound, Menu, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav } from '../components/AppRail.js'
import { Sheet } from '../components/Sheet.js'
import { Button } from '../components/ui/button.js'
import { CHROME_ROW_CLASS, CHROME_ROW_SHELL_CLASS, cn } from '../components/ui-model.js'
import {
	availableTimezones,
	isSupportedTimezone,
	type UserPreferences,
	useUserPreferences,
} from '../components/user-preferences.js'
import {
	getAccountCapabilities,
	getMailboxInfo,
	resetMailboxPassword,
	updateMailboxDisplayName,
} from '../server/fns.js'

export const Route = createFileRoute('/settings')({
	loader: async () => {
		const [info, capabilities] = await Promise.all([getMailboxInfo(), getAccountCapabilities()])
		return { info, capabilities }
	},
	component: SettingsPage,
})

function SettingsPage() {
	const { info, capabilities } = Route.useLoaderData()
	const [preferences, savePreferences] = useUserPreferences()
	const [draft, setDraft] = useState<UserPreferences>(preferences)
	const [displayName, setDisplayName] = useState(info.displayName ?? '')
	const [persistedDisplayName, setPersistedDisplayName] = useState(info.displayName ?? '')
	const [saveStatus, setSaveStatus] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [password, setPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
	const [resettingPassword, setResettingPassword] = useState(false)
	const [navigationOpen, setNavigationOpen] = useState(false)
	const timezones = useMemo(availableTimezones, [])

	useEffect(() => setDraft(preferences), [preferences])

	function update(next: Partial<UserPreferences>) {
		setDraft((current) => ({ ...current, ...next }))
		setSaveStatus(null)
	}

	async function save() {
		setSaveStatus(null)
		setSaving(true)
		const primaryTimezone = isSupportedTimezone(draft.primaryTimezone)
			? draft.primaryTimezone
			: preferences.primaryTimezone
		const secondaryTimezone =
			draft.secondaryTimezone &&
			isSupportedTimezone(draft.secondaryTimezone) &&
			draft.secondaryTimezone !== primaryTimezone
				? draft.secondaryTimezone
				: ''
		try {
			const normalizedDisplayName = displayName.trim()
			const account =
				normalizedDisplayName === persistedDisplayName
					? { displayName: persistedDisplayName }
					: await updateMailboxDisplayName({ data: { displayName } })
			savePreferences({
				...draft,
				displayName: account.displayName,
				primaryTimezone,
				secondaryTimezone,
			})
			setDisplayName(account.displayName)
			setPersistedDisplayName(account.displayName)
			setSaveStatus('Settings saved.')
		} catch {
			setSaveStatus('We could not save your settings. Check the display name and try again.')
		} finally {
			setSaving(false)
		}
	}

	async function changePassword(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setPasswordStatus(null)
		if (password !== confirmPassword) {
			setPasswordStatus('The passwords do not match.')
			return
		}
		setResettingPassword(true)
		try {
			await resetMailboxPassword({ data: { password } })
			setPassword('')
			setConfirmPassword('')
			setPasswordStatus('Password updated.')
		} catch {
			setPasswordStatus('We could not update your password. Check the requirements and try again.')
		} finally {
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
									setDisplayName(event.target.value)
									setSaveStatus(null)
								}}
								minLength={1}
								maxLength={120}
								autoComplete="name"
								required
								className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
							/>
						</section>

						<section className="border-t border-border pt-6">
							<div className="flex items-center gap-2">
								<SettingsIcon className="h-5 w-5 text-muted-foreground" />
								<h2 className="font-display text-lg font-semibold">Compose and time</h2>
							</div>
							<label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
								<input
									type="checkbox"
									aria-label="Save recipients to contacts automatically"
									checked={draft.autoSaveContacts}
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
									onChange={(primaryTimezone) => update({ primaryTimezone })}
									timezones={timezones}
									preview={preview(draft.primaryTimezone)}
								/>
								<TimezoneField
									id="settings-secondary-timezone"
									label="Secondary timezone"
									value={draft.secondaryTimezone}
									onChange={(secondaryTimezone) => update({ secondaryTimezone })}
									timezones={timezones}
									preview={draft.secondaryTimezone ? preview(draft.secondaryTimezone) : 'Not shown'}
									includeNone
								/>
							</div>
							<div className="mt-5 flex items-center gap-3">
								<Button type="button" onClick={save} disabled={saving || !displayName.trim()}>
									<Check className="h-4 w-4" />
									{saving ? 'Saving…' : 'Save settings'}
								</Button>
								{saveStatus ? (
									<span className="text-sm text-muted-foreground" role="status">
										{saveStatus}
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
										onChange={setPassword}
									/>
									<PasswordField
										id="settings-confirm-password"
										label="Confirm new password"
										value={confirmPassword}
										onChange={setConfirmPassword}
									/>
									<div className="flex items-center gap-3">
										<Button type="submit" disabled={resettingPassword || !password || !confirmPassword}>
											{resettingPassword ? 'Updating…' : 'Update password'}
										</Button>
										{passwordStatus ? (
											<span className="text-sm text-muted-foreground" role="status">
												{passwordStatus}
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
	onChange,
	timezones,
	preview,
	includeNone = false,
}: {
	id: string
	label: string
	value: string
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
				onChange={(event) => onChange(event.target.value)}
				className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
	onChange,
}: {
	id: string
	label: string
	value: string
	onChange: (value: string) => void
}) {
	return (
		<label className="block text-sm font-medium" htmlFor={id}>
			{label}
			<input
				id={id}
				type="password"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				minLength={18}
				maxLength={40}
				autoComplete="new-password"
				required
				className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
			/>
		</label>
	)
}
