import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { getThreads, listDrafts } from '../server/fns.js'

export const Route = createFileRoute('/mail/f/$folderId')({
	loader: async ({ params }) => {
		if (params.folderId === 'drafts') {
			return { threads: [] as Thread[], drafts: await listDrafts() }
		}
		const res = await getThreads({ data: { folderId: params.folderId } })
		return { ...res, drafts: [] as Draft[] }
	},
	component: FolderView,
})

function FolderView() {
	const { threads, drafts } = Route.useLoaderData()
	const { folderId } = Route.useParams()
	const router = useRouter()

	// Light-touch realtime: refresh the list every 30s while the tab is visible.
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') router.invalidate()
		}, 30_000)
		return () => clearInterval(timer)
	}, [router])

	return (
		<div className="flex h-full">
			<section className="w-96 shrink-0 overflow-y-auto border-r border-neutral-200">
				{folderId === 'drafts' ? (
					drafts.length === 0 ? (
						<p className="p-6 text-sm text-neutral-500">No drafts.</p>
					) : (
						<ul>
							{drafts.map((draft) => (
								<DraftRow key={draft.id} draft={draft} />
							))}
						</ul>
					)
				) : threads.length === 0 ? (
					<p className="p-6 text-sm text-neutral-500">Nothing here yet.</p>
				) : (
					<ul>
						{threads.map((thread) => (
							<ThreadRow key={thread.id} thread={thread} folderId={folderId} />
						))}
					</ul>
				)}
			</section>
			<section className="min-w-0 flex-1 overflow-y-auto">
				<Outlet />
			</section>
		</div>
	)
}

function DraftRow({ draft }: { draft: Draft }) {
	return (
		<li className="border-b border-neutral-100">
			<Link to="/mail/compose" search={{ draft: draft.id }} className="block px-4 py-3 hover:bg-neutral-50">
				<div className="truncate text-sm text-neutral-700">
					To: {draft.to?.map((p) => p.email).join(', ') || '(no recipient)'}
				</div>
				<div className="truncate text-sm font-medium">{draft.subject || '(no subject)'}</div>
				<div className="truncate text-xs text-neutral-400">{draft.snippet}</div>
			</Link>
		</li>
	)
}

function ThreadRow({ thread, folderId }: { thread: Thread; folderId: string }) {
	const from = thread.participants?.[0]
	const when = thread.latest_message_received_date ?? thread.latest_message_sent_date
	return (
		<li className="border-b border-neutral-100">
			<Link
				to="/mail/f/$folderId/t/$threadId"
				params={{ folderId, threadId: thread.id }}
				className="block px-4 py-3 hover:bg-neutral-50"
				activeProps={{ className: 'bg-blue-50 hover:bg-blue-50' }}
			>
				<div className="flex items-baseline justify-between gap-2">
					<span
						className={`truncate text-sm ${thread.unread ? 'font-semibold text-neutral-900' : 'text-neutral-700'}`}
					>
						{from?.name || from?.email || '(unknown sender)'}
					</span>
					{when ? <time className="shrink-0 text-xs text-neutral-400">{formatDate(when)}</time> : null}
				</div>
				<div className={`truncate text-sm ${thread.unread ? 'font-medium' : 'text-neutral-600'}`}>
					{thread.subject || '(no subject)'}
				</div>
				<div className="truncate text-xs text-neutral-400">{thread.snippet}</div>
			</Link>
		</li>
	)
}

function formatDate(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000)
	const now = new Date()
	if (date.toDateString() === now.toDateString()) {
		return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
	}
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
