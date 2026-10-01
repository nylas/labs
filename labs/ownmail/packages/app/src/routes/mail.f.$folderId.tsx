import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Loader2, Reply, Star } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { ListDensityMenu } from '#features/mail/components/ListDensityMenu'
import { ReadingPaneMenu } from '#features/mail/components/ReadingPaneMenu'
import {
	THREAD_ROW_CLASS,
	THREAD_ROW_LINK_CLASS,
	ThreadRowContent,
	ThreadRowLayout,
	threadRowLinkLabel,
} from '#features/mail/components/ThreadRow'
import {
	draftRecipientName,
	folderCount,
	mailFolderTitle,
	threadTimestamp,
} from '#features/mail/lib/mail-ui-model'
import { readingPaneLayout } from '#features/mail/lib/reading-pane'
import { useUpdateThreadMutation } from '#features/mail/state/mail-mutations'
import {
	draftsQueryOptions,
	foldersQueryOptions,
	type MailDraft,
	type MailThread,
	type MailThreadPage,
	threadListQueryOptions,
} from '#features/mail/state/mail-queries'
import { getFolders, getThreads, listDrafts, updateThreadState } from '#server/fns'
import { PullToRefresh, RefreshButton } from '#shared/components/PullToRefresh'
import { ScrollArea } from '#shared/components/ui/scroll-area'
import { Toolbar } from '#shared/components/ui/toolbar'
import { edgeCursor, listNavAction, moveCursor } from '#shared/lib/list-nav'
import { cn } from '#shared/lib/utils'

export const Route = createFileRoute('/mail/f/$folderId')({
	validateSearch: (search): { baseFolderId?: string } => ({
		...(typeof search.baseFolderId === 'string' ? { baseFolderId: search.baseFolderId } : {}),
	}),
	loader: async ({ context, params }) => loadMailFolderData(params.folderId, context.queryClient),
	component: FolderView,
})

export async function loadMailFolderData(folderId: string, queryClient: QueryClient) {
	const folders = await queryClient.ensureQueryData(foldersQueryOptions(() => getFolders()))
	if (folderId === 'drafts') {
		return {
			threads: [] as MailThread[],
			drafts: await queryClient.ensureQueryData(draftsQueryOptions(() => listDrafts())),
			folders,
			nextCursor: undefined as string | undefined,
		}
	}
	const filters = folderId === 'starred' ? { starred: true } : { folderId }
	const result = await queryClient.ensureInfiniteQueryData(
		threadListQueryOptions(filters, (input) => getThreads({ data: input })),
	)
	const firstPage = result.pages.at(0) as MailThreadPage
	return {
		threads: firstPage.threads,
		nextCursor: firstPage.nextCursor,
		drafts: [] as MailDraft[],
		folders,
	}
}

type MailFolderRouteData = Awaited<ReturnType<typeof loadMailFolderData>>
type ComposeThreadSearch = ReturnType<
	typeof import('#features/mail/lib/mail-ui-model').composeBackdropThreadSearch
>

function FolderView() {
	const loaderData = Route.useLoaderData()
	const { folderId } = Route.useParams()
	const { baseFolderId } = Route.useSearch()
	const updateThread = useUpdateThreadMutation()
	const queryClient = useQueryClient()
	const folderQuery = useQuery({
		...foldersQueryOptions(
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated route screen and query-option tests */
			() => getFolders(),
		),
		initialData: loaderData.folders,
	})
	const draftsQuery = useQuery({
		...draftsQueryOptions(
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated route screen and query-option tests */
			() => listDrafts(),
		),
		initialData: loaderData.drafts,
		enabled: folderId === 'drafts',
	})
	const threadListOptions = useMemo(
		() =>
			threadListQueryOptions(folderId === 'starred' ? { starred: true } : { folderId }, (input) =>
				getThreads({ data: input }),
			),
		[folderId],
	)
	const threadsQuery = useInfiniteQuery({
		...threadListOptions,
		initialData: {
			pages: [
				{
					threads: loaderData.threads,
					...(loaderData.nextCursor ? { nextCursor: loaderData.nextCursor } : {}),
				},
			],
			pageParams: [undefined],
		},
		enabled: folderId !== 'drafts',
	})
	useEffect(
		() => () => {
			void queryClient
				.cancelQueries({ queryKey: threadListOptions.queryKey, exact: true }, { revert: true, silent: true })
				.catch(
					/* v8 ignore next -- @preserve cancellation is a best-effort lifecycle cleanup with no user-facing failure */
					() => {},
				)
		},
		[queryClient, threadListOptions.queryKey],
	)
	const threads = dedupeThreads(threadsQuery.data.pages.flatMap((page) => page.threads))
	const nextCursor = threadsQuery.data.pages.at(-1)?.nextCursor

	async function loadMoreThreads() {
		try {
			await threadsQuery.fetchNextPage({ cancelRefetch: false })
		} catch {
			// The route screen renders static retry guidance; never expose provider details.
		}
	}

	async function refreshThreads() {
		const activeListRefresh =
			folderId === 'drafts'
				? draftsQuery.refetch({ throwOnError: true })
				: threadsQuery.refetch({ throwOnError: true })
		await Promise.all([activeListRefresh, folderQuery.refetch({ throwOnError: true })])
	}

	return (
		<MailFolderRouteScreen
			threads={threads}
			drafts={draftsQuery.data}
			folders={folderQuery.data as Awaited<ReturnType<typeof getFolders>>}
			folderId={folderId}
			baseFolderId={baseFolderId}
			nextCursor={nextCursor}
			loadingMore={threadsQuery.isFetchingNextPage}
			loadMoreError={threadsQuery.isFetchNextPageError}
			onLoadMore={loadMoreThreads}
			onRefresh={refreshThreads}
			onUpdateThread={(input) => updateThread.mutateAsync(input).then(() => undefined)}
		/>
	)
}

function threadIdFromPath(pathname: string): string | undefined {
	const encoded = /^\/mail\/f\/[^/]+\/t\/([^/]+)\/?$/.exec(pathname)?.[1]
	if (!encoded) return undefined
	try {
		return decodeURIComponent(encoded)
	} catch {
		return undefined
	}
}

function dedupeThreads<T extends { id: string }>(threads: T[]): T[] {
	return [...new Map(threads.map((thread) => [thread.id, thread])).values()]
}

export function MailFolderRouteScreen({
	threads: initialThreads,
	drafts,
	folders,
	folderId,
	baseFolderId,
	nextCursor: initialCursor,
	loadingMore: managedLoadingMore,
	loadMoreError: managedLoadMoreError,
	onLoadMore,
	onRefresh,
	onUpdateThread,
	activeThreadId,
	composeThreadSearch,
	children,
}: MailFolderRouteData & {
	folderId: string
	baseFolderId?: string
	loadingMore?: boolean
	loadMoreError?: boolean
	onLoadMore?: () => Promise<void>
	onRefresh?: () => Promise<unknown>
	onUpdateThread?: (input: { threadId: string; starred: boolean }) => Promise<void>
	activeThreadId?: string
	composeThreadSearch?: (threadId: string) => ComposeThreadSearch
	children?: ReactNode
}) {
	const folderTitle = mailFolderTitle(folderId, folders)
	const navigate = useNavigate()
	const [extraThreads, setExtraThreads] = useState<MailThread[]>([])
	const [nextCursor, setNextCursor] = useState(initialCursor)
	const [localLoadingMore, setLocalLoadingMore] = useState(false)
	const [localLoadMoreError, setLocalLoadMoreError] = useState(false)
	const [cursor, setCursor] = useState(-1)
	const listScrollRef = useRef<HTMLDivElement>(null)
	const moveFocusToCursorRef = useRef(false)
	const loadMorePendingRef = useRef(false)
	const folderIdentity = JSON.stringify([folderId, initialCursor])
	const folderGenerationRef = useRef({ identity: folderIdentity, generation: 0 })
	if (folderGenerationRef.current.identity !== folderIdentity) {
		folderGenerationRef.current = {
			identity: folderIdentity,
			generation: folderGenerationRef.current.generation + 1,
		}
	}
	const hasThreadRoute = useRouterState({
		select: (state) =>
			state.location.pathname.includes('/t/') ||
			state.matches.some(
				/* v8 ignore next -- @preserve the direct pathname arm covers the mounted nested-thread route in screen tests */
				(match) => match.routeId === '/mail/f/$folderId/t/$threadId',
			),
	})
	const routedThreadId = useRouterState({
		select: (state) =>
			(
				state.matches.find((match) => match.routeId === '/mail/f/$folderId/t/$threadId')?.params as
					| { threadId?: string }
					| undefined
			)?.threadId,
	})
	const openThreadId = activeThreadId ?? routedThreadId
	// While any navigation (j/k, click, or history) is loading, the committed
	// match lags behind; the router location already names the destination.
	const destinationThreadId = useRouterState({
		select: (state) => (state.isLoading ? threadIdFromPath(state.location.pathname) : undefined),
	})
	const hasThread = hasThreadRoute || Boolean(children)
	const [preferences, savePreferences] = useUserPreferences()
	const layout = readingPaneLayout(preferences.readingPane, hasThreadRoute, preferences.listDensity)
	const loadingMore = Boolean(managedLoadingMore || localLoadingMore)
	const loadMoreFailed = !loadingMore && Boolean(managedLoadMoreError || localLoadMoreError)
	const threads = useMemo(
		() => (onLoadMore ? initialThreads : dedupeThreads([...initialThreads, ...extraThreads])),
		[extraThreads, initialThreads, onLoadMore],
	)
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = folderCount(folders, folderId)

	// The keyboard cursor walks a flat list of the rows actually on screen —
	// drafts in the drafts folder, otherwise the sorted threads — so `j`/`k`
	// order matches render order and Enter opens the right conversation.
	const navItems = useMemo(() => {
		if (folderId === 'drafts') {
			return drafts.map((draft) => ({ draftId: draft.id }))
		}
		const search = baseFolderId ? { baseFolderId } : {}
		return sortedThreads.map((thread) => ({ folderId, threadId: thread.id, search }))
	}, [baseFolderId, drafts, folderId, sortedThreads])

	const openItem = useCallback(
		(index: number) => {
			const item = navItems[index]
			if (!item) return
			if ('draftId' in item) {
				navigate({ to: '/mail/compose', search: { draft: item.draftId, folderId: 'drafts' } })
				return
			}
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: item.folderId, threadId: item.threadId },
				search: item.search,
			})
		},
		[navItems, navigate],
	)

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset paginated threads and the keyboard cursor when the folder changes
	useEffect(() => {
		loadMorePendingRef.current = false
		setExtraThreads([])
		setNextCursor(initialCursor)
		setLocalLoadingMore(false)
		setLocalLoadMoreError(false)
		setCursor(-1)
	}, [folderId, initialCursor])

	// Keep the cursored row visible as it walks past the fold.
	useEffect(() => {
		if (cursor < 0) return
		const rows = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')
		rows?.[cursor]?.scrollIntoView({ block: 'nearest' })
		if (moveFocusToCursorRef.current) {
			const row = rows?.[cursor]
			;(row?.querySelector<HTMLElement>('.thread-row-link') ?? row)?.focus()
			moveFocusToCursorRef.current = false
		}
	}, [cursor])

	// Closing a conversation (back, Escape, or "Mark unread") returns the cursor
	// and focus to its row, so keyboard reading resumes where it left off —
	// essential when the list was hidden behind the reader.
	const previousOpenThreadIdRef = useRef(openThreadId)
	useEffect(() => {
		const closedThreadId = previousOpenThreadIdRef.current
		previousOpenThreadIdRef.current = openThreadId
		if (!closedThreadId || openThreadId) return
		const index = navItems.findIndex((item) => 'threadId' in item && item.threadId === closedThreadId)
		if (index < 0) return
		setCursor(index)
		requestAnimationFrame(() => {
			const row = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')[index]
			row?.scrollIntoView({ block: 'nearest' })
			row?.querySelector<HTMLElement>('.thread-row-link')?.focus()
		})
	}, [navItems, openThreadId])

	// Global list navigation: j/k or arrows move the cursor, Enter/o opens it.
	// Skip while typing, while a dialog (command palette, compose, event) is up,
	// or when a modifier is held so app/browser shortcuts keep working.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target instanceof HTMLElement ? event.target : null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return
			const focusedRow = target?.closest<HTMLElement>('[data-nav-row]')
			const rows = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')
			const focusedRowIndex = focusedRow && rows ? Array.from(rows).indexOf(focusedRow) : -1
			// Keep nested row actions and unrelated links in control of their keys,
			// but let a focused thread row continue list navigation.
			if (target?.closest?.('button, select') || (target?.closest?.('a') && focusedRowIndex < 0)) return
			if (document.querySelector('[role="dialog"]')) return
			const action = listNavAction(event.key)
			if (!action) return
			// With a conversation open, j/k move straight to the adjacent
			// conversation instead of only moving the list cursor.
			const fromThreadId = destinationThreadId ?? openThreadId
			const openIndex =
				fromThreadId && (event.key === 'j' || event.key === 'k')
					? navItems.findIndex((item) => 'threadId' in item && item.threadId === fromThreadId)
					: -1
			if (openIndex >= 0) {
				event.preventDefault()
				const nextIndex = moveCursor(openIndex, event.key === 'j' ? 1 : -1, navItems.length)
				setCursor(nextIndex)
				if (nextIndex !== openIndex) openItem(nextIndex)
				return
			}
			event.preventDefault()
			if (action === 'open') {
				openItem(focusedRowIndex >= 0 ? focusedRowIndex : cursor)
				return
			}
			if (focusedRowIndex >= 0) moveFocusToCursorRef.current = true
			setCursor((current) =>
				action === 'first' || action === 'last'
					? edgeCursor(action, navItems.length)
					: moveCursor(
							focusedRowIndex >= 0 ? focusedRowIndex : current,
							action === 'down' ? 1 : -1,
							navItems.length,
						),
			)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [cursor, destinationThreadId, navItems, openItem, openThreadId])

	async function loadMore() {
		if (!nextCursor || loadMorePendingRef.current || loadingMore || folderId === 'drafts') return
		const actionGeneration = folderGenerationRef.current.generation
		loadMorePendingRef.current = true
		setLocalLoadMoreError(false)
		setLocalLoadingMore(true)
		try {
			if (onLoadMore) {
				await onLoadMore()
				return
			}
			const res = await getThreads({
				data: {
					...(folderId === 'starred' ? { starred: true } : { folderId }),
					pageToken: nextCursor,
				},
			})
			if (folderGenerationRef.current.generation !== actionGeneration) return
			setExtraThreads((current) => [...current, ...res.threads])
			setNextCursor(res.nextCursor)
		} catch {
			if (folderGenerationRef.current.generation === actionGeneration) setLocalLoadMoreError(true)
		} finally {
			if (folderGenerationRef.current.generation === actionGeneration) {
				loadMorePendingRef.current = false
				setLocalLoadingMore(false)
			}
		}
	}
	const paginationControls = nextCursor ? (
		<div className="w-full border-t border-border p-3">
			{loadMoreFailed ? (
				<p id="folder-pagination-error" role="alert" className="mb-2 text-center text-xs text-destructive">
					Could not load more messages. Check your connection, then try again.
				</p>
			) : null}
			<button
				type="button"
				onClick={() => void loadMore()}
				aria-disabled={loadingMore || undefined}
				aria-busy={loadingMore}
				aria-describedby={loadMoreFailed ? 'folder-pagination-error' : undefined}
				className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted aria-disabled:cursor-wait aria-disabled:opacity-60"
			>
				{loadingMore ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> Loading more messages…
					</>
				) : loadMoreFailed ? (
					'Try loading more messages'
				) : (
					'Load more messages'
				)}
			</button>
		</div>
	) : null
	const threadList = (
		<ScrollArea
			aria-label={`${folderTitle} thread list`}
			viewportRef={listScrollRef}
			className="min-h-0 flex-1"
		>
			{folderId === 'drafts' ? (
				drafts.length === 0 ? (
					<EmptyState />
				) : (
					drafts.map((draft, index) => <DraftRow key={draft.id} draft={draft} navActive={cursor === index} />)
				)
			) : sortedThreads.length === 0 ? (
				<EmptyState moreAvailable={Boolean(nextCursor)}>{paginationControls}</EmptyState>
			) : (
				<>
					{sortedThreads.map((thread, index) => (
						<ThreadRow
							key={thread.id}
							thread={thread}
							folderId={folderId}
							baseFolderId={baseFolderId}
							active={thread.id === activeThreadId}
							composeSearch={composeThreadSearch?.(thread.id)}
							navActive={cursor === index}
							onUpdateThread={onUpdateThread}
						/>
					))}
					{paginationControls}
				</>
			)}
		</ScrollArea>
	)

	return (
		<div className={layout.container}>
			<section className={layout.list} data-density={preferences.listDensity}>
				<Toolbar className="justify-between px-4">
					<h1 className="font-display text-base font-semibold capitalize">{folderTitle}</h1>
					<div className="flex items-center gap-1">
						{unreadCount > 0 ? (
							<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
								{unreadCount}
							</span>
						) : null}
						{onRefresh ? <RefreshButton onRefresh={onRefresh} label="Refresh mail" /> : null}
						<ListDensityMenu
							value={preferences.listDensity}
							onChange={(listDensity) => savePreferences({ ...preferences, listDensity })}
						/>
						<ReadingPaneMenu
							value={preferences.readingPane}
							onChange={(readingPane) => savePreferences({ ...preferences, readingPane })}
						/>
					</div>
				</Toolbar>

				{onRefresh ? (
					<PullToRefresh
						onRefresh={onRefresh}
						scrollRef={listScrollRef}
						className="flex min-h-0 flex-1 flex-col"
					>
						{threadList}
					</PullToRefresh>
				) : (
					threadList
				)}
			</section>
			<section className={layout.reader}>
				{hasThread ? (
					(children ?? <Outlet />)
				) : (
					<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center xl:flex">
						<div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
							<Reply className="h-6 w-6" />
						</div>
						<div>
							<p className="font-display text-sm font-semibold text-foreground">Select a conversation</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Pick a message from the list, or press <kbd className="kbd">C</kbd> to compose.
							</p>
						</div>
					</div>
				)}
			</section>
		</div>
	)
}

function EmptyState({ moreAvailable = false, children }: { moreAvailable?: boolean; children?: ReactNode }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
			<p className="font-display text-sm font-semibold text-foreground">
				{moreAvailable ? 'More messages may be available' : 'All caught up'}
			</p>
			<p className="text-sm text-muted-foreground">
				{moreAvailable ? 'Load the next page to keep looking.' : 'No messages in this folder.'}
			</p>
			{children}
		</div>
	)
}

function DraftRow({ draft, navActive }: { draft: MailDraft; navActive: boolean }) {
	return (
		<Link
			to="/mail/compose"
			search={{ draft: draft.id, folderId: 'drafts' }}
			data-nav-row=""
			data-nav-cursor={navActive ? 'true' : undefined}
			className={THREAD_ROW_CLASS}
		>
			<ThreadRowLayout
				leading={<Star className="h-4 w-4 text-muted-foreground" />}
				sender={draftRecipientName(draft)}
				epochSeconds={draft.date}
				subject={draft.subject}
				snippet={draft.snippet}
			/>
		</Link>
	)
}

function ThreadRow({
	thread,
	folderId,
	baseFolderId,
	active,
	composeSearch,
	navActive,
	onUpdateThread,
}: {
	thread: MailThread
	folderId: string
	baseFolderId?: string
	active?: boolean
	composeSearch?: ComposeThreadSearch
	navActive: boolean
	onUpdateThread?: (input: { threadId: string; starred: boolean }) => Promise<void>
}) {
	const [starred, setStarred] = useState(thread.starred)
	const [starPending, setStarPending] = useState(false)

	useEffect(() => {
		setStarred(thread.starred)
	}, [thread.starred])

	async function toggleStar() {
		/* v8 ignore next -- the star control is disabled while its request is pending -- @preserve */
		if (starPending) return
		const nextStarred = !starred
		setStarred(nextStarred)
		setStarPending(true)
		try {
			if (onUpdateThread) await onUpdateThread({ threadId: thread.id, starred: nextStarred })
			else {
				// Compatibility seam for the isolated screen tests; the production route
				// always supplies the centralized optimistic mutation gateway.
				await updateThreadState({ data: { threadId: thread.id, starred: nextStarred } })
			}
		} catch {
			/* v8 ignore next -- @preserve a failed optimistic mutation restores the rendered value before re-enabling the control */
			setStarred(!nextStarred)
		} finally {
			setStarPending(false)
		}
	}
	const optimisticThread = starred === thread.starred ? thread : { ...thread, starred }
	const className = cn(THREAD_ROW_CLASS, optimisticThread.unread && 'bg-card/80')
	const rowState = {
		'data-active': active ? ('true' as const) : undefined,
		'data-nav-row': '',
		'data-nav-cursor': navActive ? ('true' as const) : undefined,
		'data-unread': optimisticThread.unread ? ('true' as const) : undefined,
	}

	if (composeSearch) {
		return (
			<div className={className} tabIndex={-1} {...rowState}>
				<Link
					to="/mail/compose"
					search={composeSearch}
					aria-label={threadRowLinkLabel(optimisticThread, folderId)}
					className={THREAD_ROW_LINK_CLASS}
					aria-current={active ? 'true' : undefined}
					data-active={active ? 'true' : undefined}
					data-nav-cursor={navActive ? 'true' : undefined}
					data-unread={optimisticThread.unread ? 'true' : undefined}
				/>
				<ThreadRowContent
					thread={optimisticThread}
					folderId={folderId}
					onToggleStar={toggleStar}
					starPending={starPending}
				/>
			</div>
		)
	}

	return (
		<div className={className} tabIndex={-1} {...rowState}>
			<Link
				to="/mail/f/$folderId/t/$threadId"
				params={{ folderId, threadId: thread.id }}
				search={baseFolderId ? { baseFolderId } : {}}
				aria-label={threadRowLinkLabel(optimisticThread, folderId)}
				className={THREAD_ROW_LINK_CLASS}
				activeProps={{ 'data-active': 'true' }}
				aria-current={active ? 'true' : undefined}
				data-active={active ? 'true' : undefined}
				data-nav-cursor={navActive ? 'true' : undefined}
				data-unread={optimisticThread.unread ? 'true' : undefined}
			/>
			<ThreadRowContent
				thread={optimisticThread}
				folderId={folderId}
				onToggleStar={toggleStar}
				starPending={starPending}
			/>
		</div>
	)
}
