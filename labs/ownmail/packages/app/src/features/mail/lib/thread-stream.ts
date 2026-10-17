/**
 * The standard reader's stream: the fold plan laid out with everything that
 * sits between messages (the "new since" divider, the catch-up card, system
 * lines and drafts), the separators between them, the reply-all names and the
 * file details the open messages show. Pure, like the reading model it builds
 * on, so the reader component only renders what this returns.
 */

import { isCalendarInvitationAttachment } from '#features/calendar/lib/calendar-invitation'
import type { MailMessage } from '../state/mail-queries.js'
import { messageBodyParagraphs } from './mail-ui-model.js'
import {
	type FoldItem,
	firstName,
	type Person,
	type SystemEvent,
	senderPerson,
	shortDayLabel,
	type ThreadFile,
	threadFiles,
	toPerson,
	versionLabel,
} from './thread-reading-model.js'

/** Above this many messages the stream mounts only what is near the viewport. */
export const VIRTUALIZE_AFTER = 50
/** The catch-up card appears on threads of at least this many messages with something new. */
export const CATCH_UP_MIN_MESSAGES = 6
/** Recipients the inline reply card names before "+n". */
const REPLY_CARD_NAMES = 3

type FoldedItem = Extract<FoldItem, { kind: 'folded' }>

export type StreamEntry = { key: string; separated: boolean } & (
	| { kind: 'open' | 'line'; index: number; message: MailMessage; prev?: MailMessage }
	| { kind: 'folded'; item: FoldedItem }
	| { kind: 'divider'; label: string; count: number }
	| { kind: 'catch-up' }
	| { kind: 'system'; text: string }
	| { kind: 'draft'; message: MailMessage; replyTo?: MailMessage }
)

export type StreamInput = {
	/** The messages the plan was made for: no drafts, no hidden (trashed) messages. */
	messages: MailMessage[]
	plan: FoldItem[]
	/** Messages the reader closed; the plan's open rule would otherwise reopen them. */
	closedIds: ReadonlySet<string>
	divider: { beforeIndex: number; count: number; label: string } | null
	events: SystemEvent[]
	/** Where the catch-up card goes: before the message at this index (the first new one), or nowhere. */
	catchUpBeforeIndex: number | null
	/** Drafts, each with the message it follows in the thread (undefined: before the first). */
	drafts: Array<{ draft: MailMessage; after?: MailMessage }>
}

const itemIndices = (item: FoldItem): number[] => (item.kind === 'folded' ? item.indices : [item.index])

/**
 * The stream in reading order. Every row is separated from the one above by
 * a 1px line, except the row right after the divider (the divider is its line)
 * and the divider and system lines themselves. A system line between two
 * messages shows only where those messages are on separate rows: one that
 * falls inside a folded run folds with it. `prev` is set on an open message
 * only when the message before it is open directly above.
 */
export function streamEntries(input: StreamInput): StreamEntry[] {
	const { messages, plan, closedIds, divider, events, catchUpBeforeIndex, drafts } = input
	const entries: StreamEntry[] = []
	const eventsAfter = new Map<number, string[]>()
	for (const event of events)
		eventsAfter.set(event.afterIndex, [...(eventsAfter.get(event.afterIndex) ?? []), event.text])
	const draftsAfter = new Map<string, MailMessage[]>()
	const leadingDrafts: MailMessage[] = []
	for (const { draft, after } of drafts) {
		if (after) draftsAfter.set(after.id, [...(draftsAfter.get(after.id) ?? []), draft])
		else leadingDrafts.push(draft)
	}
	let separateNext = true
	const push = (entry: StreamEntry) => entries.push(entry)
	const pushDrafts = (list: MailMessage[], replyTo?: MailMessage) => {
		for (const draft of list) {
			push({
				kind: 'draft',
				key: `draft:${draft.id}`,
				separated: separateNext,
				message: draft,
				...(replyTo ? { replyTo } : {}),
			})
			separateNext = true
		}
	}
	pushDrafts(leadingDrafts)
	let lastOpenIndex = -2
	for (const item of plan) {
		const indices = itemIndices(item)
		const first = indices[0] as number
		if (first > 0) {
			for (const text of eventsAfter.get(first - 1) ?? []) {
				push({ kind: 'system', key: `system:${first}:${text}`, separated: false, text })
				separateNext = true
			}
		}
		if (first === catchUpBeforeIndex) {
			push({ kind: 'catch-up', key: 'catch-up', separated: separateNext })
			separateNext = true
		}
		if (divider && first === divider.beforeIndex) {
			push({ kind: 'divider', key: 'divider', separated: false, label: divider.label, count: divider.count })
			separateNext = false
		}
		if (item.kind === 'folded') {
			push({ kind: 'folded', key: `folded:${item.key}`, separated: separateNext, item })
			lastOpenIndex = -2
		} else {
			const message = messages[item.index] as MailMessage
			const open = item.kind === 'open' && !closedIds.has(message.id)
			push({
				kind: open ? 'open' : 'line',
				key: message.id,
				separated: separateNext,
				index: item.index,
				message,
				...(open && lastOpenIndex === item.index - 1
					? { prev: messages[item.index - 1] as MailMessage }
					: {}),
			})
			lastOpenIndex = open ? item.index : -2
		}
		separateNext = true
		// A draft that follows a message in a folded run sits under the folded row.
		for (const index of indices) {
			const message = messages[index] as MailMessage
			pushDrafts(draftsAfter.get(message.id) ?? [], message)
		}
	}
	return entries
}

/**
 * Drafts and the message each one follows: the nearest earlier message in the
 * thread's order that is shown. A draft before every shown message leads.
 */
export function placeDrafts(
	all: MailMessage[],
	shown: ReadonlySet<string>,
): Array<{ draft: MailMessage; after?: MailMessage }> {
	let previous: MailMessage | undefined
	const placed: Array<{ draft: MailMessage; after?: MailMessage }> = []
	for (const message of all) {
		if (message.ownmailDraft === true)
			placed.push({ draft: message, ...(previous ? { after: previous } : {}) })
		else if (shown.has(message.id)) previous = message
	}
	return placed
}

/** Whether a message sits in a folder named Trash. */
export const isTrashed = (message: MailMessage): boolean =>
	(message.folders ?? []).some((folder) => folder.toLowerCase() === 'trash')

/** The messages that run in the stream: no drafts, and no trashed messages unless they are shown. */
export function streamMessages(messages: MailMessage[], showTrashed: boolean): MailMessage[] {
	return messages.filter((message) => message.ownmailDraft !== true && (showTrashed || !isTrashed(message)))
}

/**
 * "Mary, Grace, Alan" and how many more Reply all reaches: the sender (or
 * Reply-To) first, then To and Cc, without the owner.
 */
export function replyAllNames(message: MailMessage, owner: string): { names: string; more: number } {
	const own = owner.trim().toLowerCase()
	const seen = new Set<string>()
	const people: Person[] = []
	const replyTo = message.reply_to?.length ? message.reply_to : (message.from ?? [])
	for (const participant of [...replyTo, ...(message.to ?? []), ...(message.cc ?? [])]) {
		const key = participant.email?.trim().toLowerCase()
		if (!key || key === own || seen.has(key)) continue
		seen.add(key)
		people.push(toPerson(participant, owner))
	}
	const named = people.slice(0, REPLY_CARD_NAMES).map((person) => firstName(person))
	return { names: named.join(', '), more: people.length - named.length }
}

type Participant = NonNullable<MailMessage['from']>[number]

/**
 * Whoever a plain Reply goes to: the Reply-To, else the sender. When that is
 * the mailbox owner (your own message is the latest), the reply goes to the
 * first other person you wrote to instead.
 */
export function replyTarget(message: MailMessage, owner: string): Participant | undefined {
	const own = owner.trim().toLowerCase()
	const isOwn = (participant: Participant) => participant.email?.trim().toLowerCase() === own
	const target = message.reply_to?.[0] ?? message.from?.[0]
	if (!target || !own || !isOwn(target)) return target
	return [...(message.to ?? []), ...(message.cc ?? [])].find(
		(participant) => participant.email && !isOwn(participant),
	)
}

/** The first name of whoever a plain Reply goes to. */
export function replyFirstName(message: MailMessage, owner: string): string {
	const target = replyTarget(message, owner)
	return target ? firstName(toPerson(target, owner)) : ''
}

/**
 * The detail line of each attachment chip, keyed by message and attachment id:
 * "2.1 MB", or "2.1 MB · replaces v3 from Tue" for a later version of a file.
 * A size the provider did not give is left out; a file with nothing to say
 * has no entry.
 */
export function attachmentDetails(
	messages: MailMessage[],
	owner: string,
	now: number,
	tz: string,
	formatSize: (bytes: number) => string,
): Map<string, string> {
	const details = new Map<string, string>()
	const describe = (file: ThreadFile) => {
		const detail = [file.size > 0 ? formatSize(file.size) : '', versionLabel(file, now, tz) ?? '']
			.filter(Boolean)
			.join(' · ')
		if (detail) details.set(`${file.messageId}|${file.attachmentId}`, detail)
	}
	for (const file of threadFiles(messages, owner)) {
		describe(file)
		file.olderVersions.forEach((older, index) => {
			describe({ ...older, olderVersions: file.olderVersions.slice(index + 1) })
		})
	}
	return details
}

/** Attachments shown as chips under an open message: not inline images, not invitations (they are cards). */
export function chipAttachments(message: MailMessage): NonNullable<MailMessage['attachments']> {
	return (message.attachments ?? []).filter(
		(attachment) => !attachment.is_inline && !isCalendarInvitationAttachment(attachment),
	)
}

const domainOf = (email: string): string => email.trim().toLowerCase().split('@')[1] ?? ''

/**
 * A lookalike sender: the display name of someone else in this thread (or in
 * `known`), written from a different domain than theirs.
 */
export function isLookalikeSender(message: MailMessage, others: Person[], owner: string): boolean {
	const sender = senderPerson(message, owner)
	const name = sender.name.trim().toLowerCase()
	if (!name || sender.isOwner) return false
	const domain = domainOf(sender.email)
	return others.some(
		(person) =>
			person.name.trim().toLowerCase() === name &&
			person.email.trim().toLowerCase() !== sender.email.trim().toLowerCase() &&
			domainOf(person.email) !== domain,
	)
}

/** Heading texts (h1–h3) of an HTML body, for the long-message outline. */
export function messageHeadings(message: MailMessage): string[] {
	const body = message.body ?? ''
	const headings: string[] = []
	for (const match of body.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
		const text = (match[1] as string)
			.replace(/<br\b[^>]*>/gi, ' ')
			.replace(/<[^>]*>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/\s+/g, ' ')
			.trim()
		if (text) headings.push(text)
	}
	return headings
}

const timeFormats = new Map<string, Intl.DateTimeFormat>()

/** "9:30 AM" in a zone (UTC when the zone is unknown). */
function timeOfDay(seconds: number, tz: string): string {
	let format = timeFormats.get(tz)
	if (!format) {
		format = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: safeZone(tz) })
		timeFormats.set(tz, format)
	}
	return format.format(seconds * 1000)
}

/**
 * The day on a one-line row: the time for today ("9:30 AM"), the weekday for
 * the past six days ("Mon"), else the date ("Sep 28").
 */
export function lineDateLabel(seconds: number | undefined, now: number, tz: string): string {
	if (!seconds || seconds <= 0) return ''
	const day = shortDayLabel(seconds, now, tz)
	if (day === 'today') return timeOfDay(seconds, tz)
	if (day === 'yesterday') {
		return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: safeZone(tz) }).format(
			seconds * 1000,
		)
	}
	return day
}

function safeZone(tz: string): string {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		return tz
	} catch {
		return 'UTC'
	}
}

/** A composer seeded with your own message, to send it again: its recipients, subject and text. */
export function resendSeed(message: MailMessage): { to: string; subject: string; body: string } {
	return {
		to: [...(message.to ?? []), ...(message.cc ?? [])].map((person) => person.email).join(', '),
		subject: message.subject ?? '',
		body: messageBodyParagraphs(message).join('\n\n'),
	}
}

/** Where `j` (1) or `k` (-1) goes from `current`, clamped to the thread. */
export function stepMessage(current: number, step: 1 | -1, count: number): number {
	if (count === 0) return -1
	return Math.min(count - 1, Math.max(0, current + step))
}

/** The element id of a message in the stream, the target of `#message-<id>` links and the map. */
export const messageAnchorId = (messageId: string): string => `message-${messageId}`

/** The message a `#message-<id>` hash names, when it is in the thread. */
export function hashTarget(hash: string, messages: MailMessage[]): string | undefined {
	const match = /^#message-(.+)$/.exec(hash)
	if (!match) return undefined
	const id = decodeURIComponent(match[1] as string)
	return messages.some((message) => message.id === id) ? id : undefined
}
