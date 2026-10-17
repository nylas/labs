import { AlertTriangle, Clock } from 'lucide-react'
import { useState } from 'react'
import { pendingSendAt, scheduledLabel, viewerZone } from '../lib/edge-states.js'
import { messageBodyParagraphs } from '../lib/mail-ui-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { EDGE_BUTTON_CLASS, EDGE_GHOST_CLASS } from './edge-actions.js'

/**
 * Your outgoing message keeps its place in the thread with its state in
 * words: "Not sent. mary@nasa.gov bounced." with Edit and resend or Copy text,
 * or "Sends Mon 9:00 AM" with Send now or Cancel. Nothing renders for a
 * message that went out normally.
 */
export function OutgoingStatus({
	message,
	bounce,
	onEditResend,
	onSendNow,
	onCancelSchedule,
	now = Date.now(),
	tz = viewerZone(),
}: {
	message: MailMessage
	bounce?: { address: string }
	onEditResend(): void
	onSendNow(): void
	onCancelSchedule(): void
	now?: number
	tz?: string
}) {
	const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
	const sendAt = pendingSendAt(message as MailMessage & { send_at?: unknown }, now)
	if (!bounce && sendAt === null) return null

	const copyText = async () => {
		try {
			await navigator.clipboard.writeText(messageBodyParagraphs(message).join('\n\n'))
			setCopy('copied')
		} catch {
			setCopy('failed')
		}
	}

	return (
		<div data-slot="outgoing-status" className="flex flex-col gap-2 text-[13px]">
			{bounce ? (
				<div role="note" className="flex flex-col gap-2">
					<div className="flex min-w-0 items-center gap-2 text-danger-soft-foreground">
						<AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
						<strong className="font-semibold">Not sent.</strong>
						<span className="min-w-0 truncate">
							{bounce.address ? `${bounce.address} bounced.` : 'The address bounced.'}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<button type="button" onClick={onEditResend} className={EDGE_BUTTON_CLASS}>
							Edit and resend
						</button>
						<button type="button" onClick={() => void copyText()} className={EDGE_GHOST_CLASS}>
							{copy === 'copied' ? 'Copied' : 'Copy text'}
						</button>
						{copy === 'failed' ? (
							<span role="alert" className="text-xs text-danger-soft-foreground">
								Couldn’t copy. Select the text instead.
							</span>
						) : null}
					</div>
				</div>
			) : null}
			{bounce && sendAt !== null ? <div aria-hidden="true" className="h-px bg-border" /> : null}
			{sendAt !== null ? (
				<div role="note" className="flex min-w-0 items-center gap-2 text-muted-foreground">
					<Clock aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1">
						Sends <span className="font-data tabular-nums">{scheduledLabel(sendAt, now, tz)}</span>
					</span>
					<button type="button" onClick={onSendNow} className={EDGE_GHOST_CLASS}>
						Send now
					</button>
					<button type="button" onClick={onCancelSchedule} className={EDGE_GHOST_CLASS}>
						Cancel
					</button>
				</div>
			) : null}
		</div>
	)
}
