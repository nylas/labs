import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Forward, Inbox, Loader2, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUserPreferences, useUserPreferencesReady } from '#app/preferences/user-preferences'
import { ensureMailboxInfo } from '#app/query/mailbox-info'
import { ListDensityMenu } from '#features/mail/components/ListDensityMenu'
import { ReadingPaneMenu } from '#features/mail/components/ReadingPaneMenu'
import { ThreadConversation } from '#features/mail/components/ThreadConversation'
import { ThreadListSkeleton } from '#features/mail/components/ThreadListSkeleton'
import { ThreadReaderSkeleton } from '#features/mail/components/ThreadReaderSkeleton'
import { MobileThreadResponseActions } from '#features/mail/components/ThreadResponseActions'
import {
	THREAD_ROW_CLASS,
	THREAD_ROW_LINK_CLASS,
	ThreadRowContent,
	threadRowLinkLabel,
} from '#features/mail/components/ThreadRow'
import {
	forwardDraftSearch,
	mailFolderTitle,
	replyAllDraftSearch,
	replyDraftSearch,
	STAR_FILLED_CLASS,
	searchListSearch,
	threadRouteFolderId,
	threadTimestamp,
} from '#features/mail/lib/mail-ui-model'
import { readingPaneLayout } from '#features/mail/lib/reading-pane'
import { findCachedThread } from '#features/mail/state/mail-cache'
import {
	markThreadReadOnOpen,
	openThreadDetail,
	useUpdateThreadMutation,
} from '#features/mail/state/mail-mutations'
import {
	foldersQueryOptions,
	type MailFolder,
	type MailThreadListData,
	mailKeys,
	threadDetailQueryOptions,
	threadListQueryOptions,
	toMailFolder,
	toMailThread,
	toMailThreadDetail,
} from '#features/mail/state/mail-queries'
import { getFolders, getThreadMessages, getThreads } from '#server/fns'
import { Toolbar } from '#shared/components/ui/toolbar'
import { edgeCursor, listNavAction, moveCursor } from '#shared/lib/list-nav'
import { cn } from '#shared/lib/utils'

type PendingSearchThreadAction = 'archive' | 'restore' | 'delete' | 'star'

export const Route = createFileRoute('/mail/search')({
	validateSearch: (search): { q: string; folderId?: string; threadId?: string } => ({
		q: String(search.q ?? ''),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
		...(typeof search.threadId === 'string' ? { threadId: search.threadId } : {}),
	}),
	loaderDeps: ({ search }) => ({ q: search.q, folderId: search.folderId, threadId: search.threadId }),
	loader: async ({ context, deps, preload }) => {
		// The mailbox comes first: the detail key is partitioned by account.
		await ensureMailboxInfo(context.queryClient)
		const hasSearchQuery = deps.q.trim().length > 0
		const emptyResults: Awaited<ReturnType<typeof getThreads>> = { threads: [] }
		const [folders, res, selected] = await Promise.all([
			getFolders(),
			hasSearchQuery
				? getThreads({
						data: {
							q: deps.q,
							...(deps.folderId === 'starred'
								? { starred: true }
								: deps.folderId
									? { folderId: deps.folderId }
									: {}),
						},
					})
				: Promise.resolve(emptyResults),
			hasSearchQuery && deps.threadId
				? openThreadDetail(
						context.queryClient,
						deps.threadId,
						{ preload, queryKey: mailKeys.threadDetail(deps.threadId), cacheAs: toMailThreadDetail },
						() => getThreadMessages({ data: { threadId: deps.threadId as string } }),
					)
				: null,
		])
		return { ...res, folders, folderId: deps.folderId, selected }
	},
	component: SearchRoute,
	pendingComponent: SearchPending,
})

function searchFilters(q: string, folderId: string | undefined) {
	return { q, ...(folderId === 'starred' ? { starred: true } : folderId ? { folderId } : {}) }
}

function newestFirst(threads: Thread[]): Thread[] {
	return [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0))
}

/** Selecting a result reloads this route, but the list's identity (query and
 * folder) has not changed. The router carries the offset to the reloaded list;
 * this carries it to the pending view in between. A different query or folder
 * starts at the top. */
const searchListScroll = { identity: '', top: 0 }

function searchListIdentity(q: string, folderId: string | undefined) {
	return JSON.stringify([q, folderId ?? null])
}

/** Rows already cached for the destination search, or nothing when that search
 * has not been loaded (or its query is one the loader will reject). */
function cachedSearchThreads(queryClient: QueryClient, q: string, folderId?: string): Thread[] | undefined {
	try {
		const list = queryClient.getQueryData<MailThreadListData>(mailKeys.threadList(searchFilters(q, folderId)))
		if (!list) return undefined
		const threads = list.pages.flatMap((page) => page.threads) as Thread[]
		return newestFirst([...new Map(threads.map((thread) => [thread.id, thread])).values()])
	} catch {
		return undefined
	}
}

/** Shown while a search loads. A new query or folder gets a skeleton; picking a
 * result keeps the rows of the same search and puts a skeleton in the reader.
 * Results of a previous query are never kept under the new query. */
function SearchPending() {
	const { q, folderId, threadId } = Route.useSearch()
	const queryClient = useQueryClient()
	const [{ readingPane, listDensity }] = useUserPreferences()
	const listRef = useRef<HTMLDivElement>(null)
	const listIdentity = searchListIdentity(q, folderId)
	useLayoutEffect(() => {
		if (listRef.current && searchListScroll.identity === listIdentity) {
			listRef.current.scrollTop = searchListScroll.top
		}
	}, [listIdentity])
	const hasSearchQuery = q.trim().length > 0
	const selectedThreadId = hasSearchQuery ? threadId : undefined
	const layout = readingPaneLayout(readingPane, Boolean(selectedThreadId))
	const threads = hasSearchQuery ? cachedSearchThreads(queryClient, q, folderId) : undefined
	return (
		<div data-testid="search-pending" aria-busy="true" className={layout.container}>
			<section className={layout.list} data-density={listDensity}>
				<Toolbar className="justify-between px-4">
					<h1 className="font-display text-base font-semibold capitalize">
						{folderId
							? mailFolderTitle(folderId, queryClient.getQueryData<MailFolder[]>(mailKeys.folders()))
							: 'Search results'}
					</h1>
				</Toolbar>
				{threads ? (
					<div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
						{threads.map((thread) => (
							<SearchThreadRow
								key={thread.id}
								thread={thread}
								q={q}
								searchFolderId={folderId}
								active={thread.id === selectedThreadId}
								keyboardActive={false}
							/>
						))}
					</div>
				) : (
					<ThreadListSkeleton />
				)}
			</section>
			<section className={layout.reader}>
				{selectedThreadId ? (
					<ThreadReaderSkeleton subject={findCachedThread(queryClient, selectedThreadId)?.subject} />
				) : null}
			</section>
		</div>
	)
}

/** The results and reader are laid out by the reading-pane preference, which
 * the server cannot know. Until it can be read, the search shows its pending
 * view instead of a default split that would rearrange after hydration. */
function SearchRoute() {
	return useUserPreferencesReady() ? <SearchResults /> : <SearchPending />
}

function SearchResults() {
	const initial = Route.useLoaderData()
	const { q, threadId } = Route.useSearch()
	const hasSearchQuery = q.trim().length > 0
	const router = useRouter()
	const queryClient = useQueryClient()
	const filters = searchFilters(q, initial.folderId)
	const foldersQuery = useQuery({
		...foldersQueryOptions(
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated search screen and query-option tests */
			() => getFolders(),
		),
		initialData: initial.folders.map(toMailFolder),
	})
	const threadsQuery = useInfiniteQuery({
		...threadListQueryOptions(
			filters,
			/* v8 ignore next -- @preserve production query wiring is covered through the isolated search screen and query-option tests */
			(input) => getThreads({ data: input }),
		),
		enabled: hasSearchQuery,
		initialData: {
			pages: [
				{
					threads: initial.threads.map(toMailThread),
					...(initial.nextCursor ? { nextCursor: initial.nextCursor } : {}),
				},
			],
			pageParams: [undefined],
		},
	})
	const selectedQuery = useQuery({
		...threadDetailQueryOptions(threadId ?? '__no-selected-thread__', (id) =>
			getThreadMessages({ data: { threadId: id } }),
		),
		...(initial.selected ? { initialData: toMailThreadDetail(initial.selected) } : {}),
		enabled: hasSearchQuery && Boolean(threadId),
	})
	const threads = useMemo(
		() =>
			hasSearchQuery
				? ([
						...new Map(
							threadsQuery.data.pages.flatMap((page) => page.threads).map((thread) => [thread.id, thread]),
						).values(),
					] as Thread[])
				: [],
		[hasSearchQuery, threadsQuery.data.pages],
	)
	const folders = foldersQuery.data
	const folderId = initial.folderId
	const selected = hasSearchQuery ? (selectedQuery.data as typeof initial.selected) : null
	const [cursor, setCursor] = useState(-1)
	const [preferences, savePreferences] = useUserPreferences()
	const layout = readingPaneLayout(preferences.readingPane, Boolean(selected))
	const listScrollRef = useRef<HTMLDivElement>(null)
	const moveFocusToCursorRef = useRef(false)
	const sortedThreads = useMemo(() => newestFirst(threads), [threads])
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length
	const title = folderId ? mailFolderTitle(folderId, folders) : 'Search results'
	const canLoadMore = hasSearchQuery && threadsQuery.hasNextPage

	async function loadMoreSearchResults() {
		try {
			await threadsQuery.fetchNextPage({ cancelRefetch: false })
		} catch {
			// The query state renders generic retry guidance; never expose provider details.
		}
	}

	/* v8 ignore start -- list navigation is exercised through the shared pure helpers -- @preserve */
	useEffect(() => {
		setCursor(threadId ? sortedThreads.findIndex((thread) => thread.id === threadId) : -1)
	}, [sortedThreads, threadId])

	useEffect(() => {
		if (cursor < 0) return
		const rows = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')
		rows?.[cursor]?.scrollIntoView?.({ block: 'nearest' })
		if (moveFocusToCursorRef.current) {
			const row = rows?.[cursor]
			;(row?.querySelector<HTMLElement>('.thread-row-link') ?? row)?.focus()
			moveFocusToCursorRef.current = false
		}
	}, [cursor])

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target instanceof HTMLElement ? event.target : null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return
			const focusedRow = target?.closest?.('[data-nav-row]') as HTMLElement | null | undefined
			const focusedRowIndex = focusedRow
				? Array.from(listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]') ?? []).indexOf(
						focusedRow,
					)
				: -1
			if (target?.closest?.('button, select') || (target?.closest?.('a') && focusedRowIndex < 0)) return
			if (document.querySelector('[role="dialog"]')) return
			const action = listNavAction(event.key)
			if (!action) return
			event.preventDefault()
			if (action === 'open') {
				const thread = sortedThreads[focusedRowIndex >= 0 ? focusedRowIndex : cursor]
				if (thread) {
					router.navigate({
						to: '/mail/search',
						search: { q, ...(folderId ? { folderId } : {}), threadId: thread.id },
					})
				}
				return
			}
			if (focusedRowIndex >= 0) moveFocusToCursorRef.current = true
			setCursor((current) =>
				action === 'first' || action === 'last'
					? edgeCursor(action, sortedThreads.length)
					: moveCursor(
							focusedRowIndex >= 0 ? focusedRowIndex : current,
							action === 'down' ? 1 : -1,
							sortedThreads.length,
						),
			)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [cursor, folderId, q, router, sortedThreads])
	/* v8 ignore stop -- @preserve */

	// Server-rendered deep links skip the client loader; mark the selected
	// result read once per selection without undoing a later unread choice.
	const readRequestedFor = useRef<string | null>(null)
	useEffect(() => {
		if (!selected || readRequestedFor.current === selected.thread.id) return
		readRequestedFor.current = selected.thread.id
		if (selected.thread.unread)
			markThreadReadOnOpen(queryClient, selected.thread.id, toMailThread(selected.thread))
	}, [queryClient, selected])

	return (
		<div className={layout.container}>
			<section className={layout.list} data-density={preferences.listDensity}>
				<Toolbar className="justify-between px-4">
					<h1 className="font-display text-base font-semibold capitalize">{title}</h1>
					<div className="flex items-center gap-1">
						{unreadCount > 0 ? (
							<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
								{unreadCount}
							</span>
						) : null}
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

				<div
					ref={listScrollRef}
					onScroll={(event) => {
						searchListScroll.identity = searchListIdentity(q, folderId)
						searchListScroll.top = event.currentTarget.scrollTop
					}}
					className={cn(
						'min-h-0 flex-1 overflow-y-auto',
						sortedThreads.length === 0 && canLoadMore && 'flex flex-col',
					)}
				>
					{sortedThreads.length === 0 ? (
						<div
							key={q}
							role="status"
							aria-live="polite"
							aria-atomic="true"
							className={cn(
								'flex flex-col items-center justify-center gap-1 px-6 text-center',
								canLoadMore ? 'min-h-0 flex-1 py-6' : 'h-full',
							)}
						>
							<p className="font-display text-sm font-semibold text-foreground">
								{hasSearchQuery
									? canLoadMore
										? 'More messages may be available'
										: 'No messages found'
									: 'Search your mail'}
							</p>
							<p className="text-sm text-muted-foreground">
								{hasSearchQuery
									? canLoadMore
										? 'Load the next page to continue searching.'
										: 'Try different keywords or clear the search.'
									: 'Enter keywords above to find messages.'}
							</p>
						</div>
					) : (
						sortedThreads.map((thread) => (
							<SearchThreadRow
								key={thread.id}
								thread={thread}
								q={q}
								searchFolderId={folderId}
								active={thread.id === threadId}
								keyboardActive={cursor === sortedThreads.indexOf(thread)}
							/>
						))
					)}
					{canLoadMore ? (
						<div className="border-t border-border p-3">
							{threadsQuery.isFetchNextPageError ? (
								<p
									id="search-pagination-error"
									role="alert"
									className="mb-2 text-center text-xs text-destructive"
								>
									Could not load more results. Check your connection, then try again.
								</p>
							) : null}
							<button
								type="button"
								onClick={() => void loadMoreSearchResults()}
								disabled={threadsQuery.isFetchingNextPage}
								aria-busy={threadsQuery.isFetchingNextPage}
								aria-describedby={threadsQuery.isFetchNextPageError ? 'search-pagination-error' : undefined}
								className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
							>
								{threadsQuery.isFetchingNextPage ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" /> Loading more search results…
									</>
								) : threadsQuery.isFetchNextPageError ? (
									'Try loading more search results'
								) : (
									'Load more search results'
								)}
							</button>
						</div>
					) : null}
				</div>
			</section>
			<section className={layout.reader}>
				{selected ? (
					<SearchThreadDetail
						key={JSON.stringify([selected.thread.id, q, folderId ?? null])}
						selected={selected}
						q={q}
						folderId={folderId}
					/>
				) : (
					<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center xl:flex">
						<div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
							<Reply className="h-6 w-6" />
						</div>
						<div>
							<p className="font-display text-sm font-semibold text-foreground">Select a conversation</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Choose a message from the list to read it here.
							</p>
						</div>
					</div>
				)}
			</section>
		</div>
	)
}

function SearchThreadRow({
	thread,
	q,
	searchFolderId,
	active,
	keyboardActive,
}: {
	thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]
	q: string
	searchFolderId?: string
	active: boolean
	keyboardActive: boolean
}) {
	const folderId = threadRouteFolderId(thread)
	const updateThread = useUpdateThreadMutation()
	// The star shown is the thread's own, except while a toggle is in flight.
	const [requestedStar, setRequestedStar] = useState<boolean | null>(null)
	const starPending = requestedStar !== null
	const starred = requestedStar ?? Boolean(thread.starred)

	async function toggleStar() {
		/* v8 ignore next -- the star control is disabled while its request is pending -- @preserve */
		if (starPending) return
		const nextStarred = !starred
		setRequestedStar(nextStarred)
		try {
			await updateThread.mutateAsync({ threadId: thread.id, starred: nextStarred })
		} catch {
			// The mutation gateway has already restored the cached thread.
		} finally {
			setRequestedStar(null)
		}
	}
	const optimisticThread = starred === Boolean(thread.starred) ? thread : { ...thread, starred }

	return (
		<div
			data-nav-row=""
			data-active={active ? 'true' : undefined}
			data-nav-cursor={keyboardActive ? 'true' : undefined}
			data-unread={optimisticThread.unread ? 'true' : undefined}
			className={cn(THREAD_ROW_CLASS, optimisticThread.unread && 'bg-card/80')}
			tabIndex={-1}
		>
			<Link
				to="/mail/search"
				search={{ q, ...(searchFolderId ? { folderId: searchFolderId } : {}), threadId: thread.id }}
				aria-label={threadRowLinkLabel(optimisticThread, folderId)}
				aria-current={active ? 'true' : undefined}
				className={THREAD_ROW_LINK_CLASS}
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

function SearchThreadDetail({
	selected,
	q,
	folderId,
}: {
	selected: { thread: Thread; messages: Message[]; mailboxEmail: string }
	q: string
	folderId?: string
}) {
	const [{ readingPane }] = useUserPreferences()
	const router = useRouter()
	const updateThread = useUpdateThreadMutation()
	const routeFolderId = threadRouteFolderId(selected.thread)
	const lastMessage = selected.messages.at(-1)
	const searchList = useMemo(() => searchListSearch(q, folderId), [folderId, q])
	const isArchived = folderId === 'archive' || selected.thread.folders?.includes('archive') === true
	const [error, setError] = useState<string | null>(null)
	// The optimistic mutation writes the star into the cached thread, so the
	// control reads the same source as the conversation beside it.
	const starred = Boolean(selected.thread.starred)
	const [pendingAction, setPendingAction] = useState<PendingSearchThreadAction | null>(null)
	const pendingActionRef = useRef<PendingSearchThreadAction | null>(null)
	const currentReaderRef = useRef(true)

	useEffect(() => {
		currentReaderRef.current = true
		return () => {
			currentReaderRef.current = false
		}
	}, [])

	const reply = () => {
		/* v8 ignore next -- every exposed search reply entry point requires a latest message -- @preserve */
		if (!lastMessage) return
		router.navigate({
			to: '/mail/compose',
			search: {
				folderId: routeFolderId,
				threadId: selected.thread.id,
				...replyDraftSearch(lastMessage),
			},
		})
	}
	const replyAll = () => {
		/* v8 ignore next -- every exposed search reply-all entry point requires a latest message -- @preserve */
		if (!lastMessage) return
		router.navigate({
			to: '/mail/compose',
			search: {
				folderId: routeFolderId,
				threadId: selected.thread.id,
				...replyAllDraftSearch(lastMessage, selected.mailboxEmail),
			},
		})
	}
	const forward = () => {
		/* v8 ignore next -- every exposed search forward entry point requires a latest message -- @preserve */
		if (!lastMessage) return
		router.navigate({
			to: '/mail/compose',
			search: {
				folderId: routeFolderId,
				threadId: selected.thread.id,
				...forwardDraftSearch(lastMessage),
			},
		})
	}

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === 'Escape') {
				event.preventDefault()
				router.navigate({
					to: '/mail/search',
					search: searchList,
				})
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [router, searchList])

	async function act(
		action: PendingSearchThreadAction,
		input: { starred?: boolean; folder?: string },
		leave = false,
	) {
		if (pendingActionRef.current) return
		pendingActionRef.current = action
		setError(null)
		setPendingAction(action)
		try {
			await updateThread.mutateAsync({ threadId: selected.thread.id, ...input })
			if (!currentReaderRef.current) return
			if (leave) {
				await router.navigate({
					to: '/mail/search',
					search: searchList,
				})
			}
		} catch {
			if (!currentReaderRef.current) return
			setError('Action failed')
		} finally {
			pendingActionRef.current = null
			if (currentReaderRef.current) setPendingAction(null)
		}
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
			<Toolbar className="gap-1 px-3">
				<Link
					to="/mail/search"
					search={searchList}
					aria-label="Back to list"
					className={cn(
						'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						!readingPaneLayout(readingPane, true).wideBackControl && 'xl:hidden',
					)}
				>
					<ArrowLeft className="h-5 w-5" />
				</Link>
				<IconButton
					label={
						pendingAction === 'archive'
							? 'Archiving'
							: pendingAction === 'restore'
								? 'Returning to inbox'
								: isArchived
									? 'Return to inbox'
									: 'Archive'
					}
					disabled={pendingAction !== null}
					loading={pendingAction === 'archive' || pendingAction === 'restore'}
					onClick={() =>
						act(isArchived ? 'restore' : 'archive', { folder: isArchived ? 'inbox' : 'archive' }, true)
					}
				>
					{pendingAction === 'archive' || pendingAction === 'restore' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : isArchived ? (
						<Inbox className="h-4 w-4" />
					) : (
						<Archive className="h-4 w-4" />
					)}
				</IconButton>
				<IconButton
					label={pendingAction === 'delete' ? 'Deleting' : 'Delete'}
					disabled={pendingAction !== null}
					loading={pendingAction === 'delete'}
					onClick={() => act('delete', { folder: 'trash' }, true)}
				>
					{pendingAction === 'delete' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Trash2 className="h-4 w-4" />
					)}
				</IconButton>
				<IconButton
					label={
						pendingAction === 'star' ? (starred ? 'Starring' : 'Unstarring') : starred ? 'Unstar' : 'Star'
					}
					disabled={pendingAction !== null}
					loading={pendingAction === 'star'}
					onClick={() => act('star', { starred: !starred })}
				>
					{pendingAction === 'star' ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Star className={cn('h-4 w-4', starred && STAR_FILLED_CLASS)} />
					)}
				</IconButton>

				{lastMessage ? (
					<div className="ml-auto hidden items-center gap-1 sm:flex">
						<ActionButton label="Reply" onClick={reply}>
							<Reply className="h-4 w-4" />
						</ActionButton>
						<ActionButton label="Reply all" onClick={replyAll}>
							<ReplyAll className="h-4 w-4" />
						</ActionButton>
						<ActionButton label="Forward" onClick={forward}>
							<Forward className="h-4 w-4" />
						</ActionButton>
					</div>
				) : null}
			</Toolbar>
			{error ? (
				<p role="alert" className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</p>
			) : null}

			<div
				// The reading position belongs to one conversation.
				data-scroll-restoration-id={`thread:${selected.thread.id}`}
				className="min-h-0 flex-1 overflow-y-auto"
			>
				<ThreadConversation thread={selected.thread} messages={selected.messages} />
			</div>

			{lastMessage ? (
				<>
					<MobileThreadResponseActions onReply={reply} onReplyAll={replyAll} onForward={forward} />
					<button
						type="button"
						onClick={reply}
						className="mx-5 my-3 hidden min-h-11 items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring/30 hover:bg-muted/50 hover:text-foreground md:flex lg:mx-8"
					>
						<Reply className="h-4 w-4 shrink-0" />
						<span>Write a reply…</span>
					</button>
				</>
			) : null}
		</div>
	)
}

function IconButton({
	label,
	onClick,
	disabled = false,
	loading = false,
	children,
}: {
	label: string
	onClick?: () => void
	disabled?: boolean
	loading?: boolean
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			disabled={disabled && !loading}
			aria-disabled={disabled || undefined}
			aria-busy={loading || undefined}
			className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50 xl:h-9 xl:w-9"
		>
			{children}
		</button>
	)
}

function ActionButton({
	label,
	onClick,
	children,
}: {
	label: string
	onClick?: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:h-9 xl:w-9"
		>
			{children}
		</button>
	)
}
