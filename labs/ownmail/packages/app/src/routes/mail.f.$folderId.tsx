import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { Loader2, Reply, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClientListDate } from '../components/ClientTime.js'
import { edgeCursor, listNavAction, moveCursor } from '../components/list-nav.js'
import { THREAD_ROW_CLASS, ThreadRowContent } from '../components/ThreadRow.js'
import { cn, draftRecipientName, mailFolderTitle, threadTimestamp } from '../components/ui-model.js'
import { getFolders, getThreads, listDrafts, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/f/$folderId')({
	validateSearch: (search): { baseFolderId?: string } => ({
		...(typeof search.baseFolderId === 'string' ? { baseFolderId: search.baseFolderId } : {}),
	}),
	loader: async ({ params }) => loadMailFolderData(params.folderId),
	component: FolderView,
})

export async function loadMailFolderData(folderId: string) {
	const folders = await getFolders()
	if (folderId === 'drafts') {
		return {
			threads: [] as Thread[],
			drafts: await listDrafts(),
			folders,
			nextCursor: undefined as string | undefined,
		}
	}
	if (folderId === 'starred') {
		const res = await getThreads({ data: { starred: true } })
		return { ...res, drafts: [] as Draft[], folders }
	}
	const res = await getThreads({ data: { folderId } })
	return { ...res, drafts: [] as Draft[], folders }
}

type MailFolderRouteData = Awaited<ReturnType<typeof loadMailFolderData>>

function FolderView() {
	const loaderData = Route.useLoaderData()
	const { folderId } = Route.useParams()
	const { baseFolderId } = Route.useSearch()

	return <MailFolderRouteScreen {...loaderData} folderId={folderId} baseFolderId={baseFolderId} />
}

export function MailFolderRouteScreen({
	threads: initialThreads,
	drafts,
	folders,
	folderId,
	baseFolderId,
	nextCursor: initialCursor,
}: MailFolderRouteData & { folderId: string; baseFolderId?: string }) {
	const folderTitle = mailFolderTitle(folderId, folders)
	const router = useRouter()
	const navigate = useNavigate()
	const [extraThreads, setExtraThreads] = useState<Thread[]>([])
	const [nextCursor, setNextCursor] = useState(initialCursor)
	const [loadingMore, setLoadingMore] = useState(false)
	const [cursor, setCursor] = useState(-1)
	const listScrollRef = useRef<HTMLDivElement>(null)
	const moveFocusToCursorRef = useRef(false)
	const hasThread = useRouterState({
		select: (state) =>
			state.location.pathname.includes('/t/') ||
			state.matches.some((match) => match.routeId === '/mail/f/$folderId/t/$threadId'),
	})
	const threads = useMemo(() => [...initialThreads, ...extraThreads], [extraThreads, initialThreads])
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length

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
		setExtraThreads([])
		setNextCursor(initialCursor)
		setCursor(-1)
	}, [folderId, initialCursor])

	// Keep the cursored row visible as it walks past the fold.
	useEffect(() => {
		if (cursor < 0) return
		const rows = listScrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]')
		rows?.[cursor]?.scrollIntoView({ block: 'nearest' })
		if (moveFocusToCursorRef.current) {
			rows?.[cursor]?.focus()
			moveFocusToCursorRef.current = false
		}
	}, [cursor])

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
			const focusedRowIndex = focusedRow
				? Array.from(listScrollRef.current!.querySelectorAll<HTMLElement>('[data-nav-row]')).indexOf(
						focusedRow,
					)
				: -1
			// Keep nested row actions and unrelated links in control of their keys,
			// but let a focused thread row continue list navigation.
			if (target?.closest?.('button, select') || (target?.closest?.('a') && focusedRowIndex < 0)) return
			if (document.querySelector('[role="dialog"]')) return
			const action = listNavAction(event.key)
			if (!action) return
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
	}, [cursor, navItems.length, openItem])

	// Light-touch realtime: refresh the list every 30s while the tab is visible.
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') router.invalidate()
		}, 30_000)
		return () => clearInterval(timer)
	}, [router])

	async function loadMore() {
		/* v8 ignore next -- defensive guard: the Load-more button only renders when a cursor exists, is disabled while loading, and never appears in the drafts folder, so this early return is unreachable from the UI */
		if (!nextCursor || loadingMore || folderId === 'drafts') return
		setLoadingMore(true)
		try {
			const res = await getThreads({
				data: {
					...(folderId === 'starred' ? { starred: true } : { folderId }),
					pageToken: nextCursor,
				},
			})
			setExtraThreads((current) => [...current, ...res.threads])
			setNextCursor(res.nextCursor)
		} finally {
			setLoadingMore(false)
		}
	}

	return (
		<>
			<section
				className={cn(
					'h-full min-w-0 flex-1 flex-col border-r border-border bg-card/50 md:flex md:w-[22rem] md:max-w-[22rem] md:flex-none',
					hasThread ? 'hidden' : 'flex',
				)}
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
					<h1 className="font-display text-base font-semibold capitalize">{folderTitle}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
							{unreadCount}
						</span>
					) : null}
				</div>

				<div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
					{folderId === 'drafts' ? (
						drafts.length === 0 ? (
							<EmptyState />
						) : (
							drafts.map((draft, index) => (
								<DraftRow key={draft.id} draft={draft} navActive={cursor === index} />
							))
						)
					) : sortedThreads.length === 0 ? (
						<EmptyState />
					) : (
						<>
							{sortedThreads.map((thread, index) => (
								<ThreadRow
									key={thread.id}
									thread={thread}
									folderId={folderId}
									baseFolderId={baseFolderId}
									navActive={cursor === index}
									onChanged={() => router.invalidate()}
								/>
							))}
							{nextCursor ? (
								<div className="border-t border-border p-3">
									<button
										type="button"
										onClick={loadMore}
										disabled={loadingMore}
										className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
									>
										{loadingMore ? (
											<>
												<Loader2 className="h-4 w-4 animate-spin" /> Loading…
											</>
										) : (
											'Load more'
										)}
									</button>
								</div>
							) : null}
						</>
					)}
				</div>
			</section>
			<section className={cn('min-w-0 flex-1 flex-col bg-background', hasThread ? 'flex' : 'hidden md:flex')}>
				{hasThread ? (
					<Outlet />
				) : (
					<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center md:flex">
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
		</>
	)
}

function EmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
			<p className="font-display text-sm font-semibold text-foreground">All caught up</p>
			<p className="text-sm text-muted-foreground">No messages in this folder.</p>
		</div>
	)
}

function DraftRow({ draft, navActive }: { draft: Draft; navActive: boolean }) {
	const recipient = draftRecipientName(draft)
	return (
		<Link
			to="/mail/compose"
			search={{ draft: draft.id, folderId: 'drafts' }}
			data-nav-row=""
			data-nav-cursor={navActive ? 'true' : undefined}
			className="thread-row group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 pl-5 text-left outline-none focus-visible:bg-accent"
		>
			<div className="flex items-center gap-2">
				<span className="shrink-0 text-muted-foreground">
					<Star className="h-4 w-4" />
				</span>
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">{recipient}</span>
				{draft.date ? (
					<ClientListDate
						epochSeconds={draft.date}
						className="shrink-0 text-xs tabular-nums text-muted-foreground"
					/>
				) : null}
			</div>
			<p className="truncate text-sm text-foreground/80">{draft.subject || '(no subject)'}</p>
			<p className="min-w-0 truncate text-xs text-muted-foreground">{draft.snippet}</p>
		</Link>
	)
}

function ThreadRow({
	thread,
	folderId,
	baseFolderId,
	navActive,
	onChanged,
}: {
	thread: Thread
	folderId: string
	baseFolderId?: string
	navActive: boolean
	onChanged: () => void
}) {
	const [starred, setStarred] = useState(thread.starred)
	const [starPending, setStarPending] = useState(false)

	useEffect(() => {
		setStarred(thread.starred)
	}, [thread.starred])

	async function toggleStar() {
		/* v8 ignore next -- the star control is disabled while its request is pending */
		if (starPending) return
		const nextStarred = !starred
		setStarred(nextStarred)
		setStarPending(true)
		try {
			await updateThreadState({ data: { threadId: thread.id, starred: nextStarred } })
			onChanged()
			/* v8 ignore next 3 -- a failed optimistic mutation restores the rendered value before re-enabling the control */
		} catch {
			setStarred(!nextStarred)
		} finally {
			setStarPending(false)
		}
	}
	const optimisticThread = starred === thread.starred ? thread : { ...thread, starred }

	return (
		<Link
			to="/mail/f/$folderId/t/$threadId"
			params={{ folderId, threadId: thread.id }}
			search={baseFolderId ? { baseFolderId } : {}}
			className={cn(THREAD_ROW_CLASS, optimisticThread.unread && 'bg-card/80')}
			activeProps={{ 'data-active': 'true' }}
			data-nav-row=""
			data-nav-cursor={navActive ? 'true' : undefined}
			data-unread={optimisticThread.unread ? 'true' : undefined}
		>
			<ThreadRowContent
				thread={optimisticThread}
				folderId={folderId}
				onToggleStar={toggleStar}
				starPending={starPending}
			/>
		</Link>
	)
}
