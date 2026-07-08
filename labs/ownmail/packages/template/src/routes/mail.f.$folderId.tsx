import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { Loader2, Paperclip, Reply, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ClientListDate } from '../components/ClientTime.js'
import {
	cn,
	draftRecipientName,
	labelBadgeClass,
	mailFolderTitle,
	STAR_FILLED_CLASS,
	STAR_HOVER_CLASS,
	threadLabels,
	threadMaskFromMailLocation,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
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
	const [extraThreads, setExtraThreads] = useState<Thread[]>([])
	const [nextCursor, setNextCursor] = useState(initialCursor)
	const [loadingMore, setLoadingMore] = useState(false)
	const publicPathname = useRouterState({
		select: (state) => state.location.maskedLocation?.pathname ?? state.location.pathname,
	})
	const hasThread = useRouterState({
		select: (state) =>
			state.location.pathname.includes('/t/') ||
			state.matches.some((match) => match.routeId === '/mail/f/$folderId/t/$threadId'),
	})
	const threadMask = threadMaskFromMailLocation(publicPathname)
	const threads = useMemo(() => [...initialThreads, ...extraThreads], [extraThreads, initialThreads])
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset paginated threads when the folder changes
	useEffect(() => {
		setExtraThreads([])
		setNextCursor(initialCursor)
	}, [folderId, initialCursor])

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
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h1 className="font-display text-base font-semibold capitalize">{folderTitle}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
							{unreadCount}
						</span>
					) : null}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{folderId === 'drafts' ? (
						drafts.length === 0 ? (
							<EmptyState />
						) : (
							drafts.map((draft) => <DraftRow key={draft.id} draft={draft} mask={threadMask} />)
						)
					) : sortedThreads.length === 0 ? (
						<EmptyState />
					) : (
						<>
							{sortedThreads.map((thread) => (
								<ThreadRow
									key={thread.id}
									thread={thread}
									folderId={folderId}
									baseFolderId={baseFolderId}
									mask={threadMask}
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

function DraftRow({ draft, mask }: { draft: Draft; mask?: { to: '/' } }) {
	const recipient = draftRecipientName(draft)
	return (
		<Link
			to="/mail/f/$folderId/t/$threadId"
			params={{ folderId: 'drafts', threadId: draft.id }}
			{...(mask ? { mask } : {})}
			className="group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent"
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
	mask,
	onChanged,
}: {
	thread: Thread
	folderId: string
	baseFolderId?: string
	mask?: { to: '/' }
	onChanged: () => void
}) {
	const sender = threadSender(thread, folderId)
	const labels = threadLabels(thread)

	async function toggleStar(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault()
		event.stopPropagation()
		await updateThreadState({ data: { threadId: thread.id, starred: !thread.starred } })
		onChanged()
	}

	return (
		<Link
			to="/mail/f/$folderId/t/$threadId"
			params={{ folderId, threadId: thread.id }}
			search={baseFolderId ? { baseFolderId } : {}}
			{...(mask ? { mask } : {})}
			className={cn(
				'thread-row group flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 pl-5 text-left outline-none focus-visible:bg-accent',
				thread.unread && 'bg-card/80',
			)}
			activeProps={{ 'data-active': 'true' }}
			data-unread={thread.unread ? 'true' : undefined}
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={toggleStar}
					aria-label={thread.starred ? 'Unstar' : 'Star'}
					className={cn('shrink-0 text-muted-foreground transition-colors', STAR_HOVER_CLASS)}
				>
					<Star className={cn('h-4 w-4', thread.starred && STAR_FILLED_CLASS)} />
				</button>
				<span
					className={cn(
						'min-w-0 flex-1 truncate text-sm',
						thread.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
					)}
				>
					{sender}
					{(thread.message_ids?.length ?? 0) > 1 ? (
						<span className="ml-1 font-normal text-muted-foreground">({thread.message_ids?.length})</span>
					) : null}
				</span>
				{thread.has_attachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
				<ClientListDate
					epochSeconds={threadTimestamp(thread)}
					className="shrink-0 text-xs tabular-nums text-muted-foreground"
				/>
			</div>

			<p
				className={cn(
					'truncate text-sm',
					thread.unread ? 'font-semibold text-foreground' : 'text-foreground/80',
				)}
			>
				{thread.subject || '(no subject)'}
			</p>
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{thread.snippet}</p>
				{labels.map((label) => (
					<span key={label.id} className={cn('shrink-0', labelBadgeClass(label.tone))}>
						{label.name}
					</span>
				))}
			</div>
		</Link>
	)
}
