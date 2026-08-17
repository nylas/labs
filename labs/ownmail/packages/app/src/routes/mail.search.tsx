import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Archive, ArrowLeft, Forward, Inbox, Loader2, Reply, ReplyAll, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ThreadConversation } from '#features/mail/components/ThreadConversation'
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
import { applyMailCacheEffect } from '#features/mail/state/mail-cache'
import { useUpdateThreadMutation } from '#features/mail/state/mail-mutations'
import {
	foldersQueryOptions,
	threadDetailQueryOptions,
	threadListQueryOptions,
	toMailFolder,
	toMailThread,
	toMailThreadDetail,
} from '#features/mail/state/mail-queries'
import { getFolders, getThreadMessages, getThreads } from '#server/fns'
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
	loader: async ({ deps }) => {
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
			hasSearchQuery && deps.threadId ? getThreadMessages({ data: { threadId: deps.threadId } }) : null,
		])
		return { ...res, folders, folderId: deps.folderId, selected }
	},
	component: SearchResults,
})

function SearchResults() {
	const initial = Route.useLoaderData()
	const { q, threadId } = Route.useSearch()
	const hasSearchQuery = q.trim().length > 0
	const router = useRouter()
	const queryClient = useQueryClient()
	const filters = {
		q,
		...(initial.folderId === 'starred'
			? { starred: true }
			: initial.folderId
				? { folderId: initial.folderId }
				: {}),
	}
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
	const listScrollRef = useRef<HTMLDivElement>(null)
	const moveFocusToCursorRef = useRef(false)
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
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
			rows?.[cursor]?.focus()
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

	useEffect(() => {
		if (selected?.markedRead) {
			applyMailCacheEffect(queryClient, {
				type: 'thread.read',
				threadId: selected.thread.id,
				unread: false,
				thread: selected.thread,
			})
		}
	}, [queryClient, selected])

	return (
		<>
			<section
				className={cn(
					'h-full min-w-0 flex-1 flex-col border-r border-border bg-card/50 xl:flex xl:w-[22rem] xl:max-w-[22rem] xl:flex-none',
					selected ? 'hidden' : 'flex',
				)}
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
					<h1 className="font-display text-base font-semibold capitalize">{title}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
							{unreadCount}
						</span>
					) : null}
				</div>

				<div
					ref={listScrollRef}
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
			<section className={cn('min-w-0 flex-1 flex-col bg-background', selected ? 'flex' : 'hidden xl:flex')}>
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
		</>
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
			await updateThread.mutateAsync({ threadId: thread.id, starred: nextStarred })
		} catch {
			/* v8 ignore next -- @preserve a failed optimistic mutation restores the rendered value before re-enabling the control */
			setStarred(!nextStarred)
		} finally {
			setStarPending(false)
		}
	}
	const optimisticThread = starred === thread.starred ? thread : { ...thread, starred }

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
	const router = useRouter()
	const updateThread = useUpdateThreadMutation()
	const routeFolderId = threadRouteFolderId(selected.thread)
	const lastMessage = selected.messages.at(-1)
	const searchList = useMemo(() => searchListSearch(q, folderId), [folderId, q])
	const isArchived = folderId === 'archive' || selected.thread.folders?.includes('archive') === true
	const [error, setError] = useState<string | null>(null)
	const [starred, setStarred] = useState(selected.thread.starred)
	const [pendingAction, setPendingAction] = useState<PendingSearchThreadAction | null>(null)
	const pendingActionRef = useRef<PendingSearchThreadAction | null>(null)
	const currentReaderRef = useRef(true)

	useEffect(() => {
		currentReaderRef.current = true
		return () => {
			currentReaderRef.current = false
		}
	}, [])

	useEffect(() => setStarred(selected.thread.starred), [selected.thread.starred])
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
		const previousStarred = starred
		if (typeof input.starred === 'boolean') setStarred(input.starred)
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
			if (typeof input.starred === 'boolean') setStarred(previousStarred)
			setError('Action failed')
		} finally {
			pendingActionRef.current = null
			if (currentReaderRef.current) setPendingAction(null)
		}
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
			<div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
				<Link
					to="/mail/search"
					search={searchList}
					aria-label="Back to list"
					className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
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
			</div>
			{error ? (
				<p role="alert" className="mx-4 mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</p>
			) : null}

			<div className="min-h-0 flex-1 overflow-y-auto">
				<ThreadConversation thread={selected.thread} messages={selected.messages} />
			</div>

			{lastMessage ? (
				<div className="shrink-0 border-t border-border bg-background px-5 py-3 lg:px-8">
					<MobileThreadResponseActions onReply={reply} onReplyAll={replyAll} onForward={forward} />
					<button
						type="button"
						onClick={reply}
						className="hidden w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring/30 hover:bg-muted/50 hover:text-foreground sm:flex"
					>
						<Reply className="h-4 w-4 shrink-0" />
						<span>Write a reply…</span>
					</button>
				</div>
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
			className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50"
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
			className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{children}
			<span className="hidden md:inline">{label}</span>
		</button>
	)
}
