import type { Draft, EmailParticipant, Message, SendMessageRequest, Thread } from '@nylas-labs/cli-kit/v3'

/**
 * The local mock mailbox's mail: every conversation the reading-experience
 * design boards show (reader, thread list, phone, long threads, message
 * anatomy and edge cases), with times relative to now so the boards read the
 * same on any day. Header values live here too; the dev mailbox serves them
 * like a provider would, through `include_headers` and raw MIME.
 */

export const GRANT_ID = 'dev-grant'
export const MAILBOX_NAME = 'Ada Lovelace'
export const MAILBOX_EMAIL = 'ada@ownmail.com'
export const ACCOUNT = { name: MAILBOX_NAME, email: MAILBOX_EMAIL }

export type StoredThread = Thread & { folders: string[]; message_ids: string[] }
/** `send_at` and `schedule_id` are the provider's scheduled send of an outgoing message. */
export type StoredMessage = Message & { thread_id: string }
export type StoredDraft = Draft & { id: string; outbound_attachments?: SendMessageRequest['attachments'] }
export type MockHeader = { name: string; value: string }

const GRACE = { name: 'Grace Hopper', email: 'grace.hopper@vercel.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine.johnson@vercel.com' }
const MARY = { name: 'Mary Jackson', email: 'mjackson@vercel.com' }
const PM_LEADS = { email: 'pm-leads@vercel.com' }
const ENG_ALL = { email: 'eng-all@vercel.com' }
const VOYAGE = { name: 'Voyage', email: 'trips@voyage.com' }
const MERIDIAN = { name: 'Meridian Bank', email: 'statements@meridianbank.com' }
const DENTIST = { name: 'Bright Smile Dental', email: 'hello@brightsmile.com' }
const MAILER_DAEMON = { name: 'Mail Delivery Subsystem', email: 'mailer-daemon@ownmail.com' }
const LEGAL = { name: 'Legal', email: 'legal@northwind.com' }

/** Senders who write from another time zone than the reader, in minutes from UTC. */
export const senderUtcOffsets = new Map<string, number>([[ALAN.email, -7 * 60]])

export function daysAgo(dayCount: number, hour: number, minute: number): number {
	const date = new Date()
	date.setDate(date.getDate() - dayCount)
	date.setHours(hour, minute, 0, 0)
	return Math.floor(date.getTime() / 1000)
}

/** How many days back the given weekday (0 = Sunday) last fell, at least `minimum` days before today. */
export function daysBackTo(weekday: number, minimum: number): number {
	const back = (new Date().getDay() - weekday + 7) % 7
	return back < minimum ? back + 7 : back
}

/** The next given weekday (0 = Sunday) after today, at a local time. */
export function upcoming(weekday: number, hour: number, minute: number): number {
	const date = new Date()
	date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7 || 7))
	date.setHours(hour, minute, 0, 0)
	return Math.floor(date.getTime() / 1000)
}

function hoursAgo(hours: number): number {
	return Math.floor(Date.now() / 1000) - hours * 3600
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

const MB = 1024 * 1024

type MessageSeed = Omit<
	StoredMessage,
	'grant_id' | 'thread_id' | 'folders' | 'unread' | 'body' | 'from' | 'to'
> & {
	body: string
	from: EmailParticipant[]
	to: EmailParticipant[]
	folders?: string[]
	unread?: boolean
}

type SeededThread = { thread: StoredThread; messages: StoredMessage[] }

function participantKey(participant: EmailParticipant): string {
	return participant.email.toLowerCase()
}

/** Everyone on a thread's messages, in order of first appearance. */
function participantsOf(messages: MessageSeed[]): EmailParticipant[] {
	const seen = new Map<string, EmailParticipant>()
	for (const message of messages) {
		for (const participant of [...message.from, ...message.to, ...(message.cc ?? [])]) {
			if (!seen.has(participantKey(participant))) seen.set(participantKey(participant), participant)
		}
	}
	return [...seen.values()]
}

/** A thread and its messages, with the thread fields a provider derives from them. */
function seedThread(
	id: string,
	folders: string[],
	seeds: MessageSeed[],
	extra: Partial<StoredThread> = {},
): SeededThread {
	const messages = seeds.map((seed): StoredMessage & MessageSeed => ({
		grant_id: GRANT_ID,
		thread_id: id,
		unread: false,
		starred: false,
		folders,
		...seed,
		snippet: seed.snippet ?? stripHtml(seed.body).slice(0, 140),
	}))
	const byDate = [...messages].sort((a, b) => (a.date as number) - (b.date as number))
	const latest = byDate[byDate.length - 1] as StoredMessage
	const fromAccount = (message: StoredMessage) => message.from?.[0]?.email === MAILBOX_EMAIL
	const received = byDate.filter((message) => !fromAccount(message)).at(-1)?.date
	const sent = byDate.filter(fromAccount).at(-1)?.date
	return {
		messages,
		thread: {
			id,
			grant_id: GRANT_ID,
			subject: byDate[0]?.subject,
			snippet: latest.snippet,
			participants: participantsOf(byDate),
			message_ids: messages.map((message) => message.id),
			earliest_message_date: byDate[0]?.date,
			...(received !== undefined ? { latest_message_received_date: received } : {}),
			...(sent !== undefined ? { latest_message_sent_date: sent } : {}),
			has_attachments: messages.some((message) =>
				(message.attachments ?? []).some((attachment) => !attachment.is_inline),
			),
			unread: messages.some((message) => message.unread),
			starred: messages.some((message) => message.starred),
			folders,
			...extra,
		},
	}
}

function pdf(id: string, filename: string, size: number) {
	return { id, filename, content_type: 'application/pdf', size }
}

const html = (...paragraphs: string[]) => paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')

/** "Tue, Oct 13, 2026 at 6:02 PM", the attribution line above a quoted reply. */
function quoteDate(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000)
	const day = date.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
	const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
	return `${day} at ${time}`
}

function quoted(author: EmailParticipant, date: number, inner: string): string {
	return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On ${quoteDate(date)} ${author.name} &lt;${author.email}&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${inner}</blockquote></div>`
}

// ---- 01 Reader / 03 Phone / 04 Long threads: the 14-message roadmap thread ----

const ROADMAP_FIRST_SUBJECT = 'Q3 roadmap'
const ROADMAP_SUBJECT = 'Q3 product roadmap: final review before Friday'
const roadmapTeam = { to: [ACCOUNT, ALAN, KATHERINE], cc: [PM_LEADS] }
/**
 * The roadmap was last read on a Tuesday, as the boards say ("3 new since
 * Tuesday", "replaces v3 from Tue"), so its dates hang off the most recent
 * Tuesday at least two days back: Alan's reply the Wednesday after is then
 * always in the past, before today's v4 and Mary's question.
 */
const ROADMAP_TUESDAY = daysBackTo(2, 2)
const roadmapDay = (offset: number, hour: number, minute: number) =>
	daysAgo(ROADMAP_TUESDAY - offset, hour, minute)
const roadmapDates = {
	v1: roadmapDay(-15, 9, 14),
	m2: roadmapDay(-14, 11, 3),
	notes: roadmapDay(-13, 15, 40),
	m4: roadmapDay(-12, 10, 22),
	png: roadmapDay(-10, 16, 5),
	v2: roadmapDay(-7, 9, 48),
	m7: roadmapDay(-6, 13, 15),
	m8: roadmapDay(-5, 17, 2),
	m9: roadmapDay(-3, 12, 30),
	v3: roadmapDay(0, 18, 2),
	m11: roadmapDay(0, 19, 24),
	m12: roadmapDay(1, 16, 12),
	v4: daysAgo(0, 9, 30),
	m14: daysAgo(0, 9, 41),
}
const ROADMAP_V3_TEXT =
	'Here is v3. I tightened the intro and moved billing to its own section. Please flag anything before Friday.'
const ROADMAP_M9_TEXT =
	'Engineering signed off on the sync date in the planning doc. I’ll review v3 as soon as it lands.'

const roadmap = seedThread(
	'thread-roadmap',
	['inbox', 'work'],
	[
		{
			id: 'msg-roadmap-1',
			subject: ROADMAP_FIRST_SUBJECT,
			body: html(
				'Kicking off the Q3 roadmap review. Draft v1 is attached; please mark up anything you’d cut.',
				'Grace',
			),
			from: [GRACE],
			...roadmapTeam,
			date: roadmapDates.v1,
			attachments: [pdf('att-roadmap-v1', 'Q3-roadmap-v1.pdf', Math.round(1.6 * MB))],
		},
		{
			id: 'msg-roadmap-2',
			subject: `Re: ${ROADMAP_FIRST_SUBJECT}`,
			body: html(
				'Read it. The calendar sync section needs a real date, and I’d question whether search belongs in the headline goals.',
			),
			from: [ALAN],
			to: [GRACE, ACCOUNT, KATHERINE],
			cc: [PM_LEADS],
			date: roadmapDates.m2,
		},
		{
			id: 'msg-roadmap-3',
			subject: `Re: ${ROADMAP_FIRST_SUBJECT}`,
			body: html(
				'My notes from the planning session are attached. Billing is the open question for me.',
				'Ada',
			),
			from: [ACCOUNT],
			to: [GRACE, ALAN, KATHERINE],
			cc: [PM_LEADS],
			date: roadmapDates.notes,
			attachments: [
				{
					id: 'att-roadmap-notes',
					filename: 'planning-notes.docx',
					content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					size: 86_000,
				},
			],
		},
		{
			id: 'msg-roadmap-4',
			subject: `Re: ${ROADMAP_FIRST_SUBJECT}`,
			body: html(
				'Design can support everything in v1 except the billing settings page. That needs two more weeks.',
			),
			from: [KATHERINE],
			to: [GRACE, ALAN, ACCOUNT],
			cc: [PM_LEADS],
			date: roadmapDates.m4,
		},
		{
			id: 'msg-roadmap-5',
			subject: `Re: ${ROADMAP_FIRST_SUBJECT}`,
			body: html('Here is the sync flow as it stands. The conflict step is the risky part.'),
			from: [ALAN],
			to: [GRACE, ACCOUNT, KATHERINE],
			cc: [PM_LEADS],
			date: roadmapDates.png,
			attachments: [
				{
					id: 'att-roadmap-sync-flow',
					filename: 'sync-flow.png',
					content_type: 'image/png',
					size: Math.round(1.4 * MB),
				},
			],
		},
		{
			id: 'msg-roadmap-6',
			subject: ROADMAP_SUBJECT,
			body: html(
				'v2 attached. I folded in Katherine’s design estimate and the billing notes from the planning session.',
				'Grace',
			),
			from: [GRACE],
			...roadmapTeam,
			date: roadmapDates.v2,
			attachments: [pdf('att-roadmap-v2', 'Q3-roadmap-v2.pdf', Math.round(1.8 * MB))],
		},
		{
			id: 'msg-roadmap-7',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: html('Thanks. I’d keep billing as a stretch goal until legal has looked at the terms.', 'Ada'),
			from: [ACCOUNT],
			to: [GRACE, ALAN, KATHERINE],
			cc: [PM_LEADS],
			date: roadmapDates.m7,
		},
		{
			id: 'msg-roadmap-8',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: html('Agreed. I’ll pull the onboarding funnel numbers so we can size the Q4 carry-over.'),
			from: [KATHERINE],
			to: [GRACE, ALAN, ACCOUNT],
			cc: [PM_LEADS],
			date: roadmapDates.m8,
		},
		{
			id: 'msg-roadmap-9',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: html(ROADMAP_M9_TEXT),
			from: [ALAN],
			to: [GRACE, ACCOUNT, KATHERINE],
			cc: [PM_LEADS],
			date: roadmapDates.m9,
		},
		{
			id: 'msg-roadmap-10',
			subject: ROADMAP_SUBJECT,
			body: html(ROADMAP_V3_TEXT, 'Grace'),
			from: [GRACE],
			...roadmapTeam,
			date: roadmapDates.v3,
			attachments: [pdf('att-roadmap-v3', 'Q3-roadmap-v3.pdf', Math.round(1.9 * MB))],
		},
		{
			id: 'msg-roadmap-11',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: html('Numbers on the onboarding funnel look right to me. One question on the Q4 carry-over.'),
			from: [KATHERINE],
			to: [GRACE, ALAN, ACCOUNT],
			cc: [PM_LEADS],
			date: roadmapDates.m11,
			attachments: [
				{
					id: 'att-roadmap-funnel',
					filename: 'onboarding-funnel.xlsx',
					content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					size: 312_000,
				},
			],
		},
		{
			id: 'msg-roadmap-12',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: `<div dir="ltr">${html(
				'Grace, I went through v3 line by line. Two things before we lock it:',
				'First, the calendar sync milestone is listed as “late Q3” but engineering committed to September 30 in the planning doc. If we keep it vague here we will relitigate it in the review.',
				'Second, I’d move the search rebuild below the fold. It matters, but nobody outside the team will feel it this quarter.',
				'Otherwise this is ready. Nice work pulling it together.',
			)}<div class="gmail_signature">Alan Turing<br>Principal Engineer, Bletchley<br>alan@bletchley.dev<br>+44 20 7946 0958</div></div>${quoted(
				GRACE,
				roadmapDates.v3,
				`${html(ROADMAP_V3_TEXT, 'Grace')}${quoted(ALAN, roadmapDates.m9, html(ROADMAP_M9_TEXT))}`,
			)}`,
			snippet:
				'Grace, I went through v3 line by line. Two things before we lock it: First, the calendar sync milestone is listed as “late Q3”',
			from: [ALAN],
			to: [ACCOUNT, GRACE],
			cc: [KATHERINE, PM_LEADS],
			date: roadmapDates.m12,
			unread: true,
		},
		{
			id: 'msg-roadmap-13',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: html(
				'Thanks Alan, both done. v4 is attached: calendar sync now reads <strong>September 30</strong>, search moved to “Also this quarter”.',
				'Mary, adding you for the launch dates. The only open item is whether billing ships in Q3 or Q4.',
			),
			from: [GRACE],
			to: [ALAN, ACCOUNT, KATHERINE],
			cc: [PM_LEADS, MARY],
			date: roadmapDates.v4,
			unread: true,
			attachments: [pdf('att-roadmap-v4', 'Q3-roadmap-v4.pdf', Math.round(2.1 * MB))],
		},
		{
			id: 'msg-roadmap-14',
			subject: `Re: ${ROADMAP_SUBJECT}`,
			body: html(
				'Billing can make Q3 if legal signs off by the 20th. Ada, can you confirm that date with them?',
			),
			snippet: 'Ada, can you confirm that date with legal?',
			from: [MARY],
			to: [GRACE, ALAN, ACCOUNT, KATHERINE],
			cc: [PM_LEADS],
			date: roadmapDates.m14,
			unread: true,
		},
	],
	{ subject: ROADMAP_SUBJECT },
)

// ---- 02 Thread list -----------------------------------------------------------

/** The superseded invite: four versions of one event, each a REQUEST with a higher SEQUENCE. */
export const DESIGN_REVIEW_UID = 'design-review@ownmail.dev'
export const designReviewVersions = [
	{
		messageId: 'msg-calendar-invite-v1',
		attachmentId: 'att-calendar-invite-v1',
		hoursEarlier: 3,
		date: daysAgo(3, 10, 0),
	},
	{
		messageId: 'msg-calendar-invite-v2',
		attachmentId: 'att-calendar-invite-v2',
		hoursEarlier: 2,
		date: daysAgo(2, 11, 20),
	},
	{
		messageId: 'msg-calendar-invite-v3',
		attachmentId: 'att-calendar-invite-v3',
		hoursEarlier: 1,
		date: daysAgo(1, 9, 5),
	},
	{
		messageId: 'msg-calendar-invite',
		attachmentId: 'att-calendar-invite',
		hoursEarlier: 0,
		date: daysAgo(0, 8, 52),
	},
]

const invite = seedThread(
	'thread-calendar-invite',
	['inbox', 'work'],
	designReviewVersions.map((version, index) => ({
		id: version.messageId,
		subject:
			index === 0 ? 'Design review: token migration' : 'Updated invitation: Design review: token migration',
		body: html(
			index === 0
				? 'Katherine Johnson invited you to Design review: token migration.'
				: 'Katherine Johnson updated the time of Design review: token migration.',
		),
		from: [KATHERINE],
		// Grace is an attendee of the event, not a recipient of Katherine's mail.
		to: [ACCOUNT],
		date: version.date,
		unread: index === designReviewVersions.length - 1,
		attachments: [
			{
				id: version.attachmentId,
				filename: 'invite.ics',
				content_type: 'text/calendar; charset="UTF-8"; method=REQUEST',
				size: 512,
			},
		],
	})),
	{ subject: 'Design review: token migration' },
)

const hiking = seedThread(
	'thread-hiking',
	['inbox', 'personal'],
	[
		{
			id: 'msg-hiking-1',
			subject: 'Weekend hiking plans?',
			snippet:
				'Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning. Weather looks perfect.',
			body: "<p>Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning. Weather looks perfect.</p><p>Want to join? We'd start around 8 to beat the crowds. I can drive.</p>",
			from: [ALAN],
			to: [ACCOUNT],
			date: daysAgo(1, 11, 45),
		},
		{
			id: 'msg-hiking-2',
			subject: 'Re: Weekend hiking plans?',
			body: html('Saturday works, I’ll bring the map.', 'Ada'),
			snippet: 'Saturday works, I’ll bring the map.',
			from: [ACCOUNT],
			to: [ALAN],
			date: daysAgo(0, 7, 30),
			folders: ['sent', 'personal'],
		},
	],
)

const DENTIST_DATE = daysAgo(0, 6, 58)
const dentist = seedThread(
	'thread-dentist',
	['inbox', 'personal'],
	[
		{
			id: 'msg-dentist-1',
			subject: 'Reminder: appointment Thursday 2:30 PM',
			snippet:
				'This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:30 PM.',
			body: html(
				'This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:30 PM.',
				'Reply to reschedule, or arrive 10 minutes early to update your paperwork.',
			),
			from: [DENTIST],
			to: [ACCOUNT],
			date: DENTIST_DATE,
		},
	],
)

const STATEMENT_QUESTION_DATE = daysAgo(1, 17, 12)
const failedSend = seedThread(
	'thread-failed-send',
	['inbox', 'finance'],
	[
		{
			id: 'msg-failed-send-1',
			subject: 'Question about the June statement',
			body: html(
				'Hi, my June statement shows a $45.00 fee I don’t recognise. Could you tell me what it is for?',
				'Thanks,<br>Ada Lovelace',
			),
			from: [ACCOUNT],
			to: [{ name: 'Meridian Bank', email: 'support@meridianbank.com' }],
			date: STATEMENT_QUESTION_DATE,
			folders: ['sent', 'finance'],
		},
		{
			id: 'msg-failed-send-bounce',
			subject: 'Undeliverable: Question about the June statement',
			body: html(
				'Your message to support@meridianbank.com couldn’t be delivered.',
				'The address wasn’t found at meridianbank.com. Check the address for typos and try again.',
			),
			from: [MAILER_DAEMON],
			to: [ACCOUNT],
			date: daysAgo(1, 17, 14),
		},
	],
)

const offsite = seedThread(
	'thread-offsite',
	['inbox', 'work'],
	[
		{
			id: 'msg-offsite-1',
			subject: 'Q3 offsite agenda',
			body: html(
				'Here is a first pass at the offsite agenda. Day one is planning, day two is the team dinner and a hike.',
				'Edit freely, and tell me by Monday if anything is missing.',
				'Grace',
			),
			from: [GRACE],
			to: [ACCOUNT, ALAN, KATHERINE],
			date: daysAgo(1, 11, 20),
		},
		{
			id: 'msg-offsite-scheduled',
			subject: 'Re: Q3 offsite agenda',
			body: html(
				'Thanks for pulling this together. A couple of notes on day one: planning should start after lunch, and we need a room for the billing breakout.',
				'Ada',
			),
			from: [ACCOUNT],
			to: [GRACE],
			date: daysAgo(1, 15, 5),
			send_at: upcoming(1, 9, 0),
			schedule_id: 'schedule-offsite-agenda',
			folders: ['sent', 'work'],
		},
	],
)

const ENGINEERS = [
	'Dev Patel',
	'Lena Fischer',
	'Omar Haddad',
	'Priya Raman',
	'Tomas Silva',
	'Hana Sato',
	'Jonas Berg',
	'Amara Okafor',
	'Felix Wagner',
	'Sofia Rossi',
	'Kwame Mensah',
	'Ines Duarte',
	'Yuki Tanaka',
	'Marta Nowak',
	'Ravi Kumar',
	'Elena Petrova',
	'Noah Kim',
	'Aisha Bello',
	'Lucas Martin',
	'Freya Lund',
	'Mateo Garcia',
	'Zara Ahmed',
	'Ben Carter',
	'Chloe Dubois',
	'Arjun Mehta',
	'Nina Kowalski',
	'Sam Okoye',
	'Ivy Chen',
	'Leo Novak',
].map((name) => ({ name, email: `${name.toLowerCase().replace(' ', '.')}@vercel.com` }))

const STAGING_REPLIES = [
	'Staging is returning 502s again. Did anyone deploy after 8?',
	'Not me. My last deploy was yesterday afternoon.',
	'Seeing the same. The health check on api-2 is red.',
	'api-2 ran out of disk. Logs filled it overnight.',
	'Can we rotate logs on staging like we do in production?',
	'I’ll add logrotate to the staging image today.',
	'Freed 40 GB. api-2 is back.',
	'Still seeing 502s on the billing routes.',
	'That one is mine. Migration was half applied; rolling forward now.',
	'Billing routes look healthy from here.',
	'Can we post in #staging before running migrations?',
	'Agreed. I’ll write it up in the runbook.',
	'Staging is green. Thanks, everyone.',
]

const staging = seedThread(
	'thread-staging',
	['inbox', 'work'],
	STAGING_REPLIES.map((text, index) => ({
		id: `msg-staging-${index + 1}`,
		subject: 'Re: Who broke staging? (again)',
		body: html(text),
		from: [ENGINEERS[index] as EmailParticipant],
		to: [ENG_ALL],
		date: daysAgo(1, 9, 2) + Math.round((index * (5 * 3600 + 8 * 60)) / (STAGING_REPLIES.length - 1)),
		unread: index > 0,
	})),
	// The list delivered this conversation, so everyone on it is a participant.
	{ participants: [ENG_ALL, ...ENGINEERS, ACCOUNT] },
)

// ---- Bundles: newsletters and receipts (the newest rows of "This week") -------

// A real-world HTML newsletter: table layout, a fixed 600px width, inline styles,
// remote image, and several links — exercises the HTML renderer (shadow-DOM CSS
// scoping, links-open-in-new-tab + hover preview, auto-dark, and shrink-to-fit on
// narrow screens). Deliberately ships no dark-mode styles so auto-dark kicks in.
const NEWSLETTER_BODY = `
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;background:#ffffff;color:#1f2937">
	<tr><td style="background:#4f46e5;padding:28px 32px">
		<span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px">The&nbsp;Dispatch</span>
		<span style="color:#c7d2fe;font-size:13px;float:right;padding-top:6px">Issue #48 · Weekly</span>
	</td></tr>
	<tr><td style="padding:0">
		<img src="https://picsum.photos/600/220" width="600" alt="A desk with a laptop and coffee" style="display:block;width:600px;height:auto" />
	</td></tr>
	<tr><td style="padding:32px 32px 8px">
		<h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;color:#111827">Calendar sync is here — and it’s fast</h1>
		<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151">This week we shipped two-way calendar sync across Google, Microsoft, and iCloud. Events you create in ownmail now land in your provider within seconds, and vice versa. Here’s everything new.</p>
		<a href="https://ownmail.example.com/blog/calendar-sync" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">Read the announcement →</a>
	</td></tr>
	<tr><td style="padding:24px 32px">
		<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px" />
		<h2 style="margin:0 0 8px;font-size:17px;color:#111827">Three tips for shipping faster</h2>
		<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#374151">Small changes, reviewed and deployed the same day, beat big-bang releases. Our team’s favorite habits, distilled.</p>
		<p style="margin:0 0 24px"><a href="https://ownmail.example.com/blog/shipping-tips" style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px">Keep reading →</a></p>
		<h2 style="margin:0 0 8px;font-size:17px;color:#111827">What we learned rebuilding search</h2>
		<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#374151">Rebuilding full-text search on top of a new index cut p95 latency by 60%. The tradeoffs, and what we’d do differently.</p>
		<p style="margin:0"><a href="https://ownmail.example.com/blog/search-rebuild" style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px">Read the deep dive →</a></p>
	</td></tr>
	<tr><td style="background:#f9fafb;padding:24px 32px;text-align:center">
		<p style="margin:0 0 8px;font-size:13px;color:#6b7280">You’re receiving this because you subscribed to The Dispatch.</p>
		<p style="margin:0;font-size:13px;color:#6b7280"><a href="https://ownmail.example.com/unsubscribe" style="color:#6b7280;text-decoration:underline">Unsubscribe</a> · <a href="https://ownmail.example.com/preferences" style="color:#6b7280;text-decoration:underline">Manage preferences</a></p>
	</td></tr>
</table>`

// Designed mail with a fixed 640px layout: wider than the reading column, so the
// reader fits it to width and says so.
const FIGMA_BODY = `
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;min-width:640px;margin:0 auto;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;background:#ffffff;color:#1e1e1e">
	<tr><td style="padding:32px 40px;background:#1e1e1e;color:#ffffff;font-size:22px;font-weight:700">Config is coming</td></tr>
	<tr><td style="padding:32px 40px">
		<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Join us for two days of talks on design systems, prototyping and the craft of building products together.</p>
		<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px">
			<tr>
				<td width="270" style="width:270px;padding:16px;background:#f5f5f5;font-size:14px;line-height:1.5"><strong>Day one</strong><br>Keynote, Dev Mode deep dives, and variables in practice.</td>
				<td width="20" style="width:20px"></td>
				<td width="270" style="width:270px;padding:16px;background:#f5f5f5;font-size:14px;line-height:1.5"><strong>Day two</strong><br>Design systems at scale, accessibility, and community sessions.</td>
			</tr>
		</table>
		<p style="margin:24px 0 0"><a href="https://www.figma.com/config" style="display:inline-block;background:#0d99ff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:6px">Get your ticket</a></p>
	</td></tr>
	<tr><td style="padding:24px 40px;font-size:12px;color:#6b6b6b">You’re receiving this because you have a Figma account. <a href="https://www.figma.com/email/unsubscribe" style="color:#6b6b6b">Unsubscribe</a></td></tr>
</table>`

const dispatch = seedThread(
	'thread-newsletter',
	['inbox'],
	[
		{
			id: 'msg-newsletter-1',
			subject: 'The Dispatch — your weekly product digest',
			snippet:
				'This week: the new calendar sync, three shipping tips, and what we learned rebuilding search.',
			body: NEWSLETTER_BODY,
			from: [{ name: 'The Dispatch', email: 'digest@dispatch.email' }],
			to: [ACCOUNT],
			date: daysAgo(2, 17, 45),
		},
	],
)

const lenny = seedThread(
	'thread-lenny',
	['inbox'],
	[
		{
			id: 'msg-lenny-1',
			subject: 'How the best product teams run planning',
			body: html(
				'This week: what I learned from 30 planning docs, and the one question every roadmap should answer.',
				'<a href="https://www.lennysnewsletter.com/p/planning">Read the full post</a>',
				'You’re receiving this because you subscribed. <a href="https://www.lennysnewsletter.com/unsubscribe">Unsubscribe</a>',
			),
			from: [{ name: 'Lenny’s', email: 'newsletter@lennysnewsletter.com' }],
			to: [ACCOUNT],
			date: daysAgo(3, 7, 0),
			// Unread, so the Newsletters bundle reads as unread (semibold), as board 02 draws it;
			// the inbox still counts the board's 6 unread conversations.
			unread: true,
		},
	],
)

const stratechery = seedThread(
	'thread-stratechery',
	['inbox'],
	[
		{
			id: 'msg-stratechery-1',
			subject: 'The aggregator’s dilemma',
			body: html(
				'Good morning. Today’s update looks at why platforms keep rebuilding the products they once aggregated.',
				'<a href="https://stratechery.com/2026/the-aggregators-dilemma">Continue reading</a>',
				'<a href="https://stratechery.com/unsubscribe">Unsubscribe</a>',
			),
			from: [{ name: 'Stratechery', email: 'newsletter@stratechery.com' }],
			to: [ACCOUNT],
			date: daysAgo(4, 6, 30),
		},
	],
)

const figma = seedThread(
	'thread-figma',
	['inbox'],
	[
		{
			id: 'msg-figma-1',
			subject: 'Config is coming: two days of design and code',
			snippet:
				'Join us for two days of talks on design systems, prototyping and the craft of building products together.',
			body: FIGMA_BODY,
			from: [{ name: 'Figma', email: 'news@figma.com' }],
			to: [ACCOUNT],
			date: daysAgo(5, 8, 15),
		},
	],
)

const invoice = seedThread(
	'thread-invoice',
	['inbox', 'finance'],
	[
		{
			id: 'msg-invoice-1',
			subject: 'Invoice #2041 has been paid',
			snippet: 'You received a payment of $4,200.00 from Northwind Studio.',
			body: '<p>You received a payment of $4,200.00 from Northwind Studio.</p><p>Invoice #2041 is now marked as paid. Funds will settle to your account within 2 business days.</p><p>A PDF receipt is attached for your records.</p>',
			from: [{ name: 'Stripe', email: 'receipts@stripe.com' }],
			to: [ACCOUNT],
			date: daysAgo(2, 16, 18),
			attachments: [pdf('att-invoice-receipt', 'invoice-2041.pdf', 184_000)],
		},
	],
)

const voyageReceipt = seedThread(
	'thread-voyage-receipt',
	['inbox', 'travel'],
	[
		{
			id: 'msg-voyage-receipt-1',
			subject: 'Your Voyage receipt',
			body: html(
				'Payment of $612.40 received for booking VYG-40192.',
				'Flight TP 1351 and two nights at Praça Boutique. Keep this receipt for your records.',
			),
			from: [{ name: 'Voyage', email: 'receipts@voyage.com' }],
			to: [ACCOUNT],
			date: daysAgo(3, 6, 10),
		},
	],
)

const appleReceipt = seedThread(
	'thread-apple-receipt',
	['inbox', 'finance'],
	[
		{
			id: 'msg-apple-receipt-1',
			subject: 'Your receipt from Apple',
			body: html(
				'iCloud+ with 50 GB of storage: $2.99 per month.',
				'Billed to Visa ending in 4242. Order ID MQ2J8K3L.',
			),
			from: [{ name: 'Apple', email: 'no_reply@email.apple.com' }],
			to: [ACCOUNT],
			date: daysAgo(5, 5, 40),
		},
	],
)

// ---- The rest of the week -------------------------------------------------------

const tokens = seedThread(
	'thread-tokens',
	['inbox', 'work'],
	[
		{
			id: 'msg-tokens-1',
			subject: 'Design system: new component tokens',
			snippet:
				'The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.',
			body: '<p>The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.</p><p>Nothing you need to do today — existing components will pick up the changes automatically on the next release.</p>',
			from: [KATHERINE],
			to: [ACCOUNT],
			date: daysAgo(3, 14, 0),
		},
	],
)

/** Seven remote images from voyage.com, each with a declared size and alt text. */
const VOYAGE_IMAGES = [
	{ src: 'logo.png', alt: 'Voyage', width: 120, height: 32 },
	{ src: 'lisbon-skyline.jpg', alt: 'Lisbon skyline', width: 600, height: 220 },
	{ src: 'boarding-pass-qr.png', alt: 'Boarding pass QR', width: 160, height: 160 },
	{ src: 'seat-map.png', alt: 'Seat map, row 14', width: 280, height: 120 },
	{ src: 'hotel.jpg', alt: 'Praça Boutique hotel', width: 280, height: 160 },
	{ src: 'alfama-map.png', alt: 'Map of Alfama', width: 280, height: 160 },
	{ src: 'app-badge.png', alt: 'Get the Voyage app', width: 140, height: 42 },
]
const voyageImage = (index: number) => {
	const image = VOYAGE_IMAGES[index] as (typeof VOYAGE_IMAGES)[number]
	return `<img src="https://voyage.com/email/${image.src}" width="${image.width}" height="${image.height}" alt="${image.alt}" style="display:block;width:${image.width}px;height:${image.height}px">`
}
const FLIGHT_DATE = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-US', {
	month: 'short',
	day: 'numeric',
})
const ITINERARY_SNIPPET = `Flight TP 1351 · ${FLIGHT_DATE}, 6:40 AM · Seat 14A`

const travel = seedThread(
	'thread-travel',
	['inbox', 'travel'],
	[
		{
			id: 'msg-travel-1',
			subject: 'Your itinerary for Lisbon is confirmed',
			snippet: ITINERARY_SNIPPET,
			body: `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:#1f2937">
	<tr><td style="padding:24px 0">${voyageImage(0)}</td></tr>
	<tr><td>${voyageImage(1)}</td></tr>
	<tr><td style="padding:24px 0"><h1 style="margin:0 0 8px;font-size:24px">Your trip is booked!</h1><p style="margin:0;font-size:15px;line-height:1.6">${ITINERARY_SNIPPET}. Hotel: Praça Boutique, check-in from 3:00 PM. Confirmation #VYG-40192.</p></td></tr>
	<tr><td style="padding:0 0 24px">${voyageImage(2)}</td></tr>
	<tr><td style="padding:0 0 24px">${voyageImage(3)}</td></tr>
	<tr><td style="padding:0 0 24px">${voyageImage(4)}</td></tr>
	<tr><td style="padding:0 0 24px">${voyageImage(5)}</td></tr>
	<tr><td style="padding:0 0 24px"><p style="margin:0 0 12px;font-size:14px">We'll send a reminder 24 hours before departure with your gate information.</p>${voyageImage(6)}</td></tr>
</table>`,
			from: [VOYAGE],
			to: [ACCOUNT],
			date: daysAgo(4, 7, 5),
		},
	],
)

const statement = seedThread(
	'thread-statement',
	['inbox', 'finance'],
	[
		{
			id: 'msg-statement-1',
			subject: 'Your monthly statement is ready',
			snippet: 'Your statement for June is now available. Sign in to view your transactions and balances.',
			body: "<p>Your statement for June is now available. Sign in to view your transactions and balances.</p><p>As always, we'll never ask for your password by email.</p>",
			from: [MERIDIAN],
			to: [ACCOUNT],
			date: daysAgo(3, 6, 0),
		},
	],
)

const welcome = seedThread(
	'thread-welcome',
	['inbox'],
	[
		{
			id: 'msg-welcome-1',
			subject: 'Welcome to ownmail',
			snippet: 'Welcome aboard! ownmail brings your mail and your calendar into one calm, fast workspace.',
			body: '<p>Welcome aboard! ownmail brings your mail and your calendar into one calm, fast workspace.</p><p>Press C to compose, or jump to your calendar from the rail on the left. Everything you need is a keystroke away.</p><p>Happy sending,<br>The ownmail team</p>',
			from: [{ name: 'The ownmail team', email: 'team@ownmail.com' }],
			to: [ACCOUNT],
			date: daysAgo(4, 9, 0),
		},
	],
)

// ---- 05 Message anatomy and 06 Edge cases --------------------------------------

const emptyBody = seedThread(
	'thread-empty-body',
	['inbox', 'work'],
	[
		{
			id: 'msg-empty-body-1',
			subject: 'Signed contract',
			body: '',
			snippet: '',
			from: [GRACE],
			to: [ACCOUNT],
			date: daysAgo(5, 9, 30),
			attachments: [pdf('att-contract-signed', 'contract-signed.pdf', 236_000)],
		},
	],
)

const noSubject = seedThread(
	'thread-no-subject',
	['inbox', 'travel'],
	[
		{
			id: 'msg-no-subject-1',
			subject: '',
			body: html(
				'Can you send me the Lisbon hotel confirmation? Finance needs it for the travel report by Friday.',
				'Katherine',
			),
			from: [KATHERINE],
			to: [ACCOUNT],
			date: daysAgo(4, 8, 15),
		},
	],
)

const billingLaunch = seedThread(
	'thread-billing-launch',
	['inbox', 'work'],
	[
		{
			id: 'msg-billing-1',
			subject: 'Billing launch: legal sign-off',
			body: html(
				'Ada, can you check with legal whether the 20th works for the billing launch? I need a yes or no before I lock the launch plan.',
				'Mary',
			),
			from: [MARY],
			to: [ACCOUNT],
			date: daysAgo(4, 10, 20),
		},
		{
			id: 'msg-billing-2',
			subject: 'Re: Billing launch: legal sign-off',
			body: html('Checking with legal now. I’ll confirm by tomorrow.', 'Ada'),
			from: [ACCOUNT],
			// An old address, by itself: Mary's name stays with mjackson@vercel.com, so the
			// reader's lookalike check never mistakes her real messages for an impostor's.
			to: [{ email: 'mary@nasa.gov' }],
			date: daysAgo(4, 10, 41),
			folders: ['sent', 'work'],
		},
		{
			id: 'msg-billing-bounce',
			subject: 'Delivery Status Notification (Failure)',
			body: html(
				'Your message to mary@nasa.gov couldn’t be delivered.',
				'The recipient’s mailbox is no longer active.',
			),
			from: [MAILER_DAEMON],
			to: [ACCOUNT],
			date: daysAgo(4, 10, 42),
		},
	],
)

const OFFSITE_VENUES = 'Offsite venue shortlist'
const venues = seedThread(
	'thread-offsite-venues',
	['inbox', 'work'],
	[
		{
			id: 'msg-venues-1',
			subject: OFFSITE_VENUES,
			body: html(
				'Three options for the offsite: the boathouse in Sausalito, the lodge in Mill Valley, or the loft in the Mission.',
				'All three hold 20 people and are free on the 12th.',
			),
			from: [KATHERINE],
			to: [ACCOUNT, ALAN, GRACE],
			date: daysAgo(5, 10, 0),
		},
		{
			id: 'msg-venues-2',
			subject: `Re: ${OFFSITE_VENUES}`,
			body: html('The lodge, if it has a projector. The boathouse is lovely but loud.'),
			from: [ALAN],
			to: [KATHERINE, ACCOUNT, GRACE],
			date: daysAgo(5, 10, 40),
		},
		{
			id: 'msg-venues-3',
			subject: `Re: ${OFFSITE_VENUES}`,
			body: html('Lodge works for me. I can check the projector.'),
			from: [GRACE],
			to: [KATHERINE, ACCOUNT, ALAN],
			date: daysAgo(5, 11, 5),
			folders: ['trash'],
		},
		{
			id: 'msg-venues-4',
			subject: `Re: ${OFFSITE_VENUES}`,
			body: html('Lodge it is. I’ll book it today.', 'Ada'),
			from: [ACCOUNT],
			to: [KATHERINE, ALAN, GRACE],
			date: daysAgo(5, 12, 10),
			folders: ['sent', 'work'],
		},
	],
)

/** Alan forked the venue conversation with Grace: same subject, fewer people, started later. */
const venuesSide = seedThread(
	'thread-offsite-venues-side',
	['inbox', 'work'],
	[
		{
			id: 'msg-venues-side-1',
			subject: `Re: ${OFFSITE_VENUES}`,
			body: html('Grace, can you and I sort out the projector and the shuttle without the whole group?'),
			from: [ALAN],
			to: [GRACE],
			cc: [ACCOUNT],
			date: daysAgo(5, 13, 0),
		},
	],
)

const MSA_SECTIONS: Array<[string, string[]]> = [
	[
		'Scope',
		[
			'This Master Services Agreement (the “Agreement”) governs the design, engineering and advisory services that Northwind Studio (the “Provider”) performs for Ada Lovelace (the “Client”) under any statement of work that refers to it. Each statement of work describes the deliverables, the schedule, the people assigned and the fees for one engagement. Where a statement of work conflicts with this Agreement, this Agreement controls unless the statement of work names the clause it overrides and both parties sign it.',
			'The Provider will perform the services with reasonable skill and care, in line with generally accepted industry practice, and with people who have the experience the work requires. The Provider may use subcontractors only with the Client’s written approval, and remains responsible for their work as if it were its own. The Client will give the Provider timely access to the information, systems and decisions the services depend on, and the schedule moves day for day with any delay the Client causes.',
			'Changes to the scope of an engagement are made only through a written change order that states the effect on fees and schedule. Either party may propose a change order; neither is bound until both sign it. Work performed outside an agreed scope without a change order is at the Provider’s own risk and is not billable.',
			'The Provider will name a lead for each engagement who is responsible for day-to-day delivery and is the Client’s first point of contact. The lead will hold a weekly review with the Client’s project contact to walk through progress against the statement of work, open risks, decisions the Client needs to make and any change the Provider expects to propose. Either party may ask for a written summary of a review, and the Provider will send one within two business days. Replacing the lead requires ten days’ notice and a handover that the Client reasonably approves.',
		],
	],
	[
		'Payment',
		[
			'The Client will pay the fees set out in each statement of work. Unless a statement of work says otherwise, the Provider invoices monthly in arrears for time and materials, and on acceptance of each milestone for fixed-fee work. Invoices are due within thirty days of receipt. Amounts disputed in good faith may be withheld while the parties resolve the dispute, provided the Client pays the undisputed portion on time and explains the dispute in writing within ten days.',
			'Late payments accrue interest at one percent per month or the highest rate the law allows, whichever is lower, from the due date until paid. The Provider may suspend work on ten days’ written notice if an undisputed invoice remains unpaid for more than forty-five days, and the schedule extends by the length of any suspension. Fees exclude taxes; the Client pays any sales, use or value added tax that applies, other than taxes on the Provider’s income.',
			'Reasonable travel and out-of-pocket expenses are reimbursed at cost when the Client approves them in advance and the Provider submits receipts. The Provider will not mark up expenses, subcontractor fees or third-party licences unless the statement of work expressly allows it.',
			'Each invoice will list the statement of work it relates to, the period or milestone it covers, the hours worked by each person for time and materials work, and any approved expenses with their receipts attached. The Client may ask for reasonable supporting detail, and the Provider will answer within five business days. Invoices sent more than ninety days after the work they cover are payable only if the Client agrees, so that budgets can close on time. Payment is made by bank transfer to the account named on the invoice.',
		],
	],
	[
		'Term',
		[
			'This Agreement starts on the date of the last signature and continues for two years. It then renews for successive one-year terms unless either party gives notice of non-renewal at least sixty days before the end of the current term. Expiry or termination of this Agreement does not end a statement of work already in progress; this Agreement continues to govern that statement of work until it is complete or terminated.',
			'Either party may terminate this Agreement or any statement of work for convenience on thirty days’ written notice. Either party may terminate immediately if the other materially breaches this Agreement and fails to cure the breach within fifteen days of written notice describing it, or if the other becomes insolvent, makes an assignment for the benefit of creditors or has a receiver appointed.',
			'On termination, the Client pays for services performed and expenses incurred up to the effective date, and the Provider delivers all work in progress in its current state. Clauses that by their nature should survive termination, including confidentiality, ownership, payment obligations already accrued, limitation of liability and notices, survive it.',
			'When this Agreement or a statement of work ends for any reason, each party will return or destroy the other’s confidential information within thirty days and confirm in writing that it has done so, except for copies kept in routine backups or required by law, which stay confidential for as long as they are kept. The Provider will also give reasonable transition help for up to thirty days at its then-current rates, so that the Client or a replacement provider can continue the work without interruption.',
		],
	],
	[
		'Liability',
		[
			'Each party indemnifies the other against third-party claims arising from its gross negligence, wilful misconduct or breach of confidentiality, and the Provider indemnifies the Client against claims that the deliverables infringe a third party’s intellectual property rights. The indemnified party must give prompt notice of the claim, allow the indemnifying party to control the defence and settlement, and cooperate reasonably at the indemnifying party’s expense.',
			'A note on the redline: the indemnity clause in section 4 still caps liability at the fees paid in the twelve months before the claim, and that cap applies to the intellectual property indemnity as well. We asked for that indemnity to be uncapped, or capped at three times the annual fees, and the current draft does neither. Please confirm whether you are comfortable accepting the cap as written before we send the signature copy.',
			'Except for the indemnities, breach of confidentiality and the Client’s obligation to pay fees, neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue or data, even if it was told such damages were possible. Each party’s total liability under this Agreement is limited to the fees paid or payable in the twelve months before the event giving rise to the claim.',
			'The Provider maintains commercial general liability, professional liability and cyber liability insurance with limits of at least two million dollars per claim for the duration of this Agreement and for one year after it ends, and will provide certificates of insurance on request.',
			'Nothing in this section limits liability that cannot be limited by law, including liability for death or personal injury caused by negligence or for fraud. The caps apply in aggregate across all claims under this Agreement and every statement of work, not per claim or per engagement, and amounts paid under an indemnity count toward them. If a deliverable is found to infringe, the Provider may, at its option and expense, obtain the right for the Client to keep using it, modify it so it no longer infringes, or replace it with an equivalent.',
		],
	],
	[
		'Notices',
		[
			'Notices under this Agreement must be in writing and are effective when delivered by hand, one business day after they are sent by a recognised overnight courier, or when sent by email with confirmation of receipt. Notices to the Client go to the address in the signature block, with a copy by email; notices to the Provider go to its legal department at the address on its most recent invoice.',
			'Either party may change its notice address by giving notice under this section. Routine operational communication, including status reports, invoices and change order proposals, may be sent by ordinary email to the project contacts named in each statement of work and is not a formal notice.',
			'This Agreement is governed by the laws of the State of California, without regard to its conflict of laws rules, and the parties submit to the exclusive jurisdiction of the state and federal courts in San Francisco County. This Agreement, together with its statements of work, is the entire agreement between the parties on its subject and replaces all earlier proposals and understandings.',
			'Neither party may assign this Agreement without the other’s written consent, except to a successor to all or substantially all of its business that agrees in writing to be bound by it. Any amendment or waiver must be in writing and signed by both parties; a failure to enforce a right is not a waiver of it. If a court finds any clause unenforceable, the rest of this Agreement continues in effect. This Agreement may be signed in counterparts and by electronic signature, and each signed copy is an original.',
		],
	],
]

const msa = seedThread(
	'thread-msa',
	['inbox', 'work'],
	[
		{
			id: 'msg-msa-1',
			subject: 'Northwind MSA: full text for review',
			body: `${html(
				'Hi Ada, the full text of the master services agreement is below so you can read it without opening the attachment. Our open question is in the Liability section; everything else matches what we agreed on the call last week.',
			)}${MSA_SECTIONS.map(([heading, paragraphs]) => `<h2>${heading}</h2>${html(...paragraphs)}`).join('')}${html(
				'Best,<br>Northwind Legal',
			)}`,
			from: [LEGAL],
			to: [ACCOUNT],
			date: daysAgo(6, 11, 0),
		},
	],
)

/** Plain text, hard-wrapped at 72 columns, with a right-to-left paragraph and a code line. */
const releaseNotes = seedThread(
	'thread-release',
	['inbox', 'work'],
	[
		{
			id: 'msg-release-1',
			subject: 'Release 3.2 is out',
			body: [
				'The release went out at 6 and the rollback plan is in the doc. Ping me',
				'if staging looks off tonight.',
				'',
				'شكراً، سأراجع المستند صباح الغد.',
				'',
				'    git checkout release/3.2',
			].join('\n'),
			snippet:
				'The release went out at 6 and the rollback plan is in the doc. Ping me if staging looks off tonight.',
			from: [ALAN],
			to: [ACCOUNT, GRACE],
			date: daysAgo(4, 21, 12),
		},
	],
)

const FIRST_NAMES = [
	'Alex',
	'Bea',
	'Cole',
	'Dana',
	'Eli',
	'Fay',
	'Gus',
	'Hugo',
	'Iris',
	'Jade',
	'Kai',
	'Lia',
	'Max',
	'Nia',
	'Otto',
	'Pia',
	'Quinn',
	'Rosa',
	'Seth',
	'Tara',
]
const LAST_NAMES = [
	'Abe',
	'Bose',
	'Cruz',
	'Diaz',
	'Endo',
	'Ford',
	'Gray',
	'Hale',
	'Ito',
	'Jain',
	'Khan',
	'Lowe',
]
/** Everyone on eng-all who was copied by name: 238 people besides the list itself. */
const ENG_ALL_COPIED = FIRST_NAMES.flatMap((first) =>
	LAST_NAMES.map((last) => ({
		name: `${first} ${last}`,
		email: `${first}.${last}@vercel.com`.toLowerCase(),
	})),
).slice(0, 238)

const freeze = seedThread(
	'thread-staging-freeze',
	['inbox', 'work'],
	[
		{
			id: 'msg-freeze-1',
			subject: 'Staging freeze starts Friday',
			body: html(
				'Heads up: staging is frozen from Friday at 6 PM until the 3.2 release is verified on Monday.',
				'If you need an exception, reply to me directly, not to the list.',
				'Alan',
			),
			from: [ALAN],
			to: [ENG_ALL],
			cc: ENG_ALL_COPIED,
			date: daysAgo(4, 16, 0),
			unread: true,
		},
	],
)

const lookalike = seedThread(
	'thread-lookalike',
	['inbox', 'finance'],
	[
		{
			id: 'msg-lookalike-1',
			subject: 'Action required: confirm your account details',
			body: html(
				'We noticed unusual activity on your account. To avoid a hold on your card, confirm your details within 24 hours.',
				'<a href="https://meridian-secure.co/verify">Confirm my details</a>',
				'Meridian Bank Security',
			),
			from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }],
			to: [ACCOUNT],
			date: daysAgo(4, 7, 40),
			unread: true,
		},
	],
)

const replyTo = seedThread(
	'thread-reply-to',
	['inbox', 'personal'],
	[
		{
			id: 'msg-reply-to-1',
			subject: 'Dinner on Saturday?',
			body: html(
				'We’re doing dinner at ours on Saturday at 7. Can you make it? Reply to my personal address, I’m off work email this weekend.',
				'Grace',
			),
			from: [GRACE],
			to: [ACCOUNT],
			reply_to: [{ email: 'grace.personal@fastmail.com' }],
			date: daysAgo(5, 18, 30),
		},
	],
)

const removed = seedThread(
	'thread-removed',
	['inbox', 'work'],
	[
		{
			id: 'msg-removed-1',
			subject: 'Token migration: who owns the docs?',
			body: html(
				'Who should own the token migration docs: design systems or platform? I can draft them either way.',
				'Katherine',
			),
			from: [KATHERINE],
			to: [ALAN, GRACE, ACCOUNT],
			date: daysAgo(6, 10, 0),
		},
		{
			id: 'msg-removed-2',
			subject: 'Re: Token migration: who owns the docs?',
			body: html(
				'Taking this to a smaller group for now. Grace, Ada: I think platform should own them, with design reviewing.',
				'Alan',
			),
			from: [ALAN],
			to: [ACCOUNT, GRACE],
			date: daysAgo(6, 11, 30),
		},
	],
)

const CHECKLIST_ITEMS = [
	'Release notes drafted',
	'Pricing page reviewed',
	'Support macros updated',
	'Status page template ready',
	'Billing emails proofread',
	'Help centre articles linked',
	'Sales deck refreshed',
	'Changelog entry merged',
	'Onboarding checklist updated',
	'Analytics events verified',
	'Rollback steps rehearsed',
	'Launch tweet scheduled',
]
const checklistSenders = [GRACE, ALAN, KATHERINE, ACCOUNT]
/** Two of the fourteen messages fail to load, so the reader shows the twelve it has. */
export const UNAVAILABLE_MESSAGE_IDS = ['msg-checklist-unavailable-1', 'msg-checklist-unavailable-2']
const checklistMessages = CHECKLIST_ITEMS.map(
	(item, index): MessageSeed => ({
		id: `msg-checklist-${index + 1}`,
		subject: index === 0 ? 'Launch checklist' : 'Re: Launch checklist',
		body: html(`Done: ${item}.`),
		from: [checklistSenders[index % checklistSenders.length] as EmailParticipant],
		to: [GRACE, ALAN, KATHERINE, ACCOUNT].filter((person) => person !== checklistSenders[index % 4]),
		date: daysAgo(6, 9, 0) + index * 1800,
	}),
)
const checklistSeed = seedThread('thread-launch-checklist', ['inbox', 'work'], checklistMessages)
const checklist: SeededThread = {
	messages: checklistSeed.messages,
	thread: {
		...checklistSeed.thread,
		message_ids: [
			...checklistSeed.thread.message_ids.slice(0, 5),
			UNAVAILABLE_MESSAGE_IDS[0] as string,
			...checklistSeed.thread.message_ids.slice(5, 9),
			UNAVAILABLE_MESSAGE_IDS[1] as string,
			...checklistSeed.thread.message_ids.slice(9),
		],
	},
}

/**
 * A thread longer than the reader mounts at once (over 50 messages), in
 * Archive so it stays off the boards' inbox: the stream is windowed while the
 * map and j / k still reach every message.
 */
export const INCIDENT_LOG_LENGTH = 64
const incidentSenders = [ALAN, GRACE, KATHERINE, ACCOUNT]
const incidentLog = seedThread(
	'thread-incident-log',
	['archive', 'work'],
	Array.from(
		{ length: INCIDENT_LOG_LENGTH },
		(_, index): MessageSeed => ({
			id: `msg-incident-${index + 1}`,
			subject: index === 0 ? 'Incident log: search latency' : 'Re: Incident log: search latency',
			body: html(
				`Update ${index + 1}: p95 search latency is ${180 + ((index * 37) % 140)} ms on the new index.`,
			),
			from: [incidentSenders[index % incidentSenders.length] as EmailParticipant],
			to: [ALAN, GRACE, KATHERINE, ACCOUNT].filter(
				(person) => person !== incidentSenders[index % incidentSenders.length],
			),
			date: daysAgo(20, 9, 0) + index * 3 * 3600,
		}),
	),
)

// ---- Sent ---------------------------------------------------------------------

const contract = seedThread(
	'thread-contract',
	['sent', 'work'],
	[
		{
			id: 'msg-contract-1',
			subject: 'Re: Contract draft',
			snippet: 'Attached is the countersigned draft. Let me know if anything else is needed on my end.',
			body: '<p>Attached is the countersigned draft. Let me know if anything else is needed on my end.</p><p>Ada</p>',
			from: [ACCOUNT],
			to: [LEGAL],
			date: daysAgo(1, 17, 10),
			attachments: [pdf('att-contract-draft', 'contract-draft.pdf', 420_000)],
		},
	],
)

const sync = seedThread(
	'thread-sync',
	['sent', 'work'],
	[
		{
			id: 'msg-sync-1',
			subject: "Notes from today's sync",
			snippet: 'Quick recap of what we agreed on today, with owners and dates. Shout if I missed anything.',
			body: '<p>Quick recap of what we agreed on today, with owners and dates. Shout if I missed anything.</p>',
			from: [ACCOUNT],
			to: [{ name: 'Team', email: 'team@vercel.com' }],
			date: daysAgo(2, 18, 0),
		},
	],
)

const seeded: SeededThread[] = [
	roadmap,
	invite,
	hiking,
	dentist,
	failedSend,
	offsite,
	staging,
	dispatch,
	invoice,
	lenny,
	voyageReceipt,
	tokens,
	statement,
	stratechery,
	figma,
	appleReceipt,
	travel,
	welcome,
	emptyBody,
	noSubject,
	billingLaunch,
	venues,
	venuesSide,
	msa,
	releaseNotes,
	freeze,
	lookalike,
	replyTo,
	removed,
	checklist,
	incidentLog,
	contract,
	sync,
]

export const seedMessages: StoredMessage[] = seeded.flatMap((entry) => entry.messages)
export const seedThreads: StoredThread[] = seeded.map((entry) => entry.thread)

export const seedDrafts: StoredDraft[] = [
	{
		id: 'draft-launch-copy',
		grant_id: GRANT_ID,
		subject: 'Thoughts on the offsite agenda',
		snippet: 'Here are a few ideas for the offsite —',
		body: 'Here are a few ideas for the offsite —',
		to: [GRACE],
		date: daysAgo(0, 12, 0),
		folders: ['drafts'],
	},
	{
		id: 'draft-dentist-reply',
		grant_id: GRANT_ID,
		thread_id: 'thread-dentist',
		reply_to_message_id: 'msg-dentist-1',
		subject: 'Re: Reminder: appointment Thursday 2:30 PM',
		snippet: 'Could we move this to Friday morning instead? I have a design review on Thursday afternoon.',
		body: '<p>Could we move this to Friday morning instead? I have a design review on Thursday afternoon.</p><p>Ada</p>',
		from: [ACCOUNT],
		to: [DENTIST],
		date: DENTIST_DATE,
		folders: ['drafts'],
	},
	{
		id: 'draft-billing-reply',
		grant_id: GRANT_ID,
		thread_id: 'thread-billing-launch',
		reply_to_message_id: 'msg-billing-1',
		subject: 'Re: Billing launch: legal sign-off',
		snippet: 'Legal said the 20th is fine as long as the terms page ships the same week.',
		body: '<p>Legal said the 20th is fine as long as the terms page ships the same week. I’ll send their written confirmation tomorrow.</p>',
		from: [ACCOUNT],
		to: [MARY],
		date: hoursAgo(2),
		folders: ['drafts'],
	},
]

const AUTH_PASS = (domain: string) =>
	`mx.ownmail.com; dkim=pass header.d=${domain}; spf=pass smtp.mailfrom=${domain}; dmarc=pass (p=quarantine) header.from=${domain}`

/** Headers that differ from what a plain, authenticated message carries. */
export const headerOverrides = new Map<string, MockHeader[]>([
	[
		'msg-lookalike-1',
		[
			{
				name: 'Authentication-Results',
				value:
					'mx.ownmail.com; dkim=none; spf=softfail smtp.mailfrom=meridian-secure.co; dmarc=fail (p=none) header.from=meridian-secure.co',
			},
		],
	],
	['msg-reply-to-1', [{ name: 'Reply-To', value: 'Grace Hopper <grace.personal@fastmail.com>' }]],
	...[...staging.messages, ...freeze.messages].map((message): [string, MockHeader[]] => [
		message.id,
		[
			{ name: 'List-Id', value: 'Engineering <eng-all.vercel.com>' },
			{ name: 'List-Unsubscribe', value: '<mailto:eng-all+unsubscribe@vercel.com?subject=unsubscribe>' },
		],
	]),
	...(
		[
			['msg-newsletter-1', 'https://ownmail.example.com/unsubscribe', 'leave@dispatch.email'],
			['msg-lenny-1', 'https://www.lennysnewsletter.com/unsubscribe', 'leave@lennysnewsletter.com'],
			['msg-stratechery-1', 'https://stratechery.com/unsubscribe', 'leave@stratechery.com'],
			['msg-figma-1', 'https://www.figma.com/email/unsubscribe', 'unsubscribe@figma.com'],
		] as const
	).map(([id, url, mailto]): [string, MockHeader[]] => [
		id,
		[
			{ name: 'List-Unsubscribe', value: `<${url}>, <mailto:${mailto}>` },
			{ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
		],
	]),
])

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An RFC 5322 Date header for an instant as seen at a UTC offset. */
export function rfc5322Date(epochSeconds: number, offsetMinutes: number): string {
	const shifted = new Date((epochSeconds + offsetMinutes * 60) * 1000)
	const pad = (value: number) => String(value).padStart(2, '0')
	const sign = offsetMinutes < 0 ? '-' : '+'
	const absolute = Math.abs(offsetMinutes)
	return `${WEEKDAYS[shifted.getUTCDay()]}, ${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} ${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
}

function addressList(participants: EmailParticipant[] | undefined): string {
	return (participants ?? [])
		.map((participant) =>
			participant.name ? `"${participant.name}" <${participant.email}>` : participant.email,
		)
		.join(', ')
}

/** The headers a provider would return for a mock message with `include_headers`. */
export function mockMessageHeaders(message: Message): MockHeader[] {
	const sender = message.from?.[0]
	const date = message.date ?? 0
	const offset = senderUtcOffsets.get(sender?.email ?? '') ?? -new Date(date * 1000).getTimezoneOffset()
	const overrides = headerOverrides.get(message.id) ?? []
	const overridden = new Set(overrides.map((header) => header.name.toLowerCase()))
	const domain = sender?.email.split('@')[1] ?? ''
	const received = sender && sender.email !== MAILBOX_EMAIL
	const base: MockHeader[] = [
		// The receiving hop comes first, and its authserv-id is what makes the result below trusted.
		...(received
			? [
					{
						name: 'Received',
						value: `from mail.${domain} by mx.ownmail.com with ESMTPS id ${message.id}; ${rfc5322Date(date, 0)}`,
					},
					{ name: 'Authentication-Results', value: AUTH_PASS(domain) },
				]
			: []),
		{ name: 'From', value: addressList(message.from) },
		{ name: 'To', value: addressList(message.to) },
		...(message.cc?.length ? [{ name: 'Cc', value: addressList(message.cc) }] : []),
		{ name: 'Subject', value: message.subject ?? '' },
		{ name: 'Date', value: rfc5322Date(date, offset) },
		{ name: 'Message-ID', value: `<${message.id}@mock.ownmail.dev>` },
		{ name: 'MIME-Version', value: '1.0' },
	]
	return [...base.filter((header) => !overridden.has(header.name.toLowerCase())), ...overrides]
}
