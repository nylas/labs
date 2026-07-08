import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Paperclip, Reply, Star } from 'lucide-react'
import { useMemo } from 'react'
import {
	cn,
	formatListDate,
	labelBadgeClass,
	mailFolderTitle,
	threadLabels,
	threadRouteFolderId,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import { getFolders, getThreads, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/search')({
	validateSearch: (search): { q: string; folderId?: string } => ({
		q: String(search.q ?? ''),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
	}),
	loaderDeps: ({ search }) => ({ q: search.q, folderId: search.folderId }),
	loader: async ({ deps }) => {
		const [folders, res] = await Promise.all([
			getFolders(),
			getThreads({
				data: {
					q: deps.q,
					...(deps.folderId === 'starred'
						? { starred: true }
						: deps.folderId
							? { folderId: deps.folderId }
							: {}),
				},
			}),
		])
		return { ...res, folders, folderId: deps.folderId }
	},
	component: SearchResults,
})

function SearchResults() {
	const { threads, folders, folderId } = Route.useLoaderData()
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length
	const title = mailFolderTitle(folderId ?? 'inbox', folders)
	return (
		<>
			<section className="h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h1 className="text-base font-semibold capitalize">{title}</h1>
					{unreadCount > 0 ? (
						<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
							{unreadCount} unread
						</span>
					) : null}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{sortedThreads.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
							<p className="text-sm font-medium text-foreground">Nothing here</p>
							<p className="text-sm text-muted-foreground">This view is empty.</p>
						</div>
					) : (
						sortedThreads.map((thread) => <SearchThreadRow key={thread.id} thread={thread} />)
					)}
				</div>
			</section>
			<section className="hidden min-w-0 flex-1 flex-col bg-background md:flex">
				<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-center md:flex">
					<div className="flex h-14 w-14 items-center justify-center rounded-sm bg-muted text-muted-foreground">
						<Reply className="h-6 w-6" />
					</div>
					<div>
						<p className="text-sm font-medium text-foreground">Select a conversation</p>
						<p className="text-sm text-muted-foreground">Choose a message from the list to read it here.</p>
					</div>
				</div>
			</section>
		</>
	)
}

function SearchThreadRow({ thread }: { thread: Awaited<ReturnType<typeof getThreads>>['threads'][number] }) {
	const folderId = threadRouteFolderId(thread)
	const when = formatListDate(threadTimestamp(thread))
	const labels = threadLabels(thread)
	const router = useRouter()

	async function toggleStar(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault()
		event.stopPropagation()
		await updateThreadState({ data: { threadId: thread.id, starred: !thread.starred } })
		router.invalidate()
	}

	return (
		<Link
			to="/mail/f/$folderId/t/$threadId"
			params={{ folderId, threadId: thread.id }}
			className={cn(
				'group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent',
				thread.unread && 'bg-card',
			)}
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
					{threadSender(thread, folderId)}
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
