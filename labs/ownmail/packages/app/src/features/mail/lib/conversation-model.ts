/**
 * Conversation view: a thread as a chat transcript.
 *
 * This module turns a thread's messages into the items the transcript renders:
 * day separators, system lines for participant changes, runs of bubbles from
 * one sender, article cards, and full-width cards for mail that keeps the
 * standard reader. It also runs the thread pass that decides what a bubble
 * shows: only what was not already shown earlier in the thread. It is pure and
 * DOM-free; the caller supplies each message's block model from
 * `clean-view.ts`.
 */

import type { MailMessage } from '../state/mail-queries.js'
import { blocksText, type CleanBlock, type MessageContent, nestedBlocks } from './clean-view.js'

/** Consecutive emails from one sender this close together read as one run. */
export const GROUP_WINDOW_SECONDS = 5 * 60

/** A forwarded message is content, not history, so it is never hidden. */
const FORWARDED = /(?:^|\n)\s*(?:-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:)/i
/** "On Mon, Ines wrote:" and the header lines Outlook puts above a quote. */
const ATTRIBUTION = /(?:wrote|a écrit|schrieb|escribió)\s*:\s*$|^(?:from|sent|to|cc|date|subject)\s*:/i
/** Lines shorter than this ("Thanks", "OK") are too common to identify a message. */
const MIN_FINGERPRINT = 8
/** A block outside a quote has to be this long before a repeat of it is folded. */
const MIN_REPEAT = 40
/** The share of a quote that must be found earlier in the thread to call it a repeat. */
const REPEAT_SHARE = 0.8
const REFERENCE_MAX_CHARS = 140
const SIGNATURE_DASHES = /^--\s*(?:\n|$)/
const SIGNATURE_MAX_LINES = 6
const SIGNATURE_MAX_LINE_CHARS = 60
const CONTACT_LINE = /\+?\d[\d\s().-]{6,}\d|@|https?:\/\/|www\./i
const SUBJECT_PREFIX = /^(?:\s*(?:re|fwd?|aw|wg|tr|sv)\s*:\s*)+/i

export interface BubbleContent {
	blocks: CleanBlock[]
	/**
	 * The new-content extraction was unsure, so the whole message is shown and
	 * its quoted history stays in the bubble behind an open disclosure.
	 */
	unsure: boolean
}

export interface ConversationBubble extends BubbleContent {
	message: MailMessage
}

export type ConversationItem =
	| { kind: 'day'; key: string; epochSeconds: number }
	/** A change email hides in headers: a person added, moved to Cc, a new subject. */
	| { kind: 'event'; key: string; text: string }
	| { kind: 'run'; key: string; label: string; mine: boolean; bubbles: ConversationBubble[] }
	/** A message shown by the standard reader, across the full column. */
	| { kind: 'card'; key: string; label: string; message: MailMessage; restorable: boolean }
	/** Designed mail rendered natively by the clean pipeline. */
	| { kind: 'article'; key: string; label: string; message: MailMessage; blocks: CleanBlock[] }

export interface Conversation {
	items: ConversationItem[]
	/**
	 * `article` when every message is designed mail: the thread reads as an
	 * article, without the chat's day separators, participants or reply input.
	 */
	layout: 'chat' | 'article'
	/** Three or more participants: runs carry a name and initials. */
	group: boolean
	/** "Ines, Tomas and you": everyone on the thread, the signed-in address last. */
	participants: string
}

export interface ConversationOptions {
	/** The signed-in address; its messages sit on the right. */
	mailboxEmail?: string | undefined
	contentFor: (message: MailMessage) => MessageContent
	/** Messages the reader switched to "Show original". */
	originalIds: ReadonlySet<string>
	dayKey?: (epochSeconds: number) => string
}

/** One block the thread has already shown: its fingerprint and, when known, who wrote it. */
export interface ShownBlock {
	author?: string
	text: string
}

/** A fingerprint: the letters and digits of a text, lowercased, nothing else. */
const fingerprint = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Remember what a message showed. Its own blocks carry its author; text it
 * quoted from elsewhere is remembered without one, because the thread cannot
 * say who wrote it.
 */
export function rememberBlocks(shown: ShownBlock[], blocks: CleanBlock[], author?: string): void {
	for (const block of blocks) {
		const nested = nestedBlocks(block)
		if (nested) {
			// A footer is the sender's own words; quoted text is somebody else's.
			rememberBlocks(shown, nested, block.type === 'footer' ? author : undefined)
			continue
		}
		const text = fingerprint(blocksText([block]))
		if (text.length >= MIN_FINGERPRINT) shown.push({ text, ...(author ? { author } : {}) })
	}
}

/** The fingerprints of quoted lines, without quote markers, attribution lines or lines too short to tell apart. */
function quotedLines(blocks: CleanBlock[]): string[] {
	return blocksText(blocks)
		.split('\n')
		.map((line) => line.replace(/^[>\s]+/, ''))
		.filter((line) => !ATTRIBUTION.test(line))
		.map(fingerprint)
		.filter((line) => line.length >= MIN_FINGERPRINT)
}

const wasShown = (shown: readonly ShownBlock[], line: string): ShownBlock | undefined =>
	shown.find((entry) => entry.text.includes(line))

/** Whether quoted lines repeat what the thread already showed. Nothing countable is nothing new. */
function repeatsThread(lines: string[], shown: readonly ShownBlock[]): boolean {
	const total = lines.reduce((sum, line) => sum + line.length, 0)
	if (total === 0) return true
	const matched = lines.reduce((sum, line) => sum + (wasShown(shown, line) ? line.length : 0), 0)
	return matched / total >= REPEAT_SHARE
}

/** Answers written between quoted lines sit after a quote inside the detected history. */
function answeredInside(history: CleanBlock[]): boolean {
	const firstQuote = history.findIndex((block) => block.type === 'quote')
	return firstQuote !== -1 && history.some((block, index) => index > firstQuote && block.type !== 'quote')
}

/** A block the trailing fold may drop: a signature, or content the thread showed before. */
function isRepeat(block: CleanBlock, shown: readonly ShownBlock[]): boolean {
	if (block.type === 'signature') return true
	if (block.type === 'history') {
		return !answeredInside(block.blocks) && repeatsThread(quotedLines(block.blocks), shown)
	}
	const text = fingerprint(blocksText([block]))
	return text.length >= MIN_REPEAT && wasShown(shown, text) !== undefined
}

/** A short closing block made mostly of phone numbers, addresses and links. */
function isContactBlock(block: CleanBlock): boolean {
	if (block.type !== 'paragraph') return false
	const lines = blocksText([block]).split('\n')
	return (
		lines.length >= 2 &&
		lines.length <= SIGNATURE_MAX_LINES &&
		lines.every((line) => line.length <= SIGNATURE_MAX_LINE_CHARS) &&
		lines.filter((line) => CONTACT_LINE.test(line)).length >= 2
	)
}

/**
 * Find the signature when the sender's client did not mark one: everything
 * from a `-- ` line to the quoted history, or else a closing contact block.
 */
function markSignatures(blocks: CleanBlock[]): CleanBlock[] {
	if (blocks.some((block) => block.type === 'signature')) return blocks
	const firstHistory = blocks.findIndex((block) => block.type === 'history')
	const end = firstHistory === -1 ? blocks.length : firstHistory
	let start = blocks.findIndex(
		(block, index) => index < end && block.type === 'paragraph' && SIGNATURE_DASHES.test(blocksText([block])),
	)
	// A lone contact block is the message, not a signature.
	if (start === -1 && end > 1 && isContactBlock(blocks[end - 1] as CleanBlock)) start = end - 1
	if (start === -1) return blocks
	return [
		...blocks.slice(0, start),
		{ type: 'signature', blocks: blocks.slice(start, end) },
		...blocks.slice(end),
	]
}

function reference(quote: CleanBlock[], lines: string[], shown: readonly ShownBlock[]): CleanBlock {
	const text = blocksText(quote).replace(/\s+/g, ' ')
	const author = wasShown(shown, lines[0] as string)?.author
	return {
		type: 'reference',
		text: text.length > REFERENCE_MAX_CHARS ? `${text.slice(0, REFERENCE_MAX_CHARS - 1).trimEnd()}…` : text,
		...(author ? { author } : {}),
	}
}

/**
 * Quoted history that is not simply a trailing repeat: answers written between
 * or below quoted lines. Each quote the thread already showed shrinks to a
 * small reply reference above its answer; a quote of something the thread has
 * not shown stays in full. The "On Mon, Ines wrote:" line goes.
 */
function expandHistory(
	history: Extract<CleanBlock, { type: 'history' }>,
	shown: readonly ShownBlock[],
): CleanBlock[] {
	if (!history.blocks.some((block) => block.type === 'quote')) return [history]
	return history.blocks.flatMap((block): CleanBlock[] => {
		if (block.type !== 'quote') {
			return ATTRIBUTION.test(blocksText([block]).replace(/\n/g, ' ')) ? [] : [block]
		}
		const lines = quotedLines(block.blocks)
		return lines.length > 0 && repeatsThread(lines, shown) ? [reference(block.blocks, lines, shown)] : [block]
	})
}

const QUOTED_TYPES: ReadonlySet<CleanBlock['type']> = new Set(['history', 'signature', 'reference'])

/**
 * The thread pass for one message: keep only what was not already shown
 * earlier in the thread.
 *
 * - A trailing run of signature and repeated content is folded away.
 * - A signature with nothing new after it goes too; text below a signature
 *   keeps the signature in place.
 * - Quoted history that is followed by new text, or has answers inside it,
 *   becomes reply references and answers.
 * - A trailing quote the thread has not shown stays behind a disclosure.
 *
 * A forwarded message, or a message with nothing new left, is shown whole
 * (`unsure`) rather than risk hiding something that mattered.
 */
export function bubbleContent(blocks: CleanBlock[], shown: readonly ShownBlock[] = []): BubbleContent {
	const histories = blocks.filter((block) => block.type === 'history')
	if (FORWARDED.test(blocksText(histories))) return { blocks, unsure: true }

	const marked = markSignatures(blocks)
	let end = marked.length
	while (end > 0 && isRepeat(marked[end - 1] as CleanBlock, shown)) end -= 1
	const kept = marked.slice(0, end).flatMap((block, index, all): CleanBlock[] => {
		if (block.type !== 'history') return [block]
		const answered = index < all.length - 1 || answeredInside(block.blocks)
		return answered ? expandHistory(block, shown) : [block]
	})
	const lastNew = kept.findLastIndex((block) => !QUOTED_TYPES.has(block.type))
	if (lastNew === -1) return { blocks, unsure: true }
	return {
		blocks: kept.filter((block, index) => block.type !== 'signature' || index < lastNew),
		unsure: false,
	}
}

/** The local calendar day of a message, used to place day separators. */
export function localDayKey(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000)
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

const addressKey = (email: string | undefined): string => email?.trim().toLowerCase() ?? ''

type Person = { name?: string; email: string }

export function senderLabel(message: MailMessage): string {
	const from = message.from?.[0]
	return from?.name || from?.email || '(unknown sender)'
}

/** First name, or the part of an address before the at sign. */
function shortName(person: Person): string {
	const source = person.name?.trim() || person.email
	return (source.includes('@') ? source.slice(0, source.indexOf('@')) : source).split(/\s+/)[0] as string
}

function participantSummary(messages: MailMessage[], own: string): { count: number; summary: string } {
	const others = new Map<string, string>()
	let includesOwn = false
	for (const message of messages) {
		for (const person of [...(message.from ?? []), ...(message.to ?? []), ...(message.cc ?? [])]) {
			const key = addressKey(person.email)
			if (!key) continue
			if (key === own) includesOwn = true
			else if (!others.has(key)) others.set(key, shortName(person))
		}
	}
	const names = [...others.values(), ...(includesOwn ? ['you'] : [])]
	const summary = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
	return { count: names.length, summary }
}

const keysOf = (people: Person[] | undefined): string[] =>
	(people ?? []).map((person) => addressKey(person.email)).filter(Boolean)

const normalSubject = (subject: string | undefined): string =>
	(subject ?? '').replace(SUBJECT_PREFIX, '').replace(/\s+/g, ' ').trim()

/**
 * What changed between a message and the one before it, from To and Cc alone:
 * people who appear on the thread for the first time, people who were
 * addressed directly and are now only copied, and a new subject. A plain
 * reply-all (To is just the previous sender) moves nobody: mail clients put
 * everyone else in Cc on their own.
 */
function messageEvents(
	message: MailMessage,
	previous: MailMessage,
	known: ReadonlySet<string>,
	own: string,
): string[] {
	const isOwn = (person: Person) => own !== '' && addressKey(person.email) === own
	const actor = message.from?.[0]
	const who = actor ? (isOwn(actor) ? 'You' : shortName(actor)) : 'Someone'
	const display = (person: Person) => (isOwn(person) ? 'you' : person.name || person.email)
	const events: string[] = []

	const added = new Map<string, Person>()
	for (const person of [...(message.to ?? []), ...(message.cc ?? [])]) {
		const key = addressKey(person.email)
		if (key && !known.has(key) && !added.has(key)) added.set(key, person)
	}
	if (added.size > 0) events.push(`${who} added ${[...added.values()].map(display).join(', ')}`)

	const repliedTo = new Set([...keysOf(previous.from), ...keysOf(previous.reply_to)])
	if (!keysOf(message.to).every((key) => repliedTo.has(key))) {
		const direct = new Set([...keysOf(previous.from), ...keysOf(previous.to)])
		for (const person of message.cc ?? []) {
			if (direct.has(addressKey(person.email))) events.push(`${display(person)} moved to Cc`)
		}
	}

	const subject = normalSubject(message.subject)
	const before = normalSubject(previous.subject)
	if (subject && before && subject.toLowerCase() !== before.toLowerCase()) {
		events.push(`${who} changed the subject to “${subject}”`)
	}
	return events
}

export function buildConversation(messages: MailMessage[], options: ConversationOptions): Conversation {
	const own = addressKey(options.mailboxEmail)
	const dayKey = options.dayKey ?? localDayKey
	const items: ConversationItem[] = []
	const shown: ShownBlock[] = []
	const known = new Set<string>()
	let day: string | undefined
	let run: Extract<ConversationItem, { kind: 'run' }> | undefined
	let runSender = ''
	let designedOnly = messages.length > 0
	let previousMessage: MailMessage | undefined

	for (const message of messages) {
		if (message.date) {
			const key = dayKey(message.date)
			if (key !== day) {
				day = key
				run = undefined
				items.push({ kind: 'day', key: `day:${message.id}`, epochSeconds: message.date })
			}
		}
		if (previousMessage) {
			const events = messageEvents(message, previousMessage, known, own)
			if (events.length > 0) {
				run = undefined
				items.push({ kind: 'event', key: `event:${message.id}`, text: events.join(' · ') })
			}
		}
		previousMessage = message
		for (const key of [...keysOf(message.from), ...keysOf(message.to), ...keysOf(message.cc)]) known.add(key)

		const label = senderLabel(message)
		const from = message.from?.[0]
		const sender = addressKey(from?.email) || label
		const mine = own !== '' && sender === own
		const content = options.contentFor(message)
		// What this message adds to the thread's memory, whichever way it is shown.
		const blocks = content.kind === 'original' ? [] : content.blocks
		const author = mine ? 'You' : from ? shortName(from) : undefined

		if (content.kind === 'original' || options.originalIds.has(message.id)) {
			run = undefined
			items.push({
				kind: 'card',
				key: message.id,
				label,
				message,
				restorable: content.kind !== 'original',
			})
			designedOnly &&= content.kind !== 'blocks'
			rememberBlocks(shown, blocks, author)
			continue
		}
		if (content.kind === 'article') {
			run = undefined
			items.push({ kind: 'article', key: message.id, label, message, blocks })
			rememberBlocks(shown, blocks, author)
			continue
		}
		designedOnly = false
		const bubble: ConversationBubble = { message, ...bubbleContent(blocks, shown) }
		rememberBlocks(shown, blocks, author)
		const previous = run?.bubbles.at(-1)?.message.date
		if (
			run &&
			runSender === sender &&
			message.date !== undefined &&
			previous !== undefined &&
			Math.abs(message.date - previous) <= GROUP_WINDOW_SECONDS
		) {
			run.bubbles.push(bubble)
			continue
		}
		runSender = sender
		run = { kind: 'run', key: message.id, label, mine, bubbles: [bubble] }
		items.push(run)
	}

	const { count, summary } = participantSummary(messages, own)
	return {
		// An article has no chat furniture: no day separators and no system lines.
		items: designedOnly ? items.filter((item) => item.kind !== 'day' && item.kind !== 'event') : items,
		layout: designedOnly ? 'article' : 'chat',
		group: count >= 3,
		participants: summary,
	}
}
