import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
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
	const [filter, setFilter] = useState<'all' | 'unread' | 'starred'>('all')
	const visibleThreads = useMemo(() => {
		if (filter === 'unread') return threads.filter((thread) => thread.unread)
		if (filter === 'starred') return threads.filter((thread) => thread.starred)
		return threads
	}, [filter, threads])
	const unreadCount = threads.filter((thread) => thread.unread).length
	const starredCount = threads.filter((thread) => thread.starred).length

	// Light-touch realtime: refresh the list every 30s while the tab is visible.
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') router.invalidate()
		}, 30_000)
		return () => clearInterval(timer)
	}, [router])

	return (
		<>
			<section className="folder-panel">
				<header className="folder-header">
					<div className="flex items-end justify-between gap-3">
						<div>
							<h1 className="folder-title">{folderId}</h1>
							<p className="muted-line">
								{folderId === 'drafts'
									? `${drafts.length} draft${drafts.length === 1 ? '' : 's'}`
									: `${threads.length} thread${threads.length === 1 ? '' : 's'} · ${unreadCount} unread`}
							</p>
						</div>
						<button type="button" className="icon-btn" onClick={() => router.invalidate()} title="Refresh">
							↻
						</button>
					</div>
					{folderId !== 'drafts' ? (
						<fieldset className="mt-3 segmented">
							<legend className="sr-only">Thread filters</legend>
							<FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
								All
							</FilterButton>
							<FilterButton active={filter === 'unread'} onClick={() => setFilter('unread')}>
								Unread {unreadCount ? `(${unreadCount})` : ''}
							</FilterButton>
							<FilterButton active={filter === 'starred'} onClick={() => setFilter('starred')}>
								Starred {starredCount ? `(${starredCount})` : ''}
							</FilterButton>
						</fieldset>
					) : null}
				</header>
				{folderId === 'drafts' ? (
					drafts.length === 0 ? (
						<EmptyState title="No drafts" body="Saved drafts will wait here until you send or delete them." />
					) : (
						<ul className="message-list">
							{drafts.map((draft) => (
								<DraftRow key={draft.id} draft={draft} />
							))}
						</ul>
					)
				) : visibleThreads.length === 0 ? (
					<EmptyState
						title={filter === 'all' ? 'Nothing here yet' : `No ${filter} mail`}
						body="Change filters, search, or compose a new message."
					/>
				) : (
					<ul className="message-list">
						{visibleThreads.map((thread) => (
							<ThreadRow key={thread.id} thread={thread} folderId={folderId} />
						))}
					</ul>
				)}
			</section>
			<section className="detail-panel">
				<Outlet />
			</section>
		</>
	)
}

function FilterButton({
	active,
	onClick,
	children,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button type="button" className="tab-btn" data-active={active} onClick={onClick}>
			{children}
		</button>
	)
}

function EmptyState({ title, body }: { title: string; body: string }) {
	return (
		<div className="grid min-h-80 place-items-center p-6 text-center">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">{title}</h2>
				<p className="mt-1 max-w-xs text-sm text-neutral-500">{body}</p>
			</div>
		</div>
	)
}

function DraftRow({ draft }: { draft: Draft }) {
	return (
		<li>
			<Link to="/mail/compose" search={{ draft: draft.id }} className="message-row">
				<div className="message-row-top">
					<span className="sender">Draft</span>
					<span className="badge">Saved</span>
				</div>
				<div className="message-subject">
					To: {draft.to?.map((p) => p.email).join(', ') || '(no recipient)'}
				</div>
				<div className="message-snippet">
					{draft.subject || '(no subject)'} · {draft.snippet}
				</div>
			</Link>
		</li>
	)
}

function ThreadRow({ thread, folderId }: { thread: Thread; folderId: string }) {
	const from = thread.participants?.[0]
	const when = thread.latest_message_received_date ?? thread.latest_message_sent_date
	return (
		<li>
			<Link
				to="/mail/f/$folderId/t/$threadId"
				params={{ folderId, threadId: thread.id }}
				className={`message-row ${thread.unread ? 'message-row-unread' : ''}`}
				activeProps={{ className: 'message-row-active' }}
			>
				<div className="message-row-top">
					<span className="sender">
						{thread.starred ? <span title="Starred">★ </span> : null}
						{from?.name || from?.email || '(unknown sender)'}
					</span>
					{when ? <time className="shrink-0 text-xs text-neutral-500">{formatDate(when)}</time> : null}
				</div>
				<div className="message-subject">{thread.subject || '(no subject)'}</div>
				<div className="message-snippet">{thread.snippet}</div>
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
