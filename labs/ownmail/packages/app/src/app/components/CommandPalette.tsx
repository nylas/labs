import { useNavigate } from '@tanstack/react-router'
import { Calendar, Mail, Moon, Pencil, Search, Sun, Users, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { LIST_DENSITY_OPTIONS } from '#features/mail/components/ListDensityMenu'
import { READING_PANE_OPTIONS } from '#features/mail/components/ReadingPaneMenu'
import { MAIL_FOLDERS } from '#features/mail/lib/mail-ui-model'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { cn } from '#shared/lib/utils'
import { CALENDAR_HOME_PATH, CONTACTS_HOME_PATH } from '../config/route-paths.js'
import { themeToggleLabel, toggleTheme } from '../config/theme.js'
import { useThemeToggleState } from '../lib/use-theme-toggle-state.js'
import { useUserPreferences } from '../preferences/user-preferences.js'

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
	const { isDark, mounted } = useThemeToggleState()
	const [preferences, savePreferences] = useUserPreferences()
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	const listboxId = useId()

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
			{
				id: 'contacts',
				label: 'Open contacts',
				icon: <Users className="h-4 w-4" />,
				run: () => navigate({ to: CONTACTS_HOME_PATH }),
			},
			...MAIL_FOLDERS.map((folder) => ({
				id: `folder-${folder.id}`,
				label: `Go to ${folder.label}`,
				icon: <Mail className="h-4 w-4" />,
				run: () =>
					navigate({
						to: '/mail/f/$folderId',
						params: { folderId: folder.id },
					}),
			})),
			...READING_PANE_OPTIONS.map(({ value, label, icon: Icon }) => ({
				id: `reading-pane-${value}`,
				label: `Reading pane: ${label}`,
				...(preferences.readingPane === value ? { hint: 'Current' } : {}),
				icon: <Icon className="h-4 w-4" />,
				run: () => savePreferences({ ...preferences, readingPane: value }),
			})),
			...LIST_DENSITY_OPTIONS.map(({ value, label, icon: Icon }) => ({
				id: `list-density-${value}`,
				label: `List density: ${label}`,
				...(preferences.listDensity === value ? { hint: 'Current' } : {}),
				icon: <Icon className="h-4 w-4" />,
				run: () => savePreferences({ ...preferences, listDensity: value }),
			})),
			{
				id: 'theme',
				label: themeToggleLabel(mounted, isDark),
				icon: mounted && isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
				run: toggleTheme,
			},
		]
		return list
	}, [isDark, mounted, navigate, onFocusSearch, preferences, savePreferences])

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase()
		if (!needle) return commands
		return commands.filter((command) => command.label.toLowerCase().includes(needle))
	}, [commands, query])
	const activeCommand = filtered[activeIndex]
	const activeCommandId = activeCommand ? `${listboxId}-option-${activeCommand.id}` : undefined

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
			const target = event.target
			const isCommandContext =
				target === inputRef.current || (target instanceof Node && Boolean(listRef.current?.contains(target)))
			if (!isCommandContext) return

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
	}, [activeIndex, filtered, go, open])

	useEffect(() => {
		if (!open) return
		const selectedCommand = filtered[activeIndex]
		if (!selectedCommand) return
		const activeElement = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
		activeElement?.scrollIntoView?.({ block: 'nearest' })
	}, [activeIndex, filtered, open])

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				/* v8 ignore else -- @preserve controlled open dialogs only request dismissal; an open request is a no-op */
				if (!next) onClose()
			}}
		>
			<DialogContent
				aria-label="Command palette"
				className="command-palette top-[calc(var(--safe-area-top)+1rem)] max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom)-2rem)] translate-y-0 sm:top-[12dvh]"
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					inputRef.current?.focus()
				}}
			>
				<DialogTitle className="sr-only">Command palette</DialogTitle>
				<div className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2 sm:px-4">
					<Search className="h-4 w-4 shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value)
							setActiveIndex(0)
						}}
						placeholder="Search commands…"
						className="min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring sm:text-sm forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
						aria-label="Filter commands"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded="true"
						aria-controls={listboxId}
						aria-activedescendant={activeCommandId}
						autoComplete="off"
						spellCheck={false}
					/>
					<kbd className="kbd hidden sm:inline-flex">esc</kbd>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close command palette"
						className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring active:translate-y-px forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
				<div
					ref={listRef}
					id={listboxId}
					role="listbox"
					aria-label="Commands"
					className="max-h-[min(24rem,50dvh)] overflow-y-auto p-2"
				>
					{filtered.length === 0 ? (
						<p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
							No matching commands
						</p>
					) : (
						filtered.map((command, index) => (
							<button
								key={command.id}
								id={`${listboxId}-option-${command.id}`}
								type="button"
								role="option"
								tabIndex={-1}
								onMouseEnter={() => setActiveIndex(index)}
								onClick={() => go(command.run)}
								aria-selected={index === activeIndex}
								className={cn(
									'command-row flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
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
			</DialogContent>
		</Dialog>
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
