import { describe, expect, it } from 'vitest'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import {
	BUNDLE_MIN,
	bundleSummary,
	foldedBundleOf,
	inviteWhenLabel,
	isDraftLatest,
	isListAddress,
	ownerFromMailbox,
	pendingSendAt,
	rowDateLabel,
	rowTimeLabel,
	sendAtLabel,
	type ThreadListEnv,
	type ThreadRowFacts,
	threadListItems,
	threadRowFacts,
	threadRowLabel,
	unreadSummary,
	wantsUnreadSummary,
} from './thread-list-model.js'

/** Thursday 15 October 2026, noon UTC. */
const NOW = Date.UTC(2026, 9, 15, 12, 0) / 1000
const at = (dayOffset: number, hour: number, minute = 0) =>
	Date.UTC(2026, 9, 15 + dayOffset, hour, minute) / 1000
const TZ = 'UTC'

const ADA = { name: 'Ada Lovelace', email: 'ada@ownmail.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const MARY = { name: 'Mary Jackson', email: 'mary@vercel.com' }

const env = (over: Partial<ThreadListEnv> = {}): ThreadListEnv => ({
	owner: ADA.email,
	ownerFirstName: 'Ada',
	now: NOW,
	tz: TZ,
	mutedIds: new Set(),
	grouped: true,
	...over,
})

const message = (over: Partial<MailMessage> & { id: string }): MailMessage =>
	({
		from: [GRACE],
		to: [ADA],
		subject: 'Subject',
		snippet: 'snippet',
		date: at(0, 9),
		...over,
	}) as MailMessage

const thread = (over: Partial<MailThread> & { id: string }): MailThread =>
	({
		subject: 'Subject',
		snippet: 'snippet',
		participants: [GRACE, ADA],
		message_ids: ['m1'],
		latest_message_received_date: at(0, 9),
		...over,
	}) as MailThread

describe('rowTimeLabel', () => {
	it('is empty without a usable time', () => {
		expect(rowTimeLabel(undefined, NOW, TZ)).toBe('')
		expect(rowTimeLabel(0, NOW, TZ)).toBe('')
		expect(rowTimeLabel(Number.POSITIVE_INFINITY, NOW, TZ)).toBe('')
	})

	it('gives the time in Today and Yesterday, where the heading carries the day', () => {
		expect(rowTimeLabel(at(0, 9, 41), NOW, TZ)).toMatch(/^9:41\sAM$/)
		expect(rowTimeLabel(at(-1, 17, 14), NOW, TZ)).toMatch(/^5:14\sPM$/)
	})

	it('gives the weekday in This week and the date before it', () => {
		expect(rowTimeLabel(at(-3, 8), NOW, TZ)).toBe('Mon')
		expect(rowTimeLabel(at(-20, 8), NOW, TZ)).toBe('Sep 25')
		expect(rowTimeLabel(at(-365, 8), NOW * 1000, TZ)).toBe('Oct 15, 2025')
	})

	it('reads an unknown zone as UTC', () => {
		expect(rowTimeLabel(at(0, 9, 41), NOW, 'Not/AZone')).toMatch(/^9:41\sAM$/)
		// The answer is remembered, and stays the same.
		expect(rowTimeLabel(at(0, 9, 41), NOW, 'Not/AZone')).toMatch(/^9:41\sAM$/)
	})
})

describe('rowDateLabel', () => {
	it('carries the day where no heading does: the time today, the weekday this past week, else the date', () => {
		expect(rowDateLabel(undefined, NOW, TZ)).toBe('')
		expect(rowDateLabel(at(0, 9, 41), NOW, TZ)).toMatch(/^9:41\sAM$/)
		expect(rowDateLabel(at(-1, 17, 14), NOW, TZ)).toBe('Wed')
		expect(rowDateLabel(at(-6, 8), NOW, TZ)).toBe('Fri')
		expect(rowDateLabel(at(-7, 8), NOW, TZ)).toBe('Oct 8')
		// A time ahead of the clock reads as a date, never as a weekday.
		expect(rowDateLabel(at(2, 8), NOW, TZ)).toBe('Oct 17')
	})
})

describe('sendAtLabel', () => {
	it('names today, a weekday in the week ahead, or the date', () => {
		expect(sendAtLabel(at(0, 15), NOW, TZ)).toMatch(/^Sends today 3:00\sPM$/)
		expect(sendAtLabel(at(4, 9), NOW, TZ)).toMatch(/^Sends Mon 9:00\sAM$/)
		expect(sendAtLabel(at(10, 9), NOW, TZ)).toMatch(/^Sends Oct 25, 9:00\sAM$/)
		expect(sendAtLabel(at(-1, 9), NOW, TZ)).toMatch(/^Sends Oct 14, 9:00\sAM$/)
	})
})

describe('inviteWhenLabel', () => {
	it('shares the half of the day once when both ends are in it', () => {
		expect(inviteWhenLabel({ kind: 'timed', start: at(7, 14), end: at(7, 14, 45) }, TZ)).toMatch(
			/^Thu, Oct 22 · 2:00–2:45\sPM$/,
		)
	})

	it('names both halves of the day when the event crosses noon', () => {
		expect(inviteWhenLabel({ kind: 'timed', start: at(7, 11, 30), end: at(7, 12, 15) }, TZ)).toMatch(
			/^Thu, Oct 22 · 11:30\sAM–12:15\sPM$/,
		)
	})

	it('says All day for a date-only event, whatever the zone', () => {
		expect(
			inviteWhenLabel(
				{ kind: 'all-day', startDate: '2026-10-22', endDate: '2026-10-23' },
				'Pacific/Kiritimati',
			),
		).toBe('Thu, Oct 22 · All day')
	})
})

describe('ownerFromMailbox', () => {
	it('knows nobody until the mailbox does', () => {
		expect(ownerFromMailbox(undefined)).toEqual({ owner: '', ownerFirstName: '' })
		expect(ownerFromMailbox({ email: ' ' })).toEqual({ owner: '', ownerFirstName: '' })
	})

	it('takes the first name from the display name, else the address', () => {
		expect(ownerFromMailbox({ email: 'ada@ownmail.com', displayName: 'Ada Lovelace' })).toEqual({
			owner: 'ada@ownmail.com',
			ownerFirstName: 'Ada',
		})
		expect(ownerFromMailbox({ email: 'ada@ownmail.com' }).ownerFirstName).toBe('ada')
	})
})

describe('isListAddress', () => {
	it('recognises -all, -list and all@ addresses only', () => {
		expect(isListAddress('eng-all@vercel.com')).toBe(true)
		expect(isListAddress('Team-List@vercel.com')).toBe(true)
		expect(isListAddress('all@vercel.com')).toBe(true)
		expect(isListAddress('alice@vercel.com')).toBe(false)
		expect(isListAddress('install@vercel.com')).toBe(false)
		expect(isListAddress(undefined)).toBe(false)
	})
})

describe('isDraftLatest', () => {
	it('is false without a newest item or when it is a message', () => {
		expect(isDraftLatest(thread({ id: 't' }))).toBe(false)
		expect(isDraftLatest(thread({ id: 't', latest_draft_or_message: message({ id: 'm' }) }))).toBe(false)
		expect(
			isDraftLatest(thread({ id: 't', latest_draft_or_message: message({ id: 'm', folders: ['inbox'] }) })),
		).toBe(false)
	})

	it('recognises a draft by any of the marks providers and OwnMail put on it', () => {
		const draft = (over: Partial<MailMessage>, extra: object = {}) =>
			isDraftLatest({
				...thread({ id: 't', latest_draft_or_message: message({ id: 'd', ...over }) }),
				...extra,
			})
		expect(draft({ ownmailDraft: true })).toBe(true)
		expect(draft({ object: 'draft' } as Partial<MailMessage>)).toBe(true)
		expect(draft({}, { draft_ids: ['d'] })).toBe(true)
		expect(draft({ folders: ['drafts'] })).toBe(true)
	})
})

describe('pendingSendAt', () => {
	it('is a send time still ahead, or nothing', () => {
		expect(pendingSendAt(undefined, NOW)).toBeUndefined()
		expect(pendingSendAt(message({ id: 'm' }), NOW)).toBeUndefined()
		expect(pendingSendAt({ ...message({ id: 'm' }), send_at: 'soon' } as MailMessage, NOW)).toBeUndefined()
		expect(pendingSendAt({ ...message({ id: 'm' }), send_at: at(-1, 9) } as MailMessage, NOW)).toBeUndefined()
		expect(pendingSendAt({ ...message({ id: 'm' }), send_at: at(4, 9) } as MailMessage, NOW * 1000)).toBe(
			at(4, 9),
		)
	})
})

describe('threadRowFacts', () => {
	it('names a draft by its recipient and shows the draft, not the conversation', () => {
		const draft = threadRowFacts(
			thread({
				id: 't',
				subject: 'Reminder',
				snippet: 'their text',
				unread: true,
				latest_draft_or_message: message({
					id: 'd',
					ownmailDraft: true,
					to: [{ name: 'Bright Smile Dental', email: 'hello@brightsmile.com' }],
					subject: 'Re: Reminder',
					snippet: 'Could we move this?',
				}),
			}),
			env(),
		)
		expect(draft).toEqual({
			state: 'draft',
			who: { kind: 'draft', to: 'Bright Smile Dental' },
			subject: 'Re: Reminder',
			snippet: 'Could we move this?',
			unread: false,
			asksYou: false,
		})
		const bare = threadRowFacts(
			thread({
				id: 't',
				subject: 'Reminder',
				snippet: 'their text',
				latest_draft_or_message: message({
					id: 'd',
					ownmailDraft: true,
					to: undefined,
					subject: '',
					snippet: undefined,
				}),
			}),
			env(),
		)
		expect(bare).toMatchObject({
			who: { kind: 'draft', to: '(no recipient)' },
			subject: 'Reminder',
			snippet: 'their text',
		})
	})

	it('says how many replies a muted list conversation spares you', () => {
		const people = [
			{ email: 'eng-all@vercel.com' },
			...Array.from({ length: 29 }, (_, i) => ({ name: `E${i}`, email: `e${i}@x.com` })),
			ADA,
		]
		const muted = threadRowFacts(
			thread({
				id: 'staging',
				unread: true,
				participants: people,
				message_ids: Array.from({ length: 13 }, (_, i) => `m${i}`),
				latest_draft_or_message: message({ id: 'm12', to: [{ email: 'eng-all@vercel.com' }] }),
			}),
			env({ mutedIds: new Set(['staging']) }),
		)
		expect(muted).toMatchObject({
			state: 'muted',
			who: { kind: 'list', list: 'eng-all@', people: 31 },
			snippet: 'Muted · 12 replies you don’t need to read',
			unread: false,
		})
		const one = threadRowFacts(
			thread({ id: 'one', message_ids: ['a', 'b'], participants: [{ email: 'team-list@x.com' }, ADA] }),
			env({ mutedIds: new Set(['one']) }),
		)
		expect(one).toMatchObject({
			who: { kind: 'list', list: 'team-list@', people: 2 },
			snippet: 'Muted · 1 reply you don’t need to read',
		})
	})

	it('names the people of a muted conversation that is not a list', () => {
		const muted = threadRowFacts(
			thread({
				id: 'q',
				participants: undefined,
				message_ids: undefined,
				latest_draft_or_message: message({ id: 'm', from: [GRACE], to: [ADA] }),
			}),
			env({ mutedIds: new Set(['q']) }),
		)
		expect(muted).toMatchObject({ who: { kind: 'people', names: 'Grace Hopper', more: 0 }, snippet: 'Muted' })
	})

	it('says a send failed when the newest message is a bounce of the owner’s mail', () => {
		const bounce = message({
			id: 'b',
			from: [{ name: 'Mail Delivery Subsystem', email: 'mailer-daemon@ownmail.com' }],
		})
		const failed = threadRowFacts(
			thread({
				id: 'f',
				subject: 'Question about the June statement',
				participants: [
					ADA,
					{ name: 'Meridian Bank', email: 'support@meridianbank.com' },
					bounce.from?.[0] as never,
				],
				latest_message_sent_date: at(-1, 17, 12),
				latest_draft_or_message: bounce,
			}),
			env(),
		)
		expect(failed).toMatchObject({
			state: 'failed',
			who: { kind: 'to', name: 'Meridian Bank' },
			subject: 'Question about the June statement',
			snippet: 'Not sent. The address bounced.',
		})
		const nobody = threadRowFacts(
			thread({
				id: 'f',
				participants: [ADA],
				latest_message_sent_date: at(-1, 17),
				latest_draft_or_message: bounce,
			}),
			env(),
		)
		expect(nobody.who).toEqual({ kind: 'to', name: 'Unknown recipient' })
		// A bounce report on a conversation the owner never wrote to is just a message.
		const received = threadRowFacts(thread({ id: 'f', latest_draft_or_message: bounce }), env())
		expect(received.state).toBe('normal')
	})

	it('says when a scheduled send goes out, and to whom', () => {
		const scheduled = threadRowFacts(
			thread({
				id: 's',
				subject: 'Q3 offsite agenda',
				participants: [GRACE, ADA],
				latest_draft_or_message: {
					...message({ id: 's2', from: [ADA], to: [GRACE], subject: 'Re: Q3 offsite agenda' }),
					send_at: at(4, 9),
				} as MailMessage,
			}),
			env(),
		)
		expect(scheduled).toMatchObject({
			state: 'scheduled',
			who: { kind: 'to', name: 'Grace Hopper' },
			subject: 'Re: Q3 offsite agenda',
			sendAt: at(4, 9),
		})
		const bare = threadRowFacts(
			thread({
				id: 's',
				subject: 'Agenda',
				latest_draft_or_message: {
					...message({ id: 's2', to: undefined, subject: '' }),
					send_at: at(4, 9),
				} as MailMessage,
			}),
			env(),
		)
		expect(bare).toMatchObject({ who: { kind: 'to', name: '(no recipient)' }, subject: 'Agenda' })
	})

	it('reads a group conversation: who wrote last, what is new, whether it asks you, its newest file', () => {
		const messages = [
			message({
				id: 'v4',
				from: [GRACE],
				attachments: [
					{ id: 'a4', filename: 'Q3-roadmap-v4.pdf', size: 2_000_000, content_type: 'application/pdf' },
				] as never,
				unread: true,
				date: at(0, 9, 30),
			}),
			message({
				id: 'm14',
				from: [MARY],
				to: [GRACE, ALAN, ADA],
				body: '<p>Ada, can you confirm that date with legal?</p>',
				unread: true,
				date: at(0, 9, 41),
			}),
		]
		const roadmap = thread({
			id: 'roadmap',
			unread: true,
			subject: 'Q3 product roadmap',
			snippet: 'Ada, can you confirm that date with legal?',
			participants: [
				GRACE,
				ADA,
				ALAN,
				{ name: 'Katherine Johnson', email: 'kj@vercel.com' },
				{ email: 'pm-leads@vercel.com' },
				MARY,
			],
			message_ids: Array.from({ length: 14 }, (_, i) => `m${i}`),
			latest_draft_or_message: messages[1],
		})
		const summary = unreadSummary([message({ id: 'old', unread: false }), ...messages], ADA.email)
		expect(summary).toEqual({ unreadCount: 2, newestFile: 'Q3-roadmap-v4.pdf' })
		expect(threadRowFacts(roadmap, env(), summary)).toEqual({
			state: 'normal',
			who: { kind: 'people', names: 'Mary, Grace, Alan, you', more: 1 },
			subject: 'Q3 product roadmap',
			snippetFrom: 'Mary',
			snippet: 'Ada, can you confirm that date with legal?',
			unread: true,
			newCount: 2,
			asksYou: true,
			file: 'Q3-roadmap-v4.pdf',
		})
		// Without its summary the row knows nothing new and no file, and still sees the question.
		expect(threadRowFacts(roadmap, env())).toMatchObject({ asksYou: true })
		expect(threadRowFacts(roadmap, env())).not.toHaveProperty('newCount')
		expect(threadRowFacts(roadmap, env())).not.toHaveProperty('file')
		// Without knowing who "you" are, nothing asks you.
		expect(threadRowFacts(roadmap, env({ owner: '', ownerFirstName: '' })).asksYou).toBe(false)
	})

	it('counts nothing new on a read thread, a single message, or when every listed message is read', () => {
		const read = unreadSummary(
			[message({ id: 'a', unread: false }), message({ id: 'b', unread: false })],
			ADA.email,
		)
		expect(read).toEqual({ unreadCount: 0 })
		expect(
			threadRowFacts(thread({ id: 't', unread: false, message_ids: ['a', 'b'] }), env(), { unreadCount: 2 }),
		).not.toHaveProperty('newCount')
		expect(
			threadRowFacts(thread({ id: 't', unread: true, message_ids: ['a'] }), env(), { unreadCount: 1 }),
		).not.toHaveProperty('newCount')
		expect(
			threadRowFacts(thread({ id: 't', unread: true, message_ids: ['a', 'b'] }), env(), read),
		).not.toHaveProperty('newCount')
		// A summary without a file names none, even when the newest message has one it cannot count.
		expect(
			threadRowFacts(
				thread({
					id: 't',
					unread: true,
					message_ids: ['a', 'b'],
					latest_draft_or_message: message({
						id: 'b',
						attachments: [{ id: 'x', filename: 'x.pdf', content_type: 'application/pdf', size: 1 }] as never,
					}),
				}),
				env(),
				read,
			).file,
		).toBeUndefined()
	})

	it('marks a reply the owner wrote last as "you"', () => {
		const facts = threadRowFacts(
			thread({
				id: 'h',
				participants: [ALAN, ADA],
				snippet: 'Saturday works, I’ll bring the map.',
				latest_draft_or_message: message({ id: 'h2', from: [ADA], to: [ALAN] }),
			}),
			env(),
		)
		expect(facts).toMatchObject({ who: { names: 'Alan Turing, you' }, snippetFrom: 'you', asksYou: false })
	})

	it('names no snippet sender on a two-person thread, or when the newest message has no sender', () => {
		expect(
			threadRowFacts(thread({ id: 't', latest_draft_or_message: message({ id: 'm' }) }), env()).snippetFrom,
		).toBeUndefined()
		const group = { participants: [GRACE, ALAN, ADA] }
		expect(
			threadRowFacts(
				thread({ id: 't', ...group, latest_draft_or_message: message({ id: 'm', from: undefined }) }),
				env(),
			).snippetFrom,
		).toBeUndefined()
		expect(
			threadRowFacts(
				thread({
					id: 't',
					...group,
					latest_draft_or_message: message({ id: 'm', from: [{ email: 'grace@vercel.com' }] }),
				}),
				env(),
			).snippetFrom,
		).toBe('grace')
	})

	it('falls back to the newest message for subject and snippet, and to nothing', () => {
		const latest = message({ id: 'm', subject: 'From the message', snippet: '<p>Hello</p>' })
		expect(
			threadRowFacts(
				thread({ id: 't', subject: '', snippet: undefined, latest_draft_or_message: latest }),
				env(),
			),
		).toMatchObject({
			subject: 'From the message',
			snippet: 'Hello',
		})
		const empty = threadRowFacts(
			thread({
				id: 't',
				subject: undefined,
				snippet: undefined,
				participants: undefined,
				message_ids: undefined,
			}),
			env(),
		)
		expect(empty).toMatchObject({
			subject: '',
			snippet: '',
			unread: false,
			asksYou: false,
			who: { kind: 'people', names: '', more: 0 },
		})
	})

	it('names the newest message’s file, never an inline image or an unnamed file', () => {
		const withFiles = (attachments: unknown) =>
			threadRowFacts(
				thread({ id: 't', latest_draft_or_message: message({ id: 'm', attachments: attachments as never }) }),
				env(),
			).file
		expect(
			withFiles([
				{ id: 'a', filename: ' invoice-2041.pdf ', content_type: 'application/pdf', size: 184_000 },
			]),
		).toBe('invoice-2041.pdf')
		expect(
			withFiles([{ id: 'a', filename: 'logo.png', content_type: 'image/png', is_inline: true }]),
		).toBeUndefined()
		expect(withFiles([{ id: 'a', content_type: 'application/pdf', size: 10 }])).toBeUndefined()
		expect(withFiles(undefined)).toBeUndefined()
	})

	it('carries the invitation a newest message holds', () => {
		const facts = threadRowFacts(
			thread({
				id: 'i',
				latest_draft_or_message: message({
					id: 'inv',
					attachments: [
						{ id: 'ics', filename: 'invite.ics', content_type: 'text/calendar', size: 512 },
					] as never,
				}),
			}),
			env(),
		)
		expect(facts.invite).toEqual({ messageId: 'inv', attachmentId: 'ics' })
		expect(facts.file).toBeUndefined()
	})
})

describe('wantsUnreadSummary', () => {
	it('looks up only unread threads with earlier messages', () => {
		expect(wantsUnreadSummary(thread({ id: 't', unread: true, message_ids: ['a', 'b'] }))).toBe(true)
		expect(wantsUnreadSummary(thread({ id: 't', unread: true, message_ids: ['a'] }))).toBe(false)
		expect(wantsUnreadSummary(thread({ id: 't', unread: true, message_ids: undefined }))).toBe(false)
		expect(wantsUnreadSummary(thread({ id: 't', unread: false, message_ids: ['a', 'b'] }))).toBe(false)
		// An invitation's row shows its time, never a count.
		expect(
			wantsUnreadSummary(
				thread({
					id: 't',
					unread: true,
					message_ids: ['a', 'b'],
					latest_draft_or_message: message({
						id: 'b',
						attachments: [
							{ id: 'ics', filename: 'invite.ics', content_type: 'text/calendar', size: 512 },
						] as never,
					}),
				}),
			),
		).toBe(false)
	})
})

describe('threadRowLabel', () => {
	const facts = (over: Partial<ThreadRowFacts>): ThreadRowFacts => ({
		state: 'normal',
		who: { kind: 'people', names: 'Mary, Grace, Alan, you', more: 1 },
		subject: 'Q3 product roadmap',
		snippet: 'snippet',
		unread: false,
		asksYou: false,
		...over,
	})

	it('names the subject and the people, then every state the row shows', () => {
		expect(threadRowLabel(facts({}))).toBe('Open Q3 product roadmap from Mary, Grace, Alan, you +1')
		expect(threadRowLabel(facts({ unread: true, newCount: 3, asksYou: true }))).toBe(
			'Open Q3 product roadmap from Mary, Grace, Alan, you +1, unread, 3 new, asks you',
		)
		expect(threadRowLabel(facts({ subject: '', who: { kind: 'people', names: '', more: 0 } }))).toBe(
			'Open (no subject) from unknown sender',
		)
	})

	it('names who a draft, a scheduled send, a failed send and a muted list are about, as the row does', () => {
		expect(threadRowLabel(facts({ state: 'draft', who: { kind: 'draft', to: 'Bright Smile Dental' } }))).toBe(
			'Open Q3 product roadmap, draft to Bright Smile Dental',
		)
		expect(threadRowLabel(facts({ state: 'failed', who: { kind: 'to', name: 'Meridian Bank' } }))).toBe(
			'Open Q3 product roadmap, to Meridian Bank, not sent',
		)
		expect(
			threadRowLabel(
				facts({ state: 'scheduled', who: { kind: 'to', name: 'Grace Hopper' } }),
				'Sends Mon 9:00 AM',
			),
		).toBe('Open Q3 product roadmap, to Grace Hopper, Sends Mon 9:00 AM')
		expect(
			threadRowLabel(facts({ state: 'muted', who: { kind: 'list', list: 'eng-all@', people: 31 } })),
		).toBe('Open Q3 product roadmap from eng-all@, 31 people, muted')
	})
})

describe('threadListItems', () => {
	const newsletter = (id: string, hoursAgo: number, name: string, over: Partial<MailThread> = {}) =>
		thread({
			id,
			subject: `${name} weekly`,
			snippet: 'This week in product',
			latest_message_received_date: NOW - hoursAgo * 3600 - 48 * 3600,
			latest_draft_or_message: message({ id: `${id}-m`, from: [{ name, email: `newsletter@${id}.com` }] }),
			...over,
		})
	const receipt = (id: string, hoursAgo: number, name: string, amount: string) =>
		thread({
			id,
			subject: `Your receipt from ${name}`,
			snippet: `Payment of ${amount} received.`,
			latest_message_received_date: NOW - hoursAgo * 3600 - 48 * 3600,
			latest_draft_or_message: message({ id: `${id}-m`, from: [{ name, email: `receipts@${id}.com` }] }),
		})
	const opts = { now: NOW, tz: TZ, bundle: true, expanded: new Set<string>() }

	it('puts a heading before each day group, months for older mail, and Earlier for undated mail', () => {
		const items = threadListItems(
			[
				thread({ id: 'today', latest_message_received_date: at(0, 9) }),
				thread({ id: 'today2', latest_message_received_date: undefined, latest_message_sent_date: at(0, 8) }),
				thread({ id: 'yesterday', latest_message_received_date: at(-1, 9) }),
				thread({ id: 'week', latest_message_received_date: at(-3, 9) }),
				thread({ id: 'sept', latest_message_received_date: at(-30, 9) }),
				thread({ id: 'undated', latest_message_received_date: undefined }),
			],
			{ ...opts, bundle: false },
		)
		expect(items.map((item) => (item.kind === 'heading' ? `# ${item.label}` : item.key))).toEqual([
			'# Today',
			'today',
			'today2',
			'# Yesterday',
			'yesterday',
			'# This week',
			'week',
			'# September',
			'sept',
			'# Earlier',
			'undated',
		])
	})

	it('folds two or more newsletters of a group into one bundle where the newest sits', () => {
		const threads = [
			newsletter('dispatch', 1, 'The Dispatch'),
			receipt('stripe', 2, 'Stripe', '$4,200.00'),
			newsletter('lenny', 3, 'Lenny’s'),
			thread({ id: 'tokens', latest_message_received_date: NOW - 52 * 3600 }),
		]
		const items = threadListItems(threads, opts)
		expect(items.map((item) => item.key)).toEqual([
			'group:0:This week',
			'bundle:This week:newsletter',
			'stripe',
			'tokens',
		])
		const bundle = items[1]
		expect(bundle).toMatchObject({ kind: 'bundle', bundle: 'newsletter', expanded: false })
		expect(bundle?.kind === 'bundle' && bundle.threads.map((t) => t.id)).toEqual(['dispatch', 'lenny'])
		expect(BUNDLE_MIN).toBe(2)
	})

	it('lists a bundle’s conversations beneath it when it is open, and names the folded bundle a thread is in', () => {
		const threads = [newsletter('dispatch', 1, 'The Dispatch'), newsletter('lenny', 3, 'Lenny’s')]
		const opened = threadListItems(threads, { ...opts, expanded: new Set(['bundle:This week:newsletter']) })
		expect(opened.map((item) => [item.key, item.kind === 'thread' ? item.bundled : undefined])).toEqual([
			['group:0:This week', undefined],
			['bundle:This week:newsletter', undefined],
			['dispatch', 'bundle:This week:newsletter'],
			['lenny', 'bundle:This week:newsletter'],
		])
		const folded = threadListItems(threads, opts)
		expect(foldedBundleOf(folded, 'lenny')).toBe('bundle:This week:newsletter')
		// Nothing to open: an open bundle, a thread outside any, or no thread at all.
		expect(foldedBundleOf(opened, 'lenny')).toBeUndefined()
		expect(foldedBundleOf(folded, 'elsewhere')).toBeUndefined()
		expect(foldedBundleOf(folded, undefined)).toBeUndefined()
	})

	it('keeps muted conversations, drafts and other groups out of a bundle', () => {
		const threads = [
			newsletter('dispatch', 1, 'The Dispatch'),
			newsletter('lenny', 3, 'Lenny’s', { draft_ids: ['lenny-m'] } as Partial<MailThread>),
			newsletter('figma', 4, 'Figma'),
			newsletter('older', 24 * 30, 'Older'),
		]
		const items = threadListItems(threads, { ...opts, mutedIds: new Set(['figma']) })
		expect(items.map((item) => item.key)).toEqual([
			'group:0:This week',
			'dispatch',
			'lenny',
			'figma',
			'group:1:September',
			'older',
		])
	})
})

describe('bundleSummary', () => {
	it('lists newsletter senders once each', () => {
		const summary = bundleSummary('newsletter', [
			thread({
				id: 'a',
				unread: true,
				latest_draft_or_message: message({ id: 'a', from: [{ name: 'The Dispatch', email: 'd@x.com' }] }),
			}),
			thread({
				id: 'b',
				latest_draft_or_message: message({ id: 'b', from: [{ name: 'The Dispatch', email: 'd@x.com' }] }),
			}),
			thread({ id: 'c', participants: [{ email: 'news@figma.com' }] }),
			thread({ id: 'd', participants: undefined }),
		])
		expect(summary).toEqual({
			title: 'Newsletters',
			count: 4,
			line: 'The Dispatch, news@figma.com',
			unread: true,
		})
	})

	it('lists who was paid how much on receipts', () => {
		const summary = bundleSummary('receipt', [
			thread({
				id: 's',
				subject: 'Invoice #2041 has been paid',
				snippet: 'A payment of $4,200.00',
				participants: [{ name: 'Stripe', email: 's@x.com' }],
			}),
			thread({
				id: 'v',
				subject: 'Your Voyage receipt',
				snippet: 'Payment of $612.40',
				participants: [{ name: 'Voyage', email: 'v@x.com' }],
			}),
			thread({ id: 'n', subject: 'Order', snippet: 'Thanks', participants: undefined }),
		])
		expect(summary).toEqual({
			title: 'Receipts',
			count: 3,
			line: 'Stripe $4,200.00 · Voyage $612.40',
			unread: false,
		})
	})
})
