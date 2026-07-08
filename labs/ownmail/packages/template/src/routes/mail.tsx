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
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppRail } from '../components/AppRail.js'
import {
	cn,
	labelDotClass,
	labelToggleFolderId,
	MAIL_FOLDERS,
	sidebarFolderCount,
} from '../components/ui-model.js'
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
	const currentFolderId = useMemo(() => folderIdFromPath(pathname), [pathname])
	const [query, setQuery] = useState('')
	useVersionPolling()

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === '/') {
				event.preventDefault()
				document.getElementById('mail-search')?.focus()
			}
			if (event.key.toLowerCase() === 'c') {
				event.preventDefault()
				navigate({ to: '/mail/compose', search: composeSearch })
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
					<MailSidebar folders={folders} composeSearch={composeSearch} currentFolderId={currentFolderId} />
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
		</div>
	)
}

function MailSidebar({
	folders,
	composeSearch,
	currentFolderId,
}: {
	folders: Folder[]
	composeSearch: { folderId?: string; threadId?: string }
	currentFolderId?: string
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
						{labels.map((label, index) => {
							const active = currentFolderId === label.id
							return (
								<Link
									key={label.id}
									to="/mail/f/$folderId"
									params={{ folderId: labelToggleFolderId(currentFolderId, label.id) }}
									className={cn(
										'flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
										active
											? 'bg-accent font-semibold text-accent-foreground'
											: 'text-foreground/80 hover:bg-muted',
									)}
								>
									<span className={cn('h-2.5 w-2.5 rounded-full', labelDotClass(label.id, index))} />
									<span className="min-w-0 flex-1 truncate text-left">{label.name || label.id}</span>
								</Link>
							)
						})}
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

function folderIdFromPath(pathname: string): string | undefined {
	const match = pathname.match(/^\/mail\/f\/([^/]+)/)
	return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function isCustomFolder(folder: Folder): boolean {
	return !folder.system_folder && !MAIL_FOLDERS.some((standard) => standard.id === folder.id)
}
