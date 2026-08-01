import { Link } from '@tanstack/react-router'
import { Calendar, Command, Mail, Moon, Plus, Sun, Users } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '#shared/components/ui/tooltip'
import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'
import { APP_RAIL_WIDTH_CLASS, CHROME_ROW_CLASS } from '../config/layout.js'
import {
	CALENDAR_HOME_PATH,
	CONTACTS_HOME_PATH,
	MAIL_HOME_PATH,
	SETTINGS_PATH,
} from '../config/route-paths.js'
import { themeToggleLabel, toggleTheme } from '../config/theme.js'
import { useThemeToggleState } from '../lib/use-theme-toggle-state.js'
import { useUserPreferences } from '../preferences/user-preferences.js'

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
	const { isDark, mounted } = useThemeToggleState()
	const [preferences] = useUserPreferences()

	const effectiveDisplayName = displayName || preferences.displayName
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
				{accounts.length > 1 ? <DesktopAccountSwitcher accounts={accounts} /> : null}
				<RailTooltip label="Add inbox">
					<a href="/auth" className="app-rail-item app-rail-item-utility" aria-label="Add inbox">
						<Plus className="h-[17px] w-[17px]" />
					</a>
				</RailTooltip>
				<RailButton onClick={toggleTheme} ariaLabel={themeToggleLabel(mounted, isDark)}>
					{mounted && isDark ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
				</RailButton>
				<RailButton onClick={onOpenCommandPalette} ariaLabel="Open command palette" shortcut="⌘K">
					<Command className="h-[17px] w-[17px]" />
				</RailButton>
				<RailTooltip label="Account settings">
					<Link
						to={SETTINGS_PATH}
						className={cn(
							'app-rail-account mt-1',
							active === 'settings' && 'ring-2 ring-primary ring-offset-2',
						)}
						aria-label={`Account settings for ${accountLabel}`}
						aria-current={active === 'settings' ? 'page' : undefined}
					>
						<span className="app-rail-account-inner">
							<span className="app-rail-account-initials">{initials(effectiveDisplayName || email)}</span>
						</span>
					</Link>
				</RailTooltip>
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
	const { isDark, mounted } = useThemeToggleState()
	const [preferences] = useUserPreferences()

	const effectiveDisplayName = displayName || preferences.displayName
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
					icon={<Command className="h-5 w-5" />}
				/>
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
						<span className="app-rail-account-initials">{initials(effectiveDisplayName || email)}</span>
					</span>
					<span className="truncate">Account settings</span>
					<span className="sr-only"> for {accountLabel}</span>
				</Link>
			</div>
		</nav>
	)
}

function DesktopAccountSwitcher({ accounts }: { accounts: MailboxAccountOption[] }) {
	const active = accounts.find((account) => account.active)
	const detailsRef = useRef<HTMLDetailsElement>(null)

	useEffect(() => {
		function closeOnExternalInteraction(event: Event) {
			const details = detailsRef.current
			if (details?.open && !details.contains(event.target as Node)) details.open = false
		}
		document.addEventListener('pointerdown', closeOnExternalInteraction)
		document.addEventListener('focusin', closeOnExternalInteraction)
		return () => {
			document.removeEventListener('pointerdown', closeOnExternalInteraction)
			document.removeEventListener('focusin', closeOnExternalInteraction)
		}
	}, [])

	if (!active) return null
	const localPart = active.email.split('@')[0] || active.email
	return (
		<details ref={detailsRef} className="group relative">
			<RailTooltip label={`Switch inbox · Current: ${active.email}`}>
				<summary
					className="flex min-h-11 w-11 cursor-pointer list-none flex-col items-center justify-center rounded-md border border-border bg-card px-1 text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
					aria-label={`Switch inbox. Current inbox: ${active.email}`}
				>
					<span className="text-[10px] font-bold leading-none" aria-hidden="true">
						{initials(active.email)}
					</span>
					<span className="mt-1 block max-w-9 truncate text-[8px] leading-none" aria-hidden="true">
						{localPart}
					</span>
				</summary>
			</RailTooltip>
			<div className="absolute bottom-0 left-[calc(100%+0.5rem)] z-50 w-64 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
				<p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Switch inbox</p>
				{accounts.map((account) => (
					<form key={account.handle} action="/auth" method="post">
						<button
							type="submit"
							name="account"
							value={account.handle}
							aria-current={account.active ? 'true' : undefined}
							onClick={() => {
								/* v8 ignore next -- mounted account action owns this ref -- @preserve */
								if (detailsRef.current) detailsRef.current.open = false
							}}
							className={cn(
								'flex min-h-11 min-w-0 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted',
								account.active && 'bg-muted font-medium',
							)}
						>
							<span
								className="app-rail-account shrink-0"
								data-slot="account-switcher-avatar"
								aria-hidden="true"
							>
								<span className="app-rail-account-inner">
									<span className="app-rail-account-initials">{initials(account.email)}</span>
								</span>
							</span>
							<span className="min-w-0 flex-1 truncate" title={account.email}>
								{account.email}
							</span>
						</button>
					</form>
				))}
			</div>
		</details>
	)
}

function AccountSwitcher({
	accounts,
	onNavigate,
}: {
	accounts: MailboxAccountOption[]
	onNavigate?: () => void
}) {
	const active = accounts.find((account) => account.active)
	if (!active) return null
	return (
		<form action="/auth" method="post" className="px-1">
			<label className="block text-xs font-medium text-muted-foreground">
				<span className="px-2">Inbox</span>
				<select
					name="account"
					aria-label="Switch inbox"
					value={active.handle}
					title={`Current inbox: ${active.email}`}
					onChange={(event) => {
						onNavigate?.()
						event.currentTarget.form?.requestSubmit()
					}}
					className="mt-1 h-10 w-full cursor-pointer rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
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
		<RailTooltip label={label}>
			<Link
				to={to}
				aria-label={ariaLabel}
				aria-current={isActive ? 'page' : undefined}
				className={cn('app-rail-item', isActive && 'app-rail-item-active')}
			>
				{isActive ? <span className="app-rail-item-indicator" aria-hidden="true" /> : null}
				{children}
			</Link>
		</RailTooltip>
	)
}

function RailButton({
	children,
	ariaLabel,
	shortcut,
	onClick,
	type = 'button',
}: {
	children: ReactNode
	ariaLabel: string
	shortcut?: string
	onClick?: () => void
	type?: 'button' | 'submit'
}) {
	return (
		<RailTooltip label={ariaLabel} shortcut={shortcut}>
			<button
				type={type}
				onClick={onClick}
				className="app-rail-item app-rail-item-utility"
				aria-label={ariaLabel}
			>
				{children}
			</button>
		</RailTooltip>
	)
}

function RailTooltip({
	label,
	shortcut,
	children,
}: {
	label: string
	shortcut?: string
	children: ReactNode
}) {
	return (
		<Tooltip delayDuration={800}>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="right" className="flex items-center gap-2">
				<span>{label}</span>
				{shortcut ? <kbd className="opacity-70">{shortcut}</kbd> : null}
			</TooltipContent>
		</Tooltip>
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
