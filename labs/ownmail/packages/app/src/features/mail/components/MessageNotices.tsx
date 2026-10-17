import { AlertTriangle, Newspaper, Reply, UserMinus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '#shared/lib/utils'
import {
	addressDomain,
	lookalikeSender,
	mailingList,
	removedFromReply,
	replyToAddress,
} from '../lib/message-anatomy.js'
import { firstName, type Person, personName, senderPerson } from '../lib/thread-reading-model.js'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'

export { lookalikeSender } from '../lib/message-anatomy.js'

/** An address, domain or list in a notice reads as one unbroken token: "meridian-secure.co" never splits at its hyphen. */
const ADDRESS_CLASS = 'font-semibold whitespace-nowrap'

/**
 * Whether a message's links are made inert: it failed sender checks (DMARC),
 * or its sender only looks like someone this mailbox knows.
 */
export function linksDisabled(facts?: MessageHeaderFacts, lookalike?: boolean): boolean {
	return facts?.authFailed === true || lookalike === true
}

/** Whether a message's sender is a lookalike of someone this mailbox knows. */
export function isLookalikeSender(message: MailMessage, knownSenders: Person[], owner: string): boolean {
	return lookalikeSender(message, knownSenders, owner) !== null
}

type Tone = 'warning' | 'danger' | 'neutral'

/** Severity is a uniform line, a tint and a glyph (design.md "Borders and accents"); never a rail. */
const TONE_CLASS: Record<Tone, string> = {
	warning: 'border-notice-warning-line bg-notice-warning text-notice-warning-foreground',
	danger: 'border-notice-danger-line bg-notice-danger text-notice-danger-foreground',
	neutral: 'border-border bg-card text-note-foreground',
}

const linkClass =
	'rounded-sm font-semibold text-cta-icon outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

function Notice({
	tone,
	icon,
	kind,
	children,
}: {
	tone: Tone
	icon: ReactNode
	kind: string
	children: ReactNode
}) {
	return (
		<div
			role="note"
			data-slot="message-notice"
			data-kind={kind}
			data-tone={tone}
			className={cn('message-notice flex rounded-md border text-[13px] leading-normal', TONE_CLASS[tone])}
		>
			<span className="mt-px shrink-0 [&_svg]:size-4" aria-hidden="true">
				{icon}
			</span>
			<p className="min-w-0 [overflow-wrap:anywhere]">{children}</p>
		</div>
	)
}

/**
 * What is unusual about one message, said above its body (board 05, step 3),
 * and nothing when nothing is: replies that go to another address (amber),
 * a sender who failed checks or only looks like someone you know (red, with
 * links disabled), someone the sender dropped from a reply all, and a mailing
 * list with ways to mute (or, when `muted`, unmute) the thread or leave the
 * list. The mute control is a toggle whose label says what it will do, so it
 * carries no `aria-pressed` as well.
 */
export function MessageNotices({
	message,
	prev,
	owner,
	facts,
	knownSenders,
	muted = false,
	listNotice = true,
	onMuteThread,
	onAddBack,
}: {
	message: MailMessage
	/** The message before this one in the thread, open or not: who it reached says who was dropped. */
	prev?: MailMessage
	owner: string
	facts?: MessageHeaderFacts
	/** Contacts and earlier correspondents, never this message's own sender. */
	knownSenders: Person[]
	/** Whether the thread is muted; the list notice then offers "Unmute thread". */
	muted?: boolean
	/** A thread says it came through a list once, on its first open message from the list. */
	listNotice?: boolean
	/** Toggles the thread's muted state. */
	onMuteThread(): void
	onAddBack(person: Person): void
}) {
	const sender = senderPerson(message, owner)
	const replyTo = replyToAddress(message, facts, owner)
	const lookalike = lookalikeSender(message, knownSenders, owner)
	const failed = facts?.authFailed === true && !sender.isOwner
	const removed = removedFromReply(message, prev, owner)
	const list = sender.isOwner || !listNotice ? null : mailingList(message, facts, owner)
	const leaveHref = facts?.unsubscribeUrl ?? facts?.unsubscribeMailto
	const domain = addressDomain(sender.email)

	const notices: ReactNode[] = []
	if (replyTo) {
		notices.push(
			<Notice key="reply-to" kind="reply-to" tone="warning" icon={<Reply />}>
				Replies go to <strong className={ADDRESS_CLASS}>{replyTo}</strong>, not the address this came from.
			</Notice>,
		)
	}
	if (lookalike || failed) {
		notices.push(
			<Notice key="sender" kind="sender-check" tone="danger" icon={<AlertTriangle />}>
				{lookalike ? `“${lookalike.name}” usually writes from ${lookalike.usualDomain}. ` : null}
				This came from <strong className={ADDRESS_CLASS}>{lookalike?.domain ?? domain}</strong>
				{failed ? ' and failed sender checks' : ''}. Links are disabled.
			</Notice>,
		)
	}
	for (const person of removed) {
		const first = personName(person, 'first')
		notices.push(
			<Notice key={`removed-${person.email}`} kind="removed" tone="neutral" icon={<UserMinus />}>
				{firstName(sender)} removed <strong className="font-semibold">{first}</strong> from this reply.{' '}
				<button type="button" className={linkClass} onClick={() => onAddBack(person)}>
					Add {first} back to yours
				</button>
			</Notice>,
		)
	}
	if (list) {
		notices.push(
			<Notice key="list" kind="mailing-list" tone="neutral" icon={<Newspaper />}>
				{list.label ? (
					<>
						Sent to <strong className={ADDRESS_CLASS}>{list.label}</strong>,{' '}
						{list.count ? `a list of ${list.count.toLocaleString('en-US')}.` : 'a mailing list.'}
					</>
				) : (
					'Sent through a mailing list.'
				)}{' '}
				<button type="button" data-slot="mute-thread" className={linkClass} onClick={onMuteThread}>
					{muted ? 'Unmute thread' : 'Mute thread'}
				</button>
				{leaveHref ? (
					<>
						<span aria-hidden="true"> · </span>
						<a
							href={leaveHref}
							className={linkClass}
							{...(facts?.unsubscribeUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
						>
							Leave list
						</a>
					</>
				) : null}
			</Notice>,
		)
	}

	if (notices.length === 0) return null
	return (
		<div data-slot="message-notices" className="message-notices flex flex-col">
			{notices}
		</div>
	)
}
