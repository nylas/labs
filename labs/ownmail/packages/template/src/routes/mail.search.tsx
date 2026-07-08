import { createFileRoute, Link } from '@tanstack/react-router'
import { Paperclip } from 'lucide-react'
import { formatListDate, threadSender, threadTimestamp } from '../components/ui-model.js'
import { getThreads } from '../server/fns.js'

export const Route = createFileRoute('/mail/search')({
	validateSearch: (search): { q: string } => ({ q: String(search.q ?? '') }),
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: async ({ deps }) => getThreads({ data: { folderId: 'inbox', q: deps.q } }),
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
					threads.map((thread) => {
						const folderId = thread.folders?.[0] ?? 'inbox'
						return (
							<Link
								key={thread.id}
								to="/mail/f/$folderId/t/$threadId"
								params={{ folderId, threadId: thread.id }}
								className="group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent"
							>
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
										{threadSender(thread, folderId)}
									</span>
									{thread.has_attachments ? (
										<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									) : null}
									<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
										{formatListDate(threadTimestamp(thread))}
									</span>
								</div>
								<p className="truncate text-sm text-foreground/80">{thread.subject || '(no subject)'}</p>
								<p className="min-w-0 truncate text-xs text-muted-foreground">{thread.snippet}</p>
							</Link>
						)
					})
				)}
			</div>
		</section>
	)
}
