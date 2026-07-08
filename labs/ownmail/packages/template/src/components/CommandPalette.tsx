import { useNavigate } from '@tanstack/react-router'
import { Calendar, Mail, Moon, Pencil, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CALENDAR_HOME_PATH, MAIL_HOME_PATH } from './route-paths.js'
import { ROOT_BACKGROUND_CLASS, THEME_STORAGE_KEY, themeClassName } from './theme.js'
import { cn, MAIL_FOLDERS } from './ui-model.js'

type Command = {
	id: string
	label: string
	hint?: string
	icon: React.ReactNode
	run: () => void
}

export function CommandPalette({
	open,
	onClose,
	onFocusSearch,
}: {
	open: boolean
	onClose: () => void
	onFocusSearch?: () => void
}) {
	const navigate = useNavigate()
	const [query, setQuery] = useState('')
	const [activeIndex, setActiveIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)

	const go = useCallback(
		(run: () => void) => {
			run()
			onClose()
			setQuery('')
			setActiveIndex(0)
		},
		[onClose],
	)

	const commands = useMemo<Command[]>(() => {
		const list: Command[] = [
			{
				id: 'compose',
				label: 'Compose new message',
				hint: 'C',
				icon: <Pencil className="h-4 w-4" />,
				run: () => navigate({ to: '/mail/compose' }),
			},
			{
				id: 'search',
				label: 'Search mail',
				hint: '/',
				icon: <Search className="h-4 w-4" />,
				run: () => onFocusSearch?.(),
			},
			{
				id: 'calendar',
				label: 'Open calendar',
				icon: <Calendar className="h-4 w-4" />,
				run: () => navigate({ to: CALENDAR_HOME_PATH }),
			},
			...MAIL_FOLDERS.map((folder) => ({
				id: `folder-${folder.id}`,
				label: `Go to ${folder.label}`,
				icon: <Mail className="h-4 w-4" />,
				run: () =>
					navigate({
						to: '/mail/f/$folderId',
						params: { folderId: folder.id },
						...(folder.id === 'inbox' ? { mask: { to: MAIL_HOME_PATH } } : {}),
					}),
			})),
			{
				id: 'theme',
				label: 'Toggle light / dark theme',
				icon: <Moon className="h-4 w-4" />,
				run: () => {
					const isDark = document.documentElement.classList.contains('dark')
					const nextDark = !isDark
					const next = themeClassName(nextDark)
					const previous = nextDark ? 'light' : 'dark'
					document.documentElement.classList.add(ROOT_BACKGROUND_CLASS, next)
					document.documentElement.classList.remove(previous)
					localStorage.setItem(THEME_STORAGE_KEY, nextDark ? 'dark' : 'light')
				},
			},
		]
		return list
	}, [navigate, onFocusSearch])

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase()
		if (!needle) return commands
		return commands.filter((command) => command.label.toLowerCase().includes(needle))
	}, [commands, query])

	useEffect(() => {
		if (!open) return
		setQuery('')
		setActiveIndex(0)
		const timer = setTimeout(() => inputRef.current?.focus(), 0)
		return () => clearTimeout(timer)
	}, [open])

	useEffect(() => {
		if (!open) return
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault()
				onClose()
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault()
				setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)))
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault()
				setActiveIndex((index) => Math.max(index - 1, 0))
			}
			if (event.key === 'Enter' && filtered[activeIndex]) {
				event.preventDefault()
				go(filtered[activeIndex].run)
			}
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [activeIndex, filtered, go, onClose, open])

	if (!open) return null

	return (
		<div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="presentation">
			<button
				type="button"
				aria-label="Close command palette"
				className="sheet-backdrop absolute inset-0 bg-foreground/25 backdrop-blur-[3px]"
				onClick={onClose}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				className="command-palette relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
			>
				<div className="flex items-center gap-3 border-b border-border px-4 py-3">
					<Search className="h-4 w-4 shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value)
							setActiveIndex(0)
						}}
						placeholder="Search commands…"
						className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						aria-label="Filter commands"
						autoComplete="off"
						spellCheck={false}
					/>
					<kbd className="kbd hidden sm:inline-flex">esc</kbd>
				</div>
				<div className="max-h-[min(24rem,50vh)] overflow-y-auto p-2">
					{filtered.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching commands</p>
					) : (
						filtered.map((command, index) => (
							<button
								key={command.id}
								type="button"
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => go(command.run)}
								aria-current={index === activeIndex ? 'true' : undefined}
								className={cn(
									'command-row flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm',
									index === activeIndex && 'bg-accent text-accent-foreground',
								)}
							>
								<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
									{command.icon}
								</span>
								<span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
								{command.hint ? <kbd className="kbd">{command.hint}</kbd> : null}
							</button>
						))
					)}
				</div>
				<div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
					<span className="inline-flex items-center gap-1">
						<kbd className="kbd">↑↓</kbd> navigate
					</span>
					<span className="inline-flex items-center gap-1">
						<kbd className="kbd">↵</kbd> select
					</span>
				</div>
			</div>
		</div>
	)
}

/** Global ⌘K / Ctrl+K listener — call from mail and calendar shells. */
export function useCommandPaletteShortcut(onOpen: () => void) {
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				const target = event.target as HTMLElement | null
				const isTyping =
					target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
				if (isTyping) return
				event.preventDefault()
				onOpen()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [onOpen])
}
