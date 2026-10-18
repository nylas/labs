import { ChevronDown, Trash2, WifiOff } from 'lucide-react'
import { collapsedMessagePreview } from '../lib/mail-ui-model.js'
import type { FoldItem } from '../lib/thread-reading-model.js'
import { personName, senderPerson } from '../lib/thread-reading-model.js'
import { isTrashed } from '../lib/thread-stream.js'
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
			<span className="reader-line-preview">
				{isTrashed(message) ? <InTrash /> : null}
				{collapsedMessagePreview(message)}
			</span>
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

/**
 * "3 new since Tuesday": where the reader stopped, between two neutral lines.
 * The first line is the separator, named with the words the divider shows
 * (boards 01 and 03), so the label drawn beside it is not read twice.
 */
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

/**
 * Where messages that could not load were: a quiet line in their place in
 * the stream, with Try again (design.md "Edge states": say exactly what is
 * missing and where).
 */
export function MissingMessagesRow({ count, onRetry }: { count: number; onRetry: () => void }) {
	return (
		<p role="note" data-slot="missing-messages" className="reader-system-line reader-missing-line">
			<WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
			<span>
				Couldn’t load {count === 1 ? '1 message' : `${count} messages`} here.{' '}
				<button type="button" onClick={onRetry} className="reader-missing-retry">
					Try again
				</button>
			</span>
		</p>
	)
}

/** A message shown from Trash still says where it is. */
export function InTrash() {
	return (
		<span data-slot="in-trash" className="reader-in-trash">
			<Trash2 aria-hidden="true" className="size-3 shrink-0" />
			In Trash
			{/* A flex item drops its own edge spaces, so the gap and a margin space the dot. */}
			<span aria-hidden="true" className="reader-in-trash-separator">
				·
			</span>
		</span>
	)
}
