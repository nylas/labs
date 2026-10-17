/**
 * The thread list model: what a list row says about a thread before it is
 * rendered (design.md "List density" and "Thread list"). Day groups, the
 * newsletter and receipt bundles, who a row names, the outgoing states
 * (draft, scheduled, not sent), muting, and the signals that change what the
 * reader does next ("3 new", "Asks you", the newest file, an invitation).
 *
 * Pure and DOM-free like the reading model it builds on. Timestamps are epoch
 * seconds; `now` may be milliseconds. `tz` is an IANA zone, UTC when unknown.
 */

import { firstCalendarInvitationAttachment } from '#features/calendar/lib/calendar-invitation'
import type { InvitationWhen } from '#features/calendar/server/calendar-invitation-fns'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import { readableSnippet, threadTimestamp } from './mail-ui-model.js'
import {
	asksYou,
	classifyBundle,
	dayGroup,
	dayGroupHeading,
	firstName,
	isBounceMessage,
	isThreadFile,
	receiptAmount,
	rowParticipants,
	threadFiles,
} from './thread-reading-model.js'

/** Who is reading the list, and when and where: every row reads the same values. */
export type ThreadListEnv = {
	/** The mailbox address; empty while unknown, when nothing is attributed to "you". */
	owner: string
	ownerFirstName: string
	now: number
	tz: string
	mutedIds: ReadonlySet<string>
}

const MILLISECONDS_FLOOR = 1e11
const toSeconds = (value: number): number => (value > MILLISECONDS_FLOOR ? Math.floor(value / 1000) : value)
const addressKey = (email: string | undefined): string => email?.trim().toLowerCase() ?? ''

const zones = new Map<string, string>()

/** The zone itself when Intl knows it, else UTC. */
function zone(tz: string): string {
	const known = zones.get(tz)
	if (known) return known
	let resolved = 'UTC'
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0)
		resolved = tz
	} catch {
		// An unknown zone reads as UTC rather than failing the list.
	}
	zones.set(tz, resolved)
	return resolved
}

function format(seconds: number, tz: string, options: Intl.DateTimeFormatOptions): string {
	return new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone(tz) }).format(seconds * 1000)
}

/** Days from `now` to `seconds` in calendar days of the zone: 1 is tomorrow, -1 yesterday. */
function dayOffset(seconds: number, now: number, tz: string): number {
	const day = (value: number) => {
		const [month, date, year] = format(value, tz, { year: 'numeric', month: 'numeric', day: 'numeric' })
			.split('/')
			.map(Number)
		return Date.UTC(year as number, (month as number) - 1, date) / 86_400_000
	}
	return day(seconds) - day(toSeconds(now))
}

const clock = (seconds: number, tz: string): string =>
	format(seconds, tz, { hour: 'numeric', minute: '2-digit' })

/** "Sep 28", with the year when it is not this year's. */
function monthDay(seconds: number, now: number, tz: string): string {
	const sameYear =
		format(seconds, tz, { year: 'numeric' }) === format(toSeconds(now), tz, { year: 'numeric' })
	return format(seconds, tz, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/**
 * A row's time once day groups carry the day: the time in Today and
 * Yesterday ("9:41 AM"), the weekday in This week ("Tue"), else "Sep 28".
 */
export function rowTimeLabel(ts: number | undefined, now: number, tz: string): string {
	if (!ts || !Number.isFinite(ts)) return ''
	const group = dayGroup(ts, now, tz)
	if (group === 'Today' || group === 'Yesterday') return clock(ts, tz)
	if (group === 'This week') return format(ts, tz, { weekday: 'short' })
	return monthDay(ts, now, tz)
}

/** "Sends Mon 9:00 AM": today, a weekday within the week ahead, else the date. */
export function sendAtLabel(sendAt: number, now: number, tz: string): string {
	const ahead = dayOffset(sendAt, now, tz)
	if (ahead === 0) return `Sends today ${clock(sendAt, tz)}`
	if (ahead > 0 && ahead <= 6) return `Sends ${format(sendAt, tz, { weekday: 'short' })} ${clock(sendAt, tz)}`
	return `Sends ${monthDay(sendAt, now, tz)}, ${clock(sendAt, tz)}`
}

/** "2:00–2:45 PM", or "11:30 AM–12:15 PM" when the two halves of the day differ. */
function timeRange(start: number, end: number, tz: string): string {
	const from = clock(start, tz)
	const to = clock(end, tz)
	const half = (label: string) => label.slice(-2)
	return half(from) === half(to) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`
}

/** An invitation on one line: "Thu, Oct 22 · 2:00–2:45 PM", "Thu, Oct 22 · All day". */
export function inviteWhenLabel(when: InvitationWhen, tz: string): string {
	if (when.kind === 'timed') {
		return `${format(when.start, tz, { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeRange(when.start, when.end, tz)}`
	}
	const [year, month, day] = when.startDate.split('-').map(Number) as [number, number, number]
	const start = Date.UTC(year, month - 1, day) / 1000
	return `${format(start, 'UTC', { weekday: 'short', month: 'short', day: 'numeric' })} · All day`
}

/** The owner's address and first name from the mailbox the session belongs to. */
export function ownerFromMailbox(info: { email?: string; displayName?: string } | undefined): {
	owner: string
	ownerFirstName: string
} {
	const owner = info?.email?.trim() ?? ''
	if (!owner) return { owner: '', ownerFirstName: '' }
	return { owner, ownerFirstName: firstName({ name: info?.displayName ?? '', email: owner }) }
}

// ---- One row -----------------------------------------------------------------

export type RowWho =
	| { kind: 'people'; names: string; more: number }
	/** "Draft · to Bright Smile Dental" */
	| { kind: 'draft'; to: string }
	/** "To Grace Hopper": something the owner sent, scheduled or not delivered. */
	| { kind: 'to'; name: string }
	/** "eng-all@ · 31 people": a muted list conversation. */
	| { kind: 'list'; list: string; people: number }

export type ThreadRowFacts = {
	state: 'normal' | 'draft' | 'scheduled' | 'failed' | 'muted'
	who: RowWho
	subject: string
	/** Who the snippet is from: "you" (the owner replied last) or a first name on a group thread. */
	snippetFrom?: string
	snippet: string
	/** Bold and accented: unread, unless the row is muted. */
	unread: boolean
	sendAt?: number
	newCount?: number
	asksYou: boolean
	file?: string
	invite?: { messageId: string; attachmentId: string }
}

type Participant = NonNullable<MailThread['participants']>[number]

/** The mail server that reports a bounce, never the person the mail was for. */
const BOUNCE_SENDER = /^(?:mailer-daemon|postmaster)@/i

const personLabel = (person: Participant | undefined): string =>
	person?.name?.trim() || person?.email?.trim() || ''

/** A mailing list address: "eng-all@", "team-list@", "all@". */
export function isListAddress(email: string | undefined): boolean {
	const local = addressKey(email).split('@')[0] as string
	return /(?:^all|-all|-list)$/.test(local)
}

/** Whether the newest item on a thread is a draft rather than a message. */
export function isDraftLatest(thread: MailThread): boolean {
	const latest = thread.latest_draft_or_message
	if (!latest) return false
	return (
		latest.ownmailDraft === true ||
		(latest as { object?: string }).object === 'draft' ||
		Boolean((thread as { draft_ids?: string[] }).draft_ids?.includes(latest.id)) ||
		Boolean(latest.folders?.includes('drafts'))
	)
}

/** A scheduled send time still ahead, from the provider's `send_at`. */
export function pendingSendAt(message: MailMessage | undefined, now: number): number | undefined {
	const sendAt = (message as { send_at?: unknown } | undefined)?.send_at
	return typeof sendAt === 'number' && sendAt > toSeconds(now) ? sendAt : undefined
}

/** The newest file a thread carries, from its messages when they are loaded, else its newest message. */
function newestFile(
	thread: MailThread,
	owner: string,
	messages: MailMessage[] | undefined,
): string | undefined {
	if (messages?.length) return threadFiles(messages, owner)[0]?.filename
	const attachments = thread.latest_draft_or_message?.attachments ?? []
	return attachments.find(isThreadFile)?.filename?.trim() || undefined
}

/**
 * What a row says about a thread. `messages` are the thread's messages when
 * the list has loaded them (for "3 new" and the newest file); without them
 * the row says what the thread and its newest message carry.
 */
export function threadRowFacts(
	thread: MailThread,
	env: Pick<ThreadListEnv, 'owner' | 'ownerFirstName' | 'now' | 'mutedIds'>,
	messages?: MailMessage[],
): ThreadRowFacts {
	const latest = thread.latest_draft_or_message
	const ownerKey = addressKey(env.owner)
	const isOwner = (email: string | undefined) => ownerKey !== '' && addressKey(email) === ownerKey
	const subject = thread.subject || latest?.subject || ''
	const snippet = readableSnippet(thread.snippet ?? latest?.snippet)
	const participants = thread.participants ?? []
	const messageCount = thread.message_ids?.length ?? 0

	if (latest && isDraftLatest(thread)) {
		return {
			state: 'draft',
			who: { kind: 'draft', to: personLabel(latest.to?.[0]) || '(no recipient)' },
			subject: latest.subject || subject,
			snippet: readableSnippet(latest.snippet ?? thread.snippet),
			unread: false,
			asksYou: false,
		}
	}

	if (env.mutedIds.has(thread.id)) {
		const list = [...(latest?.to ?? []), ...participants].find((person) => isListAddress(person.email))
		const replies = Math.max(0, messageCount - 1)
		return {
			state: 'muted',
			who: list
				? { kind: 'list', list: `${addressKey(list.email).split('@')[0]}@`, people: participants.length }
				: { kind: 'people', ...rowParticipants(thread, env.owner) },
			subject,
			snippet:
				replies === 0
					? 'Muted'
					: `Muted · ${replies} ${replies === 1 ? 'reply' : 'replies'} you don’t need to read`,
			unread: false,
			asksYou: false,
		}
	}

	if (latest && isBounceMessage(latest) && thread.latest_message_sent_date) {
		const recipient = participants.find(
			(person) => !isOwner(person.email) && !BOUNCE_SENDER.test(`${person.email}`.trim()),
		)
		return {
			state: 'failed',
			who: { kind: 'to', name: personLabel(recipient) || 'Unknown recipient' },
			subject,
			snippet: 'Not sent. The address bounced.',
			unread: false,
			asksYou: false,
		}
	}

	const sendAt = pendingSendAt(latest, env.now)
	if (latest && sendAt !== undefined) {
		return {
			state: 'scheduled',
			who: { kind: 'to', name: personLabel(latest.to?.[0]) || '(no recipient)' },
			subject: latest.subject || subject,
			snippet,
			unread: false,
			sendAt,
			asksYou: false,
		}
	}

	const who = rowParticipants(thread, env.owner)
	const sender = latest?.from?.[0]
	const others = participants.filter((person) => !isOwner(person.email) && person.email)
	const snippetFrom = isOwner(sender?.email)
		? 'you'
		: others.length > 1 && sender
			? firstName({ name: sender.name ?? '', email: sender.email })
			: undefined
	const unreadCount = messages?.filter((message) => message.unread).length ?? 0
	const invitation = firstCalendarInvitationAttachment(latest?.attachments)
	const lastMessage = messages?.at(-1) ?? latest
	const file = newestFile(thread, env.owner, messages)
	return {
		state: 'normal',
		who: { kind: 'people', ...who },
		subject,
		...(snippetFrom ? { snippetFrom } : {}),
		snippet,
		unread: Boolean(thread.unread),
		...(thread.unread && messageCount > 1 && unreadCount > 0 ? { newCount: unreadCount } : {}),
		asksYou: Boolean(ownerKey && lastMessage && asksYou(lastMessage, env.owner, env.ownerFirstName)),
		...(file ? { file } : {}),
		...(invitation ? { invite: { messageId: (latest as MailMessage).id, attachmentId: invitation.id } } : {}),
	}
}

/** Whether a row's thread is worth loading to count what is new: unread, with earlier messages. */
export function wantsThreadMessages(thread: MailThread): boolean {
	return Boolean(thread.unread) && (thread.message_ids?.length ?? 0) > 1
}

// ---- The list: day groups and bundles ----------------------------------------

export type BundleKind = 'newsletter' | 'receipt'

export type ThreadListItem =
	| { kind: 'heading'; key: string; label: string }
	| { kind: 'thread'; key: string; thread: MailThread; bundled?: string }
	| { kind: 'bundle'; key: string; bundle: BundleKind; threads: MailThread[]; expanded: boolean }

/** A bundle needs at least this many threads of one kind in one day group. */
export const BUNDLE_MIN = 2

/**
 * The list as it renders: a heading for each day group, the threads in the
 * order given (newest first), and, when `bundle` is on, the newsletters and
 * receipts of a group folded into one bundle row where the newest of them
 * sits. An expanded bundle, or one holding the open thread, lists its
 * threads beneath it.
 */
export function threadListItems(
	threads: MailThread[],
	opts: {
		now: number
		tz: string
		bundle: boolean
		expanded: ReadonlySet<string>
		openId?: string
		mutedIds?: ReadonlySet<string>
	},
): ThreadListItem[] {
	const groups: Array<{ label: string; threads: MailThread[] }> = []
	for (const thread of threads) {
		const label = dayGroupHeading(threadTimestamp(thread) ?? 0, opts.now, opts.tz)
		const group = groups.at(-1)
		if (group?.label === label) group.threads.push(thread)
		else groups.push({ label, threads: [thread] })
	}
	return groups.flatMap((group, groupIndex) => {
		const headingKey = `group:${groupIndex}:${group.label}`
		const kinds = new Map<string, BundleKind | null>()
		const members = new Map<BundleKind, MailThread[]>()
		if (opts.bundle) {
			for (const thread of group.threads) {
				const kind = opts.mutedIds?.has(thread.id) || isDraftLatest(thread) ? null : classifyBundle(thread)
				kinds.set(thread.id, kind)
				if (kind) members.set(kind, [...(members.get(kind) ?? []), thread])
			}
		}
		const bundled = (thread: MailThread): BundleKind | null => {
			const kind = kinds.get(thread.id)
			return kind && (members.get(kind) as MailThread[]).length >= BUNDLE_MIN ? kind : null
		}
		const items: ThreadListItem[] = [{ kind: 'heading', key: headingKey, label: group.label }]
		for (const thread of group.threads) {
			const kind = bundled(thread)
			if (!kind) {
				items.push({ kind: 'thread', key: thread.id, thread })
				continue
			}
			const inBundle = members.get(kind) as MailThread[]
			// The bundle sits where its newest thread would, and only there.
			if (inBundle[0] !== thread) continue
			const key = `bundle:${group.label}:${kind}`
			const expanded = opts.expanded.has(key) || inBundle.some((member) => member.id === opts.openId)
			items.push({ kind: 'bundle', key, bundle: kind, threads: inBundle, expanded })
			if (expanded) {
				for (const member of inBundle)
					items.push({ kind: 'thread', key: member.id, thread: member, bundled: key })
			}
		}
		return items
	})
}

/** A bundle row: "Newsletters" over its senders, "Receipts" over who was paid and how much. */
export function bundleSummary(
	bundle: BundleKind,
	threads: MailThread[],
): { title: string; count: number; line: string; unread: boolean } {
	const senders = threads.map((thread) =>
		personLabel(thread.latest_draft_or_message?.from?.[0] ?? thread.participants?.[0]),
	)
	const line =
		bundle === 'newsletter'
			? [...new Set(senders.filter(Boolean))].join(', ')
			: threads
					.map((thread, index) => [senders[index], receiptAmount(thread)].filter(Boolean).join(' '))
					.filter(Boolean)
					.join(' · ')
	return {
		title: bundle === 'newsletter' ? 'Newsletters' : 'Receipts',
		count: threads.length,
		line,
		unread: threads.some((thread) => thread.unread),
	}
}
