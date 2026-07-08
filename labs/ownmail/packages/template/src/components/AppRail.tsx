import { Link } from '@tanstack/react-router'
import { Calendar, LogOut, Mail, Moon, Search, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_CALENDAR_VIEW } from './calendar.js'
import { initials } from './ui-model.js'

export function AppRail({
	email,
	displayName,
	active,
}: {
	email: string
	displayName?: string
	active: 'mail' | 'calendar'
}) {
	const [isDark, setIsDark] = useState(false)
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		const saved = localStorage.getItem('ownmail_theme')
		const nextDark = initialThemeIsDark(saved)
		document.documentElement.classList.toggle('dark', nextDark)
		setIsDark(nextDark)
		setMounted(true)
	}, [])

	function toggleTheme() {
		const nextDark = !isDark
		document.documentElement.classList.toggle('dark', nextDark)
		localStorage.setItem('ownmail_theme', nextDark ? 'dark' : 'light')
		setIsDark(nextDark)
	}

	return (
		<nav
			aria-label="Primary"
			className="flex h-full w-16 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3"
		>
			<Link
				to="/mail"
				className="mb-2 flex h-10 w-10 items-center justify-center rounded-sm bg-primary text-primary-foreground"
				aria-label="ownmail home"
			>
				<span className="font-display text-lg font-extrabold leading-none">o</span>
			</Link>

			<Link
				to="/mail"
				aria-label="Mail"
				aria-current={active === 'mail' ? 'page' : undefined}
				className={`group relative flex h-11 w-11 flex-col items-center justify-center rounded-sm transition-colors ${
					active === 'mail'
						? 'bg-sidebar-primary text-sidebar-primary-foreground'
						: 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
				}`}
			>
				<Mail className="h-5 w-5" strokeWidth={active === 'mail' ? 2.4 : 2} />
				<span className="mt-0.5 text-[10px] font-medium tracking-tight">Mail</span>
			</Link>
			<Link
				to="/calendar/$view"
				params={{ view: DEFAULT_CALENDAR_VIEW }}
				aria-label="Calendar"
				aria-current={active === 'calendar' ? 'page' : undefined}
				className={`group relative flex h-11 w-11 flex-col items-center justify-center rounded-sm transition-colors ${
					active === 'calendar'
						? 'bg-sidebar-primary text-sidebar-primary-foreground'
						: 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
				}`}
			>
				<Calendar className="h-5 w-5" strokeWidth={active === 'calendar' ? 2.4 : 2} />
				<span className="mt-0.5 text-[10px] font-medium tracking-tight">Calendar</span>
			</Link>

			<div className="mt-auto flex flex-col items-center gap-1">
				<button
					type="button"
					onClick={toggleTheme}
					className="flex h-11 w-11 items-center justify-center rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
					aria-label={mounted && isDark ? 'Switch to light mode' : 'Switch to dark mode'}
				>
					{mounted && isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
				</button>
				<button
					type="button"
					className="flex h-11 w-11 items-center justify-center rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
					aria-label="Search"
				>
					<Search className="h-5 w-5" />
				</button>
				<button
					type="button"
					className="flex h-11 w-11 items-center justify-center rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
					aria-label="Settings"
				>
					<Settings className="h-5 w-5" />
				</button>
				<form action="/logout" method="get" className="contents">
					<button
						type="submit"
						className="group relative flex h-11 w-11 items-center justify-center rounded-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
						aria-label="Sign out"
					>
						<LogOut className="h-5 w-5" />
					</button>
				</form>
				<div
					className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
					title={displayName ? `${displayName} · ${email}` : email}
				>
					{initials(displayName ?? email)}
				</div>
			</div>
		</nav>
	)
}

export function initialThemeIsDark(savedTheme: string | null): boolean {
	return savedTheme === 'dark'
}
