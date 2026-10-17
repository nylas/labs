import { ChevronDown } from 'lucide-react'
import { collapsedMessagePreview } from '../lib/mail-ui-model.js'
import type { FoldItem } from '../lib/thread-reading-model.js'
import { personName, senderPerson } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { Avatar, AvatarStack } from './Avatar.js'

/**
 * A read message on one line: avatar, sender, the start of what they wrote,
 * and the day. On a phone the preview drops under the name. Opening it is
 * one click anywhere on the row.
 */
export function OneLineMessageRow({
	message,
	owner,
	date,
	onOpen,
}: {
	message: MailMessage
	owner: string
	/** "Sep 28", "Mon", "9:30 AM"; empty until the reader's clock is known. */
	date: string
	onOpen: (messageId: string) => void
}) {
	const sender = senderPerson(message, owner)
	const name = sender.isOwner ? 'You' : personName(sender, 'full')
	return (
		<button
			type="button"
			data-slot="message-expand"
			className="reader-line"
			onClick={() => onOpen(message.id)}
		>
			<Avatar person={sender} size={28} className="reader-line-avatar" />
			<span className="reader-line-name">{name}</span>
			<span className="reader-line-preview">{collapsedMessagePreview(message)}</span>
			<span className="reader-line-date font-data tabular-nums">{date}</span>
		</button>
	)
}

/**
 * Three or more read messages in a row as one stacked row: who wrote them,
 * how many, and when. Clicking it lays the run out as one-line rows.
 */
export function FoldedMessagesRow({
	item,
	onExpand,
}: {
	item: Extract<FoldItem, { kind: 'folded' }>
	onExpand: (ids: string[]) => void
}) {
	const count = item.indices.length
	const meta = [item.names, item.span].filter(Boolean).join(' · ')
	return (
		<button
			type="button"
			data-slot="folded-messages"
			aria-expanded={false}
			className="reader-folded"
			onClick={() => onExpand(item.ids)}
		>
			<AvatarStack people={item.avatars} size={20} max={3} />
			<span className="reader-folded-count">{count} earlier messages</span>
			<span className="reader-folded-meta">{meta}</span>
			<ChevronDown aria-hidden="true" className="reader-folded-chevron" />
		</button>
	)
}

/** "3 new since Tuesday": where the reader stopped, between two neutral lines. */
export function NewSinceDivider({ label }: { label: string }) {
	return (
		<div data-slot="new-since-divider" className="reader-divider">
			<hr aria-label={label} className="reader-divider-line" />
			<span aria-hidden="true" className="reader-divider-label">
				<span className="reader-divider-dot" />
				{label}
			</span>
			<span aria-hidden="true" className="reader-divider-line" />
		</div>
	)
}

/** A centred line saying what changed between two messages: "Grace added Mary Jackson". */
export function SystemLine({ text }: { text: string }) {
	return (
		<p data-slot="system-line" className="reader-system-line">
			{text}
		</p>
	)
}
