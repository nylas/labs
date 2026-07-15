import { Link } from '@tanstack/react-router'
import { Calendar, LogOut, Mail, Moon, Search, Sun, Users } from 'lucide-react'
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

type AppRailNavProps = {
	email: string
	displayName?: string
	active: 'mail' | 'calendar' | 'contacts' | 'settings'
	onOpenCommandPalette?: () => void
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

export function AppRailNav({ email, displayName, active, onOpenCommandPalette }: AppRailNavProps) {
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
				'app-rail flex h-full shrink-0 flex-col border-r border-border bg-background',
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

function applyThemeClass(isDark: boolean): void {
	const next = themeClassName(isDark)
	const previous = isDark ? 'light' : 'dark'
	document.documentElement.classList.add(ROOT_BACKGROUND_CLASS, next)
	document.documentElement.classList.remove(previous)
}
