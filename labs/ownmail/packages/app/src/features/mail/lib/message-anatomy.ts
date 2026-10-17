/**
 * The message anatomy: what one open message's header, details panel, notices
 * and sender card say (design board 05, "headers that whisper").
 *
 * The header is one line: who wrote, a short recipient summary and the time.
 * Full addresses, authentication and the sender's own clock are one click
 * away, and a notice appears only when something is unusual: replies go
 * elsewhere, the sender is not who they look like, someone was dropped from
 * the reply, or the message came through a mailing list. Everything here is
 * pure; header facts are the server's derived booleans and short strings,
 * never raw header values.
 *
 * Timestamps are epoch seconds, as `MailMessage.date` is; `now` may be
 * milliseconds. `tz` is an IANA zone; an unknown one falls back to UTC.
 */

import type { EmailParticipant } from '@nylas-labs/cli-kit/v3'
import { isCalendarInvitationAttachment } from '#features/calendar/lib/calendar-invitation'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'
import { blocksText, type CleanBlock, messageContent } from './clean-view.js'
import { bubbleContent } from './conversation-model.js'
import {
	firstName,
	isBounceMessage,
	type Person,
	personName,
	REPLY_ALL_GUARD,
	senderPerson,
	toPerson,
} from './thread-reading-model.js'

/** Any `now` above this is milliseconds: in seconds it is past the year 5000. */
const MILLISECONDS_FLOOR = 1e11
/** A signature line longer than this is prose, not a title. */
const SIGNATURE_LINE_MAX_CHARS = 60
const EMAIL_IN_TEXT = /[^\s@<>()",;:]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{6,}\d/
const LINK_LINE = /https?:\/\/|www\./i
/** A label some signatures put before a number or address: "Mobile:", "T:", "Email -". */
const LINE_LABEL = /^(?:[a-z]{1,8}\.?\s*[:|–-]\s*)/i
const FORWARD_SUBJECT = /^\s*fwd?\s*:/i
/** Second-level labels under a two-letter country code that a registrant cannot own (`co.uk`). */
const PUBLIC_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])
/** A To address that names a mailing list by itself: eng-all@, pm-list@, all@. */
const LIST_LOCAL_PART = /(?:-all|-list|^all)$/i

const toSeconds = (value: number): number => (value > MILLISECONDS_FLOOR ? Math.floor(value / 1000) : value)
const addressKey = (email: string): string => email.trim().toLowerCase()
const localPart = (email: string): string => addressKey(email).split('@')[0] as string

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

function formatter(tz: string, options: Intl.DateTimeFormatOptions, locale = 'en-US'): Intl.DateTimeFormat {
	const timeZone = zone(tz)
	const key = `${locale}|${timeZone}|${JSON.stringify(options)}`
	let cached = formatters.get(key)
	if (!cached) {
		cached = new Intl.DateTimeFormat(locale, { ...options, timeZone })
		formatters.set(key, cached)
	}
	return cached
}

const format = (seconds: number, tz: string, options: Intl.DateTimeFormatOptions): string =>
	formatter(tz, options).format(seconds * 1000)

/** The calendar day a moment falls on in a zone, as a day count. */
function calendarDay(seconds: number, tz: string): number {
	const [month, day, year] = format(seconds, tz, { year: 'numeric', month: 'numeric', day: 'numeric' })
		.split('/')
		.map(Number) as [number, number, number]
	return Date.UTC(year, month - 1, day) / 86_400_000
}

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

/**
 * The time in a message header: "9:30 AM" today, "Wed 4:12 PM" within the
 * past six days, "Sep 28, 4:12 PM" earlier this year, else "Sep 28, 2025".
 */
export function headerTimeLabel(seconds: number, now: number, tz: string): string {
	const current = toSeconds(now)
	const ago = calendarDay(current, tz) - calendarDay(seconds, tz)
	if (ago === 0) return format(seconds, tz, TIME)
	if (ago > 0 && ago <= 6) return format(seconds, tz, { weekday: 'short', ...TIME }).replace(',', '')
	if (format(seconds, tz, { year: 'numeric' }) === format(current, tz, { year: 'numeric' })) {
		return format(seconds, tz, { month: 'short', day: 'numeric', ...TIME })
	}
	return format(seconds, tz, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The details panel's date: "Wed, Oct 14, 2026, 4:12 PM". */
export function longDateLabel(seconds: number, tz: string): string {
	return format(seconds, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...TIME })
}

/** The zone name a formatter writes for a moment: "GMT-07:00", "PDT". */
const zoneName = (zoneFormatter: Intl.DateTimeFormat, seconds: number): string =>
	zoneFormatter
		.formatToParts(seconds * 1000)
		.filter((part) => part.type === 'timeZoneName')
		.map((part) => part.value)
		.join('')

/** A zone's offset from UTC at a moment, in minutes. */
export function zoneOffsetMinutes(seconds: number, tz: string): number {
	const match = /([+\-−])(\d{2}):(\d{2})/.exec(
		zoneName(formatter(tz, { timeZoneName: 'longOffset' }), seconds),
	)
	if (!match) return 0
	const minutes = Number(match[2]) * 60 + Number(match[3])
	return match[1] === '+' ? minutes : -minutes
}

/**
 * Zones whose short names people recognise, tried in order. A Date header
 * carries only an offset, so the first zone with that offset at that moment
 * names it: -420 is PDT in summer and MST in winter.
 */
const NAMED_ZONES: ReadonlyArray<readonly [zone: string, locale: string]> = [
	['America/Los_Angeles', 'en-US'],
	['America/Denver', 'en-US'],
	['America/Chicago', 'en-US'],
	['America/New_York', 'en-US'],
	['America/Halifax', 'en-US'],
	['America/Anchorage', 'en-US'],
	['Pacific/Honolulu', 'en-US'],
	['Europe/London', 'en-GB'],
	['Europe/Paris', 'en-GB'],
	['Europe/Athens', 'en-GB'],
	['Asia/Kolkata', 'en-IN'],
	['Australia/Sydney', 'en-AU'],
]

/** "PDT", "CEST", or "UTC−7" / "UTC+5:30" when no well-known zone has that offset then. */
export function zoneAbbreviation(offsetMinutes: number, seconds: number): string {
	const named = NAMED_ZONES.find(([name]) => zoneOffsetMinutes(seconds, name) === offsetMinutes)
	if (named) return zoneName(formatter(named[0], { timeZoneName: 'short' }, named[1]), seconds)
	if (offsetMinutes === 0) return 'UTC'
	const absolute = Math.abs(offsetMinutes)
	const minutes = absolute % 60
	return `UTC${offsetMinutes < 0 ? '−' : '+'}${Math.floor(absolute / 60)}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}

/**
 * The sender's own clock when it differs from the reader's: "7:12 AM" in
 * "PDT", from the Date header's offset. Null when the offset is unknown or
 * the same as the reader's at that moment.
 */
export function senderLocalTime(
	seconds: number,
	offsetMinutes: number | undefined,
	viewerTz: string,
): { time: string; zone: string } | null {
	if (offsetMinutes === undefined || !Number.isFinite(offsetMinutes)) return null
	if (zoneOffsetMinutes(seconds, viewerTz) === offsetMinutes) return null
	return {
		time: format(seconds + offsetMinutes * 60, 'UTC', TIME),
		zone: zoneAbbreviation(offsetMinutes, seconds),
	}
}

/** The registrable part of an address's domain: mail.meridianbank.com → meridianbank.com. */
export function organisationDomain(email: string): string {
	const host = addressKey(email).split('@')[1] ?? ''
	const labels = host.split('.').filter(Boolean)
	const keep =
		labels.length >= 3 &&
		(labels.at(-1) as string).length === 2 &&
		PUBLIC_SECOND_LEVELS.has(labels.at(-2) as string)
			? 3
			: 2
	return labels.slice(-keep).join('.')
}

/** The domain an address came from, as written: meridian-secure.co. */
export const addressDomain = (email: string): string => addressKey(email).split('@')[1] ?? ''

const sameName = (a: string, b: string): boolean =>
	a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

export type Lookalike = { name: string; usualDomain: string; domain: string }

/**
 * A sender whose display name is someone this mailbox knows (a contact or a
 * prior correspondent) but whose address is on another organisation's domain:
 * "Meridian Bank" from meridian-secure.co when Meridian Bank writes from
 * meridianbank.com. Null when any other known address with that name shares
 * the sender's domain, or the sender is the owner or has no name. The
 * sender's own address never vouches for itself: saving a lookalike to
 * contacts, or listing this message's sender among correspondents, does not
 * make it safe.
 */
export function lookalikeSender(
	message: MailMessage,
	knownSenders: Person[],
	owner: string,
): Lookalike | null {
	const sender = senderPerson(message, owner)
	if (sender.isOwner || !sender.name || !sender.email) return null
	const namesakes = knownSenders.filter(
		(person) =>
			!person.isOwner &&
			person.email &&
			addressKey(person.email) !== addressKey(sender.email) &&
			sameName(person.name, sender.name),
	)
	if (namesakes.length === 0) return null
	const domain = organisationDomain(sender.email)
	if (namesakes.some((person) => organisationDomain(person.email) === domain)) return null
	return {
		name: sender.name,
		usualDomain: organisationDomain((namesakes[0] as Person).email),
		domain: addressDomain(sender.email),
	}
}

/** Where replies go when it is not the address the message came from; the owner's own mail never warns. */
export function replyToAddress(
	message: MailMessage,
	facts: MessageHeaderFacts | undefined,
	owner: string,
): string | null {
	const sender = senderPerson(message, owner)
	if (sender.isOwner) return null
	if (facts?.replyTo) return facts.replyTo
	const replyTo = message.reply_to?.[0]?.email?.trim()
	return replyTo && addressKey(replyTo) !== addressKey(sender.email) ? replyTo : null
}

/** People on a list of addresses, once each, in order, without empty addresses. */
function uniquePeople(participants: EmailParticipant[], owner: string): Person[] {
	const people = new Map<string, Person>()
	for (const participant of participants) {
		const person = toPerson(participant, owner)
		const key = addressKey(person.email)
		if (key && !people.has(key)) people.set(key, person)
	}
	return [...people.values()]
}

const everyone = (message: MailMessage): EmailParticipant[] => [
	...(message.from ?? []),
	...(message.to ?? []),
	...(message.cc ?? []),
]

/**
 * Who a reply all dropped: people the previous message involved whom this
 * one, written by someone else, no longer reaches. Counted the way the
 * thread's system lines count it: only for a reply that still reaches at
 * least two of those people (not a reply to one person, a forward, a bounce
 * or an invitation). The owner is never listed; nor is anyone when the owner
 * wrote the message.
 */
export function removedFromReply(
	message: MailMessage,
	prev: MailMessage | undefined,
	owner: string,
): Person[] {
	if (!prev || isBounceMessage(message) || isBounceMessage(prev)) return []
	if ((message.attachments ?? []).some(isCalendarInvitationAttachment)) return []
	if (FORWARD_SUBJECT.test(message.subject ?? '')) return []
	const sender = senderPerson(message, owner)
	if (sender.isOwner) return []
	const audience = uniquePeople(everyone(prev), owner).filter(
		(person) => addressKey(person.email) !== addressKey(sender.email),
	)
	const reached = new Set(uniquePeople(everyone(message), owner).map((person) => addressKey(person.email)))
	const kept = audience.filter((person) => reached.has(addressKey(person.email))).length
	if (kept < 2) return []
	return audience.filter((person) => !person.isOwner && !reached.has(addressKey(person.email)))
}

/** The list's address as "eng-all@"; none when the message names no recipient as the list. */
export type MailingList = { label?: string; count?: number }

/** Whether an address is the list a List-Id names: eng-all@vercel.com for `eng-all.vercel.com`. */
const isListIdAddress = (email: string, listId: string): boolean =>
	addressKey(email).replace('@', '.') === listId || localPart(email) === listId.split('.')[0]

/**
 * The mailing list a message came through: the To or Cc address its List-Id
 * names, else a To address that names a list by itself (eng-all@, pm-list@,
 * all@). A List-Id that names no recipient gives a list without a label;
 * no address is made up from it. "a list of 240" counts the people the
 * message shows (the copied recipients, the sender and you), and only when
 * the list is the sole To recipient and that count is a broadcast (more
 * than the reply-all guard); a smaller count says nothing about the list's
 * size, so then the size is not known.
 */
export function mailingList(
	message: MailMessage,
	facts: MessageHeaderFacts | undefined,
	owner: string,
): MailingList | null {
	const to = message.to ?? []
	const listId = facts?.listId?.toLowerCase()
	const list = listId
		? [...to, ...(message.cc ?? [])].find(
				(participant) => !toPerson(participant, owner).isOwner && isListIdAddress(participant.email, listId),
			)
		: to.find((participant) => LIST_LOCAL_PART.test(localPart(participant.email)))
	if (!list) return listId ? {} : null
	const label = `${localPart(list.email)}@`
	const copied = message.cc ?? []
	if (to.length !== 1 || to[0] !== list || copied.length === 0) return { label }
	const people = uniquePeople([...(message.from ?? []), ...copied], owner)
	const count = people.length + (people.some((person) => person.isOwner) ? 0 : 1)
	return count > REPLY_ALL_GUARD ? { label, count } : { label }
}

/**
 * A chip in the details panel: "You", "Grace Hopper", a list as "pm-leads@"
 * (with its member count when known: "pm-leads@ · 12"), and any other
 * nameless address in full, so its domain is always on screen.
 */
export type PersonChip = { person: Person; label: string; isList: boolean; count?: number }

/** What marks an address as a list: the message's List-Id, and member counts known for this mailbox keyed by lower-case address. */
export type ChipContext = { listId?: string; listSizes?: Readonly<Record<string, number>> }

export function personChips(
	participants: EmailParticipant[] | undefined,
	owner: string,
	context: ChipContext = {},
): PersonChip[] {
	const listId = context.listId?.toLowerCase()
	return uniquePeople(participants ?? [], owner).map((person) => {
		const key = addressKey(person.email)
		const size =
			!person.isOwner && context.listSizes && Object.hasOwn(context.listSizes, key)
				? context.listSizes[key]
				: undefined
		const count = size !== undefined && Number.isFinite(size) && size >= 1 ? Math.floor(size) : undefined
		const isList =
			!person.isOwner &&
			(count !== undefined ||
				LIST_LOCAL_PART.test(localPart(key)) ||
				(listId !== undefined && isListIdAddress(key, listId)))
		const label = person.isOwner ? 'You' : person.name || (isList ? `${localPart(key)}@` : person.email)
		return { person, label, isList, ...(count !== undefined ? { count } : {}) }
	})
}

/** Every address on a message but the owner's, as "Name <address>", for "Copy addresses". */
export function copyableAddresses(message: MailMessage, owner: string): string {
	return uniquePeople([...everyone(message), ...(message.bcc ?? []), ...(message.reply_to ?? [])], owner)
		.filter((person) => !person.isOwner)
		.map((person) => (person.name ? `${person.name} <${person.email}>` : person.email))
		.join(', ')
}

/** How a header names the sender: their full name, "You" for the owner. */
export function headerSenderName(message: MailMessage, owner: string): string {
	const sender = senderPerson(message, owner)
	return sender.isOwner ? 'You' : personName(sender, 'full')
}

export type SignatureCard = { title?: string; email?: string; phone?: string }

/** The blocks of the message's own text, before quoted history. */
function ownBlocks(message: MailMessage): CleanBlock[] {
	const content = messageContent(message, false)
	if (content.kind === 'original') return []
	const history = content.blocks.findIndex((block) => block.type === 'history')
	return history === -1 ? content.blocks : content.blocks.slice(0, history)
}

/**
 * The lines of the signature the sender signed this message with, found the
 * way the Conversation view finds it: a client's signature marker, a `-- `
 * line, or a closing block with the sender's name and how to reach them.
 * Null when there is none.
 */
export function signatureLines(message: MailMessage): string[] | null {
	const blocks = ownBlocks(message)
	let signature = blocks.find((block) => block.type === 'signature')
	if (!signature) {
		const { blocks: kept, unsure } = bubbleContent(blocks, [], message.from?.[0])
		signature = kept.find((block) => block.type === 'signature')
		if (!signature && !unsure) {
			const last = blocks.findLastIndex((block) => kept.includes(block))
			const dropped = blocks.slice(last + 1)
			if (dropped.length > 0) signature = { type: 'signature', blocks: dropped }
		}
	}
	if (!signature) return null
	const lines = blocksText([signature])
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !/^--\s*$/.test(line))
	return lines.length > 0 ? lines : null
}

/**
 * A title line, an address and a phone number from a signature: "Principal
 * Engineer, Bletchley", "alan@bletchley.dev", "+44 20 7946 0958". The line
 * with the sender's name is skipped; null when nothing useful is left.
 */
export function parseSignature(
	lines: string[],
	sender: Pick<Person, 'name' | 'email'>,
): SignatureCard | null {
	const card: SignatureCard = {}
	const names = [sender.name, firstName(sender)].filter(Boolean)
	for (const raw of lines) {
		const line = raw.replace(LINE_LABEL, '').trim()
		if (names.some((name) => sameName(raw, name))) continue
		const email = EMAIL_IN_TEXT.exec(line)?.[0]
		if (email) {
			card.email ??= email
			continue
		}
		const phone = PHONE_IN_TEXT.exec(line)?.[0]
		if (phone && line.replace(phone, '').replace(/[\s:|·,–-]/g, '').length <= 3) {
			card.phone ??= phone.trim()
			continue
		}
		if (LINK_LINE.test(raw) || raw.length > SIGNATURE_LINE_MAX_CHARS || !/\p{L}/u.test(raw)) continue
		card.title ??= raw
	}
	return card.title || card.email || card.phone ? card : null
}

/** The sender card's details from the message's signature, or null without one. */
export function senderSignature(message: MailMessage, owner: string): SignatureCard | null {
	const lines = signatureLines(message)
	return lines ? parseSignature(lines, senderPerson(message, owner)) : null
}
