/**
 * Conversation view: a thread as a chat transcript.
 *
 * This module turns a thread's messages into the items the transcript renders:
 * day separators, runs of bubbles from one sender, and full-width cards for
 * mail that keeps the standard reader. It is pure and DOM-free; the caller
 * supplies each message's block model from `clean-view.ts`.
 */

import type { MailMessage } from '../state/mail-queries.js'
import { blocksText, type CleanBlock, type MessageContent } from './clean-view.js'

/** Consecutive emails from one sender this close together read as one run. */
export const GROUP_WINDOW_SECONDS = 5 * 60

/** A forwarded message is content, not history, so it is never hidden. */
const FORWARDED = /(?:^|\n)\s*(?:-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:)/i

export interface BubbleContent {
	blocks: CleanBlock[]
	/**
	 * The new-content extraction was unsure, so the whole message is shown and
	 * its quoted history stays in the bubble behind a disclosure.
	 */
	unsure: boolean
}

export interface ConversationBubble extends BubbleContent {
	message: MailMessage
}

export type ConversationItem =
	| { kind: 'day'; key: string; epochSeconds: number }
	| { kind: 'run'; key: string; label: string; mine: boolean; bubbles: ConversationBubble[] }
	/** A message shown by the standard reader, across the full column. */
	| { kind: 'card'; key: string; label: string; message: MailMessage; restorable: boolean }

export interface Conversation {
	items: ConversationItem[]
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

/**
 * Keep only what the sender newly wrote. Quoted history is dropped when it is a
 * trailing run below the new text. Anything else is ambiguous (a forwarded
 * message, text below the quote, inline replies, or nothing but a quote), so the
 * message is kept whole rather than risk hiding something that mattered.
 */
export function newContent(blocks: CleanBlock[]): BubbleContent {
	const firstHistory = blocks.findIndex((block) => block.type === 'history')
	if (firstHistory === -1) return { blocks, unsure: false }
	const lastNew = blocks.findLastIndex((block) => block.type !== 'history')
	const history = blocks.filter((block) => block.type === 'history') as Array<
		Extract<CleanBlock, { type: 'history' }>
	>
	const unsure =
		lastNew === -1 ||
		lastNew > firstHistory ||
		FORWARDED.test(blocksText(history)) ||
		history.some((block) => hasTextAfterQuote(block.blocks))
	return unsure ? { blocks, unsure } : { blocks: blocks.slice(0, firstHistory), unsure }
}

/** Answers written between quoted lines sit after a quote inside the detected history. */
function hasTextAfterQuote(blocks: CleanBlock[]): boolean {
	const firstQuote = blocks.findIndex((block) => block.type === 'quote')
	return firstQuote !== -1 && blocks.findLastIndex((block) => block.type !== 'quote') > firstQuote
}

/** The local calendar day of a message, used to place day separators. */
export function localDayKey(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000)
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

const addressKey = (email: string | undefined): string => email?.trim().toLowerCase() ?? ''

export function senderLabel(message: MailMessage): string {
	const from = message.from?.[0]
	return from?.name || from?.email || '(unknown sender)'
}

/** First name, or the part of an address before the at sign. */
function shortName(person: { name?: string; email: string }): string {
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

export function buildConversation(messages: MailMessage[], options: ConversationOptions): Conversation {
	const own = addressKey(options.mailboxEmail)
	const dayKey = options.dayKey ?? localDayKey
	const items: ConversationItem[] = []
	let day: string | undefined
	let run: Extract<ConversationItem, { kind: 'run' }> | undefined
	let runSender = ''

	for (const message of messages) {
		if (message.date) {
			const key = dayKey(message.date)
			if (key !== day) {
				day = key
				run = undefined
				items.push({ kind: 'day', key: `day:${message.id}`, epochSeconds: message.date })
			}
		}
		const label = senderLabel(message)
		const content = options.contentFor(message)
		if (content.kind === 'original' || options.originalIds.has(message.id)) {
			run = undefined
			items.push({
				kind: 'card',
				key: message.id,
				label,
				message,
				restorable: content.kind === 'blocks',
			})
			continue
		}
		const bubble: ConversationBubble = { message, ...newContent(content.blocks) }
		const sender = addressKey(message.from?.[0]?.email) || label
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
		run = { kind: 'run', key: message.id, label, mine: own !== '' && sender === own, bubbles: [bubble] }
		items.push(run)
	}

	const { count, summary } = participantSummary(messages, own)
	return { items, group: count >= 3, participants: summary }
}
