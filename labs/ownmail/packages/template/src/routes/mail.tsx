import type { Folder } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router'
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
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
	const [commandOpen, setCommandOpen] = useState(false)
	useVersionPolling()
	const sorted = [...folders].sort((a, b) => {
		const ai = FOLDER_ORDER.indexOf(a.id)
		const bi = FOLDER_ORDER.indexOf(b.id)
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
	})
	const unreadCount = folders.reduce((sum, folder) => sum + (folder.unread_count ?? 0), 0)

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault()
				setCommandOpen(true)
				return
			}
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === '/') {
				event.preventDefault()
				document.getElementById('mail-search')?.focus()
			}
			if (event.key.toLowerCase() === 'c') {
				event.preventDefault()
				navigate({ to: '/mail/compose' })
			}
			if (event.key.toLowerCase() === 'g') {
				event.preventDefault()
				setCommandOpen(true)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [navigate])

	return (
		<div className="ownmail-shell">
			<header className="app-topbar">
				<div className="topbar-row">
					<div className="brand-lockup">
						<div className="brand-title">{info.appName}</div>
						<div className="brand-subtitle" title={info.email}>
							{info.email}
						</div>
					</div>
					<div className="topbar-actions">
						<button type="button" className="btn btn-quiet" onClick={() => setCommandOpen(true)}>
							<span>Command</span>
							<span className="kbd">⌘K</span>
						</button>
					</div>
				</div>
				<form
					className="search-field"
					onSubmit={(e) => {
						e.preventDefault()
						if (query.trim()) {
							navigate({ to: '/mail/search', search: { q: query.trim() } })
						}
					}}
				>
					<input
						id="mail-search"
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search mail, people, subjects"
						aria-label="Search mail"
						enterKeyHint="search"
						autoCapitalize="none"
					/>
				</form>
				<div className="topbar-actions">
					<Link to="/mail/compose" className="btn btn-primary">
						Compose
						<span className="kbd">C</span>
					</Link>
				</div>
			</header>
			<div className="mail-workbench">
				<aside className="mail-sidebar">
					<div className="folder-nav">
						<div className="muted-line">Unread now</div>
						<div className="brand-title">{unreadCount}</div>
					</div>
					<FolderNav folders={sorted} />
					<div className="mt-auto grid gap-2 p-4">
						<Link to="/calendar/$view" params={{ view: 'month' }} className="btn w-full">
							Calendar
						</Link>
						<a href="/logout" className="btn btn-quiet w-full">
							Sign out
						</a>
					</div>
				</aside>
				<main className="mail-main">
					<Outlet />
				</main>
			</div>
			<nav className="bottom-tabs" aria-label="Primary">
				<Link to="/mail/f/$folderId" params={{ folderId: 'inbox' }} className="bottom-tab">
					Inbox
				</Link>
				<Link to="/mail/f/$folderId" params={{ folderId: 'drafts' }} className="bottom-tab">
					Drafts
				</Link>
				<Link to="/mail/compose" className="bottom-tab">
					Compose
				</Link>
				<Link to="/calendar/$view" params={{ view: 'month' }} className="bottom-tab">
					Calendar
				</Link>
			</nav>
			{commandOpen ? (
				<CommandPalette
					folders={sorted}
					onClose={() => setCommandOpen(false)}
					onNavigate={(to) => {
						setCommandOpen(false)
						if (to === 'compose') navigate({ to: '/mail/compose' })
						else if (to === 'calendar') navigate({ to: '/calendar/$view', params: { view: 'month' } })
						else navigate({ to: '/mail/f/$folderId', params: { folderId: to } })
					}}
				/>
			) : null}
		</div>
	)
}

function FolderNav({ folders }: { folders: Folder[] }) {
	return (
		<nav className="folder-nav" aria-label="Folders">
			{folders.map((folder) => (
				<Link
					key={folder.id}
					to="/mail/f/$folderId"
					params={{ folderId: folder.id }}
					className="folder-link"
					activeProps={{ className: 'folder-link-active' }}
				>
					<span className="capitalize">{folder.name}</span>
					{folder.unread_count ? <span className="badge">{folder.unread_count}</span> : null}
				</Link>
			))}
		</nav>
	)
}

function CommandPalette({
	folders,
	onClose,
	onNavigate,
}: {
	folders: Folder[]
	onClose: () => void
	onNavigate: (target: string) => void
}) {
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const previousFocusRef = useRef<HTMLElement | null>(null)
	const commands = useMemo(
		() => [
			{ id: 'compose', label: 'Compose message', detail: 'Start a new email', shortcut: 'C' },
			{ id: 'calendar', label: 'Open calendar', detail: 'Month, week, and day views' },
			...folders.map((folder) => ({
				id: folder.id,
				label: `Open ${folder.name}`,
				detail: `${folder.total_count ?? 0} total · ${folder.unread_count ?? 0} unread`,
			})),
		],
		[folders],
	)
	const filtered = useMemo(
		() =>
			commands.filter((command) =>
				`${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()),
			),
		[commands, query],
	)

	useEffect(() => {
		previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
		inputRef.current?.focus()
		return () => {
			previousFocusRef.current?.focus()
		}
	}, [])

	function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		if (event.key === 'Escape') {
			event.preventDefault()
			onClose()
			return
		}
		if (event.key === 'Enter' && filtered[0]) {
			event.preventDefault()
			onNavigate(filtered[0].id)
			return
		}
		if (event.key !== 'Tab') return
		const focusable = Array.from(
			panelRef.current?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
			) ?? [],
		)
		if (focusable.length === 0) return
		const first = focusable[0]
		const last = focusable[focusable.length - 1]
		if (!first || !last) return
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault()
			last?.focus()
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault()
			first.focus()
		}
	}

	return (
		<div className="command-backdrop">
			<button
				type="button"
				className="command-dismiss"
				aria-label="Close command palette"
				onClick={onClose}
			/>
			<div
				ref={panelRef}
				className="command-panel"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				onKeyDown={onPanelKeyDown}
			>
				<input
					ref={inputRef}
					className="command-input"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Go to folder, compose, open calendar"
					aria-label="Command palette"
				/>
				<div className="command-list">
					{filtered.map((command, index) => (
						<button
							key={command.id}
							type="button"
							className="command-row"
							data-active={index === 0}
							onClick={() => onNavigate(command.id)}
						>
							<span>
								<strong>{command.label}</strong>
								<span className="block muted-line">{command.detail}</span>
							</span>
							{command.shortcut ? <span className="kbd">{command.shortcut}</span> : null}
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
