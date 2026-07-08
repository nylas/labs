import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Paperclip, Star } from 'lucide-react'
import {
	cn,
	formatListDate,
	labelBadgeClass,
	threadLabels,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import { getThreads, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/search')({
	validateSearch: (search): { q: string } => ({ q: String(search.q ?? '') }),
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: async ({ deps }) => getThreads({ data: { q: deps.q } }),
	component: SearchResults,
})

function SearchResults() {
	const { threads } = Route.useLoaderData()
	const { q } = Route.useSearch()
	return (
		<section className="h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<h1 className="text-base font-semibold">Search</h1>
					<p className="text-xs text-muted-foreground">
						{threads.length} result{threads.length === 1 ? '' : 's'} for "{q}"
					</p>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{threads.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
						<p className="text-sm font-medium text-foreground">Nothing here</p>
						<p className="text-sm text-muted-foreground">Try a different search.</p>
					</div>
				) : (
					threads.map((thread) => <SearchThreadRow key={thread.id} thread={thread} />)
				)}
			</div>
		</section>
	)
}

function SearchThreadRow({ thread }: { thread: Awaited<ReturnType<typeof getThreads>>['threads'][number] }) {
	const folderId =
		thread.folders?.find((folder) => !['work', 'personal', 'finance', 'travel'].includes(folder)) ?? 'inbox'
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
