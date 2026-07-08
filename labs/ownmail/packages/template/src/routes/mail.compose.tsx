import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RecipientInput } from '../components/RecipientInput.js'
import {
	cn,
	collapsedMessagePreview,
	composeBackdropListSearch,
	composeBackdropReplySearch,
	composeBackdropThreadSearch,
	formatListDate,
	forwardDraftSearch,
	initials,
	labelBadgeClass,
	mailFolderTitle,
	messageBodyParagraphs,
	replyAllDraftSearch,
	STAR_FILLED_CLASS,
	STAR_HOVER_CLASS,
	shouldUseBrowserBackForComposeClose,
	threadLabels,
	threadSender,
	threadTimestamp,
} from '../components/ui-model.js'
import {
	deleteDraft,
	getDraft,
	getFolders,
	getThreadMessages,
	getThreads,
	saveDraft,
	sendMessage,
	updateThreadState,
} from '../server/fns.js'
import type { OutboundAttachment } from '../server/outbound-attachments.js'
import { ErrorBanner } from './mail.f.$folderId.t.$threadId.js'

const MAX_COMPOSE_ATTACHMENTS = 10
const MAX_COMPOSE_ATTACHMENT_BYTES = 2 * 1024 * 1024

type ComposeAttachment = OutboundAttachment & { clientId: string }

export const Route = createFileRoute('/mail/compose')({
	validateSearch: (
		search,
	): {
		draft?: string
		folderId?: string
		threadId?: string
		to?: string
		subject?: string
		body?: string
		replyToMessageId?: string
	} => ({
		...(typeof search.draft === 'string' ? { draft: search.draft } : {}),
		...(typeof search.folderId === 'string' ? { folderId: search.folderId } : {}),
		...(typeof search.threadId === 'string' ? { threadId: search.threadId } : {}),
		...(typeof search.to === 'string' ? { to: search.to } : {}),
		...(typeof search.subject === 'string' ? { subject: search.subject } : {}),
		...(typeof search.body === 'string' && search.body.length <= 4000 ? { body: search.body } : {}),
		...(typeof search.replyToMessageId === 'string' ? { replyToMessageId: search.replyToMessageId } : {}),
	}),
	loaderDeps: ({ search }) => ({
		draft: search.draft,
		folderId: search.folderId,
		threadId: search.threadId,
		to: search.to,
		subject: search.subject,
		body: search.body,
		replyToMessageId: search.replyToMessageId,
	}),
	loader: async ({ deps }) => {
		const folderId = deps.folderId ?? 'inbox'
		const threadQuery = folderId === 'starred' ? { starred: true } : { folderId }
		const [draft, folders, threads, selected] = await Promise.all([
			deps.draft ? getDraft({ data: { draftId: deps.draft } }) : null,
			getFolders(),
			getThreads({ data: threadQuery }),
			deps.threadId ? getThreadMessages({ data: { threadId: deps.threadId } }) : null,
		])
		return {
			draft,
			folders,
			threads: threads.threads,
			selected,
			folderId,
			reply: deps.replyToMessageId
				? {
						to: deps.to ?? '',
						subject: deps.subject ?? '',
						body: deps.body ?? '',
						replyToMessageId: deps.replyToMessageId,
					}
				: deps.to || deps.subject || deps.body
					? { to: deps.to ?? '', subject: deps.subject ?? '', body: deps.body ?? '' }
					: null,
		}
	},
	component: Compose,
})

function Compose() {
	const { draft, folders, threads, selected, folderId, reply } = Route.useLoaderData()
	const search = Route.useSearch()
	const navigate = useNavigate()
	const router = useRouter()
	const [draftId, setDraftId] = useState<string | undefined>(draft?.id)
	const [to, setTo] = useState(draft?.to?.map((person) => person.email).join(', ') ?? reply?.to ?? '')
	const [subject, setSubject] = useState(draft?.subject ?? reply?.subject ?? '')
	const [body, setBody] = useState(draft?.body ?? reply?.body ?? '')
	const [busy, setBusy] = useState(false)
	const [minimized, setMinimized] = useState(false)
	const [saved, setSaved] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const dirty = useRef(false)
	const attachmentInputRef = useRef<HTMLInputElement>(null)
	const [attachments, setAttachments] = useState<ComposeAttachment[]>([])
	const sortedThreads = useMemo(
		() => [...threads].sort((a, b) => (threadTimestamp(b) ?? 0) - (threadTimestamp(a) ?? 0)),
		[threads],
	)
	const unreadCount = sortedThreads.filter((thread) => thread.unread).length
	const folderTitle = mailFolderTitle(folderId, folders)
	const composeThreadSearch = (threadId: string) =>
		composeBackdropThreadSearch({
			folderId,
			threadId,
			...(draftId ? { draftId } : {}),
			...(search.replyToMessageId ? { replyToMessageId: search.replyToMessageId } : {}),
			...(search.to ? { to: search.to } : {}),
			...(search.subject ? { subject: search.subject } : {}),
			...(search.body ? { body: search.body } : {}),
		})
	const composeListSearch = useCallback(
		() =>
			composeBackdropListSearch({
				folderId,
				...(draftId ? { draftId } : {}),
				...(search.replyToMessageId ? { replyToMessageId: search.replyToMessageId } : {}),
				...(search.to ? { to: search.to } : {}),
				...(search.subject ? { subject: search.subject } : {}),
				...(search.body ? { body: search.body } : {}),
			}),
		[draftId, folderId, search.body, search.replyToMessageId, search.subject, search.to],
	)

	async function actOnBackdropThread(
		threadId: string,
		input: { unread?: boolean; starred?: boolean; folder?: string },
		leave = false,
	) {
		await updateThreadState({ data: { threadId, ...input } })
		if (leave) {
			await navigate({ to: '/mail/compose', search: composeListSearch() })
		}
		await router.invalidate()
	}

	async function toggleBackdropRowStar(thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]) {
		await updateThreadState({ data: { threadId: thread.id, starred: !thread.starred } })
		await router.invalidate()
	}

	function replyFromBackdrop(thread: Thread, messages: Message[]) {
		const message = messages.at(-1)
		if (!message) return
		const replySearch = composeBackdropReplySearch({ folderId, threadId: thread.id, message })
		setDraftId(undefined)
		setTo(replySearch.to ?? '')
		setSubject(replySearch.subject ?? '')
		setBody('')
		setError(null)
		dirty.current = true
		navigate({
			to: '/mail/compose',
			search: replySearch,
		})
	}

	function replyAllFromBackdrop(thread: Thread, messages: Message[], mailboxEmail: string) {
		const message = messages.at(-1)
		if (!message) return
		const replySearch = composeBackdropThreadSearch({
			folderId,
			threadId: thread.id,
			...replyAllDraftSearch(message, mailboxEmail),
		})
		setDraftId(undefined)
		setTo(replySearch.to ?? '')
		setSubject(replySearch.subject ?? '')
		setBody('')
		setError(null)
		dirty.current = true
		navigate({ to: '/mail/compose', search: replySearch })
	}

	function forwardFromBackdrop(thread: Thread, messages: Message[]) {
		const message = messages.at(-1)
		if (!message) return
		const forwardSearch = composeBackdropThreadSearch({
			folderId,
			threadId: thread.id,
			...forwardDraftSearch(message),
		})
		setDraftId(undefined)
		setTo(forwardSearch.to ?? '')
		setSubject(forwardSearch.subject ?? '')
		setBody(forwardSearch.body ?? '')
		setError(null)
		dirty.current = true
		navigate({ to: '/mail/compose', search: forwardSearch })
	}

	useEffect(() => {
		if (!selected) return
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (event.key === 'Escape') {
				event.preventDefault()
				navigate({ to: '/mail/compose', search: composeListSearch() })
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [composeListSearch, navigate, selected])

	function close() {
		if (shouldUseBrowserBackForComposeClose(history.state)) {
			history.back()
			return
		}
		if (selected) {
			navigate({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId, threadId: selected.thread.id },
			})
		} else navigate({ to: '/mail/f/$folderId', params: { folderId } })
	}

	// Autosave a draft 3s after the last edit.
	useEffect(() => {
		dirty.current = true
		const timer = setTimeout(async () => {
			if (!dirty.current || (!to && !subject && !body && attachments.length === 0)) return
			try {
				const saved = await saveDraft({
					data: {
						...(draftId ? { draftId } : {}),
						to,
						subject,
						body,
						...(attachments.length ? { attachments } : {}),
					},
				})
				setDraftId(saved.draftId)
				dirty.current = false
				setSaved(true)
			} catch {
				// autosave is best-effort
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [to, subject, body, draftId, attachments])

	useEffect(() => {
		if (!saved) return
		const timer = setTimeout(() => setSaved(false), 2500)
		return () => clearTimeout(timer)
	}, [saved])

	async function addAttachments(files: FileList | null) {
		if (!files?.length) return
		const selected = [...files]
		if (attachments.length + selected.length > MAX_COMPOSE_ATTACHMENTS) {
			setError(`Attach up to ${MAX_COMPOSE_ATTACHMENTS} files.`)
			return
		}
		const totalBytes = attachments.reduce((sum, attachment) => sum + attachmentBytes(attachment), 0)
		const nextBytes = selected.reduce((sum, file) => sum + file.size, totalBytes)
		if (nextBytes > MAX_COMPOSE_ATTACHMENT_BYTES) {
			setError('Attachments must be under 2 MB total.')
			return
		}
		try {
			const nextAttachments = await Promise.all(selected.map(fileToAttachment))
			setAttachments((current) => [...current, ...nextAttachments])
			dirty.current = true
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to attach file')
		}
	}

	function removeAttachment(index: number) {
		setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))
		dirty.current = true
	}

	async function submit() {
		setBusy(true)
		setError(null)
		try {
			await sendMessage({
				data: {
					to,
					subject,
					body: body.replaceAll('\n', '<br>'),
					...(attachments.length ? { attachments } : {}),
					...(reply?.replyToMessageId ? { replyToMessageId: reply.replyToMessageId } : {}),
				},
			})
			navigate({ to: '/mail/f/$folderId', params: { folderId: 'sent' } })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send')
			setBusy(false)
		}
	}

	async function discard() {
		setBusy(true)
		setError(null)
		try {
			if (draftId) await deleteDraft({ data: { draftId } })
			close()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to discard draft')
			setBusy(false)
		}
	}

	return (
		<>
			{selected ? (
				<>
					<section className="h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none">
						<div className="flex items-center justify-between border-b border-border px-4 py-3">
							<h1 className="text-base font-semibold capitalize">{folderTitle}</h1>
							{unreadCount > 0 ? (
								<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
									{unreadCount} unread
								</span>
							) : null}
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							{sortedThreads.map((thread) => (
								<ComposeThreadRow
									key={thread.id}
									thread={thread}
									folderId={folderId}
									search={composeThreadSearch(thread.id)}
									onToggleStar={() => toggleBackdropRowStar(thread)}
									active={selected.thread.id === thread.id}
								/>
							))}
						</div>
					</section>
					<section className="hidden min-w-0 flex-1 bg-background md:flex">
						<ComposeThreadBackdrop
							thread={selected.thread}
							messages={selected.messages}
							onArchive={() => actOnBackdropThread(selected.thread.id, { folder: 'archive' }, true)}
							onDelete={() => actOnBackdropThread(selected.thread.id, { folder: 'trash' }, true)}
							onToggleStar={() =>
								actOnBackdropThread(selected.thread.id, { starred: !selected.thread.starred })
							}
							onReply={() => replyFromBackdrop(selected.thread, selected.messages)}
							onReplyAll={() =>
								replyAllFromBackdrop(selected.thread, selected.messages, selected.mailboxEmail)
							}
							onForward={() => forwardFromBackdrop(selected.thread, selected.messages)}
						/>
					</section>
				</>
			) : (
				<>
					<section className="h-full min-w-0 flex-1 flex-col border-r border-border bg-card md:flex md:w-96 md:max-w-96 md:flex-none">
						<div className="flex items-center justify-between border-b border-border px-4 py-3">
							<h1 className="text-base font-semibold capitalize">{folderTitle}</h1>
							{unreadCount > 0 ? (
								<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
									{unreadCount} unread
								</span>
							) : null}
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							{sortedThreads.map((thread) => (
								<ComposeThreadRow
									key={thread.id}
									thread={thread}
									folderId={folderId}
									search={composeThreadSearch(thread.id)}
									onToggleStar={() => toggleBackdropRowStar(thread)}
								/>
							))}
						</div>
					</section>
					<section className="hidden min-w-0 flex-1 flex-col bg-background md:flex">
						<div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-center md:flex">
							<div className="flex h-14 w-14 items-center justify-center rounded-sm bg-muted text-muted-foreground">
								<Reply className="h-6 w-6" />
							</div>
							<div>
								<p className="text-sm font-medium text-foreground">Select a conversation</p>
								<p className="text-sm text-muted-foreground">
									Choose a message from the list to read it here.
								</p>
							</div>
						</div>
					</section>
				</>
			)}
			<div
				className={cn(
					'fixed right-4 bottom-0 z-50 flex w-[min(30rem,calc(100vw-1rem))] flex-col rounded-t-xl border border-border bg-card shadow-2xl',
					minimized ? 'h-11' : 'h-[32rem] max-h-[80vh]',
				)}
				role="dialog"
				aria-label="Compose message"
			>
				<div className="flex items-center justify-between rounded-t-xl bg-foreground px-3 py-2.5 text-background">
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate text-sm font-semibold">{subject || 'New message'}</span>
						{saved ? <span className="text-xs text-background/70">Saved</span> : null}
					</div>
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
							<div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
								<span className="w-14 shrink-0 text-muted-foreground">To</span>
								<RecipientInput
									value={to}
									onChange={setTo}
									placeholder="recipient@email.com"
									className="compose-field min-h-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
								/>
							</div>
							<label
								htmlFor="compose-subject"
								className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm"
							>
								<span className="w-14 text-muted-foreground">Subject</span>
								<input
									id="compose-subject"
									value={subject}
									onChange={(event) => setSubject(event.target.value)}
									placeholder="Subject"
									className="compose-field flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
								/>
							</label>
						</div>

						<textarea
							value={body}
							onChange={(event) => setBody(event.target.value)}
							placeholder="Write your message..."
							className="compose-field min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
						/>

						{attachments.length ? (
							<div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
								{attachments.map((attachment, index) => (
									<span
										key={attachment.clientId}
										className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
									>
										<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										<span className="min-w-0 truncate">{attachment.filename}</span>
										<span className="shrink-0 text-muted-foreground">
											{formatSize(attachmentBytes(attachment))}
										</span>
										<button
											type="button"
											onClick={() => removeAttachment(index)}
											aria-label={`Remove ${attachment.filename}`}
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									</span>
								))}
							</div>
						) : null}
						{error ? <ErrorBanner message={error} /> : null}
						<div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
							<button
								type="button"
								disabled={busy}
								onClick={submit}
								className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
							>
								<Send className="h-4 w-4" /> {busy ? 'Sending...' : 'Send'}
							</button>
							<button
								type="button"
								aria-label="Attach file"
								disabled={busy}
								onClick={() => attachmentInputRef.current?.click()}
								className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Paperclip className="h-4 w-4" />
							</button>
							<input
								ref={attachmentInputRef}
								type="file"
								multiple
								hidden
								aria-hidden="true"
								tabIndex={-1}
								onChange={(event) => {
									void addAttachments(event.target.files)
									event.target.value = ''
								}}
							/>
							<button
								type="button"
								disabled={busy}
								onClick={discard}
								aria-label="Discard draft"
								className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
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
	search,
	onToggleStar,
	active,
}: {
	thread: Awaited<ReturnType<typeof getThreads>>['threads'][number]
	folderId: string
	search: ReturnType<typeof composeBackdropThreadSearch>
	onToggleStar: () => void
	active?: boolean
}) {
	const when = formatListDate(threadTimestamp(thread))
	const labels = threadLabels(thread)
	return (
		<Link
			to="/mail/compose"
			search={search}
			className={cn(
				'group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-accent',
				active ? 'bg-accent hover:bg-accent' : 'bg-card',
			)}
		>
			{thread.unread ? <span className="absolute top-0 left-0 h-full w-0.5 bg-primary" aria-hidden /> : null}
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={(event) => {
						event.preventDefault()
						event.stopPropagation()
						onToggleStar()
					}}
					aria-label={thread.starred ? 'Unstar' : 'Star'}
					className={cn('shrink-0 text-muted-foreground transition-colors', STAR_HOVER_CLASS)}
				>
					<Star className={cn('h-4 w-4', thread.starred && STAR_FILLED_CLASS)} />
				</button>
				<span
					className={cn(
						'min-w-0 flex-1 truncate text-sm',
						thread.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
					)}
				>
					{threadSender(thread, folderId)}
					{(thread.message_ids?.length ?? 0) > 1 ? (
						<span className="ml-1 font-normal text-muted-foreground">({thread.message_ids?.length})</span>
					) : null}
				</span>
				{thread.has_attachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
				{when ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when}</span> : null}
			</div>
			<p
				className={cn(
					'truncate text-sm',
					thread.unread ? 'font-semibold text-foreground' : 'text-foreground/80',
				)}
			>
				{thread.subject || '(no subject)'}
			</p>
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{thread.snippet}</p>
				{labels.map((label) => (
					<span
						key={label.id}
						className={cn(
							'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
							labelBadgeClass(label.tone),
						)}
					>
						{label.name}
					</span>
				))}
			</div>
		</Link>
	)
}

function ComposeThreadBackdrop({
	thread,
	messages,
	onArchive,
	onDelete,
	onToggleStar,
	onReply,
	onReplyAll,
	onForward,
}: {
	thread: Thread
	messages: Message[]
	onArchive: () => void
	onDelete: () => void
	onToggleStar: () => void
	onReply: () => void
	onReplyAll: () => void
	onForward: () => void
}) {
	const labels = threadLabels(thread)
	const firstAttachment = messages
		.flatMap((message) => message.attachments ?? [])
		.find((attachment) => !attachment.is_inline)
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
				<BackdropIcon label="Archive" onClick={onArchive}>
					<Archive className="h-4.5 w-4.5" />
				</BackdropIcon>
				<BackdropIcon label="Delete" onClick={onDelete}>
					<Trash2 className="h-4.5 w-4.5" />
				</BackdropIcon>
				<BackdropIcon label={thread.starred ? 'Unstar' : 'Star'} onClick={onToggleStar}>
					<Star className={cn('h-4.5 w-4.5', thread.starred && STAR_FILLED_CLASS)} />
				</BackdropIcon>
				<div className="ml-auto">
					<BackdropIcon label="More">
						<MoreHorizontal className="h-4.5 w-4.5" />
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
							<BackdropMessage
								key={message.id}
								message={message}
								defaultOpen={index === messages.length - 1}
							/>
						))}
					</div>

					<div className="mt-4 flex flex-wrap gap-2">
						<BackdropAction icon={<Reply className="h-4 w-4" />} label="Reply" onClick={onReply} />
						<BackdropAction icon={<ReplyAll className="h-4 w-4" />} label="Reply all" onClick={onReplyAll} />
						<BackdropAction icon={<Forward className="h-4 w-4" />} label="Forward" onClick={onForward} />
					</div>
				</div>
			</div>
		</div>
	)
}

function BackdropIcon({
	label,
	onClick,
	children,
}: {
	label: string
	onClick?: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		>
			{children}
		</button>
	)
}

function BackdropMessage({ message, defaultOpen }: { message: Message; defaultOpen: boolean }) {
	const [open, setOpen] = useState(defaultOpen)
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	return (
		<div className="rounded-sm border border-border bg-card">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-start gap-3 px-4 py-3 text-left"
			>
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
			</button>
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

function BackdropAction({
	icon,
	label,
	onClick,
}: {
	icon: React.ReactNode
	label: string
	onClick?: () => void
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
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

async function fileToAttachment(file: File): Promise<ComposeAttachment> {
	if (file.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
		throw new Error('Attachments must be under 2 MB total.')
	}
	return {
		clientId: newAttachmentClientId(),
		filename: safeAttachmentFilename(file.name),
		content_type: file.type || 'application/octet-stream',
		content: await fileToBase64(file),
	}
}

function safeAttachmentFilename(filename: string): string {
	const safe = [...filename.trim()]
		.map((char) => {
			const code = char.charCodeAt(0)
			return code < 32 || char === '/' || char === '\\' ? '_' : char
		})
		.join('')
	return safe || 'attachment'
}

async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer())
	let binary = ''
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
	}
	return btoa(binary)
}

function attachmentBytes(attachment: OutboundAttachment): number {
	const padding = attachment.content.endsWith('==') ? 2 : attachment.content.endsWith('=') ? 1 : 0
	return Math.floor((attachment.content.length * 3) / 4) - padding
}

function newAttachmentClientId(): string {
	return typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
