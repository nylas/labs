import type { Folder } from '@nylas-labs/cli-kit/v3'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Menu, Pencil } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav, type MailboxAccountOption } from '#app/components/AppRail'
import { CommandPalette, useCommandPaletteShortcut } from '#app/components/CommandPalette'
import { ContentReadyOutlet } from '#app/components/ContentReadyOutlet'
import { MobileTabBar } from '#app/components/MobileTabBar'
import {
	CHROME_ROW_CLASS,
	CHROME_ROW_SHELL_CLASS,
	MAIL_HEADER_GRID_CLASS,
	MAIL_SIDEBAR_WIDTH_CLASS,
} from '#app/config/layout'
import { ensureMailboxInfo, mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { MailSearchBar } from '#features/mail/components/MailSearchBar'
import { MailSidebar } from '#features/mail/components/MailSidebar'
import {
	activeMailSidebarFolderId,
	composeSearchFromMailLocation,
	liveSearchTarget,
	mailSearchInputValue,
} from '#features/mail/lib/mail-ui-model'
import { foldersQueryOptions } from '#features/mail/state/mail-queries'
import { getFolders } from '#server/fns'
import { Sheet } from '#shared/components/Sheet'
import { useIdentityState } from '#shared/hooks/use-identity-state'
import { seededData } from '#shared/lib/seeded-data'
import { cn } from '#shared/lib/utils'

export const Route = createFileRoute('/mail')({
	loader: async ({ context }) => {
		// The mailbox comes first: the folder key is partitioned by account.
		const info = await ensureMailboxInfo(context.queryClient)
		const folders = await context.queryClient.ensureQueryData(foldersQueryOptions(() => getFolders()))
		return { info, folders }
	},
	staleTime: Number.POSITIVE_INFINITY,
	component: MailLayout,
})

type MailInfo = {
	email: string
	displayName?: string
	appName: string
	accounts?: MailboxAccountOption[]
}

function MailLayout() {
	const { info: initialInfo, folders: initialFolders } = Route.useLoaderData()
	const infoQuery = useQuery({
		...mailboxInfoQueryOptions(),
		initialData: initialInfo,
		initialDataUpdatedAt: 0,
	})
	const foldersQuery = useQuery({
		...foldersQueryOptions(() => getFolders()),
		initialData: initialFolders,
	})
	return (
		<MailRouteScreen
			info={seededData(infoQuery.data, initialInfo)}
			folders={seededData(foldersQuery.data, initialFolders)}
		/>
	)
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
	const isThreadRoute = useRouterState({
		select: (state) => state.matches.some((match) => match.routeId === '/mail/f/$folderId/t/$threadId'),
	})
	const searchParams = useRouterState({ select: (state) => state.location.search as Record<string, unknown> })
	const searchScopeFolderId = typeof searchParams.folderId === 'string' ? searchParams.folderId : undefined
	const routeSearchQuery = typeof searchParams.q === 'string' ? searchParams.q : undefined
	const currentFolderId = useMemo(
		() => activeMailSidebarFolderId(pathname, searchScopeFolderId) ?? defaultFolderId,
		[defaultFolderId, pathname, searchScopeFolderId],
	)
	const selectedSearchThreadId = typeof searchParams.threadId === 'string' ? searchParams.threadId : undefined
	const hasThreadActions = isThreadRoute || (isSearchRoute && Boolean(selectedSearchThreadId))
	const labelBaseFolder =
		typeof searchParams.baseFolderId === 'string' ? searchParams.baseFolderId : undefined
	const activeSearchFolderId = currentFolderId ?? searchScopeFolderId
	const composeSearch = useMemo(
		() => composeSearchFromMailLocation(pathname, activeSearchFolderId, selectedSearchThreadId),
		[activeSearchFolderId, pathname, selectedSearchThreadId],
	)
	const searchAwarePathname = isSearchRoute ? '/mail/search' : pathname
	// What the search box shows belongs to the route's query: another search or
	// folder shows its own text on its first render, and typing edits only that.
	const [query, setQuery] = useIdentityState([searchAwarePathname, routeSearchQuery], () =>
		mailSearchInputValue(searchAwarePathname, routeSearchQuery),
	)
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const openPalette = useCallback(() => setPaletteOpen(true), [])
	const closePalette = useCallback(() => setPaletteOpen(false), [])
	const focusSearch = useCallback(() => {
		closePalette()
		document.getElementById('mail-search')?.focus()
	}, [closePalette])
	useCommandPaletteShortcut(openPalette)

	async function navigateSearch(nextQuery: string) {
		const target = liveSearchTarget(
			nextQuery,
			searchAwarePathname,
			activeSearchFolderId,
			selectedSearchThreadId,
		)
		if (target.kind === 'search') {
			await navigate({
				to: '/mail/search',
				search: { q: target.q, ...(target.folderId ? { folderId: target.folderId } : {}) },
				replace: true,
			})
		} else if (target.kind === 'thread') {
			await navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: target.folderId, threadId: target.threadId },
				replace: true,
			})
		} else if (target.kind === 'folder') {
			await navigate({
				to: '/mail/f/$folderId',
				params: { folderId: target.folderId },
				replace: true,
			})
		}
	}

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
		onFolderDeleted: (folderId: string) => {
			if (currentFolderId === folderId) {
				navigate({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } })
			}
		},
	}

	const railNavProps = {
		email: info.email,
		displayName: info.displayName,
		accounts: info.accounts,
		active: 'mail' as const,
		onOpenCommandPalette: openPalette,
	}

	return (
		<div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={CHROME_ROW_SHELL_CLASS}>
				<AppRailLogo appName={info.appName} className="hidden md:flex" />
				<header
					className={cn(
						'mail-header relative flex min-w-0 flex-1 items-stretch bg-background',
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
							<div className="flex min-w-0 flex-1 border-r border-border">
								<MailSearchBar
									value={query}
									activeQuery={isSearchRoute ? routeSearchQuery : undefined}
									onChange={setQuery}
									onSubmit={navigateSearch}
								/>
							</div>
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
					<div className="flex min-h-0 flex-1 overflow-hidden">
						{children ?? <ContentReadyOutlet parentRouteId="/mail" />}
					</div>
				</div>
			</div>
			<MobileTabBar active="mail" context={hasThreadActions ? 'thread' : 'primary'} />

			<Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Navigation">
				<AppRailMobileNav
					{...railNavProps}
					onNavigate={() => setSidebarOpen(false)}
					showDestinations={false}
				/>
				<div className="border-t border-border">
					<MailSidebar {...sidebarProps} mobile />
				</div>
			</Sheet>

			<CommandPalette open={paletteOpen} onClose={closePalette} onFocusSearch={focusSearch} />

			{hasThreadActions ? null : (
				<Link
					to="/mail/compose"
					search={composeSearch}
					className="fab md:hidden"
					aria-label="Compose message"
				>
					<Pencil className="h-5 w-5" strokeWidth={2.5} />
				</Link>
			)}
		</div>
	)
}
