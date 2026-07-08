import type { Folder } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { Menu, Pencil, Search, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppRail } from '../components/AppRail.js'
import { CommandPalette, useCommandPaletteShortcut } from '../components/CommandPalette.js'
import { MailSidebar } from '../components/MailSidebar.js'
import { Sheet } from '../components/Sheet.js'
import {
	activeMailSidebarFolderId,
	composeMaskFromMailLocation,
	composeSearchFromMailLocation,
	folderMaskFromMailLocation,
	liveSearchTarget,
	mailSearchInputValue,
	searchMaskFromMailLocation,
} from '../components/ui-model.js'
import { getFolders, getMailboxInfo } from '../server/fns.js'

export const Route = createFileRoute('/mail')({
	loader: async () => {
		const [info, folders] = await Promise.all([getMailboxInfo(), getFolders()])
		return { info, folders }
	},
	staleTime: 30_000,
	component: MailLayout,
})

type MailInfo = {
	email: string
	displayName?: string
	appName: string
}

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
	return <MailRouteScreen info={info} folders={folders} />
}

export function MailRouteScreen({
	info,
	folders,
	defaultFolderId,
	children,
}: {
	info: MailInfo
	folders: Folder[]
	defaultFolderId?: string
	children?: ReactNode
}) {
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const publicPathname = useRouterState({
		select: (state) => state.location.maskedLocation?.pathname ?? state.location.pathname,
	})
	const isSearchRoute = useRouterState({
		select: (state) => state.matches.some((match) => match.routeId === '/mail/search'),
	})
	const searchParams = useRouterState({ select: (state) => state.location.search as Record<string, unknown> })
	const searchScopeFolderId = typeof searchParams.folderId === 'string' ? searchParams.folderId : undefined
	const routeSearchQuery = typeof searchParams.q === 'string' ? searchParams.q : undefined
	const currentFolderId = useMemo(
		() => activeMailSidebarFolderId(pathname, searchScopeFolderId) ?? defaultFolderId,
		[defaultFolderId, pathname, searchScopeFolderId],
	)
	const selectedSearchThreadId = typeof searchParams.threadId === 'string' ? searchParams.threadId : undefined
	const labelBaseFolder =
		typeof searchParams.baseFolderId === 'string' ? searchParams.baseFolderId : undefined
	const activeSearchFolderId = currentFolderId ?? searchScopeFolderId
	const composeSearch = useMemo(
		() => composeSearchFromMailLocation(pathname, activeSearchFolderId, selectedSearchThreadId),
		[activeSearchFolderId, pathname, selectedSearchThreadId],
	)
	const composeMask = useMemo(() => composeMaskFromMailLocation(publicPathname), [publicPathname])
	const folderMask = useMemo(() => folderMaskFromMailLocation(publicPathname), [publicPathname])
	const searchMask = useMemo(() => searchMaskFromMailLocation(publicPathname), [publicPathname])
	const searchAwarePathname = isSearchRoute ? '/mail/search' : pathname
	const [query, setQuery] = useState('')
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
	useVersionPolling()

	const openPalette = useCallback(() => setPaletteOpen(true), [])
	const closePalette = useCallback(() => setPaletteOpen(false), [])
	const focusSearch = useCallback(() => {
		closePalette()
		document.getElementById('mail-search')?.focus()
	}, [closePalette])
	useCommandPaletteShortcut(openPalette)

	useEffect(() => {
		setQuery(mailSearchInputValue(searchAwarePathname, routeSearchQuery))
	}, [routeSearchQuery, searchAwarePathname])

	function navigateSearch(nextQuery: string) {
		const target = liveSearchTarget(
			nextQuery,
			searchAwarePathname,
			activeSearchFolderId,
			selectedSearchThreadId,
		)
		if (target.kind === 'search') {
			navigate({
				to: '/mail/search',
				search: { q: target.q, ...(target.folderId ? { folderId: target.folderId } : {}) },
				replace: true,
				...(searchMask ? { mask: searchMask } : {}),
			})
		} else if (target.kind === 'thread') {
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: target.folderId, threadId: target.threadId },
				replace: true,
				...(searchMask ? { mask: searchMask } : {}),
			})
		} else if (target.kind === 'folder') {
			navigate({
				to: '/mail/f/$folderId',
				params: { folderId: target.folderId },
				replace: true,
				...(searchMask ? { mask: searchMask } : {}),
			})
		}
	}

	function updateSearch(nextQuery: string) {
		setQuery(nextQuery)
		if (searchDebounce.current) clearTimeout(searchDebounce.current)
		searchDebounce.current = setTimeout(() => navigateSearch(nextQuery), 280)
	}

	useEffect(() => {
		return () => {
			if (searchDebounce.current) clearTimeout(searchDebounce.current)
		}
	}, [])

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
				navigate({
					to: '/mail/compose',
					search: composeSearch,
					...(composeMask ? { mask: composeMask } : {}),
				})
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [composeMask, composeSearch, navigate])

	const sidebarProps = {
		folders,
		composeMask,
		composeSearch,
		folderMask,
		currentFolderId,
		baseFolderId: labelBaseFolder,
		onNavigate: () => setSidebarOpen(false),
	}

	return (
		<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
			<AppRail
				email={info.email}
				displayName={info.displayName}
				active="mail"
				onOpenCommandPalette={openPalette}
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<div className="hidden w-56 shrink-0 border-r border-border bg-sidebar md:block">
					<MailSidebar {...sidebarProps} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex items-center gap-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur-sm sm:gap-3 sm:px-4">
						<button
							type="button"
							onClick={() => setSidebarOpen(true)}
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
							aria-label="Open folders"
						>
							<Menu className="h-5 w-5" />
						</button>
						<form
							className="relative min-w-0 flex-1 md:max-w-md"
							onSubmit={(event) => {
								event.preventDefault()
								if (searchDebounce.current) clearTimeout(searchDebounce.current)
								navigateSearch(query)
							}}
						>
							<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<input
								id="mail-search"
								type="search"
								value={query}
								onChange={(event) => updateSearch(event.target.value)}
								placeholder="Search mail"
								className="mail-search-field h-9 w-full rounded-lg border border-border bg-card pr-20 pl-9 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
								aria-label="Search mail"
								enterKeyHint="search"
								autoCapitalize="none"
							/>
							<div className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
								{query ? (
									<button
										type="button"
										onClick={() => updateSearch('')}
										aria-label="Clear search"
										className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
									>
										<X className="h-4 w-4" />
									</button>
								) : (
									<kbd className="kbd hidden sm:inline-flex">/</kbd>
								)}
							</div>
						</form>
						<button
							type="button"
							onClick={openPalette}
							className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex"
							aria-label="Open command palette"
						>
							<span className="hidden lg:inline">Commands</span>
							<kbd className="kbd">⌘K</kbd>
						</button>
						<span className="ml-auto hidden text-xs text-muted-foreground xl:inline">
							<kbd className="kbd">C</kbd> compose
						</span>
					</header>
					<div className="flex min-h-0 flex-1">{children ?? <Outlet />}</div>
				</div>
			</div>

			<Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Mail">
				<MailSidebar {...sidebarProps} />
			</Sheet>

			<CommandPalette open={paletteOpen} onClose={closePalette} onFocusSearch={focusSearch} />

			<Link
				to="/mail/compose"
				search={composeSearch}
				{...(composeMask ? { mask: composeMask } : {})}
				className="fab md:hidden"
				aria-label="Compose message"
			>
				<Pencil className="h-5 w-5" strokeWidth={2.5} />
			</Link>
		</div>
	)
}
