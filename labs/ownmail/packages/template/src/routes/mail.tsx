import { createFileRoute, Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { getFolders, getMailboxInfo } from '../server/fns.js'

export const Route = createFileRoute('/mail')({
	loader: async () => {
		const [info, folders] = await Promise.all([getMailboxInfo(), getFolders()])
		return { info, folders }
	},
	component: MailLayout,
})

const FOLDER_ORDER = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']

/**
 * Near-realtime updates: poll the cheap /api/version signal every 10s and
 * refetch loaders only when the webhook receiver has bumped it.
 */
function useVersionPolling() {
	const router = useRouter()
	const last = useRef<number | null>(null)
	useEffect(() => {
		const timer = setInterval(async () => {
			if (document.visibilityState !== 'visible') return
			try {
				const res = await fetch('/api/version')
				if (!res.ok) return
				const { version } = (await res.json()) as { version: number }
				if (last.current !== null && version !== last.current) router.invalidate()
				last.current = version
			} catch {
				// transient network errors — next tick will retry
			}
		}, 10_000)
		return () => clearInterval(timer)
	}, [router])
}

function MailLayout() {
	const { info, folders } = Route.useLoaderData()
	const navigate = useNavigate()
	const [query, setQuery] = useState('')
	useVersionPolling()
	const sorted = [...folders].sort((a, b) => {
		const ai = FOLDER_ORDER.indexOf(a.id)
		const bi = FOLDER_ORDER.indexOf(b.id)
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
	})

	return (
		<div className="flex h-screen">
			<aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
				<div className="px-4 py-4">
					<div className="text-sm font-semibold tracking-tight">{info.appName}</div>
					<div className="truncate text-xs text-neutral-500" title={info.email}>
						{info.email}
					</div>
				</div>
				<Link
					to="/mail/compose"
					className="mx-3 mb-3 rounded-full bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white shadow-sm hover:bg-blue-700"
				>
					Compose
				</Link>
				<nav className="flex-1 overflow-y-auto px-2">
					{sorted.map((folder) => (
						<Link
							key={folder.id}
							to="/mail/f/$folderId"
							params={{ folderId: folder.id }}
							className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-200/60"
							activeProps={{ className: 'bg-blue-100 font-semibold text-blue-900 hover:bg-blue-100' }}
						>
							<span className="capitalize">{folder.name}</span>
							{folder.unread_count ? (
								<span className="text-xs font-semibold text-blue-700">{folder.unread_count}</span>
							) : null}
						</Link>
					))}
				</nav>
				<div className="space-y-1 border-t border-neutral-200 p-3 text-xs text-neutral-500">
					<Link to="/calendar/$view" params={{ view: 'month' }} className="block hover:text-neutral-800">
						📅 Calendar
					</Link>
					<div>
						<a href="/logout" className="hover:text-neutral-800">
							Sign out
						</a>
						<span className="mx-1">·</span>
						<span>Powered by Nylas</span>
					</div>
				</div>
			</aside>
			<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<div className="border-b border-neutral-200 px-4 py-2">
					<form
						onSubmit={(e) => {
							e.preventDefault()
							if (query.trim()) {
								navigate({ to: '/mail/search', search: { q: query.trim() } })
							}
						}}
					>
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search mail…"
							className="w-full max-w-xl rounded-full border border-neutral-200 bg-neutral-100 px-4 py-1.5 text-sm focus:border-blue-400 focus:bg-white focus:outline-none"
						/>
					</form>
				</div>
				<div className="min-h-0 flex-1 overflow-hidden">
					<Outlet />
				</div>
			</main>
		</div>
	)
}
