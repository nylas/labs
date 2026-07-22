import type { Folder } from '@nylas-labs/cli-kit/v3'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Menu, Pencil, Search, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	AppRailLogo,
	AppRailMobileNav,
	AppRailNav,
	type MailboxAccountOption,
} from '../app/components/AppRail.js'
import { CommandPalette, useCommandPaletteShortcut } from '../app/components/CommandPalette.js'
import {
	CHROME_ROW_CLASS,
	CHROME_ROW_SHELL_CLASS,
	MAIL_HEADER_GRID_CLASS,
	MAIL_SIDEBAR_WIDTH_CLASS,
} from '../app/config/layout.js'
import { MailSidebar } from '../features/mail/components/MailSidebar.js'
import {
	activeMailSidebarFolderId,
	composeSearchFromMailLocation,
	liveSearchTarget,
	mailSearchInputValue,
} from '../features/mail/lib/mail-ui-model.js'
import { foldersQueryOptions, toMailFolder } from '../features/mail/state/mail-queries.js'
import { getFolders, getMailboxInfo } from '../server/fns.js'
import { Sheet } from '../shared/components/Sheet.js'
import { cn } from '../shared/lib/utils.js'

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
	accounts?: MailboxAccountOption[]
}

function MailLayout() {
	const { info, folders: initialFolders } = Route.useLoaderData()
	const { data: folders } = useQuery({
		...foldersQueryOptions(() => getFolders()),
		initialData: initialFolders.map(toMailFolder),
	})
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
	const searchAwarePathname = isSearchRoute ? '/mail/search' : pathname
	const [query, setQuery] = useState('')
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
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
			})
		} else if (target.kind === 'thread') {
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: target.folderId, threadId: target.threadId },
				replace: true,
			})
		} else if (target.kind === 'folder') {
			navigate({
				to: '/mail/f/$folderId',
				params: { folderId: target.folderId },
				replace: true,
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
				})
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [composeSearch, navigate])

	const sidebarProps = {
		folders,
		composeSearch,
		currentFolderId,
		baseFolderId: labelBaseFolder,
		onNavigate: () => setSidebarOpen(false),
	}

	const railNavProps = {
		email: info.email,
		displayName: info.displayName,
		accounts: info.accounts,
		active: 'mail' as const,
		onOpenCommandPalette: openPalette,
	}

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={CHROME_ROW_SHELL_CLASS}>
				<AppRailLogo appName={info.appName} className="hidden md:flex" />
				<header
					className={cn(
						'flex min-w-0 flex-1 items-stretch border-b border-border bg-background',
						CHROME_ROW_CLASS,
					)}
				>
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						className={cn(
							'flex h-11 w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground md:hidden',
						)}
						aria-label="Open navigation"
					>
						<Menu className="h-4 w-4" />
					</button>
					<div className={cn('min-w-0 flex-1', MAIL_HEADER_GRID_CLASS)}>
						<div className="hidden border-r border-border md:block" aria-hidden="true" />
						<div className="flex min-w-0 items-stretch">
							<form
								className="relative flex min-w-0 flex-1 items-center border-r border-border px-3"
								onSubmit={(event) => {
									event.preventDefault()
									if (searchDebounce.current) clearTimeout(searchDebounce.current)
									navigateSearch(query)
								}}
							>
								<Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
								<input
									id="mail-search"
									type="text"
									value={query}
									onChange={(event) => updateSearch(event.target.value)}
									placeholder="Search mail"
									className="mail-search-field h-full w-full border-0 bg-transparent py-2 pr-16 pl-7 text-sm text-foreground outline-none placeholder:text-muted-foreground"
									aria-label="Search mail"
									enterKeyHint="search"
									autoCapitalize="none"
								/>
								<div className="pointer-events-none absolute right-3 flex items-center gap-1">
									{query ? (
										<button
											type="button"
											onClick={() => updateSearch('')}
											aria-label="Clear search"
											className="pointer-events-auto flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
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
								className="hidden shrink-0 items-center gap-2 border-r border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:flex"
								aria-label="Open command palette"
							>
								<span className="hidden lg:inline">Commands</span>
								<kbd className="kbd">⌘K</kbd>
							</button>
							<div className="hidden shrink-0 items-center px-3 text-xs text-muted-foreground xl:flex">
								<kbd className="kbd">C</kbd>
								<span className="ml-1.5">compose</span>
							</div>
						</div>
					</div>
				</header>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppRailNav {...railNavProps} />
				<div
					className={cn(
						'hidden shrink-0 overflow-hidden border-r border-border bg-background md:block',
						MAIL_SIDEBAR_WIDTH_CLASS,
					)}
				>
					<MailSidebar {...sidebarProps} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<div className="flex min-h-0 flex-1 overflow-hidden">{children ?? <Outlet />}</div>
				</div>
			</div>

			<Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Navigation">
				<AppRailMobileNav {...railNavProps} onNavigate={() => setSidebarOpen(false)} />
				<div className="border-t border-border">
					<MailSidebar {...sidebarProps} />
				</div>
			</Sheet>

			<CommandPalette open={paletteOpen} onClose={closePalette} onFocusSearch={focusSearch} />

			<Link to="/mail/compose" search={composeSearch} className="fab md:hidden" aria-label="Compose message">
				<Pencil className="h-5 w-5" strokeWidth={2.5} />
			</Link>
		</div>
	)
}
