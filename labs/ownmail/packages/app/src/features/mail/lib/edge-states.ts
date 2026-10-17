/**
 * Words and shapes for the reader's edge states (design.md "Edge states"): how
 * long ago a draft was edited, when a scheduled message sends, how plain text
 * reflows, what the hidden-images and fit-to-width bars say. Pure and DOM-free;
 * times are epoch seconds and `tz` is an IANA zone (unknown zones read as UTC).
 */

import { shortDayLabel } from './thread-reading-model.js'

/** The viewer's own time zone, or UTC where Intl cannot tell. */
export function viewerZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function knownZone(tz: string): string {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		return tz
	} catch {
		return 'UTC'
	}
}

/** "9:00 AM" in a zone. */
export function clockTime(seconds: number, tz: string): string {
	return new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: knownZone(tz),
	}).format(seconds * 1000)
}

const nowSeconds = (now: number): number => (now > 1e11 ? Math.floor(now / 1000) : now)

/** "just now", "12 min ago", "2 h ago", then "yesterday", "Tue" or "Oct 3". */
export function editedAgo(seconds: number, now: number, tz: string): string {
	const elapsed = nowSeconds(now) - seconds
	if (elapsed < 60) return 'just now'
	if (elapsed < 3600) return `${Math.floor(elapsed / 60)} min ago`
	if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)} h ago`
	return shortDayLabel(seconds, now, tz)
}

/** When a scheduled message sends: "today 9:00 AM", "Mon 9:00 AM" within the week, else "Oct 22 9:00 AM". */
export function scheduledLabel(sendAt: number, now: number, tz: string): string {
	const zone = knownZone(tz)
	const day = (seconds: number) =>
		new Intl.DateTimeFormat('en-US', {
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			timeZone: zone,
		}).format(seconds * 1000)
	const ahead = Math.round((Date.parse(day(sendAt)) - Date.parse(day(nowSeconds(now)))) / 86_400_000)
	const time = clockTime(sendAt, zone)
	if (ahead === 0) return `today ${time}`
	const options: Intl.DateTimeFormatOptions =
		ahead > 0 && ahead <= 6 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }
	return `${new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(sendAt * 1000)} ${time}`
}

/** The provider's scheduled-send time of an outgoing message, when it is still ahead. */
export function pendingSendAt(message: { send_at?: unknown }, now: number): number | null {
	const sendAt = message.send_at
	return typeof sendAt === 'number' && Number.isFinite(sendAt) && sendAt > nowSeconds(now) ? sendAt : null
}

export type PlainBlock = { kind: 'text' | 'code'; text: string }

/** A line a person typed as structure, not prose: a list item, a quote, or an indented line. */
const STRUCTURE_LINE = /^(?:\s|>|[-*•+]\s|\d{1,3}[.)]\s)/
/** A hard wrap leaves lines between these lengths; shorter lines were broken on purpose. */
const WRAP_MIN = 40
const WRAP_MAX = 80

const isIndented = (line: string): boolean => /^(?: {2,}|\t)\S/.test(line)
/** Inside prose, only a code-sized indent counts: shallower indents are a list item's continuation or layout. */
const isCodeLine = (line: string): boolean => /^(?: {4,}|\t)\S/.test(line)
const LIST_ITEM = /^\s*(?:[-*•+]|\d{1,3}[.)])\s/

/** Remove the indentation every line of a block shares. */
function dedent(lines: string[]): string {
	const indent = Math.min(...lines.map((line) => (/^[ \t]*/.exec(line) as RegExpExecArray)[0].length))
	return lines.map((line) => line.slice(indent)).join('\n')
}

/**
 * Plain text as the reader shows it. Paragraphs split on blank lines. Inside
 * a paragraph, a line of 40 to 80 characters was hard-wrapped by the sender's
 * client and joins the next one, unless the next line starts a list item, a
 * quote or an indented line. A paragraph whose every line is indented, or a
 * fenced block, is code: kept exactly as written, without its shared indent.
 * Code-indented lines inside a prose paragraph split out as code of their own.
 */
export function reflowPlainText(text: string): PlainBlock[] {
	const blocks: PlainBlock[] = []
	const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
	for (const paragraph of paragraphs) {
		const lines = paragraph.split('\n').filter((line) => line.trim())
		if (lines.length === 0) continue
		if (
			lines.length > 1 &&
			/^\s*```/.test(lines[0] as string) &&
			/^\s*```\s*$/.test(lines.at(-1) as string)
		) {
			blocks.push({ kind: 'code', text: lines.slice(1, -1).join('\n') })
			continue
		}
		if (lines.every(isIndented)) {
			blocks.push({ kind: 'code', text: dedent(lines) })
			continue
		}
		blocks.push(...proseAndCode(lines))
	}
	return blocks
}

/**
 * One paragraph that mixes prose and code ("Run this:" then indented commands):
 * each run of lines indented as code (four spaces or a tab) becomes its own
 * code block, unless it continues a list item; the prose around it reflows.
 */
function proseAndCode(lines: string[]): PlainBlock[] {
	const blocks: PlainBlock[] = []
	let prose: string[] = []
	let code: string[] = []
	const flushProse = () => {
		if (prose.length > 0) blocks.push({ kind: 'text', text: joinWrapped(prose) })
		prose = []
	}
	// A list item runs on through the indented lines under it.
	let inItem = false
	for (const line of lines) {
		if (LIST_ITEM.test(line)) inItem = true
		else if (!/^\s/.test(line)) inItem = false
		if (isCodeLine(line) && !inItem) {
			flushProse()
			code.push(line)
			continue
		}
		if (code.length > 0) blocks.push({ kind: 'code', text: dedent(code) })
		code = []
		prose.push(line)
	}
	if (code.length > 0) blocks.push({ kind: 'code', text: dedent(code) })
	flushProse()
	return blocks
}

/** Join a paragraph's hard-wrapped lines; lines broken on purpose stay broken. */
function joinWrapped(lines: string[]): string {
	let current = (lines[0] as string).trimEnd()
	let previousLength = current.length
	const out: string[] = []
	for (const line of lines.slice(1)) {
		const trimmed = line.trimEnd()
		const wrapped = previousLength >= WRAP_MIN && previousLength <= WRAP_MAX && !STRUCTURE_LINE.test(line)
		if (wrapped) current = `${current} ${trimmed}`
		else {
			out.push(current)
			current = trimmed
		}
		previousLength = trimmed.length
	}
	out.push(current)
	return out.join('\n')
}

/** Arabic script letters (Arabic, its supplement and extended blocks, presentation forms). */
const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u

/** Whether a paragraph is written in Arabic script: its first letter is one. */
export function isArabicScript(text: string): boolean {
	const first = /\p{L}/u.exec(text)?.[0]
	return first !== undefined && ARABIC_LETTER.test(first)
}

/** A short, stable hash of a string, for React keys of repeated text. */
export function textKey(text: string, index: number): string {
	let hash = 0x811c9dc5
	for (let at = 0; at < text.length; at += 1) {
		hash ^= text.charCodeAt(at)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return `${index}-${hash.toString(36)}`
}

/** "voyage.com" from "trips@voyage.com". */
export function senderDomain(address: string | undefined): string {
	const at = address?.lastIndexOf('@') ?? -1
	return at === -1
		? ''
		: (address as string)
				.slice(at + 1)
				.trim()
				.toLowerCase()
}

/** "7 images from voyage.com are hidden", "1 image is hidden", "Images from voyage.com are hidden". */
export function hiddenImagesText(count: number, domain: string): string {
	const from = domain ? ` from ${domain}` : ''
	if (count <= 0) return `Images${from} are hidden`
	return count === 1 ? `1 image${from} is hidden` : `${count} images${from} are hidden`
}

/** "Always for Voyage": the sender's name, else their domain. */
export function alwaysForLabel(name: string | undefined, domain: string): string {
	const who = name?.trim() || domain
	return who ? `Always for ${who}` : 'Always for this sender'
}

/** The scale a fitted layout is shown at, as a whole percent. */
export function fitPercent(scale: number): number {
	return Math.round(Math.min(1, Math.max(0, scale)) * 100)
}

/**
 * Cut text at a word near `max` characters, ending in "…": "Here is v3. I
 * tightened the intro and moved billing to its own section…".
 */
export function cutAtWord(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim()
	if (clean.length <= max) return clean
	const head = clean.slice(0, max + 1)
	const space = head.lastIndexOf(' ')
	return `${(space > 0 ? head.slice(0, space) : clean.slice(0, max)).replace(/[\s,;:.–—-]+$/, '')}…`
}

/** A first name from an address alone, for "Reply to Alan only": "alan.turing@x" → "Alan". */
export function firstNameFromAddress(address: string): string {
	const local = address.trim().split('@')[0] as string
	const word = local.split(/[._+-]/).find(Boolean) ?? ''
	return word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : ''
}

type NamedParticipant = { name?: string | null; email: string }
type KnownMessage = {
	id: string
	from?: NamedParticipant[]
	to?: NamedParticipant[]
	cc?: NamedParticipant[]
}

/**
 * The display name a thread already knows for an address, for "Reply to Alan
 * only": the replied-to message's own entry first, then anyone on a thread the
 * reader has loaded. Undefined when no message names that address.
 */
export function knownNameFor(
	address: string,
	threads: ReadonlyArray<{ messages: KnownMessage[] } | undefined>,
	replyToMessageId?: string,
): string | undefined {
	const key = address.trim().toLowerCase()
	const messages = threads.flatMap((thread) => thread?.messages ?? [])
	const target = messages.filter((message) => message.id === replyToMessageId)
	for (const message of [...target, ...messages]) {
		for (const person of [...(message.from ?? []), ...(message.to ?? []), ...(message.cc ?? [])]) {
			const name = person.name?.trim()
			if (name && person.email.trim().toLowerCase() === key) return name
		}
	}
	return undefined
}

/** The distinct addresses of a comma- or semicolon-separated recipient field. */
export function recipientAddresses(field: string): string[] {
	const seen = new Set<string>()
	const addresses: string[] = []
	for (const part of field.split(/[,;]/)) {
		const address = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim()
		const key = address.toLowerCase()
		if (address && !seen.has(key)) {
			seen.add(key)
			addresses.push(address)
		}
	}
	return addresses
}
