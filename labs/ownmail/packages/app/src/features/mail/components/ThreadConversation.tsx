import { ChevronDown, Download, Paperclip } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
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

	useEffect(() => {
		setOpenMessageIds(new Set(latestMessageId ? [latestMessageId] : []))
	}, [latestMessageId])

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
			<header className="sticky top-0 z-10 border-b border-border bg-muted px-5 py-5 dark:bg-background lg:px-8">
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
					<div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
						<h1 className="min-w-0 font-display text-xl font-semibold text-balance [overflow-wrap:anywhere] lg:text-2xl">
							{thread.subject || '(no subject)'}
						</h1>
						{labels.map((label) => (
							<span key={label.id} className={cn('text-xs', labelBadgeClass(label.tone))}>
								{label.name}
							</span>
						))}
					</div>

					{messages.length > 1 ? (
						<fieldset className="flex min-w-0 shrink-0 items-center gap-1 border-0 p-0">
							<legend className="sr-only">Message display controls</legend>
							<button
								type="button"
								onClick={() => setOpenMessageIds(new Set(messages.map((message) => message.id)))}
								disabled={allMessagesOpen}
								className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
							>
								Expand all
							</button>
							<button
								type="button"
								onClick={() => setOpenMessageIds(new Set())}
								disabled={allMessagesClosed}
								className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
							>
								Collapse all
							</button>
						</fieldset>
					) : null}
				</div>

				{threadAttachments.length > 0 ? (
					<div className="mt-4 flex flex-wrap gap-2">
						{threadAttachments.map(({ attachment, messageId }) => (
							<AttachmentLink key={attachment.id} attachment={attachment} messageId={messageId} />
						))}
					</div>
				) : null}
			</header>

			<div className="px-5 py-2 lg:px-8">
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
			<div className="flex items-start gap-2">
				<button
					type="button"
					onClick={onToggle}
					className="min-w-0 flex-1 text-left"
					aria-expanded={open}
					aria-controls={contentId}
				>
					{/*
					 * The sender-identity row is a single line in every state, so the avatar
					 * always centers against exactly one line of text — no orphaned avatar
					 * height when expanded, and the row never changes height on toggle.
					 */}
					<div className="flex items-center gap-3">
						<div
							data-slot="sender-avatar"
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-foreground dark:bg-muted"
						>
							{initials(fromLabel)}
						</div>
						<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span className="text-sm font-semibold text-foreground">{fromLabel}</span>
							{open ? <span className="text-xs text-muted-foreground">to {recipients}</span> : null}
							{message.date ? (
								<ClientMessageTime
									epochSeconds={message.date}
									className="ml-auto shrink-0 text-xs text-muted-foreground"
								/>
							) : null}
						</div>
						<ChevronDown
							className={cn(
								'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
								open && 'rotate-180',
							)}
						/>
					</div>
					{/* Collapsed preview sits below the identity row, indented to the name's edge. */}
					{!open ? (
						<p className="mt-1 truncate pl-12 text-sm text-muted-foreground">
							{collapsedMessagePreview(message)}
						</p>
					) : null}
				</button>
				<a
					data-slot="raw-email-download"
					href={`/messages/${encodeURIComponent(message.id)}/download`}
					download
					aria-label={`Download raw email from ${fromLabel}`}
					title="Download raw email"
					className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Download className="h-4 w-4" />
				</a>
			</div>

			{open ? (
				<div id={contentId} data-slot="expanded-message-content" className="mt-4 min-w-0">
					<MessageDetails message={message} />
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

function MessageDetails({ message }: { message: MailMessage }) {
	const addressRows = MESSAGE_ADDRESS_FIELDS.flatMap(([field, label]) => {
		const participants = message[field]
		return participants?.length ? [{ label, value: participants.map(formatParticipant).join(', ') }] : []
	})
	if (addressRows.length === 0 && !message.date) return null

	return (
		<details data-slot="message-details" className="mb-3 text-xs text-muted-foreground">
			<summary className="w-fit cursor-pointer rounded-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
				Message details
			</summary>
			<dl className="mt-2 grid max-w-3xl grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-border bg-card/60 p-3">
				{addressRows.map((row) => (
					<div key={row.label} className="contents">
						<dt className="font-medium text-foreground">{row.label}</dt>
						<dd className="min-w-0 [overflow-wrap:anywhere]">{row.value}</dd>
					</div>
				))}
				{message.date ? (
					<div className="contents">
						<dt className="font-medium text-foreground">Date</dt>
						<dd>
							<ClientMessageTime epochSeconds={message.date} />
						</dd>
					</div>
				) : null}
			</dl>
		</details>
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
			className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent dark:bg-muted/40 dark:hover:bg-muted"
			download={attachment.filename}
		>
			<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
			<span className="font-medium">{attachment.filename ?? 'attachment'}</span>
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
