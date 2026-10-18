import { emptyBodyNote } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'

/**
 * A message with no text never renders as a blank gap: it says the body is
 * empty and points to what was sent instead ("No message text. Grace sent 1
 * file."). The attachment chips follow it. Nothing renders when there is text.
 */
export function EmptyBody({ message, owner }: { message: MailMessage; owner: string }) {
	const note = emptyBodyNote(message, owner)
	if (!note) return null
	return (
		<p data-slot="empty-body" className="m-0 text-[13px] text-muted-foreground italic">
			{note}
		</p>
	)
}
