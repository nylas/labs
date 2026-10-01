import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Loader2, Reply, Star } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContentReadyOutlet } from '#app/components/ContentReadyOutlet'
import { useUserPreferences, useUserPreferencesReady } from '#app/preferences/user-preferences'
import { ensureMailboxInfo } from '#app/query/mailbox-info'
import { ListDensityMenu } from '#features/mail/components/ListDensityMenu'
import { ReadingPaneMenu } from '#features/mail/components/ReadingPaneMenu'
import { ThreadListSkeleton } from '#features/mail/components/ThreadListSkeleton'
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
	type MailFolder,
	type MailThread,
	type MailThreadPage,
	mailKeys,
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
	pendingComponent: FolderPending,
})

export async function loadMailFolderData(folderId: string, queryClient: QueryClient) {
	// The mailbox comes first: every key below is partitioned by account.
	await ensureMailboxInfo(queryClient)
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

/** Shown while another folder loads. It names the destination folder, which is
 * already known, and never keeps the previous folder's rows, title or badge. */
function FolderPending() {
	const { folderId } = Route.useParams()
	const queryClient = useQueryClient()
	return (
		<MailFolderPlaceholder
			folderId={folderId}
			folders={queryClient.getQueryData<MailFolder[]>(mailKeys.folders())}
		/>
	)
}

/** A folder's title over skeleton rows: the pending view, and the first server
 * render, where the reading-pane preference that shapes the list is unknown. */
function MailFolderPlaceholder({ folderId, folders }: { folderId: string; folders?: MailFolder[] }) {
	const [{ readingPane, listDensity }] = useUserPreferences()
	const threadOpen = useRouterState({ select: (state) => state.location.pathname.includes('/t/') })
	const layout = readingPaneLayout(readingPane, threadOpen)
	return (
		<div data-testid="folder-pending" aria-busy="true" className={layout.container}>
			<section className={layout.list} data-density={listDensity}>
				<Toolbar className="justify-between px-4">
					<h1 className="font-display text-base font-semibold capitalize">
						{mailFolderTitle(folderId, folders)}
					</h1>
				</Toolbar>
				<ThreadListSkeleton />
			</section>
			<section className={layout.reader} />
		</div>
	)
}

type MailFolderRouteData = Awaited<ReturnType<typeof loadMailFolderData>>

/** List state owned by one folder and first page; see `MailFolderRouteScreen`. */
type FolderListState = {
	identity: string
	extraThreads: MailThread[]
	nextCursor: string | undefined
	loadingMore: boolean
	loadMoreError: boolean
	cursor: number
}

function emptyFolderListState(identity: string, nextCursor: string | undefined): FolderListState {
	return { identity, extraThreads: [], nextCursor, loadingMore: false, loadMoreError: false, cursor: -1 }
}
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

type MailFolderRouteScreenProps = Parameters<typeof LoadedMailFolderRouteScreen>[0]

/** The list and reader are laid out by the reading-pane preference, which the
 * server cannot know. Until it can be read, the folder shows its placeholder
 * instead of a default split that would rearrange after hydration. */
export function MailFolderRouteScreen(props: MailFolderRouteScreenProps) {
	if (!useUserPreferencesReady()) {
		return <MailFolderPlaceholder folderId={props.folderId} folders={props.folders} />
	}
	return <LoadedMailFolderRouteScreen {...props} />
}

function LoadedMailFolderRouteScreen({
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
	const folderIdentity = JSON.stringify([folderId, initialCursor])
	// Paged-in rows, the pagination status and the keyboard cursor belong to one
	// folder and first page. They are stored with that identity and read back
	// only while it still matches, so another folder starts clean on its first
	// render instead of being reset by an effect one render later.
	const [storedList, setStoredList] = useState<FolderListState>(() =>
		emptyFolderListState(folderIdentity, initialCursor),
	)
	const listState =
		storedList.identity === folderIdentity ? storedList : emptyFolderListState(folderIdentity, initialCursor)
	const updateList = useCallback(
		(change: (current: FolderListState) => Partial<FolderListState>) =>
			setStoredList((stored) => {
				const current =
					stored.identity === folderIdentity ? stored : emptyFolderListState(folderIdentity, initialCursor)
				return { ...current, ...change(current) }
			}),
		[folderIdentity, initialCursor],
	)
	const { extraThreads, nextCursor, cursor } = listState
	const localLoadingMore = listState.loadingMore
	const localLoadMoreError = listState.loadMoreError
	const setCursor = useCallback(
		(next: number | ((current: number) => number)) =>
			updateList((current) => ({ cursor: typeof next === 'function' ? next(current.cursor) : next })),
		[updateList],
	)
	const listScrollRef = useRef<HTMLDivElement>(null)
	const moveFocusToCursorRef = useRef(false)
	const loadMorePendingRef = useRef<string | null>(null)
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
	const layout = readingPaneLayout(preferences.readingPane, hasThreadRoute)
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
	}, [navItems, openThreadId, setCursor])

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
	}, [cursor, destinationThreadId, navItems, openItem, openThreadId, setCursor])

	async function loadMore() {
		if (!nextCursor || loadMorePendingRef.current === folderIdentity || loadingMore || folderId === 'drafts')
			return
		const actionGeneration = folderGenerationRef.current.generation
		loadMorePendingRef.current = folderIdentity
		updateList(() => ({ loadMoreError: false, loadingMore: true }))
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
			updateList((current) => ({
				extraThreads: [...current.extraThreads, ...res.threads],
				nextCursor: res.nextCursor,
			}))
		} catch {
			if (folderGenerationRef.current.generation === actionGeneration) {
				updateList(() => ({ loadMoreError: true }))
			}
		} finally {
			if (folderGenerationRef.current.generation === actionGeneration) {
				loadMorePendingRef.current = null
				updateList(() => ({ loadingMore: false }))
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
			// The scroll offset belongs to one folder; another folder starts at the top.
			key={folderId}
			scrollRestorationId={`mail-list:${folderId}`}
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
					(children ?? <ContentReadyOutlet parentRouteId="/mail/f/$folderId" />)
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
	// The star shown is the thread's own, except while a toggle is in flight.
	// The requested value lives only for that request, so it can never outlive
	// or disagree with the thread once the request settles.
	const [requestedStar, setRequestedStar] = useState<boolean | null>(null)
	const starPending = requestedStar !== null
	const starred = requestedStar ?? Boolean(thread.starred)

	async function toggleStar() {
		/* v8 ignore next -- the star control is disabled while its request is pending -- @preserve */
		if (starPending) return
		const nextStarred = !starred
		setRequestedStar(nextStarred)
		try {
			if (onUpdateThread) await onUpdateThread({ threadId: thread.id, starred: nextStarred })
			else {
				// Compatibility seam for the isolated screen tests; the production route
				// always supplies the centralized optimistic mutation gateway.
				await updateThreadState({ data: { threadId: thread.id, starred: nextStarred } })
			}
		} catch {
			// The mutation gateway has already restored the cached thread.
		} finally {
			setRequestedStar(null)
		}
	}
	const optimisticThread = starred === Boolean(thread.starred) ? thread : { ...thread, starred }
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
