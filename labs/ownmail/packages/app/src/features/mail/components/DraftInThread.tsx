import { Pencil } from 'lucide-react'
import { editedAgo, viewerZone } from '../lib/edge-states.js'
import { messageBodyParagraphs } from '../lib/mail-ui-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { EDGE_BUTTON_CLASS, EDGE_DANGER_GHOST_CLASS } from './edge-actions.js'

/** The element id a thread scrolls to when it opens with a draft in it. */
export function draftAnchorId(id: string): string {
	return `draft-${id}`
}

/**
 * Your unsent reply, in the thread under the message it answers: a Draft pill
 * (glyph and word), who it replies to and when it was last edited, the first
 * line of what you wrote, and Resume or Discard.
 */
export function DraftInThread({
	draft,
	replyToFirstName,
	onResume,
	onDiscard,
	now = Date.now(),
	tz = viewerZone(),
}: {
	draft: MailMessage
	replyToFirstName?: string
	onResume(): void
	onDiscard(): void
	now?: number
	tz?: string
}) {
	const edited =
		typeof draft.date === 'number' && draft.date > 0 ? `edited ${editedAgo(draft.date, now, tz)}` : ''
	const context = [replyToFirstName ? `reply to ${replyToFirstName}` : '', edited].filter(Boolean).join(' · ')
	const first = messageBodyParagraphs(draft)[0] ?? ''
	// OwnMail's own drafts store Markdown; the preview shows the words, not the marks.
	const preview = draft.ownmailDraft ? first.replace(/^#+\s*|[*_`]+/g, '') : first
	return (
		<section
			id={draftAnchorId(draft.id)}
			data-slot="draft-in-thread"
			aria-label={replyToFirstName ? `Your draft reply to ${replyToFirstName}` : 'Your draft'}
			className="flex scroll-mt-16 flex-col gap-2 text-[13px]"
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 text-[11px] font-semibold text-danger-soft-foreground">
					<Pencil aria-hidden="true" className="size-3" />
					Draft
				</span>
				{context ? <span className="min-w-0 truncate text-xs text-muted-foreground">{context}</span> : null}
			</div>
			{preview ? <p className="m-0 truncate text-secondary-foreground">{preview}</p> : null}
			<div className="flex items-center gap-2">
				<button type="button" onClick={onResume} className={EDGE_BUTTON_CLASS}>
					Resume
				</button>
				<button type="button" onClick={onDiscard} className={EDGE_DANGER_GHOST_CLASS}>
					Discard
				</button>
			</div>
		</section>
	)
}
