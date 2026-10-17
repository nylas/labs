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
	isBounceMessage,
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
	| { kind: 'open' | 'line'; index: number; message: MailMessage; prev?: MailMessage; earlier?: MailMessage }
	| { kind: 'folded'; item: FoldedItem }
	| { kind: 'divider'; label: string; count: number }
	| { kind: 'catch-up' }
	| { kind: 'system'; text: string }
	| { kind: 'draft'; message: MailMessage; replyTo?: MailMessage }
	| { kind: 'missing'; count: number }
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
	/** Messages that could not load, counted after the shown message they follow (-1: before the first). */
	missing?: ReadonlyMap<number, number>
}

/**
 * Where the messages that could not load were: how many follow each shown
 * message, by the thread's own order of message ids (-1: before the first).
 * A missing message breaks a folded run there, so the stream can say so in place.
 */
export function missingAfter(
	messageIds: readonly string[] | undefined,
	shown: MailMessage[],
	failedIds: readonly string[] | undefined,
): Map<number, number> {
	const missing = new Map<number, number>()
	const failed = new Set(failedIds ?? [])
	if (failed.size === 0) return missing
	const indexOf = new Map(shown.map((message, index) => [message.id, index]))
	let after = -1
	for (const id of messageIds ?? []) {
		if (failed.has(id)) missing.set(after, (missing.get(after) ?? 0) + 1)
		else after = indexOf.get(id) ?? after
	}
	return missing
}

const itemIndices = (item: FoldItem): number[] => (item.kind === 'folded' ? item.indices : [item.index])

/**
 * The stream in reading order. Every row is separated from the one above by
 * a 1px line, except the row right after the divider (the divider is its line)
 * and the divider and system lines themselves. A system line between two
 * messages shows only where those messages are on separate rows: one that
 * falls inside a folded run folds with it. `prev` is set on an open message
 * only when the message before it is open directly above; `earlier` is the
 * message before it however that one is shown.
 */
export function streamEntries(input: StreamInput): StreamEntry[] {
	const { messages, plan, closedIds, divider, events, catchUpBeforeIndex, drafts, missing } = input
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
	const pushMissing = (afterIndex: number) => {
		const count = missing?.get(afterIndex)
		if (!count) return
		push({ kind: 'missing', key: `missing:${afterIndex}`, separated: separateNext, count })
		separateNext = true
	}
	pushDrafts(leadingDrafts)
	pushMissing(-1)
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
				...(open && item.index > 0 ? { earlier: messages[item.index - 1] as MailMessage } : {}),
			})
			lastOpenIndex = open ? item.index : -2
		}
		separateNext = true
		// A draft that follows a message in a folded run sits under the folded row.
		for (const index of indices) {
			const message = messages[index] as MailMessage
			pushDrafts(draftsAfter.get(message.id) ?? [], message)
		}
		// A run is folded only between missing messages, so they follow its last row.
		pushMissing(indices.at(-1) as number)
	}
	return entries
}

/**
 * Drafts and the message each one follows: the message it answers when that
 * is shown (board 06: "A draft sits under the message it answers"), else the
 * nearest earlier message in the thread's order that is shown. A draft before
 * every shown message leads.
 */
export function placeDrafts(
	all: MailMessage[],
	shown: ReadonlySet<string>,
): Array<{ draft: MailMessage; after?: MailMessage }> {
	const byId = new Map(all.map((message) => [message.id, message]))
	let previous: MailMessage | undefined
	const placed: Array<{ draft: MailMessage; after?: MailMessage }> = []
	for (const message of all) {
		if (message.ownmailDraft === true) {
			const answers = (message as { reply_to_message_id?: unknown }).reply_to_message_id
			const answered = typeof answers === 'string' && shown.has(answers) ? byId.get(answers) : undefined
			const after = answered ?? previous
			placed.push({ draft: message, ...(after ? { after } : {}) })
		} else if (shown.has(message.id)) previous = message
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
 * A participant as a person, taking the name the thread knows them by when
 * the message carries the address alone (your own sent mail often does), so
 * "mjackson@…" still reads as Mary.
 */
export function knownPerson(participant: Participant, owner: string, known: readonly Person[]): Person {
	const person = toPerson(participant, owner)
	if (person.name) return person
	const key = person.email.toLowerCase()
	const named = known.find((entry) => entry.name && entry.email.trim().toLowerCase() === key)
	return named ? { ...person, name: named.name } : person
}

/**
 * "Mary, Grace, Alan" and how many more Reply all reaches: the sender (or
 * Reply-To) first, then To and Cc, without the owner. `known` are the people
 * the thread names, for addresses the message gives without a name.
 */
export function replyAllNames(
	message: MailMessage,
	owner: string,
	known: readonly Person[] = [],
): { names: string; more: number } {
	const own = owner.trim().toLowerCase()
	const seen = new Set<string>()
	const people: Person[] = []
	const replyTo = message.reply_to?.length ? message.reply_to : (message.from ?? [])
	for (const participant of [...replyTo, ...(message.to ?? []), ...(message.cc ?? [])]) {
		const key = participant.email?.trim().toLowerCase()
		if (!key || key === own || seen.has(key)) continue
		seen.add(key)
		people.push(knownPerson(participant, owner, known))
	}
	const named = people.slice(0, REPLY_CARD_NAMES).map((person) => firstName(person))
	return { names: named.join(', '), more: people.length - named.length }
}

type Participant = NonNullable<MailMessage['from']>[number]

/**
 * The message the thread's replies answer: the latest one that is not a draft
 * and not a delivery report, so a bounce of your own mail never makes the
 * mail server the person you reply to. A thread of nothing but reports
 * answers its latest one.
 */
export function replyBase(messages: readonly MailMessage[]): MailMessage | undefined {
	const sent = messages.filter((message) => message.ownmailDraft !== true)
	return sent.findLast((message) => !isBounceMessage(message)) ?? sent.at(-1)
}

/** The people of a conversation, without the mail servers that report a bounce. */
export const conversationMessages = (messages: readonly MailMessage[]): MailMessage[] =>
	messages.filter((message) => !isBounceMessage(message))

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

/** The first name of whoever a plain Reply goes to, by the name the thread knows them by. */
export function replyFirstName(message: MailMessage, owner: string, known: readonly Person[] = []): string {
	const target = replyTarget(message, owner)
	return target ? firstName(knownPerson(target, owner, known)) : ''
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

/**
 * The thread message a quoted history entry came from: the latest earlier
 * message from that address, or, when the entry carries its date (seconds),
 * the one sent closest to it. Nothing when no earlier message is theirs.
 */
export function quotedMessageId(
	messages: MailMessage[],
	quotingId: string,
	quote: { email?: string; date?: number },
): string | undefined {
	const email = quote.email?.trim().toLowerCase()
	if (!email) return undefined
	const end = messages.findIndex((message) => message.id === quotingId)
	const earlier = (end < 0 ? messages : messages.slice(0, end)).filter(
		(message) => message.from?.some((from) => from.email.trim().toLowerCase() === email) === true,
	)
	const { date } = quote
	if (date === undefined) return earlier.at(-1)?.id
	let best: MailMessage | undefined
	for (const message of earlier) {
		const distance = Math.abs((message.date ?? 0) - date)
		if (!best || distance <= Math.abs((best.date ?? 0) - date)) best = message
	}
	return best?.id
}
