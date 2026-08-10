/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Quiet */
import { ChevronDown, ChevronsDown, ChevronsUp, Download, Paperclip } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { ClientMessageTime } from '#shared/components/ClientTime'
import { labelBadgeClass } from '#shared/lib/color-tone'
import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'
import { collapsedMessagePreview, threadLabels } from '../lib/mail-ui-model.js'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import { MessageBody } from './MessageBody.js'

/**
 * The canonical thread reader: subject header, thread-level attachments, and the
 * expandable message list. Shared by the folder thread route, the compose backdrop,
 * and search results so there is a single reading-pane implementation.
 */
export function ThreadConversation({ thread, messages }: { thread: MailThread; messages: MailMessage[] }) {
	const latestMessageId = messages.at(-1)?.id

	// Reset expansion state as part of the conversation identity so a thread swap
	// cannot paint once with the previous thread's open message IDs. Including the
	// latest message also preserves the existing behaviour when a new reply arrives.
	return (
		<ThreadConversationContent
			key={JSON.stringify([thread.id, latestMessageId])}
			thread={thread}
			messages={messages}
		/>
	)
}

function ThreadConversationContent({ thread, messages }: { thread: MailThread; messages: MailMessage[] }) {
	const [preferences] = useUserPreferences()
	const latestMessageId = messages.at(-1)?.id
	const [openMessageIds, setOpenMessageIds] = useState<Set<string>>(
		() => new Set(latestMessageId ? [latestMessageId] : []),
	)
	const labels = threadLabels(thread)
	const threadAttachments = useMemo(
		() =>
			messages.flatMap((message) =>
				(message.attachments ?? [])
					.filter((attachment) => !attachment.is_inline)
					.map((attachment) => ({ attachment, messageId: message.id })),
			),
		[messages],
	)
	const allMessagesOpen = messages.length > 0 && messages.every((message) => openMessageIds.has(message.id))
	const allMessagesClosed = messages.every((message) => !openMessageIds.has(message.id))

	function toggleMessage(messageId: string) {
		setOpenMessageIds((current) => {
			const next = new Set(current)
			if (next.has(messageId)) next.delete(messageId)
			else next.add(messageId)
			return next
		})
	}

	return (
		<div data-slot="thread-conversation" className="min-h-full bg-muted dark:bg-background">
			<header
				data-slot="thread-summary"
				className="border-b border-border bg-muted px-4 py-3 dark:bg-background lg:px-8 xl:sticky xl:top-0 xl:z-10 xl:py-5"
			>
				<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 xl:flex xl:flex-wrap xl:justify-between xl:gap-x-4 xl:gap-y-3">
					<div className="flex min-w-0 flex-col items-start gap-2 xl:flex-row xl:flex-wrap xl:gap-x-3 xl:gap-y-2">
						<h1 className="min-w-0 font-display text-lg leading-6 font-semibold text-balance [overflow-wrap:anywhere] xl:text-xl xl:leading-normal 2xl:text-2xl">
							{thread.subject || '(no subject)'}
						</h1>
						{labels.length > 0 ? (
							<div className="flex min-w-0 flex-wrap gap-1.5">
								{labels.map((label) => (
									<span key={label.id} className={cn('text-xs', labelBadgeClass(label.tone))}>
										{label.name}
									</span>
								))}
							</div>
						) : null}
					</div>

					{messages.length > 1 ? (
						<fieldset className="flex min-w-0 shrink-0 items-center gap-0.5 border-0 p-0 xl:gap-1">
							<legend className="sr-only">Message display controls</legend>
							<button
								type="button"
								onClick={() => setOpenMessageIds(new Set(messages.map((message) => message.id)))}
								disabled={allMessagesOpen}
								aria-label={`Expand all ${messages.length} messages`}
								className="inline-flex h-11 w-11 items-center justify-center rounded-md text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-40 xl:w-auto xl:px-2.5 xl:py-1.5"
							>
								<ChevronsDown className="h-4 w-4 xl:hidden" aria-hidden="true" />
								<span className="sr-only xl:not-sr-only">Expand all</span>
							</button>
							<button
								type="button"
								onClick={() => setOpenMessageIds(new Set())}
								disabled={allMessagesClosed}
								aria-label={`Collapse all ${messages.length} messages`}
								className="inline-flex h-11 w-11 items-center justify-center rounded-md text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-40 xl:w-auto xl:px-2.5 xl:py-1.5"
							>
								<ChevronsUp className="h-4 w-4 xl:hidden" aria-hidden="true" />
								<span className="sr-only xl:not-sr-only">Collapse all</span>
							</button>
						</fieldset>
					) : null}
				</div>

				{threadAttachments.length > 0 ? (
					<div
						data-slot="thread-attachment-rail"
						className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1 xl:mt-4 xl:flex-wrap xl:overflow-x-visible xl:pb-0"
					>
						{threadAttachments.map(({ attachment, messageId }) => (
							<AttachmentLink key={attachment.id} attachment={attachment} messageId={messageId} />
						))}
					</div>
				) : null}
			</header>

			<div className="px-4 py-1 sm:px-5 sm:py-2 lg:px-8">
				{messages.map((message, index) => (
					<MessageBlock
						key={message.id}
						message={message}
						open={openMessageIds.has(message.id)}
						onToggle={() => toggleMessage(message.id)}
						isLast={index === messages.length - 1}
						darkenEmail={preferences.emailDarkMode}
					/>
				))}
			</div>
		</div>
	)
}

function MessageBlock({
	message,
	open,
	onToggle,
	isLast,
	darkenEmail,
}: {
	message: MailMessage
	open: boolean
	onToggle: () => void
	isLast: boolean
	darkenEmail: boolean
}) {
	const contentId = useId()
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	const recipients = message.to?.map((person) => person.name || person.email).join(', ') || 'me'

	return (
		<article className={cn('py-5', !isLast && 'border-b border-border')}>
			<div className="flex min-w-0 flex-wrap items-start gap-x-3">
				<div
					data-slot="sender-avatar"
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-foreground dark:bg-muted"
				>
					{initials(fromLabel)}
				</div>
				<div className="min-w-0 flex-1 pt-1">
					<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
						<span className="order-1 min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
							{fromLabel}
						</span>
						{open ? <MessageDetails message={message} recipientLabel={recipients} /> : null}
						{message.date ? (
							<ClientMessageTime
								epochSeconds={message.date}
								className="order-3 ml-auto hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline-block"
							/>
						) : null}
					</div>
					{!open ? (
						<p className="mt-1 truncate text-sm text-muted-foreground">{collapsedMessagePreview(message)}</p>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{message.ownmailDraft !== true ? (
						<a
							data-slot="raw-email-download"
							href={`/messages/${encodeURIComponent(message.id)}/download`}
							download
							aria-label={`Download raw email from ${fromLabel}`}
							title="Download raw email"
							className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Download className="h-4 w-4" />
						</a>
					) : null}
					<button
						data-slot="message-toggle"
						type="button"
						onClick={onToggle}
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-expanded={open}
						aria-controls={contentId}
						aria-label={`${open ? 'Collapse' : 'Expand'} message from ${fromLabel}`}
						title={`${open ? 'Collapse' : 'Expand'} message`}
					>
						<ChevronDown className={cn('h-4 w-4', open && 'rotate-180')} />
					</button>
				</div>
				{message.date ? (
					<ClientMessageTime
						epochSeconds={message.date}
						className="mt-1 basis-full whitespace-nowrap pl-12 text-right text-xs leading-5 text-muted-foreground sm:hidden"
					/>
				) : null}
			</div>

			{open ? (
				<div id={contentId} data-slot="expanded-message-content" className="mt-5 w-full min-w-0">
					<MessageBody message={message} darkenEmail={darkenEmail} />
					<MessageAttachments message={message} />
				</div>
			) : null}
		</article>
	)
}

const MESSAGE_ADDRESS_FIELDS = [
	['from', 'From'],
	['to', 'To'],
	['cc', 'Cc'],
	['bcc', 'Bcc'],
	['reply_to', 'Reply-To'],
] as const

function MessageDetails({ message, recipientLabel }: { message: MailMessage; recipientLabel: string }) {
	const [open, setOpen] = useState(false)
	const panelId = useId()
	const labelId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const pointerStartedInsideRef = useRef(false)
	const clearPointerGuardTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const addressRows = MESSAGE_ADDRESS_FIELDS.flatMap(([field, label]) => {
		const participants = message[field]
		return participants?.length ? [{ label, value: participants.map(formatParticipant).join(', ') }] : []
	})

	useEffect(() => {
		if (!open) return

		function onPointerDown(event: PointerEvent) {
			clearTimeout(clearPointerGuardTimerRef.current)
			pointerStartedInsideRef.current = event.composedPath().includes(rootRef.current as EventTarget)
			if (!pointerStartedInsideRef.current) setOpen(false)
		}

		function onPointerUp() {
			clearPointerGuardTimerRef.current = setTimeout(() => {
				pointerStartedInsideRef.current = false
				clearPointerGuardTimerRef.current = undefined
			}, 0)
		}

		function onPointerCancel() {
			clearTimeout(clearPointerGuardTimerRef.current)
			clearPointerGuardTimerRef.current = undefined
			pointerStartedInsideRef.current = false
		}

		function onFocusIn(event: FocusEvent) {
			if (pointerStartedInsideRef.current) return
			if (!event.composedPath().includes(rootRef.current as EventTarget)) setOpen(false)
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setOpen(false)
			triggerRef.current?.focus()
		}

		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('pointerup', onPointerUp)
		document.addEventListener('pointercancel', onPointerCancel)
		document.addEventListener('focusin', onFocusIn)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('pointerup', onPointerUp)
			document.removeEventListener('pointercancel', onPointerCancel)
			document.removeEventListener('focusin', onFocusIn)
			document.removeEventListener('keydown', onKeyDown)
			clearTimeout(clearPointerGuardTimerRef.current)
			clearPointerGuardTimerRef.current = undefined
			pointerStartedInsideRef.current = false
		}
	}, [open])

	if (addressRows.length === 0 && !message.date) return null

	return (
		<div
			ref={rootRef}
			data-slot="message-details"
			className="relative order-3 min-w-0 basis-full text-xs text-muted-foreground sm:order-2 sm:max-w-80 sm:shrink-0 sm:basis-auto"
		>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-controls={panelId}
				className="relative -mx-1 inline-flex min-h-7 max-w-full items-center gap-0.5 rounded-md px-1 text-left before:absolute before:-inset-x-1 before:-inset-y-2 hover:text-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="truncate sm:overflow-visible sm:text-clip sm:whitespace-nowrap">
					to {recipientLabel}
				</span>
				<ChevronDown className={cn('h-3 w-3 shrink-0', open && 'rotate-180')} />
				<span className="sr-only">{open ? 'Hide' : 'Show'} message details</span>
			</button>
			{open ? (
				<section
					id={panelId}
					aria-labelledby={labelId}
					className="z-20 mt-2 w-[calc(100vw-5.5rem)] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-sm sm:absolute sm:left-0 sm:top-full sm:w-96 sm:max-w-[calc(100vw-6rem)]"
				>
					<h2 id={labelId} className="mb-3 font-display text-sm font-semibold text-foreground">
						Message details
					</h2>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
						{addressRows.map((row) => (
							<div key={row.label} className="contents">
								<dt className="font-medium text-foreground">{row.label}</dt>
								<dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{row.value}</dd>
							</div>
						))}
						{message.date ? (
							<div className="contents">
								<dt className="font-medium text-foreground">Date</dt>
								<dd className="text-muted-foreground tabular-nums">
									<ClientMessageTime epochSeconds={message.date} />
								</dd>
							</div>
						) : null}
					</dl>
				</section>
			) : null}
		</div>
	)
}

function formatParticipant(participant: { email: string; name?: string }): string {
	return participant.name ? `${participant.name} <${participant.email}>` : participant.email
}

function MessageAttachments({ message }: { message: MailMessage }) {
	const attachments = (message.attachments ?? []).filter((attachment) => !attachment.is_inline)
	if (attachments.length === 0) return null
	return (
		<div className="mt-4 flex flex-wrap gap-2">
			{attachments.map((attachment) => (
				<AttachmentLink key={attachment.id} attachment={attachment} messageId={message.id} />
			))}
		</div>
	)
}

type Attachment = NonNullable<MailMessage['attachments']>[number]

function AttachmentLink({ attachment, messageId }: { attachment: Attachment; messageId: string }) {
	return (
		<a
			data-slot="thread-attachment"
			href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(messageId)}`}
			className="inline-flex min-h-11 max-w-[calc(100vw-2rem)] shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-accent active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid sm:max-w-none sm:shrink dark:bg-muted/40 dark:hover:bg-muted"
			download={attachment.filename}
		>
			<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
			<span className="min-w-0 truncate font-medium">{attachment.filename ?? 'attachment'}</span>
			{attachment.size ? (
				<span className="text-muted-foreground">· {formatSize(attachment.size)}</span>
			) : null}
		</a>
	)
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
