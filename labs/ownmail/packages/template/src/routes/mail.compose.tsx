import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Minus, Paperclip, Send, Star, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
	cn,
	formatListDate,
	type MailFolderId,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import { getDraft, getThreads, saveDraft, sendMessage } from '../server/fns.js'
import { ErrorBanner } from './mail.f.$folderId.t.$threadId.js'

export const Route = createFileRoute('/mail/compose')({
	validateSearch: (search): { draft?: string } =>
		typeof search.draft === 'string' ? { draft: search.draft } : {},
	loaderDeps: ({ search }) => ({ draft: search.draft }),
	loader: async ({ deps }) => {
		const [draft, inbox] = await Promise.all([
			deps.draft ? getDraft({ data: { draftId: deps.draft } }) : null,
			getThreads({ data: { folderId: 'inbox' } }),
		])
		return { draft, threads: inbox.threads }
	},
	component: Compose,
})

function Compose() {
	const { draft, threads } = Route.useLoaderData()
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
		else navigate({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } })
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
			<section className="h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h1 className="text-base font-semibold capitalize">Inbox</h1>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{threads.map((thread) => (
						<ComposeThreadRow key={thread.id} thread={thread} folderId="inbox" />
					))}
				</div>
			</section>
			<section className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-center md:flex" />
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
}: {
	thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]
	folderId: MailFolderId
}) {
	const when = formatListDate(threadTimestamp(thread))
	return (
		<div className="group relative flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left">
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
