import { Link } from '@tanstack/react-router'
import { Calendar, LogOut, Mail, Moon, Plus, Search, Sun, Users } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { CALENDAR_HOME_PATH, CONTACTS_HOME_PATH, MAIL_HOME_PATH, SETTINGS_PATH } from './route-paths.js'
import {
	initialThemeIsDark,
	ROOT_BACKGROUND_CLASS,
	THEME_STORAGE_KEY,
	themeClassName,
	themeToggleLabel,
} from './theme.js'
import { APP_RAIL_WIDTH_CLASS, CHROME_ROW_CLASS, cn, initials } from './ui-model.js'
import { useUserPreferences } from './user-preferences.js'

export type MailboxAccountOption = {
	email: string
	handle: string
	active: boolean
}

type AppRailNavProps = {
	email: string
	displayName?: string
	accounts?: MailboxAccountOption[]
	active: 'mail' | 'calendar' | 'contacts' | 'settings'
	onOpenCommandPalette?: () => void
}

type AppRailMobileNavProps = AppRailNavProps & {
	onNavigate: () => void
}

function formatOrgLabel(appName: string): string {
	return appName
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

export function AppRailLogo({ appName, className }: { appName: string; className?: string }) {
	const orgLabel = formatOrgLabel(appName)
	const orgInitials = initials(appName)

	return (
		<Link
			to={MAIL_HOME_PATH}
			className={cn(
				'group flex shrink-0 items-center justify-center border-r border-border bg-background transition-colors hover:bg-muted/30',
				APP_RAIL_WIDTH_CLASS,
				CHROME_ROW_CLASS,
				className,
			)}
			aria-label={`${orgLabel} home`}
			title={orgLabel}
		>
			<div className="app-rail-org-mark" aria-hidden="true">
				<span className="app-rail-org-mark-inner">
					<span className="app-rail-org-initials">{orgInitials}</span>
				</span>
			</div>
		</Link>
	)
}

export function AppRailNav({
	email,
	displayName,
	accounts = [],
	active,
	onOpenCommandPalette,
}: AppRailNavProps) {
	const [isDark, setIsDark] = useState(false)
	const [mounted, setMounted] = useState(false)
	const [preferences] = useUserPreferences()

	useEffect(() => {
		const saved = localStorage.getItem(THEME_STORAGE_KEY)
		const nextDark = initialThemeIsDark(saved)
		applyThemeClass(nextDark)
		setIsDark(nextDark)
		setMounted(true)
	}, [])

	function toggleTheme() {
		const nextDark = !isDark
		applyThemeClass(nextDark)
		localStorage.setItem(THEME_STORAGE_KEY, nextDark ? 'dark' : 'light')
		setIsDark(nextDark)
	}

	const effectiveDisplayName = preferences.displayName || displayName
	const accountLabel = effectiveDisplayName ? `${effectiveDisplayName} · ${email}` : email

	return (
		<nav
			aria-label="Primary"
			className={cn(
				'app-rail hidden h-full shrink-0 flex-col border-r border-border bg-background md:flex',
				APP_RAIL_WIDTH_CLASS,
			)}
		>
			<div className="flex flex-col items-center gap-0.5 px-2 pt-3">
				<RailLink to={MAIL_HOME_PATH} label="Mail" isActive={active === 'mail'} ariaLabel="Mail">
					<Mail className="h-[18px] w-[18px]" strokeWidth={active === 'mail' ? 2.25 : 1.75} />
				</RailLink>
				<RailLink
					to={CALENDAR_HOME_PATH}
					label="Calendar"
					isActive={active === 'calendar'}
					ariaLabel="Calendar"
				>
					<Calendar className="h-[18px] w-[18px]" strokeWidth={active === 'calendar' ? 2.25 : 1.75} />
				</RailLink>
				<RailLink
					to={CONTACTS_HOME_PATH}
					label="Contacts"
					isActive={active === 'contacts'}
					ariaLabel="Contacts"
				>
					<Users className="h-[18px] w-[18px]" strokeWidth={active === 'contacts' ? 2.25 : 1.75} />
				</RailLink>
			</div>

			<div className="mt-auto flex flex-col items-center gap-0.5 px-2 pb-3 pt-2">
				<div className="app-rail-divider" aria-hidden="true" />
				{accounts.length > 1 ? <AccountSwitcher accounts={accounts} compact /> : null}
				<a
					href="/auth"
					className="app-rail-item app-rail-item-utility"
					aria-label="Add inbox"
					title="Add inbox"
				>
					<Plus className="h-[17px] w-[17px]" />
				</a>
				<RailButton onClick={toggleTheme} ariaLabel={themeToggleLabel(mounted, isDark)}>
					{mounted && isDark ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
				</RailButton>
				<RailButton onClick={onOpenCommandPalette} ariaLabel="Open command palette" title="⌘K">
					<Search className="h-[17px] w-[17px]" />
				</RailButton>
				<form action="/logout" method="post" className="contents">
					<RailButton type="submit" ariaLabel="Sign out">
						<LogOut className="h-[17px] w-[17px]" />
					</RailButton>
				</form>
				<Link
					to={SETTINGS_PATH}
					className={cn(
						'app-rail-account mt-1',
						active === 'settings' && 'ring-2 ring-primary ring-offset-2',
					)}
					title={`Account settings · ${accountLabel}`}
					aria-label={`Account settings for ${accountLabel}`}
					aria-current={active === 'settings' ? 'page' : undefined}
				>
					<span className="app-rail-account-inner">
						<span className="app-rail-account-initials">{initials(effectiveDisplayName ?? email)}</span>
					</span>
				</Link>
			</div>
		</nav>
	)
}

/**
 * The mobile counterpart to the persistent desktop rail. It is intended for a
 * temporary navigation sheet, so it uses labelled, touch-sized rows instead of
 * reserving a narrow column in the app viewport.
 */
export function AppRailMobileNav({
	email,
	displayName,
	accounts = [],
	active,
	onOpenCommandPalette,
	onNavigate,
}: AppRailMobileNavProps) {
	const [isDark, setIsDark] = useState(false)
	const [mounted, setMounted] = useState(false)
	const [preferences] = useUserPreferences()

	useEffect(() => {
		const saved = localStorage.getItem(THEME_STORAGE_KEY)
		const nextDark = initialThemeIsDark(saved)
		applyThemeClass(nextDark)
		setIsDark(nextDark)
		setMounted(true)
	}, [])

	function toggleTheme() {
		const nextDark = !isDark
		applyThemeClass(nextDark)
		localStorage.setItem(THEME_STORAGE_KEY, nextDark ? 'dark' : 'light')
		setIsDark(nextDark)
	}

	const effectiveDisplayName = preferences.displayName || displayName
	const accountLabel = effectiveDisplayName ? `${effectiveDisplayName} · ${email}` : email

	return (
		<nav aria-label="Primary" className="flex shrink-0 flex-col py-2">
			<div className="space-y-1 px-2">
				<MobileNavLink to={MAIL_HOME_PATH} label="Mail" isActive={active === 'mail'} onNavigate={onNavigate}>
					<Mail className="h-5 w-5" aria-hidden="true" />
				</MobileNavLink>
				<MobileNavLink
					to={CALENDAR_HOME_PATH}
					label="Calendar"
					isActive={active === 'calendar'}
					onNavigate={onNavigate}
				>
					<Calendar className="h-5 w-5" aria-hidden="true" />
				</MobileNavLink>
				<MobileNavLink
					to={CONTACTS_HOME_PATH}
					label="Contacts"
					isActive={active === 'contacts'}
					onNavigate={onNavigate}
				>
					<Users className="h-5 w-5" aria-hidden="true" />
				</MobileNavLink>
			</div>

			<div className="mt-3 space-y-1 border-t border-border px-2 pt-3">
				{accounts.length > 1 ? <AccountSwitcher accounts={accounts} onNavigate={onNavigate} /> : null}
				<a
					href="/auth"
					onClick={onNavigate}
					className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Plus className="h-5 w-5" aria-hidden="true" />
					<span>Add inbox</span>
				</a>
				<MobileNavButton
					label={themeToggleLabel(mounted, isDark)}
					onClick={toggleTheme}
					icon={mounted && isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
				/>
				<MobileNavButton
					label="Open command palette"
					onClick={() => {
						onNavigate()
						onOpenCommandPalette?.()
					}}
					icon={<Search className="h-5 w-5" />}
				/>
				<form action="/logout" method="post">
					<MobileNavButton label="Sign out" type="submit" icon={<LogOut className="h-5 w-5" />} />
				</form>
				<Link
					to={SETTINGS_PATH}
					onClick={onNavigate}
					aria-label={`Account settings for ${accountLabel}`}
					aria-current={active === 'settings' ? 'page' : undefined}
					className={cn(
						'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-muted',
						active === 'settings' && 'bg-muted text-foreground',
					)}
				>
					<span className="app-rail-account-inner shrink-0" aria-hidden="true">
						<span className="app-rail-account-initials">{initials(effectiveDisplayName ?? email)}</span>
					</span>
					<span className="truncate">Account settings</span>
					<span className="sr-only"> for {accountLabel}</span>
				</Link>
			</div>
		</nav>
	)
}

function AccountSwitcher({
	accounts,
	compact = false,
	onNavigate,
}: {
	accounts: MailboxAccountOption[]
	compact?: boolean
	onNavigate?: () => void
}) {
	const active = accounts.find((account) => account.active)
	if (!active) return null
	return (
		<form action="/auth" method="post" className={compact ? 'contents' : 'px-1'}>
			<label className={compact ? 'block' : 'block text-xs font-medium text-muted-foreground'}>
				{compact ? <span className="sr-only">Switch inbox</span> : <span className="px-2">Inbox</span>}
				<select
					name="account"
					aria-label="Switch inbox"
					value={active.handle}
					title={`Current inbox: ${active.email}`}
					onChange={(event) => {
						onNavigate?.()
						event.currentTarget.form?.requestSubmit()
					}}
					className={cn(
						'cursor-pointer rounded-md border border-border bg-card outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
						compact
							? 'mt-0.5 h-9 w-11 px-1 text-[10px] font-semibold'
							: 'mt-1 h-10 w-full px-2 text-sm text-foreground',
					)}
				>
					{accounts.map((account) => (
						<option key={account.handle} value={account.handle}>
							{account.email}
						</option>
					))}
				</select>
			</label>
		</form>
	)
}

function RailLink({
	to,
	label,
	isActive,
	ariaLabel,
	children,
}: {
	to: string
	label: string
	isActive: boolean
	ariaLabel: string
	children: ReactNode
}) {
	return (
		<Link
			to={to}
			aria-label={ariaLabel}
			aria-current={isActive ? 'page' : undefined}
			title={label}
			className={cn('app-rail-item', isActive && 'app-rail-item-active')}
		>
			{isActive ? <span className="app-rail-item-indicator" aria-hidden="true" /> : null}
			{children}
		</Link>
	)
}

function RailButton({
	children,
	ariaLabel,
	title,
	onClick,
	type = 'button',
}: {
	children: ReactNode
	ariaLabel: string
	title?: string
	onClick?: () => void
	type?: 'button' | 'submit'
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			className="app-rail-item app-rail-item-utility"
			aria-label={ariaLabel}
			title={title}
		>
			{children}
		</button>
	)
}

function MobileNavLink({
	to,
	label,
	isActive,
	onNavigate,
	children,
}: {
	to: string
	label: string
	isActive: boolean
	onNavigate: () => void
	children: ReactNode
}) {
	return (
		<Link
			to={to}
			onClick={onNavigate}
			aria-current={isActive ? 'page' : undefined}
			className={cn(
				'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
				isActive && 'bg-muted text-foreground',
			)}
		>
			{children}
			<span>{label}</span>
		</Link>
	)
}

function MobileNavButton({
	label,
	icon,
	onClick,
	type = 'button',
}: {
	label: string
	icon: ReactNode
	onClick?: () => void
	type?: 'button' | 'submit'
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			<span aria-hidden="true">{icon}</span>
			<span>{label}</span>
		</button>
	)
}

function applyThemeClass(isDark: boolean): void {
	const next = themeClassName(isDark)
	const previous = isDark ? 'light' : 'dark'
	document.documentElement.classList.add(ROOT_BACKGROUND_CLASS, next)
	document.documentElement.classList.remove(previous)
}
