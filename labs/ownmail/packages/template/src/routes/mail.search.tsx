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
		<section className="folder-panel mail-main-full">
			<header className="folder-header">
				<h1 className="folder-title">Search</h1>
				<p className="muted-line">
					{threads.length} result{threads.length === 1 ? '' : 's'} for “{q}”
				</p>
			</header>
			<ul className="message-list">
				{threads.map((thread) => (
					<li key={thread.id}>
						<Link
							to="/mail/f/$folderId/t/$threadId"
							params={{ folderId: thread.folders?.[0] ?? 'inbox', threadId: thread.id }}
							className="message-row"
						>
							<div className="message-subject">{thread.subject || '(no subject)'}</div>
							<div className="message-snippet">{thread.snippet}</div>
						</Link>
					</li>
				))}
			</ul>
		</section>
	)
}
