import { Users } from 'lucide-react'
import { REPLY_ALL_GUARD } from '../lib/thread-reading-model.js'
import { EDGE_BUTTON_CLASS } from './edge-actions.js'

/**
 * Asks once before Reply all reaches a crowd: past `REPLY_ALL_GUARD` people the
 * reply card and the composer say how many people it will reach and offer the
 * smaller reply as the first choice. Nothing renders at or below the guard.
 */
export function ReplyAllGuard({
	count,
	replyOnlyFirstName,
	onReplyOnly,
}: {
	count: number
	replyOnlyFirstName: string
	onReplyOnly(): void
}) {
	if (count <= REPLY_ALL_GUARD) return null
	return (
		<div
			role="note"
			data-slot="reply-all-guard"
			className="flex items-center gap-2 rounded-md border border-notice-warning-line bg-notice-warning px-3 py-2 text-xs text-notice-warning-foreground"
		>
			<Users aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="min-w-0 flex-1">Reply all will reach {count} people.</span>
			{replyOnlyFirstName ? (
				<button type="button" onClick={onReplyOnly} className={EDGE_BUTTON_CLASS}>
					Reply to {replyOnlyFirstName} only
				</button>
			) : null}
		</div>
	)
}
