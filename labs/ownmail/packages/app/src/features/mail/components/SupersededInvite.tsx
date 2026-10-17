import { Calendar } from 'lucide-react'
import type { MailMessage } from '../state/mail-queries.js'
import { EDGE_LINK_CLASS } from './edge-actions.js'

/** The invitation's title, without the "Updated invitation:" a calendar puts before it. */
export function invitationTitle(subject: string | undefined): string {
	return (subject ?? '')
		.replace(/^\s*(?:(?:re|fwd?):\s*)*/i, '')
		.replace(/^(?:updated |new )?(?:invitation|event)(?: updated)?:\s*/i, '')
		.trim()
}

/**
 * An invitation that a later one in the thread replaced. Only the newest
 * invitation gets the card and its buttons; this one folds into a line that
 * says it was replaced and leads to the newest.
 */
export function SupersededInviteNote({
	message,
	onShowLatest,
}: {
	message: MailMessage
	onShowLatest(): void
}) {
	const title = invitationTitle(message.subject)
	return (
		<p
			role="note"
			data-slot="superseded-invite"
			className="m-0 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground"
		>
			<Calendar aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="min-w-0 truncate">
				{title ? `Earlier version of “${title}”` : 'Earlier version of this invitation'}
			</span>
			<button type="button" onClick={onShowLatest} className={EDGE_LINK_CLASS}>
				Show latest
			</button>
		</p>
	)
}
