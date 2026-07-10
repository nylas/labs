import type { Message, Thread } from '@nylas-labs/cli-kit/v3'
import { ChevronDown, Paperclip } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ClientMessageTime } from './ClientTime.js'
import { MessageBody } from './MessageBody.js'
import { cn, collapsedMessagePreview, initials, labelBadgeClass, threadLabels } from './ui-model.js'

/**
 * The canonical thread reader: subject header, thread-level attachments, and the
 * expandable message list. Shared by the folder thread route, the compose backdrop,
 * and search results so there is a single reading-pane implementation.
 */
export function ThreadConversation({ thread, messages }: { thread: Thread; messages: Message[] }) {
	const labels = threadLabels(thread)
	const threadAttachments = useMemo(
		() =>
			messages.flatMap((message) =>
				(message.attachments ?? []).filter((attachment) => !attachment.is_inline),
			),
		[messages],
	)

	return (
		<>
			<header className="border-b border-border px-5 py-5 lg:px-8">
				<div className="flex flex-wrap items-start gap-x-3 gap-y-2">
					<h1 className="font-display text-xl font-semibold text-balance lg:text-2xl">
						{thread.subject || '(no subject)'}
					</h1>
					{labels.map((label) => (
						<span key={label.id} className={cn('text-xs', labelBadgeClass(label.tone))}>
							{label.name}
						</span>
					))}
				</div>

				{threadAttachments.length > 0 ? (
					<div className="mt-4 flex flex-wrap gap-2">
						{threadAttachments.map((attachment) => {
							const parent = messages.find((message) =>
								message.attachments?.some((item) => item.id === attachment.id),
							)
							/* v8 ignore next -- unreachable: threadAttachments is derived from these same messages, so every attachment id always matches its source message */
							if (!parent) return null
							return (
								<a
									key={attachment.id}
									href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(parent.id)}`}
									className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm transition-colors hover:bg-muted"
									download={attachment.filename}
								>
									<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
									<span className="font-medium">{attachment.filename ?? 'attachment'}</span>
									{attachment.size ? (
										<span className="text-muted-foreground">· {formatSize(attachment.size)}</span>
									) : null}
								</a>
							)
						})}
					</div>
				) : null}
			</header>

			<div className="px-5 py-2 lg:px-8">
				{messages.map((message, index) => (
					<MessageBlock
						key={message.id}
						message={message}
						defaultOpen={index === messages.length - 1}
						isLast={index === messages.length - 1}
					/>
				))}
			</div>
		</>
	)
}

function MessageBlock({
	message,
	defaultOpen,
	isLast,
}: {
	message: Message
	defaultOpen: boolean
	isLast: boolean
}) {
	const [open, setOpen] = useState(defaultOpen)
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	const recipients = message.to?.map((person) => person.name || person.email).join(', ') || 'me'

	return (
		<article className={cn('py-5', !isLast && 'border-b border-border')}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="w-full text-left"
				aria-expanded={open}
			>
				{/*
				 * The sender-identity row is a single line in every state, so the avatar
				 * always centers against exactly one line of text — no orphaned avatar
				 * height when expanded, and the row never changes height on toggle.
				 */}
				<div className="flex items-center gap-3">
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
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

			{open ? (
				// Indent by the avatar column (w-9) plus the header gap (gap-3) so the body
				// shares the sender/recipient/timestamp left edge — one reading column, with
				// the avatar as a gutter rather than dead space beside the text.
				<div className="mt-4 pl-12">
					<MessageBody message={message} />
					<MessageAttachments message={message} />
				</div>
			) : null}
		</article>
	)
}

function MessageAttachments({ message }: { message: Message }) {
	const attachments = (message.attachments ?? []).filter((attachment) => !attachment.is_inline)
	if (attachments.length === 0) return null
	return (
		<div className="mt-4 flex flex-wrap gap-2">
			{attachments.map((attachment) => (
				<a
					key={attachment.id}
					href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(message.id)}`}
					className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm transition-colors hover:bg-muted"
					download={attachment.filename}
				>
					<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="font-medium">{attachment.filename ?? 'attachment'}</span>
					{attachment.size ? (
						<span className="text-muted-foreground">· {formatSize(attachment.size)}</span>
					) : null}
				</a>
			))}
		</div>
	)
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
