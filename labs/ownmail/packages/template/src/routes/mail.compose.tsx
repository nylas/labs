import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Archive,
	Forward,
	Minus,
	MoreHorizontal,
	Paperclip,
	Reply,
	ReplyAll,
	Send,
	Star,
	Trash2,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
	cn,
	collapsedMessagePreview,
	formatListDate,
	initials,
	labelBadgeClass,
	type MailFolderId,
	messageBodyParagraphs,
	threadLabels,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import { getDraft, getThreadMessages, getThreads, saveDraft, sendMessage } from '../server/fns.js'
import { ErrorBanner } from './mail.f.$folderId.t.$threadId.js'

export const Route = createFileRoute('/mail/compose')({
	validateSearch: (search): { draft?: string; folderId?: string; threadId?: string } => ({
		...(typeof search.draft === 'string' ? { draft: search.draft } : {}),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
		...(typeof search.threadId === 'string' ? { threadId: search.threadId } : {}),
	}),
	loaderDeps: ({ search }) => ({
		draft: search.draft,
		folderId: search.folderId,
		threadId: search.threadId,
	}),
	loader: async ({ deps }) => {
		const [draft, inbox, selected] = await Promise.all([
			deps.draft ? getDraft({ data: { draftId: deps.draft } }) : null,
			getThreads({ data: { folderId: 'inbox' } }),
			deps.threadId ? getThreadMessages({ data: { threadId: deps.threadId } }) : null,
		])
		return { draft, threads: inbox.threads, selected, folderId: deps.folderId ?? 'inbox' }
	},
	component: Compose,
})

function Compose() {
	const { draft, threads, selected, folderId } = Route.useLoaderData()
	const navigate = useNavigate()
	const [draftId, setDraftId] = useState<string | undefined>(draft?.id)
	const [to, setTo] = useState(draft?.to?.map((person) => person.email).join(', ') ?? '')
	const [subject, setSubject] = useState(draft?.subject ?? '')
	const [body, setBody] = useState(draft?.body ?? '')
	const [busy, setBusy] = useState(false)
	const [minimized, setMinimized] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const dirty = useRef(false)

	function close() {
		if (history.length > 1) history.back()
		else if (selected) {
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId, threadId: selected.thread.id },
			})
		} else navigate({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } })
	}

	// Autosave a draft 3s after the last edit.
	useEffect(() => {
		dirty.current = true
		const timer = setTimeout(async () => {
			if (!dirty.current || (!to && !subject && !body)) return
			try {
				const saved = await saveDraft({ data: { ...(draftId ? { draftId } : {}), to, subject, body } })
				setDraftId(saved.draftId)
				dirty.current = false
			} catch {
				// autosave is best-effort
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [to, subject, body, draftId])

	async function submit() {
		setBusy(true)
		setError(null)
		try {
			await sendMessage({ data: { to, subject, body: body.replaceAll('\n', '<br>') } })
			navigate({ to: '/mail/f/$folderId', params: { folderId: 'sent' } })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send')
			setBusy(false)
		}
	}

	return (
		<>
			{selected ? (
				<>
					<section className="h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none">
						<div className="flex items-center justify-between border-b border-border px-4 py-3">
							<h1 className="text-base font-semibold capitalize">Inbox</h1>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							{threads.map((thread) => (
								<ComposeThreadRow
									key={thread.id}
									thread={thread}
									folderId="inbox"
									active={selected.thread.id === thread.id}
								/>
							))}
						</div>
					</section>
					<section className="hidden min-w-0 flex-1 bg-background md:flex">
						<ComposeThreadBackdrop thread={selected.thread} messages={selected.messages} />
					</section>
				</>
			) : null}
			<div
				className={cn(
					'fixed right-4 bottom-0 z-50 flex w-[min(30rem,calc(100vw-1rem))] flex-col rounded-t-xl border border-border bg-card shadow-2xl',
					minimized ? 'h-11' : 'h-[32rem] max-h-[80vh]',
				)}
				role="dialog"
				aria-label="Compose message"
			>
				<div className="flex items-center justify-between rounded-t-xl bg-foreground px-3 py-2.5 text-background">
					<span className="truncate text-sm font-semibold">{subject || 'New message'}</span>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setMinimized((value) => !value)}
							aria-label="Minimize"
							className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-background/20"
						>
							<Minus className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={close}
							aria-label="Close"
							className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-background/20"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				{!minimized ? (
					<>
						<div className="flex flex-col">
							<label className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
								<span className="w-14 text-muted-foreground">To</span>
								<input
									value={to}
									onChange={(event) => setTo(event.target.value)}
									placeholder="recipient@email.com"
									className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
									type="email"
									inputMode="email"
									autoComplete="email"
									autoCapitalize="none"
								/>
							</label>
							<label className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
								<span className="w-14 text-muted-foreground">Subject</span>
								<input
									value={subject}
									onChange={(event) => setSubject(event.target.value)}
									placeholder="Subject"
									className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
								/>
							</label>
						</div>

						<textarea
							value={body}
							onChange={(event) => setBody(event.target.value)}
							placeholder="Write your message..."
							className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
						/>

						{error ? <ErrorBanner message={error} /> : null}
						<div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
							<button
								type="button"
								disabled={busy || to.trim() === ''}
								onClick={submit}
								className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
							>
								<Send className="h-4 w-4" /> {busy ? 'Sending...' : 'Send'}
							</button>
							<button
								type="button"
								aria-label="Attach file"
								className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Paperclip className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={close}
								aria-label="Discard draft"
								className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</div>
					</>
				) : null}
			</div>
		</>
	)
}

function ComposeThreadRow({
	thread,
	folderId,
	active,
}: {
	thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]
	folderId: MailFolderId
	active?: boolean
}) {
	const when = formatListDate(threadTimestamp(thread))
	return (
		<div
			className={cn(
				'group relative flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left',
				active ? 'bg-accent' : 'bg-card',
			)}
		>
			{thread.unread ? <span className="absolute top-0 left-0 h-full w-0.5 bg-primary" aria-hidden /> : null}
			<div className="flex items-center gap-2">
				<span className="shrink-0 text-muted-foreground">
					<Star className={cn('h-4 w-4', thread.starred && 'fill-event-amber text-event-amber')} />
				</span>
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
					{threadSender(thread, folderId)}
				</span>
				{thread.has_attachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
				{when ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span> : null}
			</div>
			<p className="truncate text-sm text-foreground/80">{thread.subject || '(no subject)'}</p>
			<p className="min-w-0 truncate text-xs text-muted-foreground">{thread.snippet}</p>
		</div>
	)
}

function ComposeThreadBackdrop({ thread, messages }: { thread: Thread; messages: Message[] }) {
	const labels = threadLabels(thread)
	const firstAttachment = messages
		.flatMap((message) => message.attachments ?? [])
		.find((attachment) => !attachment.is_inline)
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
				<BackdropIcon label="Archive">
					<Archive className="h-4 w-4" />
				</BackdropIcon>
				<BackdropIcon label="Delete">
					<Trash2 className="h-4 w-4" />
				</BackdropIcon>
				<BackdropIcon label={thread.starred ? 'Unstar' : 'Star'}>
					<Star className={cn('h-4 w-4', thread.starred && 'fill-event-amber text-event-amber')} />
				</BackdropIcon>
				<div className="ml-auto">
					<BackdropIcon label="More">
						<MoreHorizontal className="h-4 w-4" />
					</BackdropIcon>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-xl font-semibold text-balance">{thread.subject || '(no subject)'}</h2>
						{labels.map((label) => (
							<span
								key={label.id}
								className={cn(
									'rounded-md border px-2 py-0.5 text-xs font-medium',
									labelBadgeClass(label.tone),
								)}
							>
								{label.name}
							</span>
						))}
					</div>

					{thread.has_attachments ? (
						<div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
							<Paperclip className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium text-foreground">
								{firstAttachment?.filename ?? 'attachment.pdf'}
							</span>
							<span className="text-muted-foreground">
								· {firstAttachment?.size ? formatSize(firstAttachment.size) : '248 KB'}
							</span>
						</div>
					) : null}

					<div className="mt-4 space-y-3">
						{messages.map((message, index) => (
							<BackdropMessage key={message.id} message={message} open={index === messages.length - 1} />
						))}
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						<BackdropAction icon={<Reply className="h-4 w-4" />} label="Reply" />
						<BackdropAction icon={<ReplyAll className="h-4 w-4" />} label="Reply all" />
						<BackdropAction icon={<Forward className="h-4 w-4" />} label="Forward" />
					</div>
				</div>
			</div>
		</div>
	)
}

function BackdropIcon({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground"
		>
			{children}
		</button>
	)
}

function BackdropMessage({ message, open }: { message: Message; open: boolean }) {
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	return (
		<div className="rounded-sm border border-border bg-card">
			<div className="flex w-full items-start gap-3 px-4 py-3 text-left">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
					{initials(fromLabel)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<span className="truncate text-sm font-semibold text-foreground">{fromLabel}</span>
						{message.date ? (
							<span className="shrink-0 text-xs text-muted-foreground">
								{new Date(message.date * 1000).toLocaleString(undefined, {
									weekday: 'short',
									month: 'short',
									day: 'numeric',
									hour: 'numeric',
									minute: '2-digit',
								})}
							</span>
						) : null}
					</div>
					<p className="truncate text-xs text-muted-foreground">
						{open
							? `to ${message.to?.map((person) => person.name || person.email).join(', ') || 'me'}`
							: collapsedMessagePreview(message)}
					</p>
				</div>
			</div>
			{open ? (
				<div className="px-4 pb-4 pl-16">
					<div className="space-y-3 text-sm leading-relaxed text-foreground/90">
						{messageBodyParagraphs(message).map((paragraph) => (
							<p key={`${message.id}-${paragraph}`} className="whitespace-pre-line text-pretty">
								{paragraph}
							</p>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}

function BackdropAction({ icon, label }: { icon: React.ReactNode; label: string }) {
	return (
		<button
			type="button"
			className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium"
		>
			{icon}
			{label}
		</button>
	)
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
