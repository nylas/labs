import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { Paperclip, Reply, Star } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import {
	cn,
	draftRecipientList,
	formatListDate,
	labelBadgeClass,
	mailFolderTitle,
	threadLabels,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import { getFolders, getThreads, listDrafts, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/f/$folderId')({
	loader: async ({ params }) => {
		const folders = await getFolders()
		if (params.folderId === 'drafts') {
			return { threads: [] as Thread[], drafts: await listDrafts(), folders }
		}
		if (params.folderId === 'starred') {
			const res = await getThreads({ data: { starred: true } })
			return { ...res, drafts: [] as Draft[], folders }
		}
		const res = await getThreads({ data: { folderId: params.folderId } })
		return { ...res, drafts: [] as Draft[], folders }
	},
	component: FolderView,
})

function FolderView() {
	const { threads, drafts, folders } = Route.useLoaderData()
	const { folderId } = Route.useParams()
	const folderTitle = mailFolderTitle(folderId, folders)
	const router = useRouter()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	const hasThread = pathname.includes('/t/')
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length

	// Light-touch realtime: refresh the list every 30s while the tab is visible.
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') router.invalidate()
		}, 30_000)
		return () => clearInterval(timer)
	}, [router])

	return (
		<>
			<section
				className={cn(
					'h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none',
					hasThread ? 'hidden' : 'flex',
				)}
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h1 className="text-base font-semibold">{folderTitle}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
							{unreadCount} unread
						</span>
					) : null}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{folderId === 'drafts' ? (
						drafts.length === 0 ? (
							<EmptyState />
						) : (
							drafts.map((draft) => <DraftRow key={draft.id} draft={draft} />)
						)
					) : sortedThreads.length === 0 ? (
						<EmptyState />
					) : (
						sortedThreads.map((thread) => (
							<ThreadRow
								key={thread.id}
								thread={thread}
								folderId={folderId}
								onChanged={() => router.invalidate()}
							/>
						))
					)}
				</div>
			</section>
			<section className={cn('min-w-0 flex-1 flex-col bg-background', hasThread ? 'flex' : 'hidden md:flex')}>
				{hasThread ? (
					<Outlet />
				) : (
					<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-center md:flex">
						<div className="flex h-14 w-14 items-center justify-center rounded-sm bg-muted text-muted-foreground">
							<Reply className="h-6 w-6" />
						</div>
						<div>
							<p className="text-sm font-medium text-foreground">Select a conversation</p>
							<p className="text-sm text-muted-foreground">Choose a message from the list to read it here.</p>
						</div>
					</div>
				)}
			</section>
		</>
	)
}

function EmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<p className="text-sm font-medium text-foreground">Nothing here</p>
			<p className="text-sm text-muted-foreground">This view is empty.</p>
		</div>
	)
}

function DraftRow({ draft }: { draft: Draft }) {
	return (
		<Link
			to="/mail/compose"
			search={{ draft: draft.id }}
			className="group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent"
		>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Draft</span>
				<span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
					Saved
				</span>
			</div>
			<p className="truncate text-sm font-semibold text-foreground">To: {draftRecipientList(draft)}</p>
			<p className="min-w-0 truncate text-xs text-muted-foreground">
				{draft.subject || '(no subject)'} · {draft.snippet}
			</p>
		</Link>
	)
}

function ThreadRow({
	thread,
	folderId,
	onChanged,
}: {
	thread: Thread
	folderId: string
	onChanged: () => void
}) {
	const when = formatListDate(threadTimestamp(thread))
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
			className={cn(
				'group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent',
				thread.unread && 'bg-card',
			)}
			activeProps={{ className: 'bg-accent hover:bg-accent' }}
		>
			{thread.unread ? <span className="absolute top-0 left-0 h-full w-0.5 bg-primary" aria-hidden /> : null}
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={toggleStar}
					aria-label={thread.starred ? 'Unstar' : 'Star'}
					className="shrink-0 text-muted-foreground transition-colors hover:text-event-amber"
				>
					<Star className={cn('h-4 w-4', thread.starred && 'fill-event-amber text-event-amber')} />
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
				{when ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span> : null}
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
					<span
						key={label.id}
						className={cn(
							'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
							labelBadgeClass(label.tone),
						)}
					>
						{label.name}
					</span>
				))}
			</div>
		</Link>
	)
}
