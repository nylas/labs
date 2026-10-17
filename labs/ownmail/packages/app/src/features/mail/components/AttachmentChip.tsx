import { Download, Paperclip } from 'lucide-react'
import { cn } from '#shared/lib/utils'
import type { MailMessage } from '../state/mail-queries.js'
import { formatSize } from './AttachmentLink.js'

type Attachment = NonNullable<MailMessage['attachments']>[number]

type FileKind = { label: string; tile: string }

const KINDS: Array<{ test: RegExp; tile: string; label?: string }> = [
	{ test: /pdf$/, tile: 'bg-file-pdf text-file-pdf-foreground', label: 'PDF' },
	{ test: /sheet|excel|csv|xlsx?$|numbers$/, tile: 'bg-file-sheet text-file-sheet-foreground', label: 'XLS' },
	{ test: /word|document|docx?$|pages$|rtf$/, tile: 'bg-file-doc text-file-doc-foreground', label: 'DOC' },
	{ test: /^image\/|png$|jpe?g$|gif$|webp$|heic$|svg$/, tile: 'bg-file-image text-file-doc-foreground' },
]

/** The type tile of a file: PDF, XLS and DOC in their colours, other types by extension on the muted fill. */
export function fileKind(attachment: Pick<Attachment, 'filename' | 'content_type'>): FileKind {
	const extension = /\.([a-z0-9]{1,5})$/i.exec(attachment.filename ?? '')?.[1]?.toLowerCase() ?? ''
	const type = ((attachment.content_type ?? '').toLowerCase().split(';')[0] as string).trim()
	for (const kind of KINDS) {
		if (kind.test.test(type) || kind.test.test(extension)) {
			return { label: kind.label ?? (extension.toUpperCase() || 'IMG'), tile: kind.tile }
		}
	}
	return { label: extension.toUpperCase() || 'FILE', tile: 'bg-muted text-muted-foreground' }
}

/**
 * One file attached to a message: a 32×40 type tile, the name, a detail line
 * ("2.1 MB · replaces v3 from Tue", or the size alone) and a download button.
 * `compact` is the quiet 28px chip that follows an empty body (board 06 card
 * 1): a paperclip and the name, the whole chip the download link.
 */
export function AttachmentChip({
	attachment,
	messageId,
	detail,
	compact = false,
}: {
	attachment: Attachment
	messageId: string
	detail?: string
	compact?: boolean
}) {
	const filename = attachment.filename ?? 'attachment'
	const kind = fileKind(attachment)
	const line = detail ?? (attachment.size ? formatSize(attachment.size) : '')
	const href = `/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(messageId)}`
	if (compact) {
		return (
			<a
				data-slot="attachment-chip"
				data-compact=""
				href={href}
				download={attachment.filename}
				title={line ? `Download ${filename} (${line})` : `Download ${filename}`}
				className="inline-flex h-7 max-w-full min-w-0 items-center gap-2 self-start rounded-md border border-border px-3 text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [@media(any-pointer:coarse)]:min-h-11"
			>
				<Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="truncate">{filename}</span>
			</a>
		)
	}
	return (
		<div
			data-slot="attachment-chip"
			className="inline-flex min-h-15 max-w-full min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
		>
			<span
				aria-hidden="true"
				className={cn(
					'inline-flex h-10 w-8 shrink-0 items-center justify-center rounded-sm font-data text-[9px] font-bold',
					kind.tile,
				)}
			>
				{kind.label}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-semibold text-foreground">{filename}</span>
				{line ? (
					<span className="truncate font-data text-xs text-muted-foreground tabular-nums">{line}</span>
				) : null}
			</span>
			<a
				href={href}
				download={attachment.filename}
				aria-label={`Download ${filename}`}
				title={`Download ${filename}`}
				className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:size-11 [@media(any-pointer:coarse)]:size-11"
			>
				<Download aria-hidden="true" className="size-3.5" />
			</a>
		</div>
	)
}
