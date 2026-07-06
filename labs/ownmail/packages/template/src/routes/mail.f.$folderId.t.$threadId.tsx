import type { Message } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
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

	async function act(input: { unread?: boolean; starred?: boolean; folder?: string }, leave = false) {
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
	}

	return (
		<article className="mx-auto max-w-3xl px-6 py-4">
			<div className="mb-3 flex items-center gap-1 border-b border-neutral-100 pb-2">
				<ActionButton label="Archive" onClick={() => act({ folder: 'archive' }, true)}>
					🗄
				</ActionButton>
				<ActionButton label="Delete" onClick={() => act({ folder: 'trash' }, true)}>
					🗑
				</ActionButton>
				<ActionButton
					label={thread.starred ? 'Unstar' : 'Star'}
					onClick={() => act({ starred: !thread.starred })}
				>
					{thread.starred ? '★' : '☆'}
				</ActionButton>
				<ActionButton label="Mark unread" onClick={() => act({ unread: true }, true)}>
					✉️
				</ActionButton>
				{error ? <span className="ml-2 text-xs text-red-600">{error}</span> : null}
			</div>
			<h1 className="mb-4 text-xl font-semibold tracking-tight">{thread.subject || '(no subject)'}</h1>
			<div className="space-y-4">
				{messages.map((message) => (
					<MessageCard key={message.id} message={message} />
				))}
			</div>
			{messages.length > 0 ? <ReplyBox lastMessage={messages[messages.length - 1]!} /> : null}
		</article>
	)
}

function ActionButton({
	label,
	onClick,
	children,
}: {
	label: string
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className="rounded px-2 py-1 text-sm hover:bg-neutral-100"
		>
			{children}
		</button>
	)
}

function MessageCard({ message }: { message: Message }) {
	const from = message.from?.[0]
	const attachments = (message.attachments ?? []).filter((a) => !a.is_inline)
	return (
		<div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
			<header className="flex items-baseline justify-between border-b border-neutral-100 px-4 py-2">
				<div className="min-w-0">
					<span className="text-sm font-medium">{from?.name || from?.email}</span>
					{from?.name ? <span className="ml-2 text-xs text-neutral-500">{from.email}</span> : null}
				</div>
				{message.date ? (
					<time className="shrink-0 text-xs text-neutral-400">
						{new Date(message.date * 1000).toLocaleString()}
					</time>
				) : null}
			</header>
			<div className="px-4 py-3">
				<MessageBody message={message} />
			</div>
			{attachments.length > 0 ? (
				<footer className="flex flex-wrap gap-2 border-t border-neutral-100 px-4 py-2">
					{attachments.map((a) => (
						<a
							key={a.id}
							href={`/attachments/${encodeURIComponent(a.id)}?message_id=${encodeURIComponent(message.id)}`}
							className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
							download={a.filename}
						>
							📎 {a.filename ?? 'attachment'}
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
		return (
			<iframe
				title="message"
				sandbox=""
				srcDoc={message.body}
				className="h-96 w-full rounded border-0 bg-white"
			/>
		)
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
		<div className="mt-6 rounded-lg border border-neutral-200 p-4">
			<p className="mb-2 text-xs text-neutral-500">Reply to {replyTo}</p>
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				rows={4}
				placeholder="Write your reply…"
				className="w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<div className="mt-2 flex justify-end">
				<button
					type="button"
					disabled={busy || body.trim() === ''}
					onClick={submit}
					className="rounded-full bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
		<p
			className={`mt-1 rounded px-2 py-1 text-xs ${isQuota ? 'bg-amber-50 text-amber-800' : 'text-red-600'}`}
		>
			{isQuota ? message.slice(6).trim() : message}
		</p>
	)
}
