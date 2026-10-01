import { Paperclip } from 'lucide-react'
import type { MailMessage } from '../state/mail-queries.js'

type Attachment = NonNullable<MailMessage['attachments']>[number]

/** One downloadable attachment, shared by the standard reader and the Conversation view. */
export function AttachmentLink({
	attachment,
	messageId,
	attribution,
}: {
	attachment: Attachment
	messageId: string
	attribution: string
}) {
	const filename = attachment.filename ?? 'attachment'
	const sizeLabel = attachment.size ? formatSize(attachment.size) : undefined
	return (
		<a
			data-slot="thread-attachment"
			href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(messageId)}`}
			aria-label={`${filename}${sizeLabel ? `, ${sizeLabel}` : ''}, attached to message from ${attribution}`}
			className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid dark:bg-muted/40 dark:hover:bg-muted"
			download={attachment.filename}
		>
			<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 truncate font-medium">{filename}</span>
			{sizeLabel ? <span className="shrink-0 text-muted-foreground">· {sizeLabel}</span> : null}
		</a>
	)
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
