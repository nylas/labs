import { createFileRoute, Link } from '@tanstack/react-router'
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
		<div className="h-full overflow-y-auto">
			<p className="border-b border-neutral-100 px-4 py-2 text-sm text-neutral-500">
				{threads.length} result{threads.length === 1 ? '' : 's'} for “{q}”
			</p>
			<ul>
				{threads.map((thread) => (
					<li key={thread.id} className="border-b border-neutral-100">
						<Link
							to="/mail/f/$folderId/t/$threadId"
							params={{ folderId: thread.folders?.[0] ?? 'inbox', threadId: thread.id }}
							className="block px-4 py-3 hover:bg-neutral-50"
						>
							<div className="truncate text-sm font-medium">{thread.subject || '(no subject)'}</div>
							<div className="truncate text-xs text-neutral-500">{thread.snippet}</div>
						</Link>
					</li>
				))}
			</ul>
		</div>
	)
}
