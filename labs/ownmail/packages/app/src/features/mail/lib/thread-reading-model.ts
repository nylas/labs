/**
 * The reading model: what the reader, the thread list and the phone thread
 * screen say about a thread before any of it is rendered.
 *
 * Who is on a thread and how to name them, which messages open, which take one
 * line and which fold into a stacked row, the "new since" divider, the system
 * lines between messages, the files a thread carries (with versions folded),
 * the catch-up facts, the thread map and the list signals (asks you, bounces,
 * bundles, day groups). Everything here is pure and DOM-free so it runs the
 * same on the server and in the browser; callers memoise.
 *
 * Timestamps are epoch seconds, as `MailMessage.date` is. `now` may also be
 * given in milliseconds (`Date.now()`): any value past the year 5000 in
 * seconds is read as milliseconds. `tz` is an IANA time zone; an unknown one
 * falls back to UTC.
 */

import type { EmailParticipant } from '@nylas-labs/cli-kit/v3'
import { isCalendarInvitationAttachment } from '#features/calendar/lib/calendar-invitation'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import { blocksText, type CleanBlock, messageContent } from './clean-view.js'
import { bubbleContent, normalSubject } from './conversation-model.js'
import { messageBodyParagraphs, messageHasHtml, messagePreview } from './mail-ui-model.js'

export type Person = { name: string; email: string; isOwner: boolean }

type Attachment = NonNullable<MailMessage['attachments']>[number]

/** Words a minute for the reading-time estimate. */
export const READING_WPM = 238
/** Reply all past this many people asks once and offers the smaller reply first. */
export const REPLY_ALL_GUARD = 25
/** Runs of at least this many read messages fold into one stacked row. */
export const FOLD_MIN_RUN = 3
/** Names shown on a folded row before "+n". */
const FOLD_MAX_NAMES = 4
/** People on a folded row's avatar stack. */
const FOLD_MAX_AVATARS = 3
/** A subject stand-in is the first line of the first message, cut at a word near this length. */
const STAND_IN_MAX_CHARS = 40
/** Images this small are signature logos and social icons, not files. */
const SIGNATURE_IMAGE_MAX_BYTES = 10 * 1024
/** Any `now` above this is milliseconds: in seconds it is past the year 5000. */
const MILLISECONDS_FLOOR = 1e11
const PERSON_HUES = [75, 250, 32, 158, 300, 200] as const
const PERSON_HUE_OFFSET = 3

const NO_ONE: Person = { name: '', email: '', isOwner: false }

const toSeconds = (value: number): number => (value > MILLISECONDS_FLOOR ? Math.floor(value / 1000) : value)
const isTime = (value: number | undefined): value is number => Number.isFinite(value) && (value as number) > 0

const zones = new Map<string, string>()

/** The zone itself when Intl knows it, else UTC. */
function zone(tz: string): string {
	const known = zones.get(tz)
	if (known) return known
	let resolved = 'UTC'
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		resolved = tz
	} catch {}
	zones.set(tz, resolved)
	return resolved
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function format(seconds: number, tz: string, options: Intl.DateTimeFormatOptions): string {
	const timeZone = zone(tz)
	const key = `${timeZone}|${JSON.stringify(options)}`
	let formatter = formatters.get(key)
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
		formatters.set(key, formatter)
	}
	return formatter.format(seconds * 1000)
}

/** The calendar day a moment falls on in a zone, as a day count. */
function calendarDay(seconds: number, tz: string): number {
	const [month, day, year] = format(seconds, tz, { year: 'numeric', month: 'numeric', day: 'numeric' })
		.split('/')
		.map(Number) as [number, number, number]
	return Date.UTC(year, month - 1, day) / 86_400_000
}

/** How many calendar days ago `seconds` was, seen from `now` in `tz`. */
function daysAgo(seconds: number, now: number, tz: string): number {
	return calendarDay(toSeconds(now), tz) - calendarDay(seconds, tz)
}

const year = (seconds: number, tz: string): string => format(seconds, tz, { year: 'numeric' })

/** "Oct 12", or "Oct 12, 2025" outside the current year. */
function monthDay(seconds: number, now: number, tz: string): string {
	const sameYear = year(seconds, tz) === year(toSeconds(now), tz)
	return format(seconds, tz, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** One end of a date span: "today", "yesterday" or "Sep 28". */
function spanEnd(seconds: number, now: number, tz: string): string {
	const ago = daysAgo(seconds, now, tz)
	if (ago === 0) return 'today'
	if (ago === 1) return 'yesterday'
	return monthDay(seconds, now, tz)
}

/**
 * When the last read message was, for "3 new since Tuesday": "earlier today",
 * "yesterday", the weekday within the past six days, else "Oct 12".
 */
export function sinceDayLabel(seconds: number, now: number, tz: string): string {
	const ago = daysAgo(seconds, now, tz)
	if (ago === 0) return 'earlier today'
	if (ago === 1) return 'yesterday'
	if (ago > 1 && ago <= 6) return format(seconds, tz, { weekday: 'long' })
	return monthDay(seconds, now, tz)
}

/** A short day, for "replaces v3 from Tue": "today", "yesterday", "Tue", else "Oct 3". */
export function shortDayLabel(seconds: number, now: number, tz: string): string {
	const ago = daysAgo(seconds, now, tz)
	if (ago > 1 && ago <= 6) return format(seconds, tz, { weekday: 'short' })
	return spanEnd(seconds, now, tz)
}

/** "Sep 28 – today". One end alone when both fall on one day or only one is known. */
export function dateSpanLabel(first: number, last: number, now: number, tz: string): string {
	const known = [first, last].filter(isTime).sort((a, b) => a - b)
	if (known.length === 0) return ''
	const labels = [...new Set(known.map((seconds) => spanEnd(seconds, now, tz)))]
	return labels.join(' – ')
}

export type DayGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier'

/** The thread-list day group a timestamp belongs to. */
export function dayGroup(ts: number, now: number, tz: string): DayGroup {
	if (!isTime(ts)) return 'Earlier'
	const ago = daysAgo(ts, now, tz)
	if (ago <= 0) return 'Today'
	if (ago === 1) return 'Yesterday'
	if (ago <= 6) return 'This week'
	return 'Earlier'
}

/** The heading a day group renders: "Earlier" groups by month ("September", "September 2025"). */
export function dayGroupHeading(ts: number, now: number, tz: string): string {
	const group = dayGroup(ts, now, tz)
	if (group !== 'Earlier') return group
	if (!isTime(ts)) return 'Earlier'
	const sameYear = year(ts, tz) === year(toSeconds(now), tz)
	return format(ts, tz, { month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
}

const addressKey = (email: string | undefined): string => email?.trim().toLowerCase() ?? ''

/** A display name without the quotes some clients wrap it in. */
const cleanName = (name: string | undefined): string =>
	(name ?? '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ')

export function toPerson(participant: EmailParticipant | undefined, owner: string): Person {
	if (!participant) return NO_ONE
	const email = participant.email?.trim() ?? ''
	const own = addressKey(owner)
	return { name: cleanName(participant.name), email, isOwner: own !== '' && addressKey(email) === own }
}

/** Who sent a message, or nobody when the provider left From empty. */
export const senderPerson = (message: MailMessage, owner: string): Person =>
	toPerson(message.from?.[0], owner)

/** A first name from an address alone, for "Reply to Alan only": "alan.turing@x" → "Alan". */
export function firstNameFromAddress(address: string): string {
	const local = address.trim().split('@')[0] as string
	const word = local.split(/[._+-]/).find(Boolean) ?? ''
	return word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : ''
}

/**
 * "Grace" from "Grace Hopper", "Alan" from "Turing, Alan", and "Grace" from
 * grace@example.com when no name came with the address, so a person reads
 * the same in sentence case whether or not their mail carried a name.
 */
export function firstName(person: Pick<Person, 'name' | 'email'>): string {
	const name = person.name.trim()
	if (name) {
		const inverted = /^([^,]+),\s*(\S.*)$/.exec(name)
		return ((inverted ? (inverted[2] as string) : name).split(' ')[0] as string).trim()
	}
	return firstNameFromAddress(person.email)
}

/**
 * A person with the name the thread knows them by, when their address came
 * alone (your own sent mail often carries none), so alan@… still reads as Alan.
 */
export function withKnownName(person: Person, known: readonly Person[]): Person {
	if (person.name) return person
	const key = addressKey(person.email)
	const named = known.find((entry) => entry.name && addressKey(entry.email) === key)
	return named ? { ...person, name: named.name } : person
}

/** How a person is named in running text. The mailbox owner is always "you". */
export function personName(p: Person, style: 'full' | 'first'): string {
	if (p.isOwner) return 'you'
	if (style === 'full') return p.name || p.email || 'Unknown sender'
	return firstName(p) || 'Someone'
}

/** Sentence-start form: "You" for the owner. */
const actorName = (person: Person): string => (person.isOwner ? 'You' : personName(person, 'first'))

/** First names, except where two people share one: those get their full names. */
function firstNames(people: Person[]): string[] {
	const counts = new Map<string, number>()
	for (const person of people) {
		const key = personName(person, 'first').toLowerCase()
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	return people.map((person) => {
		const first = personName(person, 'first')
		return (counts.get(first.toLowerCase()) as number) > 1 ? personName(person, 'full') : first
	})
}

/** "Mary", "Mary and Grace", "Mary, Grace and Alan". */
function joinAnd(names: string[]): string {
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('')
}

/** People on a list of addresses, once each, in order, without empty addresses. */
function uniquePeople(participants: EmailParticipant[], owner: string): Person[] {
	const people = new Map<string, Person>()
	for (const participant of participants) {
		const person = toPerson(participant, owner)
		const key = addressKey(person.email)
		if (!key) continue
		const known = people.get(key)
		if (!known) people.set(key, person)
		else if (!known.name && person.name) people.set(key, { ...known, name: person.name })
	}
	return [...people.values()]
}

const messagePeople = (message: MailMessage): EmailParticipant[] => [
	...(message.from ?? []),
	...(message.to ?? []),
	...(message.cc ?? []),
]

/** An address that names a mailing list by itself: eng-all@, pm-list@, all@. */
export const LIST_LOCAL_PART = /(?:-all|-list|^all)$/i

const localPart = (email: string): string => addressKey(email).split('@')[0] as string

/**
 * People without the nameless addresses nobody writes from, such as a Cc'd
 * pm-leads@ list: they are recipients, not people on the thread. Kept when
 * leaving them out would leave the owner alone.
 */
function withoutSilentAddresses(people: Person[], speaks: (person: Person) => boolean): Person[] {
	const kept = people.filter((person) => person.isOwner || person.name !== '' || speaks(person))
	return kept.some((person) => !person.isOwner) ? kept : people
}

/**
 * Everyone on a thread (From, To, Cc), in order of first appearance, the owner
 * last. A nameless address that never sends (a list on Cc) is not counted.
 */
export function threadParticipants(messages: MailMessage[], owner: string): Person[] {
	const senders = new Set(messages.map((message) => addressKey(message.from?.[0]?.email)))
	const people = withoutSilentAddresses(uniquePeople(messages.flatMap(messagePeople), owner), (person) =>
		senders.has(addressKey(person.email)),
	)
	return [...people.filter((person) => !person.isOwner), ...people.filter((person) => person.isOwner)]
}

/**
 * "Grace, Alan, Katherine, you" and how many more. The owner stays in the
 * visible names, last, so a long thread still says you are on it.
 */
export function participantsLabel(people: Person[], max = 4): { names: string; more: number } {
	const limit = Math.max(1, max)
	const owner = people.find((person) => person.isOwner)
	const others = people.filter((person) => !person.isOwner)
	const shown = owner ? [...others.slice(0, limit - 1), owner] : others.slice(0, limit)
	return { names: firstNames(shown).join(', '), more: people.length - shown.length }
}

/**
 * The thread-list row's people: the latest sender first, the owner last, a
 * nameless list address that is not the latest sender left out. A lone
 * correspondent is named in full, with "you" only when the owner wrote last
 * ("Alan Turing, you"), since the owner is on nearly every inbox thread.
 */
export function rowParticipants(thread: MailThread, owner: string): { names: string; more: number } {
	const latest = thread.latest_draft_or_message
	const source = thread.participants?.length
		? thread.participants
		: [...(latest?.from ?? []), ...(latest?.to ?? []), ...(latest?.cc ?? [])]
	const lead = addressKey(latest?.ownmailDraft ? undefined : latest?.from?.[0]?.email)
	const people = withoutSilentAddresses(
		uniquePeople(source, owner),
		(person) => addressKey(person.email) === lead,
	)
	const others = people.filter((person) => !person.isOwner)
	others.sort((a, b) => Number(addressKey(b.email) === lead) - Number(addressKey(a.email) === lead))
	const self = people.filter((person) => person.isOwner)
	if (others.length === 1) {
		const ownerWroteLast = self.some((person) => addressKey(person.email) === lead)
		return {
			names: [personName(others[0] as Person, 'full'), ...(ownerWroteLast ? ['you'] : [])].join(', '),
			more: 0,
		}
	}
	return participantsLabel([...others, ...self], 4)
}

/**
 * The short recipient line of a message header: "to you, Grace +2", or "to
 * everyone" when a reply (its sender was on the previous message) went to
 * everyone the previous message involved, even if it also adds people: the "Grace added Mary"
 * line already says so. `changed` is true when it leaves out someone the
 * previous message involved, which is when the header sets the recipients in
 * the normal text colour.
 *
 * Mail to a mailing list names the list instead, as `group` ("to eng-all@ and
 * 238 others"), which the header sets apart from the rest.
 *
 * Pass `prev` only when the previous message sits open directly above this
 * one. After a folded or one-line gap pass undefined, so the header names the
 * recipients ("to you, Grace +2") instead of pointing at a message the reader
 * cannot see. `known` are the people the thread names, for a recipient whose
 * address came without a name.
 */
export function recipientSummary(
	msg: MailMessage,
	prev: MailMessage | undefined,
	owner: string,
	known: readonly Person[] = [],
): { text: string; changed: boolean; group?: string } {
	const recipients = uniquePeople([...(msg.to ?? []), ...(msg.cc ?? [])], owner).map((person) =>
		withKnownName(person, known),
	)
	if (recipients.length === 0) return { text: 'to undisclosed recipients', changed: false }
	const sender = addressKey(msg.from?.[0]?.email)
	const before = prev
		? new Set(uniquePeople(messagePeople(prev), owner).map((p) => addressKey(p.email)))
		: null
	const replied = before?.has(sender) ?? false
	before?.delete(sender)
	const reached = new Set(recipients.map((person) => addressKey(person.email)))
	const dropped = before ? [...before].filter((key) => !reached.has(key)).length : 0
	const changed = dropped > 0
	if (replied && before !== null && before.size > 0 && !changed && recipients.length >= 2) {
		return { text: 'to everyone', changed: false }
	}
	// Mail sent to a list is summarised by the list it came through: "to eng-all@ and 238 others".
	const list = recipients.find((person) => !person.isOwner && LIST_LOCAL_PART.test(localPart(person.email)))
	if (list) {
		const group = `${localPart(list.email)}@`
		const others = recipients.length - 1
		const rest = others === 0 ? '' : ` and ${others} ${others === 1 ? 'other' : 'others'}`
		return { text: `to ${group}${rest}`, changed, group }
	}
	const ordered = [...recipients.filter((p) => p.isOwner), ...recipients.filter((p) => !p.isOwner)]
	const named = firstNames(ordered).slice(0, 2)
	const more = ordered.length - named.length
	return { text: `to ${named.join(', ')}${more > 0 ? ` +${more}` : ''}`, changed }
}

/**
 * A tint for a person's avatar, the same for an address everywhere. The
 * offset makes the boards' alan@bletchley.dev the canvas blue (250).
 */
export function personHue(email: string): 75 | 250 | 32 | 158 | 300 | 200 {
	// FNV-1a: small, stable and well spread for short strings.
	let hash = 0x811c9dc5
	for (const char of addressKey(email)) {
		hash ^= char.codePointAt(0) as number
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return PERSON_HUES[(hash + PERSON_HUE_OFFSET) % PERSON_HUES.length] as (typeof PERSON_HUES)[number]
}

/**
 * Where quoted history or a client-marked signature starts in HTML: the
 * markers `collapseQuotedHistory` and the clean view recognise.
 */
const HTML_QUOTED_START =
	/<blockquote\b|\bclass\s*=\s*["'][^"']*\b(?:gmail_quote|yahoo_quoted|AppleOriginalContents|moz-cite-prefix|OutlookMessageHeader|gmail_signature|moz-signature)\b|\bid\s*=\s*["'](?:divRplyFwdMsg|stopSpelling|Signature|AppleMailSignature|yahoo_quoted)/i

const paragraphBlock = (text: string): CleanBlock => ({ type: 'paragraph', spans: [{ text }] })

/**
 * What the sender wrote in this message: quoted history and the signature
 * removed. Plain text goes through the clean view's plaintext model; HTML is
 * cut where its quoted history starts. Both then pass the conversation
 * model's thread pass, which finds unmarked signatures by the sender's name.
 */
export function messageNewText(message: MailMessage): string {
	let blocks: CleanBlock[]
	if (!messageHasHtml(message) && message.ownmailDraft !== true) {
		// Plain text never takes the DOM path: messageContent returns its blocks directly.
		blocks = (messageContent(message, false) as { blocks: CleanBlock[] }).blocks
	} else {
		const html = message.body ?? ''
		const start = html.search(HTML_QUOTED_START)
		const own = start === -1 ? html : html.slice(0, Math.max(0, html.lastIndexOf('<', start)))
		// Each line break becomes its own block, as the clean view's table signatures are,
		// so the thread pass can still find a signature laid out line by line.
		const lines = own.replace(/<br\b[^>]*>/gi, '</p><p>')
		blocks = own.trim() ? messageBodyParagraphs({ ...message, body: lines }).map(paragraphBlock) : []
	}
	const { blocks: kept } = bubbleContent(blocks, [], message.from?.[0])
	return blocksText(kept.filter((block) => block.type !== 'history' && block.type !== 'signature'))
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a text holds a word, as a whole word, ignoring case. */
function hasWord(text: string, word: string): boolean {
	if (!word) return false
	return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/** A line or sentence that opens by addressing someone: "Ada,", "Hi Ada:", "Dear Ada —". */
function addressedTo(text: string, name: string): boolean {
	return new RegExp(`^\\s*(?:(?:hi|hey|hello|dear)\\s+)?${escapeRegExp(name)}\\s*[,:—–-]`, 'iu').test(text)
}

/** Whether a message's own text names the owner, by first name or address. */
function namesOwner(message: MailMessage, owner: string, ownerFirstName: string): boolean {
	if (senderPerson(message, owner).isOwner) return false
	const text = messageNewText(message)
	return (
		hasWord(text, ownerFirstName.trim()) ||
		(addressKey(owner) !== '' && text.toLowerCase().includes(addressKey(owner)))
	)
}

/**
 * Whether a message asks the owner something: it is not the owner's, and its
 * own text has a question that names the owner (first name or address), a
 * question that says "you" and does not open by addressing someone else
 * ("Alan, can you…?" asks Alan), or a line addressed to the owner by name.
 */
export function asksYou(msg: MailMessage, owner: string, ownerFirstName: string): boolean {
	if (senderPerson(msg, owner).isOwner) return false
	const text = messageNewText(msg)
	const name = ownerFirstName.trim()
	if (name && text.split('\n').some((line) => addressedTo(line, name))) return true
	const others = uniquePeople(messagePeople(msg), owner)
		.filter((person) => !person.isOwner)
		.map((person) => firstName(person))
		.filter((other) => other.toLowerCase() !== name.toLowerCase())
	return text
		.replace(/\s*\n\s*/g, ' ')
		.split(/(?<=[.!?…])\s+/)
		.map((sentence) => sentence.trim().replace(/["'”’)\]]+$/, ''))
		.some(
			(sentence) =>
				sentence.endsWith('?') &&
				(hasWord(sentence, name) ||
					hasWord(sentence, addressKey(owner)) ||
					(hasWord(sentence, 'you') && !others.some((other) => addressedTo(sentence, other)))),
		)
}

/**
 * The thread title when the subject is missing: the first line of the first
 * message, cut at a word, flagged so the header can say it is a stand-in.
 */
export function subjectStandIn(
	subject: string | undefined,
	firstBody: string,
): { text: string; isStandIn: boolean } {
	const own = (subject ?? '').replace(/\s+/g, ' ').trim()
	if (own && own.toLowerCase() !== '(no subject)') return { text: own, isStandIn: false }
	const line = messageBodyParagraphs({ id: '', body: firstBody })[0]
	if (!line) return { text: 'No subject', isStandIn: false }
	if (line.length <= STAND_IN_MAX_CHARS) return { text: line, isStandIn: true }
	const cut = line.slice(0, STAND_IN_MAX_CHARS + 1)
	const space = cut.lastIndexOf(' ')
	const text = (space > 0 ? cut.slice(0, space) : cut.slice(0, STAND_IN_MAX_CHARS)).replace(
		/[\s,;:.–—-]+$/,
		'',
	)
	return { text: `${text}…`, isStandIn: true }
}

/** "No message text. Grace sent 1 file." for a message with no body at all; null otherwise. */
export function emptyBodyNote(msg: MailMessage, owner: string): string | null {
	if (messageBodyParagraphs(msg).length > 0 || /<img\b/i.test(msg.body ?? '')) return null
	const files = (msg.attachments ?? []).filter(isThreadFile).length
	if (files === 0) return 'No message text.'
	return `No message text. ${actorName(senderPerson(msg, owner))} sent ${files} file${files === 1 ? '' : 's'}.`
}

/** Word count and reading time at 238 words a minute (at least a minute for any text). */
export function readingStats(text: string): { words: number; minutes: number } {
	const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
	return { words, minutes: words === 0 ? 0 : Math.max(1, Math.round(words / READING_WPM)) }
}

/** How many people Reply all would address: the sender (or Reply-To), To and Cc, without the owner. */
export function replyAllCount(msg: MailMessage, owner: string): number {
	const replyTo = msg.reply_to?.length ? msg.reply_to : (msg.from ?? [])
	return uniquePeople([...replyTo, ...(msg.to ?? []), ...(msg.cc ?? [])], owner).filter((p) => !p.isOwner)
		.length
}

export type SystemEvent = { afterIndex: number; text: string }

type MessageChange = { added: Person[]; removed: Person[]; subject?: string }

const FORWARD_SUBJECT = /^\s*fwd?\s*:/i

/**
 * "Subject changed: “Q3 roadmap” → “… final review before Friday”". When the
 * new subject restates the old one before a colon, only what it adds is shown.
 */
export function subjectChangeText(before: string, after: string): string {
	const colon = after.indexOf(':')
	const words = before.match(/[\p{L}\p{N}]+/gu) ?? []
	let tail = ''
	if (after.toLowerCase().startsWith(before.toLowerCase())) {
		tail = after.slice(before.length).replace(/^[\s:–—-]+/, '')
	} else if (colon > 0 && words.length > 0 && words.every((word) => hasWord(after.slice(0, colon), word))) {
		tail = after.slice(colon + 1).trim()
	}
	return `Subject changed: “${before}” → “${tail ? `… ${tail}` : after}”`
}

/**
 * Subject prefixes that calendars and autoresponders add, which do not change
 * what a thread is about: "Invitation:", "Updated invitation with note:",
 * "Accepted:", "Canceled event:", "Automatic reply:", "Out of office:".
 */
const AUTOMATED_SUBJECT_PREFIX =
	/^(?:(?:updated\s+)?invitation(?:\s+updated)?(?:\s+with\s+note)?|updated|new event|accepted|declined|tentative(?:ly accepted)?|cancell?ed(?:\s+(?:event|invitation))?|automatic reply|auto[- ]?reply|out of (?:the )?office)\s*:\s*/i

/** A subject without Re:/Fwd: and automated prefixes; a calendar subject also loses its "@ Thu 2pm" tail. */
function subjectTopic(subject: string | undefined): string {
	let topic = normalSubject(subject)
	let automated = false
	for (let previous = ''; previous !== topic; ) {
		previous = topic
		const stripped = topic.replace(AUTOMATED_SUBJECT_PREFIX, '')
		automated ||= stripped !== topic
		topic = normalSubject(stripped)
	}
	return automated ? topic.replace(/\s+@\s.*$/, '') : topic
}

/**
 * What each message changed against the one before it: people added or
 * removed, a new subject. Bounces and invitations change nothing (a bounce
 * is not the message the next one answers; an invitation's people still
 * count as known, so replies to it add no one). People
 * count as removed only from a reply all, one that still reaches at least two
 * of the people the previous message involved; a reply to one person, or to a
 * mailing list, leaves the rest out without removing them. People count as
 * added only by a message that still reaches someone from before.
 */
function threadChanges(messages: MailMessage[], owner: string): MessageChange[] {
	const known = new Set<string>()
	let subject = ''
	let previous: MailMessage | undefined
	return messages.map((message) => {
		const change: MessageChange = { added: [], removed: [] }
		if (isBounceMessage(message)) return change
		const invitation = (message.attachments ?? []).some(isCalendarInvitationAttachment)
		const current = invitation ? '' : subjectTopic(message.subject)
		if (previous && !invitation) {
			const sender = addressKey(message.from?.[0]?.email)
			const audience = uniquePeople(messagePeople(previous), owner).filter(
				(person) => addressKey(person.email) !== sender,
			)
			const recipients = uniquePeople([...(message.to ?? []), ...(message.cc ?? [])], owner)
			const reached = new Set(uniquePeople(messagePeople(message), owner).map((p) => addressKey(p.email)))
			const kept = audience.filter((person) => reached.has(addressKey(person.email))).length
			if (kept >= 1) change.added = recipients.filter((person) => !known.has(addressKey(person.email)))
			if (kept >= 2 && !FORWARD_SUBJECT.test(message.subject ?? '')) {
				change.removed = audience.filter((person) => !reached.has(addressKey(person.email)))
			}
			if (current && subject && current.toLowerCase() !== subject.toLowerCase()) {
				change.subject = subjectChangeText(subject, current)
			}
		}
		for (const person of uniquePeople(messagePeople(message), owner)) known.add(addressKey(person.email))
		if (current) subject = current
		previous = message
		return change
	})
}

/**
 * The centred lines between messages: "Grace added Mary Jackson", "Alan
 * removed Katherine", "Subject changed: …". Each sits after `afterIndex`,
 * directly above the message that made the change.
 */
export function systemEvents(messages: MailMessage[], owner: string): SystemEvent[] {
	return threadChanges(messages, owner).flatMap((change, index) => {
		const actor = actorName(senderPerson(messages[index] as MailMessage, owner))
		const events: SystemEvent[] = []
		if (change.added.length > 0) {
			const names = change.added.map((person) => personName(person, 'full'))
			events.push({ afterIndex: index - 1, text: `${actor} added ${joinAnd(names)}` })
		}
		if (change.removed.length > 0) {
			events.push({ afterIndex: index - 1, text: `${actor} removed ${joinAnd(firstNames(change.removed))}` })
		}
		if (change.subject) events.push({ afterIndex: index - 1, text: change.subject })
		return events
	})
}

export type ThreadFile = {
	attachmentId: string
	messageId: string
	filename: string
	size: number
	contentType: string
	from: Person
	date: number
	/** The filename of the version this one replaces. */
	versionOf?: string
	/** Earlier versions of this file, newest first. Empty on the earlier versions themselves. */
	olderVersions: ThreadFile[]
}

const SIGNATURE_IMAGE_NAME = /^(?:image\d{3}|outlook-[\w-]+|logo|signature|icon)[\w-]*\.(?:png|jpe?g|gif)$/i

/** Whether an attachment is a file the person sent, not an inline image, signature logo or invite. */
export function isThreadFile(attachment: Attachment): boolean {
	if (attachment.is_inline || isCalendarInvitationAttachment(attachment)) return false
	const image = (attachment.content_type ?? '').toLowerCase().startsWith('image/')
	if (!image) return true
	if (attachment.content_id) return false
	const name = attachment.filename?.trim() ?? ''
	return !(
		SIGNATURE_IMAGE_NAME.test(name) ||
		(attachment.size !== undefined && attachment.size < SIGNATURE_IMAGE_MAX_BYTES)
	)
}

const splitName = (filename: string): [stem: string, extension: string] => {
	const dot = filename.lastIndexOf('.')
	return dot > 0 ? [filename.slice(0, dot), filename.slice(dot)] : [filename, '']
}

const VERSION_MARKS = [
	/[\s_-]*\(\d+\)$/,
	/(?:^|[\s_.-]+)v\d+(?:\.\d+)*$/i,
	/(?:^|[\s_-]+)(?:final|draft|copy|latest|updated|rev\d*)$/i,
]

/** The family a file belongs to: its name without version marks ("q3-roadmap.pdf" for "Q3-roadmap-v4.pdf"). */
export function fileFamilyKey(filename: string): string {
	const [stem, extension] = splitName(filename.trim().toLowerCase())
	let base = stem
	for (let previous = ''; previous !== base; ) {
		previous = base
		for (const mark of VERSION_MARKS) base = base.replace(mark, '')
	}
	return `${base.trim() || stem}${extension}`
}

/** How a version names itself: "v3", "final", "(1)", else its filename. */
export function versionToken(filename: string): string {
	const [stem] = splitName(filename.trim())
	const version = /(?:^|[^\p{L}\p{N}])v(\d+(?:\.\d+)*)$/iu.exec(stem)
	if (version) return `v${version[1]}`
	const copy = /\((\d+)\)$/.exec(stem)
	if (copy) return `(${copy[1]})`
	const word = /(?:^|[\s_-])(final|draft|latest|updated)$/i.exec(stem)
	return word ? (word[1] as string).toLowerCase() : filename
}

const extensionOf = (filename: string): string => splitName(filename)[1].slice(1).toLowerCase()

/** A map chip for a file: its version in a family of versions, else its type. */
function fileChip(file: ThreadFile, versioned: boolean): string {
	const token = versionToken(file.filename)
	if (versioned && token !== file.filename) return token
	return extensionOf(file.filename) || file.filename
}

/** Every file in a thread, each once, families flattened in thread order. */
function collectFiles(messages: MailMessage[], owner: string): ThreadFile[] {
	const seen = new Set<string>()
	return messages.flatMap((message) =>
		(message.attachments ?? []).filter(isThreadFile).flatMap((attachment): ThreadFile[] => {
			const filename = attachment.filename?.trim() || 'Untitled attachment'
			// The same file attached again to a reply is the same file.
			const identity = `${filename.toLowerCase()}|${attachment.size ?? ''}`
			if (seen.has(identity)) return []
			seen.add(identity)
			return [
				{
					attachmentId: attachment.id,
					messageId: message.id,
					filename,
					size: attachment.size ?? 0,
					contentType: attachment.content_type ?? '',
					from: senderPerson(message, owner),
					date: message.date ?? 0,
					olderVersions: [],
				},
			]
		}),
	)
}

/** Files grouped by family, each family oldest first, `versionOf` linked. */
function fileFamilies(messages: MailMessage[], owner: string): ThreadFile[][] {
	const families = new Map<string, ThreadFile[]>()
	for (const file of collectFiles(messages, owner)) {
		const key = fileFamilyKey(file.filename)
		families.set(key, [...(families.get(key) ?? []), file])
	}
	return [...families.values()].map((family) => {
		const ordered = family
			.map((file, order) => ({ file, order }))
			.sort((a, b) => a.file.date - b.file.date || a.order - b.order)
			.map(({ file }) => file)
		return ordered.map((file, index) => {
			const older = ordered[index - 1]
			return older ? { ...file, versionOf: older.filename } : file
		})
	})
}

/**
 * The files a thread carries, newest first: inline images, signature logos
 * and invitations are not files, a file re-attached to a reply counts once,
 * and versions of one file (v1…vN, -final, (1)) fold under the newest.
 */
export function threadFiles(messages: MailMessage[], owner: string): ThreadFile[] {
	return fileFamilies(messages, owner)
		.map((family) => ({ ...(family.at(-1) as ThreadFile), olderVersions: family.slice(0, -1).reverse() }))
		.map((file, order) => ({ file, order }))
		.sort((a, b) => b.file.date - a.file.date || a.order - b.order)
		.map(({ file }) => file)
}

/** "replaces v3 from Tue", or null for a file with no earlier version. */
export function versionLabel(f: ThreadFile, now: number, tz: string): string | null {
	const older = f.olderVersions[0]
	if (!older) return null
	const token = versionToken(older.filename)
	return isTime(older.date)
		? `replaces ${token} from ${shortDayLabel(older.date, now, tz)}`
		: `replaces ${token}`
}

export type UnreadSnapshot = {
	unreadIds: string[]
	/**
	 * When the reader last read this thread, when the caller knows it. Without
	 * it the day is taken from the last read message.
	 */
	lastReadAt?: number
}

/**
 * "3 new since Tuesday", placed before the first message that was unread when
 * the thread opened. None when nothing was unread or everything was. `since`
 * is the day alone ("Tuesday"), for "Since you last read, Tuesday"; null when
 * no time is known.
 */
export function newSinceDivider(
	messages: MailMessage[],
	snap: UnreadSnapshot,
	now: number,
	tz: string,
): { beforeIndex: number; count: number; label: string; since: string | null } | null {
	const unread = new Set(snap.unreadIds)
	const first = messages.findIndex((message) => unread.has(message.id))
	if (first <= 0) return null
	const count = messages.filter((message) => unread.has(message.id)).length
	const lastRead = isTime(snap.lastReadAt)
		? toSeconds(snap.lastReadAt)
		: (messages[first - 1] as MailMessage).date
	const since = isTime(lastRead) ? sinceDayLabel(lastRead, now, tz) : null
	return { beforeIndex: first, count, label: since ? `${count} new since ${since}` : `${count} new`, since }
}

export type FoldItem =
	| { kind: 'open'; index: number }
	| { kind: 'line'; index: number }
	| {
			kind: 'folded'
			indices: number[]
			names: string
			span: string
			avatars: Person[]
			/** The run's message ids. Add all of them to `expandedRuns` to show it as one-line rows. */
			ids: string[]
			/** A stable React key: the id of the run's first message. */
			key: string
	  }

export type FoldOptions = {
	owner: string
	ownerFirstName: string
	unreadIds: string[]
	targetId?: string
	/**
	 * Messages of folded runs the reader expanded (every id of the clicked
	 * folded item's `ids`). A run that holds any of them stays as one-line rows,
	 * even after opening one of its rows splits it.
	 */
	expandedRuns: Set<string>
	/** Messages the reader opened (or all of them, for Expand all). */
	openIds: Set<string>
	/** For the folded rows' date span. Defaults to the current time and zone. */
	now?: number
	tz?: string
	/** Indices after which a run may not continue (a message there could not load). */
	breaksAfter?: ReadonlySet<number>
}

/** The key of a folded run: the id of its first message. */
export const foldRunKey = (messages: MailMessage[], indices: number[]): string =>
	(messages[indices[0] as number] as MailMessage).id

/**
 * How a thread lays out. Open: unread when opened, the latest, starred, a
 * message that names the owner, the linked message and any the reader opened.
 * One line: the first message and each read message next to an open one.
 * Folded: three or more of the rest in a row, as one stacked row naming who
 * wrote them and when. Shorter runs, and runs the reader expanded, are lines.
 * Folded rows name their senders in the order they wrote, the owner as "you".
 */
export function foldPlan(messages: MailMessage[], opts: FoldOptions): FoldItem[] {
	const unread = new Set(opts.unreadIds)
	const last = messages.length - 1
	const open = messages.map(
		(message, index) =>
			index === last ||
			unread.has(message.id) ||
			message.starred === true ||
			message.id === opts.targetId ||
			opts.openIds.has(message.id) ||
			namesOwner(message, opts.owner, opts.ownerFirstName),
	)
	const line = messages.map(
		(_, index) => !open[index] && (index === 0 || open[index - 1] || open[index + 1] === true),
	)
	const now = opts.now ?? Date.now()
	const tz = opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
	const items: FoldItem[] = []
	let run: number[] = []
	const flush = () => {
		const expanded = run.some((index) => opts.expandedRuns.has((messages[index] as MailMessage).id))
		if (run.length >= FOLD_MIN_RUN && !expanded) {
			items.push(foldedRow(messages, run, foldRunKey(messages, run), opts.owner, now, tz))
		} else {
			for (const index of run) items.push({ kind: 'line', index })
		}
		run = []
	}
	messages.forEach((_, index) => {
		if (open[index] || line[index]) {
			flush()
			items.push({ kind: open[index] ? 'open' : 'line', index })
		} else {
			run.push(index)
			if (opts.breaksAfter?.has(index)) flush()
		}
	})
	flush()
	return items
}

/**
 * A folded run's stack: the first people who wrote in it, in the order they
 * spoke, so each face sits over its name in "Alan, Katherine, you, …"
 * (boards 01 and 03 draw AT, KJ, AL over those names).
 */
const foldAvatars = (senders: Person[]): Person[] => senders.slice(0, FOLD_MAX_AVATARS)

function foldedRow(
	messages: MailMessage[],
	indices: number[],
	key: string,
	owner: string,
	now: number,
	tz: string,
): Extract<FoldItem, { kind: 'folded' }> {
	const run = indices.map((index) => messages[index] as MailMessage)
	const senders = uniquePeople(
		run.flatMap((message) => message.from?.slice(0, 1) ?? []),
		owner,
	)
	// The senders in the order they spoke in the run, "you" where the owner did.
	const names = firstNames(senders.slice(0, FOLD_MAX_NAMES)).join(', ')
	const more = senders.length - Math.min(senders.length, FOLD_MAX_NAMES)
	const dates = run.map((message) => message.date ?? 0).filter(isTime)
	return {
		kind: 'folded',
		indices,
		names: `${names}${more > 0 ? ` +${more}` : ''}`,
		span: dates.length > 0 ? dateSpanLabel(Math.min(...dates), Math.max(...dates), now, tz) : '',
		avatars: foldAvatars(senders),
		ids: run.map((message) => message.id),
		key,
	}
}

export type CatchUpFacts = {
	newCount: number
	joined: Person[]
	replacedFiles: Array<{ file: string; replaces: string }>
	questionsToYou: Array<{ messageId: string; from: Person }>
}

/**
 * The catch-up card's facts about the new messages: how many, who joined,
 * which files replaced earlier versions, and which ask the owner something.
 */
export function catchUpFacts(
	messages: MailMessage[],
	snap: UnreadSnapshot,
	owner: string,
	ownerFirstName: string,
): CatchUpFacts {
	const unread = new Set(snap.unreadIds)
	const fresh = messages.filter((message) => unread.has(message.id))
	const first = messages.findIndex((message) => unread.has(message.id))
	const known = new Set(
		uniquePeople(messages.slice(0, Math.max(0, first)).flatMap(messagePeople), owner).map((p) =>
			addressKey(p.email),
		),
	)
	const freshIds = new Set(fresh.map((message) => message.id))
	return {
		newCount: fresh.length,
		joined:
			first > 0
				? uniquePeople(fresh.flatMap(messagePeople), owner).filter(
						(person) => !person.isOwner && !known.has(addressKey(person.email)),
					)
				: [],
		replacedFiles: fileFamilies(messages, owner)
			.flat()
			.filter((file) => file.versionOf !== undefined && freshIds.has(file.messageId))
			.map((file) => ({ file: file.filename, replaces: versionToken(file.versionOf as string) })),
		questionsToYou: fresh
			.filter((message) => asksYou(message, owner, ownerFirstName))
			.map((message) => ({ messageId: message.id, from: senderPerson(message, owner) })),
	}
}

export type MapEntry = {
	messageId: string
	from: Person
	date: number
	/** "v1", "docx", "+ Mary", "asks you". */
	chips: string[]
	unread: boolean
	/** A system line shown above this entry, such as a subject change. */
	event?: string
}

/** The owner's first name as the thread spells it, for callers that only know the address. */
function ownerFirstNameFrom(messages: MailMessage[], owner: string): string {
	const self = uniquePeople(messages.flatMap(messagePeople), owner).find(
		(person) => person.isOwner && person.name,
	)
	return self ? firstName(self) : ''
}

/**
 * The thread map: one entry per message with its sender, date and chips
 * (file versions or types, people added or removed, "asks you"), and the
 * index "You stopped here" sits before (the first message unread at open).
 */
export function threadMap(
	messages: MailMessage[],
	snap: UnreadSnapshot,
	owner: string,
	ownerFirstName = ownerFirstNameFrom(messages, owner),
): { entries: MapEntry[]; stoppedBeforeIndex: number | null } {
	const unread = new Set(snap.unreadIds)
	const changes = threadChanges(messages, owner)
	const chipsByAttachment = new Map<string, string>()
	for (const family of fileFamilies(messages, owner)) {
		for (const file of family) {
			chipsByAttachment.set(`${file.messageId}|${file.attachmentId}`, fileChip(file, family.length > 1))
		}
	}
	const entries = messages.map((message, index): MapEntry => {
		const change = changes[index] as MessageChange
		const chips = [
			...(message.attachments ?? []).flatMap((attachment) => {
				const chip = chipsByAttachment.get(`${message.id}|${attachment.id}`)
				return chip ? [chip] : []
			}),
			...change.added.map((person) => `+ ${personName(person, 'first')}`),
			...change.removed.map((person) => `− ${personName(person, 'first')}`),
			...(asksYou(message, owner, ownerFirstName) ? ['asks you'] : []),
		]
		return {
			messageId: message.id,
			from: senderPerson(message, owner),
			date: message.date ?? 0,
			chips,
			unread: unread.has(message.id),
			...(change.subject ? { event: change.subject } : {}),
		}
	})
	const first = messages.findIndex((message) => unread.has(message.id))
	return { entries, stoppedBeforeIndex: first > 0 ? first : null }
}

/** The event an invitation message is about, when its iCal UID is not at hand: organiser and title. */
function inviteFamily(message: MailMessage): string {
	const title = subjectTopic(message.subject).replace(/\s*@.*$/, '')
	return `${addressKey(message.from?.[0]?.email)}|${title.toLowerCase()}`
}

/**
 * Invitations sent more than once for one event. Keyed by the event (its iCal
 * UID when `uidOf` knows it, else organiser and title); `versions` lists every
 * invitation message for it oldest first, the last being `latestId`, so the
 * event was updated `versions.length - 1` times.
 */
export function supersededInvites(
	messages: MailMessage[],
	uidOf: (message: MailMessage) => string | undefined = () => undefined,
): Map<string, { latestId: string; versions: string[] }> {
	const families = new Map<string, MailMessage[]>()
	for (const message of messages) {
		if (!(message.attachments ?? []).some(isCalendarInvitationAttachment)) continue
		const key = uidOf(message) ?? inviteFamily(message)
		families.set(key, [...(families.get(key) ?? []), message])
	}
	const result = new Map<string, { latestId: string; versions: string[] }>()
	for (const [key, family] of families) {
		if (family.length < 2) continue
		const versions = family
			.map((message, order) => ({ message, order }))
			.sort((a, b) => (a.message.date ?? 0) - (b.message.date ?? 0) || a.order - b.order)
			.map(({ message }) => message.id)
		result.set(key, { latestId: versions.at(-1) as string, versions })
	}
	return result
}

const BOUNCE_SENDER = /^(?:mailer-daemon|postmaster)@/i
const BOUNCE_SUBJECT =
	/^\s*(?:undeliverable|undelivered mail|delivery status notification \(failure\)|mail delivery failed)/i

/** A delivery failure report from a mail server. */
export function isBounceMessage(message: MailMessage): boolean {
	return (
		BOUNCE_SENDER.test(message.from?.[0]?.email?.trim() ?? '') || BOUNCE_SUBJECT.test(message.subject ?? '')
	)
}

/**
 * Bounces of the owner's own mail: a delivery failure right after a message
 * the owner sent. `address` is the recipient the report names, else the
 * original's first To address.
 */
export function bounceFor(
	messages: MailMessage[],
	owner: string,
): Array<{ bounceId: string; originalId: string; address: string }> {
	return messages.flatMap((message, index) => {
		const original = messages[index - 1]
		if (!original || !isBounceMessage(message) || !senderPerson(original, owner).isOwner) return []
		const report = `${messagePreview(message)} ${message.body ?? ''}`.toLowerCase()
		const recipients = [...(original.to ?? []), ...(original.cc ?? []), ...(original.bcc ?? [])]
			.map((person) => person.email.trim())
			.filter(Boolean)
		const address = recipients.find((email) => report.includes(email.toLowerCase())) ?? recipients[0] ?? ''
		return [{ bounceId: message.id, originalId: original.id, address }]
	})
}

const RECEIPT_WORDS = /\b(?:receipt|invoice|payment|order|paid)\b/i
const AMOUNT = /[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/
const BULK_SENDER = /newsletter|digest|^news@|noreply|no-reply|donotreply|do-not-reply/i
const BULK_SNIPPET = /\bunsubscribe\b|\bview (?:it |this )?(?:email )?in (?:your |a )?browser\b/i

const listText = (thread: MailThread): string =>
	`${thread.subject ?? thread.latest_draft_or_message?.subject ?? ''} ${thread.snippet ?? thread.latest_draft_or_message?.snippet ?? ''}`

/** The amount a receipt row shows ("$4,200.00"), from the subject or snippet. */
export function receiptAmount(thread: MailThread): string | null {
	return AMOUNT.exec(listText(thread))?.[0].replace(/\s+/g, ' ') ?? null
}

/**
 * Whether a thread belongs in a list bundle: a receipt (receipt, invoice,
 * payment, order or paid with an amount) or a newsletter (a bulk sender
 * address, an unsubscribe or view-in-browser line, or a List-Unsubscribe
 * header when the caller knows it). Conversations with more than two people
 * and drafts never bundle.
 */
export function classifyBundle(
	thread: MailThread,
	known: { listUnsubscribe?: boolean } = {},
): 'newsletter' | 'receipt' | null {
	const latest = thread.latest_draft_or_message
	if (latest?.ownmailDraft || (thread.participants?.length ?? 0) > 2) return null
	const text = listText(thread)
	if (RECEIPT_WORDS.test(text) && AMOUNT.test(text)) return 'receipt'
	const sender = (latest?.from?.[0] ?? thread.participants?.[0])?.email?.trim() ?? ''
	if (known.listUnsubscribe || BULK_SENDER.test(sender) || BULK_SNIPPET.test(text)) return 'newsletter'
	return null
}
