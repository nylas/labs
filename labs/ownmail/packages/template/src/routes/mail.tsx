import type { Folder } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import {
	Archive,
	FileText,
	Inbox,
	type LucideIcon,
	Pencil,
	Search,
	Send,
	SlidersHorizontal,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AppRail } from '../components/AppRail.js'
import { cn, MAIL_FOLDERS, sidebarFolderCount } from '../components/ui-model.js'
import { getFolders, getMailboxInfo } from '../server/fns.js'

export const Route = createFileRoute('/mail')({
	loader: async () => {
		const [info, folders] = await Promise.all([getMailboxInfo(), getFolders()])
		return { info, folders }
	},
	component: MailLayout,
})

const FOLDER_ICONS: Record<string, LucideIcon> = {
	inbox: Inbox,
	starred: Star,
	sent: Send,
	drafts: FileText,
	archive: Archive,
	trash: Trash2,
}

/**
 * Near-realtime updates: poll the cheap /api/version signal every 10s and
 * refetch loaders only when the webhook receiver has bumped it.
 */
function useVersionPolling() {
	const router = useRouter()
	const last = useRef<number | null>(null)
	useEffect(() => {
		const timer = setInterval(async () => {
			if (document.visibilityState !== 'visible') return
			try {
				const res = await fetch('/api/version')
				if (!res.ok) return
				const { version } = (await res.json()) as { version: number }
				if (last.current !== null && version !== last.current) router.invalidate()
				last.current = version
			} catch {
				// transient network errors — next tick will retry
			}
		}, 10_000)
		return () => clearInterval(timer)
	}, [router])
}

function MailLayout() {
	const { info, folders } = Route.useLoaderData()
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const composeSearch = useMemo(() => composeSearchFromPath(pathname), [pathname])
	const [query, setQuery] = useState('')
	const [commandOpen, setCommandOpen] = useState(false)
	useVersionPolling()

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault()
				setCommandOpen(true)
				return
			}
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === '/') {
				event.preventDefault()
				document.getElementById('mail-search')?.focus()
			}
			if (event.key.toLowerCase() === 'c') {
				event.preventDefault()
				navigate({ to: '/mail/compose', search: composeSearch })
			}
			if (event.key.toLowerCase() === 'g') {
				event.preventDefault()
				setCommandOpen(true)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [composeSearch, navigate])

	return (
		<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
			<AppRail email={info.email} displayName={info.displayName} active="mail" />
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className="hidden md:flex">
					<MailSidebar folders={folders} composeSearch={composeSearch} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex items-center gap-3 border-b border-border bg-background px-4 py-2.5">
						<form
							className="relative flex-1 md:max-w-md"
							onSubmit={(event) => {
								event.preventDefault()
								if (query.trim()) navigate({ to: '/mail/search', search: { q: query.trim() } })
							}}
						>
							<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<input
								id="mail-search"
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search mail"
								className="h-9 w-full rounded-lg border border-border bg-card pr-9 pl-9 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
								aria-label="Search mail"
								enterKeyHint="search"
								autoCapitalize="none"
							/>
							{query ? (
								<button
									type="button"
									onClick={() => setQuery('')}
									aria-label="Clear search"
									className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
								>
									<X className="h-4 w-4" />
								</button>
							) : null}
						</form>
						<button
							type="button"
							className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
							onClick={() => setCommandOpen(true)}
						>
							<SlidersHorizontal className="h-4 w-4" />
							<span className="hidden sm:inline">Filters</span>
						</button>
						<span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
							Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">C</kbd> to
							compose
						</span>
					</header>
					<div className="flex min-h-0 flex-1">
						<Outlet />
					</div>
				</div>
			</div>
			{commandOpen ? (
				<CommandPalette
					folders={folders}
					onClose={() => setCommandOpen(false)}
					onNavigate={(to) => {
						setCommandOpen(false)
						if (to === 'compose') navigate({ to: '/mail/compose', search: composeSearch })
						else if (to === 'calendar') navigate({ to: '/calendar/$view', params: { view: 'week' } })
						else navigate({ to: '/mail/f/$folderId', params: { folderId: to } })
					}}
				/>
			) : null}
		</div>
	)
}

function MailSidebar({
	folders,
	composeSearch,
}: {
	folders: Folder[]
	composeSearch: { folderId?: string; threadId?: string }
}) {
	const labels = folders.filter(isCustomFolder)
	return (
		<aside className="flex w-56 shrink-0 flex-col gap-4 border-r border-border bg-sidebar px-3 py-4">
			<Link
				to="/mail/compose"
				search={composeSearch}
				className="flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:brightness-105 active:scale-[0.98]"
			>
				<Pencil className="h-4 w-4" strokeWidth={2.5} />
				Compose
			</Link>

			<nav className="flex flex-col gap-0.5" aria-label="Mail folders">
				{MAIL_FOLDERS.map((folder) => {
					const Icon = FOLDER_ICONS[folder.id] ?? Inbox
					const count = sidebarFolderCount(folders, folder.id)
					return (
						<Link
							key={folder.id}
							to="/mail/f/$folderId"
							params={{ folderId: folder.id }}
							className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
							activeProps={{
								className: 'bg-accent font-semibold text-accent-foreground hover:bg-accent',
							}}
						>
							<Icon className="h-4 w-4 shrink-0" />
							<span className="flex-1 text-left">{folder.label}</span>
							{count > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
						</Link>
					)
				})}
			</nav>

			{labels.length > 0 ? (
				<div className="mt-1">
					<p className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Labels
					</p>
					<div className="flex flex-col gap-0.5">
						{labels.map((label, index) => (
							<Link
								key={label.id}
								to="/mail/f/$folderId"
								params={{ folderId: label.id }}
								className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
								activeProps={{ className: 'bg-accent font-semibold text-accent-foreground' }}
							>
								<span className={cn('h-2.5 w-2.5 rounded-full', labelDotClass(index))} />
								<span className="min-w-0 flex-1 truncate text-left">{label.name || label.id}</span>
							</Link>
						))}
					</div>
				</div>
			) : null}

			<div className="mt-auto rounded-sm border border-border bg-card p-3">
				<p className="text-xs font-semibold text-foreground">Storage</p>
				<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div className="h-full w-[38%] rounded-full bg-primary" />
				</div>
				<p className="mt-1.5 text-xs text-muted-foreground">5.7 GB of 15 GB used</p>
			</div>
		</aside>
	)
}

function composeSearchFromPath(pathname: string): { folderId?: string; threadId?: string } {
	const match = pathname.match(/^\/mail\/f\/([^/]+)\/t\/([^/]+)/)
	if (!match?.[1] || !match[2]) return {}
	return { folderId: decodeURIComponent(match[1]), threadId: decodeURIComponent(match[2]) }
}

function CommandPalette({
	folders,
	onClose,
	onNavigate,
}: {
	folders: Folder[]
	onClose: () => void
	onNavigate: (target: string) => void
}) {
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const previousFocusRef = useRef<HTMLElement | null>(null)
	const commands = useMemo(() => {
		const labels = folders.filter(isCustomFolder)
		return [
			{ id: 'compose', label: 'Compose message', detail: 'Start a new email', shortcut: 'C' },
			{ id: 'calendar', label: 'Open calendar', detail: 'Month, week, and day views' },
			...MAIL_FOLDERS.map((folder) => ({
				id: folder.id,
				label: `Open ${folder.label}`,
				detail: `${sidebarFolderCount(folders, folder.id)} items`,
			})),
			...labels.map((folder) => ({
				id: folder.id,
				label: `Open ${folder.name || folder.id}`,
				detail: `${folder.unread_count ?? 0} unread`,
			})),
		]
	}, [folders])
	const filtered = useMemo(
		() =>
			commands.filter((command) =>
				`${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()),
			),
		[commands, query],
	)

	useEffect(() => {
		previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
		inputRef.current?.focus()
		return () => {
			previousFocusRef.current?.focus()
		}
	}, [])

	function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		if (event.key === 'Escape') {
			event.preventDefault()
			onClose()
			return
		}
		if (event.key === 'Enter' && filtered[0]) {
			event.preventDefault()
			onNavigate(filtered[0].id)
			return
		}
		if (event.key !== 'Tab') return
		const focusable = Array.from(
			panelRef.current?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
			) ?? [],
		)
		if (focusable.length === 0) return
		const first = focusable[0]
		const last = focusable[focusable.length - 1]
		if (!first || !last) return
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault()
			last.focus()
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault()
			first.focus()
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 p-4 pt-20 backdrop-blur-[2px]">
			<button
				type="button"
				className="absolute inset-0"
				aria-label="Close command palette"
				onClick={onClose}
			/>
			<div
				ref={panelRef}
				className="relative w-full max-w-xl overflow-hidden rounded-sm border border-border bg-card shadow-2xl"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				onKeyDown={onPanelKeyDown}
			>
				<input
					ref={inputRef}
					className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Go to folder, compose, open calendar"
					aria-label="Command palette"
				/>
				<div className="max-h-80 overflow-y-auto p-1.5">
					{filtered.map((command, index) => (
						<button
							key={command.id}
							type="button"
							className={cn(
								'flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
								index === 0 && 'bg-accent',
							)}
							onClick={() => onNavigate(command.id)}
						>
							<span>
								<strong className="font-semibold">{command.label}</strong>
								<span className="block text-xs text-muted-foreground">{command.detail}</span>
							</span>
							{command.shortcut ? (
								<span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
									{command.shortcut}
								</span>
							) : null}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}

function isCustomFolder(folder: Folder): boolean {
	return !folder.system_folder && !MAIL_FOLDERS.some((standard) => standard.id === folder.id)
}

function labelDotClass(index: number): string {
	const tone = index % 4
	if (tone === 1) return 'bg-event-teal'
	if (tone === 2) return 'bg-event-amber'
	if (tone === 3) return 'bg-event-rose'
	return 'bg-event-blue'
}
