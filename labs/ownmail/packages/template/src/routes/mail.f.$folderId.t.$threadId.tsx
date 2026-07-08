import type { Message } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { getThreadMessages, sendMessage, updateThreadState } from '../server/fns.js'

export const Route = createFileRoute('/mail/f/$folderId/t/$threadId')({
	loader: async ({ params }) => getThreadMessages({ data: { threadId: params.threadId } }),
	component: ThreadView,
})

function ThreadView() {
	const { thread, messages } = Route.useLoaderData()
	const { folderId, threadId } = Route.useParams()
	const router = useRouter()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const lastMessage = messages.at(-1)

	const act = useCallback(
		async (input: { unread?: boolean; starred?: boolean; folder?: string }, leave = false) => {
			setError(null)
			try {
				await updateThreadState({ data: { threadId, ...input } })
				if (leave) {
					navigate({ to: '/mail/f/$folderId', params: { folderId } })
				}
				router.invalidate()
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Action failed')
			}
		},
		[folderId, navigate, router, threadId],
	)

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key.toLowerCase() === 'e') {
				event.preventDefault()
				act({ folder: 'archive' }, true)
			}
			if (event.key === '#') {
				event.preventDefault()
				act({ folder: 'trash' }, true)
			}
			if (event.key.toLowerCase() === 's') {
				event.preventDefault()
				act({ starred: !thread.starred })
			}
			if (event.key.toLowerCase() === 'u') {
				event.preventDefault()
				act({ unread: true }, true)
			}
			if (event.key === 'Escape') {
				event.preventDefault()
				navigate({ to: '/mail/f/$folderId', params: { folderId } })
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [act, folderId, navigate, thread.starred])

	return (
		<article className="thread-article">
			<div className="thread-toolbar">
				<Link to="/mail/f/$folderId" params={{ folderId }} className="btn btn-quiet">
					Back
				</Link>
				<ActionButton label="Archive" shortcut="E" onClick={() => act({ folder: 'archive' }, true)}>
					Archive
				</ActionButton>
				<ActionButton label="Delete" shortcut="#" danger onClick={() => act({ folder: 'trash' }, true)}>
					Delete
				</ActionButton>
				<ActionButton
					label={thread.starred ? 'Unstar' : 'Star'}
					shortcut="S"
					onClick={() => act({ starred: !thread.starred })}
				>
					{thread.starred ? 'Unstar' : 'Star'}
				</ActionButton>
				<ActionButton label="Mark unread" shortcut="U" onClick={() => act({ unread: true }, true)}>
					Mark unread
				</ActionButton>
			</div>
			{error ? <ErrorBanner message={error} /> : null}
			<h1 className="thread-title">{thread.subject || '(no subject)'}</h1>
			<div>
				{messages.map((message) => (
					<MessageCard key={message.id} message={message} />
				))}
			</div>
			{lastMessage ? <ReplyBox lastMessage={lastMessage} /> : null}
		</article>
	)
}

function ActionButton({
	label,
	onClick,
	children,
	shortcut,
	danger,
}: {
	label: string
	onClick: () => void
	children: React.ReactNode
	shortcut?: string
	danger?: boolean
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className={`btn ${danger ? 'btn-danger' : 'btn-quiet'}`}
		>
			<span>{children}</span>
			{shortcut ? <span className="kbd">{shortcut}</span> : null}
		</button>
	)
}

function MessageCard({ message }: { message: Message }) {
	const from = message.from?.[0]
	const attachments = (message.attachments ?? []).filter((a) => !a.is_inline)
	return (
		<div className="message-card">
			<header className="message-card-header">
				<div className="min-w-0">
					<span className="sender">{from?.name || from?.email}</span>
					{from?.name ? <span className="ml-2 text-xs text-neutral-500">{from.email}</span> : null}
				</div>
				{message.date ? (
					<time className="shrink-0 text-xs text-neutral-400">
						{new Date(message.date * 1000).toLocaleString()}
					</time>
				) : null}
			</header>
			<div className="p-4">
				<MessageBody message={message} />
			</div>
			{attachments.length > 0 ? (
				<footer className="flex flex-wrap gap-2 border-t border-neutral-100 px-4 py-3">
					{attachments.map((a) => (
						<a
							key={a.id}
							href={`/attachments/${encodeURIComponent(a.id)}?message_id=${encodeURIComponent(message.id)}`}
							className="btn btn-quiet min-h-9 px-3 text-xs"
							download={a.filename}
						>
							{a.filename ?? 'attachment'}
							{a.size ? <span className="text-neutral-400">({formatSize(a.size)})</span> : null}
						</a>
					))}
				</footer>
			) : null}
		</div>
	)
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MessageBody({ message }: { message: Message }) {
	// Email bodies are untrusted HTML. Render inside a sandboxed iframe so
	// scripts/styles can't touch the app; srcDoc keeps it same-process but inert.
	if (message.body) {
		return <iframe title="message" sandbox="" srcDoc={message.body} className="mail-frame" />
	}
	return <p className="whitespace-pre-wrap text-sm text-neutral-800">{message.snippet}</p>
}

function ReplyBox({ lastMessage }: { lastMessage: Message }) {
	const router = useRouter()
	const [body, setBody] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const replyTo = lastMessage.reply_to?.[0]?.email ?? lastMessage.from?.[0]?.email ?? ''

	async function submit() {
		setBusy(true)
		setError(null)
		try {
			await sendMessage({
				data: {
					to: replyTo,
					subject: lastMessage.subject?.startsWith('Re:')
						? lastMessage.subject
						: `Re: ${lastMessage.subject ?? ''}`,
					body: body.replaceAll('\n', '<br>'),
					replyToMessageId: lastMessage.id,
				},
			})
			setBody('')
			router.invalidate()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send')
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="reply-box">
			<p className="mb-2 text-xs text-neutral-500">Reply to {replyTo}</p>
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={4}
				placeholder="Write your reply…"
				className="app-textarea"
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<div className="mt-2 flex justify-end">
				<button
					type="button"
					disabled={busy || body.trim() === ''}
					onClick={submit}
					className="btn btn-primary"
				>
					{busy ? 'Sending…' : 'Send'}
				</button>
			</div>
		</div>
	)
}

export function ErrorBanner({ message }: { message: string }) {
	const isQuota = message.startsWith('QUOTA:')
	return (
		<p className={`error-banner ${isQuota ? 'error-banner-quota' : ''}`}>
			{isQuota ? message.slice(6).trim() : message}
		</p>
	)
}
