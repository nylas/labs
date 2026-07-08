import { Link } from '@tanstack/react-router'
import { Calendar, LogOut, Mail, Moon, Search, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CALENDAR_HOME_PATH, MAIL_HOME_PATH } from './route-paths.js'
import {
	initialThemeIsDark,
	ROOT_BACKGROUND_CLASS,
	THEME_STORAGE_KEY,
	themeClassName,
	themeToggleLabel,
} from './theme.js'
import {
	APP_RAIL_ICON_SLOT_CLASS,
	APP_RAIL_LABEL_SLOT_CLASS,
	APP_RAIL_WIDTH_CLASS,
	CHROME_ROW_CLASS,
	cn,
	initials,
} from './ui-model.js'

type AppRailNavProps = {
	email: string
	displayName?: string
	active: 'mail' | 'calendar'
	onOpenCommandPalette?: () => void
}

export function AppRailLogo({ className }: { className?: string }) {
	return (
		<Link
			to={MAIL_HOME_PATH}
			className={cn(
				'flex shrink-0 items-center justify-center border-r border-b border-border bg-background transition-colors hover:bg-muted/60',
				APP_RAIL_WIDTH_CLASS,
				CHROME_ROW_CLASS,
				className,
			)}
			aria-label="ownmail home"
		>
			<span className="app-rail-logo-mark" aria-hidden="true">
				o
			</span>
		</Link>
	)
}

export function AppRailNav({ email, displayName, active, onOpenCommandPalette }: AppRailNavProps) {
	const [isDark, setIsDark] = useState(false)
	const [mounted, setMounted] = useState(false)

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

	return (
		<nav
			aria-label="Primary"
			className={cn('flex h-full shrink-0 flex-col border-r border-border bg-background', APP_RAIL_WIDTH_CLASS)}
		>
			<RailLink to={MAIL_HOME_PATH} label="Mail" isActive={active === 'mail'} ariaLabel="Mail">
				<Mail className="h-4 w-4" strokeWidth={active === 'mail' ? 2.25 : 1.75} />
			</RailLink>
			<RailLink
				to={CALENDAR_HOME_PATH}
				label="Calendar"
				isActive={active === 'calendar'}
				ariaLabel="Calendar"
			>
				<Calendar className="h-4 w-4" strokeWidth={active === 'calendar' ? 2.25 : 1.75} />
			</RailLink>

			<div className="mt-auto border-t border-border">
				<RailButton onClick={toggleTheme} ariaLabel={themeToggleLabel(mounted, isDark)}>
					{mounted && isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
				</RailButton>
				<RailButton onClick={onOpenCommandPalette} ariaLabel="Open command palette" title="⌘K">
					<Search className="h-4 w-4" />
				</RailButton>
				<form action="/logout" method="get" className="contents">
					<RailButton type="submit" ariaLabel="Sign out">
						<LogOut className="h-4 w-4" />
					</RailButton>
				</form>
				<div
					className={cn(
						'flex items-center justify-center border-t border-border',
						CHROME_ROW_CLASS,
					)}
					title={displayName ? `${displayName} · ${email}` : email}
				>
					<div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
						{initials(displayName ?? email)}
					</div>
				</div>
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
			className={cn(
				'relative flex w-full flex-col items-center border-b border-border transition-colors',
				CHROME_ROW_CLASS,
				isActive
					? 'nav-item-active'
					: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
			)}
		>
			<span className={APP_RAIL_ICON_SLOT_CLASS}>{children}</span>
			<span className={APP_RAIL_LABEL_SLOT_CLASS}>{label}</span>
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
			className={cn(
				'flex w-full items-center justify-center border-b border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
				CHROME_ROW_CLASS,
			)}
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
