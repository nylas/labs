import { describe, expect, it } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import type { FoldItem } from './thread-reading-model.js'
import {
	attachmentDetails,
	chipAttachments,
	conversationMessages,
	hashTarget,
	isLookalikeSender,
	isTrashed,
	knownPerson,
	lineDateLabel,
	messageAnchorId,
	messageHeadings,
	missingAfter,
	placeDrafts,
	quotedMessageId,
	replyAllNames,
	replyBase,
	replyFirstName,
	replyTarget,
	resendSeed,
	stepMessage,
	streamEntries,
	streamMessages,
} from './thread-stream.js'

const OWNER = 'ada@ownmail.com'
const GRACE = { name: 'Grace Hopper', email: 'grace@example.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@example.com' }
const ADA = { name: 'Ada Lovelace', email: OWNER }
// Tuesday 13 October 2026, 15:00 UTC.
const NOW = Date.UTC(2026, 9, 13, 15) / 1000
const DAY = 86_400

const message = (id: string, extra: Partial<MailMessage> = {}): MailMessage => ({
	id,
	from: [GRACE],
	to: [ADA],
	body: `Body ${id}`,
	...extra,
})

const messages = ['m0', 'm1', 'm2', 'm3', 'm4'].map((id) => message(id))
const kinds = (entries: ReturnType<typeof streamEntries>) =>
	entries.map((entry) => `${entry.separated ? '|' : ''}${entry.kind}`)

describe('streamEntries', () => {
	const plan: FoldItem[] = [
		{ kind: 'line', index: 0 },
		{
			kind: 'folded',
			indices: [1, 2],
			names: 'Grace',
			span: 'Oct 1',
			avatars: [],
			ids: ['m1', 'm2'],
			key: 'm1',
		},
		{ kind: 'open', index: 3 },
		{ kind: 'open', index: 4 },
	]
	const base = {
		messages,
		plan,
		closedIds: new Set<string>(),
		divider: null,
		events: [],
		catchUpBeforeIndex: null,
		drafts: [],
	}

	it('separates each row from the one above with a line', () => {
		expect(kinds(streamEntries(base))).toEqual(['|line', '|folded', '|open', '|open'])
	})

	it('marks messages that could not load where they were, before the first or after a row', () => {
		const missing = new Map([
			[-1, 1],
			[2, 2],
		])
		const entries = streamEntries({ ...base, missing })
		expect(kinds(entries)).toEqual(['|missing', '|line', '|folded', '|missing', '|open', '|open'])
		expect(entries[3]).toMatchObject({ kind: 'missing', count: 2, key: 'missing:2' })
	})

	it('lets the divider be the line above the first new message, with the catch-up card before it', () => {
		const entries = streamEntries({
			...base,
			divider: { beforeIndex: 3, count: 2, label: '2 new since Tuesday' },
			catchUpBeforeIndex: 3,
		})
		expect(kinds(entries)).toEqual(['|line', '|folded', '|catch-up', 'divider', 'open', '|open'])
		expect(entries.find((entry) => entry.kind === 'divider')).toMatchObject({
			label: '2 new since Tuesday',
			count: 2,
		})
		// Without the card the divider follows the row above directly.
		expect(kinds(streamEntries({ ...base, divider: { beforeIndex: 3, count: 2, label: 'x' } }))).toEqual([
			'|line',
			'|folded',
			'divider',
			'open',
			'|open',
		])
	})

	it('puts the catch-up card before the first new message when every message is new (no divider)', () => {
		const allNew: FoldItem[] = messages.map((_, index) => ({ kind: 'open', index }))
		expect(kinds(streamEntries({ ...base, plan: allNew, catchUpBeforeIndex: 0 }))).toEqual([
			'|catch-up',
			'|open',
			'|open',
			'|open',
			'|open',
			'|open',
		])
	})

	it('passes the previous message only to an open message right under another open one', () => {
		const entries = streamEntries(base)
		const open = entries.filter((entry) => entry.kind === 'open')
		expect(open.map((entry) => ('prev' in entry ? entry.prev?.id : undefined))).toEqual([undefined, 'm3'])
	})

	it('shows a message the reader closed as a line, and nothing above it as its previous message', () => {
		const entries = streamEntries({ ...base, closedIds: new Set(['m3']) })
		expect(kinds(entries)).toEqual(['|line', '|folded', '|line', '|open'])
		expect(entries.at(-1)).not.toHaveProperty('prev')
	})

	it('gives every open message after the first the message before it, however that one is shown', () => {
		const entries = streamEntries({ ...base, closedIds: new Set(['m3']) })
		const open = entries.filter((entry) => entry.kind === 'open')
		expect(open.map((entry) => ('earlier' in entry ? entry.earlier?.id : undefined))).toEqual(['m3'])
		const first = streamEntries({ ...base, plan: [{ kind: 'open', index: 0 }] })
		expect(first[0]).not.toHaveProperty('earlier')
	})

	it('puts system lines only between rows, never inside a folded run', () => {
		const entries = streamEntries({
			...base,
			events: [
				{ afterIndex: 0, text: 'Grace added Mary' },
				{ afterIndex: 1, text: 'hidden in the fold' },
				{ afterIndex: 2, text: 'Subject changed' },
			],
		})
		expect(kinds(entries)).toEqual(['|line', 'system', '|folded', 'system', '|open', '|open'])
		expect(
			entries.filter((entry) => entry.kind === 'system').map((entry) => 'text' in entry && entry.text),
		).toEqual(['Grace added Mary', 'Subject changed'])
	})

	it('places drafts after the row of the message they follow, and before everything when they lead', () => {
		const lead = message('d0', { ownmailDraft: true })
		const inFold = message('d1', { ownmailDraft: true })
		const entries = streamEntries({
			...base,
			drafts: [{ draft: lead }, { draft: inFold, after: messages[2] }],
		})
		expect(kinds(entries)).toEqual(['|draft', '|line', '|folded', '|draft', '|open', '|open'])
		expect(entries[3]).toMatchObject({ kind: 'draft', key: 'draft:d1', replyTo: { id: 'm2' } })
		expect(entries[0]).not.toHaveProperty('replyTo')
	})

	it('keeps a draft that follows a message inside a folded run, under the folded row', () => {
		const draft = message('d1', { ownmailDraft: true })
		const entries = streamEntries({ ...base, drafts: [{ draft, after: messages[1] }] })
		expect(kinds(entries)).toEqual(['|line', '|folded', '|draft', '|open', '|open'])
		expect(entries[2]).toMatchObject({ kind: 'draft', key: 'draft:d1', replyTo: { id: 'm1' } })
	})
})

describe('missingAfter', () => {
	it('counts the messages that could not load after the shown message each follows', () => {
		const shown = [message('a'), message('b')]
		expect([...missingAfter(['x', 'a', 'y', 'z', 'gone', 'b'], shown, ['x', 'y', 'z'])]).toEqual([
			[-1, 1],
			[0, 2],
		])
		expect(missingAfter(['a', 'b'], shown, undefined).size).toBe(0)
		expect([...missingAfter(undefined, shown, ['x'])]).toEqual([])
	})
})

describe('replyBase and conversationMessages', () => {
	const daemon = { name: 'Mail Delivery Subsystem', email: 'MAILER-DAEMON@example.com' }
	const sent = message('sent', { from: [ADA], to: [GRACE] })
	const bounce = message('bounce', { from: [daemon], subject: 'Undeliverable: Launch' })
	const draft = message('draft', { ownmailDraft: true })

	it('answers the latest message that is neither a draft nor a bounce report', () => {
		expect(replyBase([message('m1'), sent, bounce, draft])?.id).toBe('sent')
		// Only reports: the latest one, as before.
		expect(replyBase([bounce, draft])?.id).toBe('bounce')
		expect(replyBase([draft])).toBeUndefined()
	})

	it('leaves the bounce’s mail server out of the people', () => {
		expect(conversationMessages([sent, bounce]).map((entry) => entry.id)).toEqual(['sent'])
	})
})

describe('placeDrafts and streamMessages', () => {
	const all = [
		message('d0', { ownmailDraft: true }),
		message('m1'),
		message('t1', { folders: ['TRASH'] }),
		message('d1', { ownmailDraft: true }),
	]

	it('follows each draft with the nearest earlier message that is shown', () => {
		expect(placeDrafts(all, new Set(['m1']))).toEqual([{ draft: all[0] }, { draft: all[3], after: all[1] }])
	})

	it('puts a draft under the message it answers when that message is shown', () => {
		const thread = [
			message('m1'),
			message('m2'),
			message('m3'),
			message('d1', { ownmailDraft: true, reply_to_message_id: 'm1' } as Partial<MailMessage>),
			message('d2', { ownmailDraft: true, reply_to_message_id: 'gone' } as Partial<MailMessage>),
		]
		expect(placeDrafts(thread, new Set(['m1', 'm2', 'm3']))).toEqual([
			{ draft: thread[3], after: thread[0] },
			{ draft: thread[4], after: thread[2] },
		])
		// An answered message that is not shown (in Trash) leaves the draft where it falls.
		expect(placeDrafts(thread, new Set(['m2', 'm3']))[0]).toEqual({ draft: thread[3], after: thread[2] })
	})

	it('runs drafts outside the stream and trashed messages only when asked', () => {
		expect(streamMessages(all, false).map((entry) => entry.id)).toEqual(['m1'])
		expect(streamMessages(all, true).map((entry) => entry.id)).toEqual(['m1', 't1'])
		expect(isTrashed(all[2] as MailMessage)).toBe(true)
		expect(isTrashed(message('x'))).toBe(false)
	})
})

describe('reply names', () => {
	it('names Reply all from the Reply-To or sender, then To and Cc, without the owner, three before "+n"', () => {
		const latest = message('m', {
			from: [{ name: 'Mary Jackson', email: 'mary@example.com' }],
			to: [ADA, GRACE, ALAN, { email: 'pm-leads@example.com' }],
			cc: [{ name: 'Katherine Johnson', email: 'kj@example.com' }, GRACE],
		})
		expect(replyAllNames(latest, OWNER)).toEqual({ names: 'Mary, Grace, Alan', more: 2 })
		expect(replyFirstName(latest, OWNER)).toBe('Mary')
		const redirected = { ...latest, reply_to: [{ email: 'replies@example.com' }] }
		expect(replyAllNames(redirected, OWNER).names).toBe('Replies, Grace, Alan')
		expect(replyFirstName(redirected, OWNER)).toBe('Replies')
	})

	it('replies to the first other person when your own message is the latest', () => {
		const own = message('m', { from: [ADA], to: [ADA, ALAN], cc: [GRACE] })
		expect(replyTarget(own, OWNER)).toEqual(ALAN)
		expect(replyFirstName(own, OWNER)).toBe('Alan')
		// Written only to yourself, there is no one else to reply to.
		expect(replyTarget(message('n', { from: [ADA], to: [ADA] }), OWNER)).toBeUndefined()
		expect(replyFirstName(message('n', { from: [ADA], to: undefined }), OWNER)).toBe('')
		// Someone else's message keeps its sender, and so does any message when the owner is not known.
		expect(replyTarget(message('o', { from: [GRACE] }), OWNER)).toEqual(GRACE)
		expect(replyTarget(own, '')).toEqual(ADA)
	})

	it('names addresses your own reply gives alone as the thread knows them', () => {
		const sent = message('m', {
			from: [ADA],
			to: [{ email: 'mjackson@example.com' }, { email: 'grace@example.com' }],
			cc: [{ email: 'Alan@example.com' }, { email: 'kj@example.com' }],
		})
		const known = [
			{ name: 'Mary Jackson', email: 'mjackson@example.com', isOwner: false },
			{ name: '', email: 'kj@example.com', isOwner: false },
			{ name: 'Grace Hopper', email: 'grace@example.com', isOwner: false },
			{ name: 'Alan Turing', email: 'alan@example.com', isOwner: false },
		]
		expect(replyAllNames(sent, OWNER, known)).toEqual({ names: 'Mary, Grace, Alan', more: 1 })
		expect(replyFirstName(sent, OWNER, known)).toBe('Mary')
		// Without the thread's people the local part is all there is, in sentence case.
		expect(replyFirstName(sent, OWNER)).toBe('Mjackson')
		// A name the message itself gives wins over the thread's.
		expect(knownPerson(GRACE, OWNER, [{ ...known[2], name: 'G. Hopper' }]).name).toBe(GRACE.name)
		expect(knownPerson({ email: 'kj@example.com' }, OWNER, known).name).toBe('')
	})

	it('has no one to name on a message with no sender', () => {
		expect(replyAllNames(message('m', { from: [], to: [] }), OWNER)).toEqual({ names: '', more: 0 })
		expect(replyFirstName(message('m', { from: undefined }), OWNER)).toBe('')
	})
})

describe('attachmentDetails', () => {
	const size = (bytes: number) => `${bytes} B`

	it('gives each file its size and, for a later version, the one it replaces', () => {
		const files = [
			message('v1', {
				date: NOW - 7 * DAY,
				attachments: [{ id: 'a1', filename: 'plan-v1.pdf', size: 10_240 }],
			}),
			message('v2', {
				date: NOW - 5 * DAY,
				attachments: [{ id: 'a2', filename: 'plan-v2.pdf', size: 10_240 }],
			}),
			message('v3', { date: NOW, attachments: [{ id: 'a3', filename: 'plan-v3.pdf', size: 10_240 }] }),
			message('x', { date: NOW, attachments: [{ id: 'a4', filename: 'notes.txt' }] }),
		]
		const details = attachmentDetails(files, OWNER, NOW, 'UTC', size)
		expect(details.get('v3|a3')).toBe('10240 B · replaces v2 from Thu')
		expect(details.get('v2|a2')).toBe('10240 B · replaces v1 from Oct 6')
		expect(details.get('v1|a1')).toBe('10240 B')
		// A file with no size and no earlier version has nothing to add.
		expect(details.has('x|a4')).toBe(false)
	})
})

describe('chipAttachments', () => {
	it('leaves inline images and invitations out of the chips', () => {
		const chips = chipAttachments(
			message('m', {
				attachments: [
					{ id: 'a', filename: 'a.pdf' },
					{ id: 'b', filename: 'logo.png', is_inline: true },
					{ id: 'c', filename: 'invite.ics', content_type: 'text/calendar' },
				],
			}),
		)
		expect(chips.map((chip) => chip.id)).toEqual(['a'])
		expect(chipAttachments(message('m'))).toEqual([])
	})
})

describe('isLookalikeSender', () => {
	const bank = { name: 'Meridian Bank', email: 'statements@meridianbank.com', isOwner: false }

	it('flags a known name written from another domain', () => {
		const fake = message('m', { from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }] })
		expect(isLookalikeSender(fake, [bank], OWNER)).toBe(true)
	})

	it('trusts the same address, the same domain, unknown names, nameless senders and the owner', () => {
		const known = { name: 'meridian bank', email: 'Statements@MeridianBank.com', isOwner: false }
		expect(isLookalikeSender(message('m', { from: [bank] }), [known], OWNER)).toBe(false)
		expect(
			isLookalikeSender(
				message('m', { from: [{ name: 'Meridian Bank', email: 'help@meridianbank.com' }] }),
				[bank],
				OWNER,
			),
		).toBe(false)
		expect(isLookalikeSender(message('m', { from: [GRACE] }), [bank], OWNER)).toBe(false)
		expect(isLookalikeSender(message('m', { from: [{ email: 'x@y.z' }] }), [bank], OWNER)).toBe(false)
		expect(
			isLookalikeSender(message('m', { from: [{ name: 'Meridian Bank', email: OWNER }] }), [bank], OWNER),
		).toBe(false)
		expect(
			isLookalikeSender(
				message('m', { from: [{ name: 'Meridian Bank', email: 'nodomain' }] }),
				[bank],
				OWNER,
			),
		).toBe(true)
	})
})

describe('messageHeadings', () => {
	it('reads h1 to h3 as plain text and skips empty headings', () => {
		const body =
			'<h1>Scope</h1><p>x</p><h2 id="p">Pay<b>ment</b>&nbsp;terms &amp; fees</h2><h3> </h3><h4>Not this</h4>'
		expect(messageHeadings(message('m', { body }))).toEqual(['Scope', 'Payment terms & fees'])
		expect(messageHeadings(message('m', { body: undefined }))).toEqual([])
	})
})

describe('lineDateLabel', () => {
	it('says the time today, the weekday this past week, and the date before that', () => {
		expect(lineDateLabel(NOW - 3600, NOW, 'UTC')).toBe('2:00 PM')
		expect(lineDateLabel(NOW - DAY, NOW, 'UTC')).toBe('Mon')
		expect(lineDateLabel(NOW - 3 * DAY, NOW, 'UTC')).toBe('Sat')
		expect(lineDateLabel(NOW - 20 * DAY, NOW, 'UTC')).toBe('Sep 23')
		expect(lineDateLabel(undefined, NOW, 'UTC')).toBe('')
		expect(lineDateLabel(0, NOW, 'UTC')).toBe('')
		// An unknown zone falls back to UTC rather than failing.
		expect(lineDateLabel(NOW - 3600, NOW, 'Not/AZone')).toBe('2:00 PM')
		expect(lineDateLabel(NOW - DAY, NOW, 'Not/AZone')).toBe('Mon')
	})
})

describe('resendSeed', () => {
	it("seeds a composer with the message's recipients, subject and text", () => {
		expect(
			resendSeed(message('m', { to: [GRACE], cc: [ALAN], subject: 'Launch dates', body: 'One.\n\nTwo.' })),
		).toEqual({ to: 'grace@example.com, alan@example.com', subject: 'Launch dates', body: 'One.\n\nTwo.' })
		expect(resendSeed(message('m', { to: undefined, body: '' }))).toEqual({ to: '', subject: '', body: '' })
	})
})

describe('navigation helpers', () => {
	it('steps within the thread and stops at its ends', () => {
		expect(stepMessage(2, 1, 5)).toBe(3)
		expect(stepMessage(4, 1, 5)).toBe(4)
		expect(stepMessage(0, -1, 5)).toBe(0)
		expect(stepMessage(0, 1, 0)).toBe(-1)
	})

	it('names message anchors and reads them back from a link', () => {
		expect(messageAnchorId('m/1')).toBe('message-m/1')
		expect(hashTarget('#message-m1', messages.slice(0, 2))).toBe('m1')
		expect(hashTarget(`#message-${encodeURIComponent('m 1')}`, [message('m 1')])).toBe('m 1')
		expect(hashTarget('#message-missing', messages)).toBeUndefined()
		expect(hashTarget('#other', messages)).toBeUndefined()
		expect(hashTarget('', messages)).toBeUndefined()
	})
})

describe('quotedMessageId', () => {
	const thread = [
		message('g1', { date: NOW - 3 * DAY }),
		message('a1', { from: [ALAN], date: NOW - 2 * DAY }),
		message('g2', { from: [{ name: 'Grace', email: ' Grace@Example.com ' }], date: NOW - DAY }),
		message('reply', { from: [ADA], date: NOW }),
	]

	it('finds the latest earlier message from the quoted address', () => {
		expect(quotedMessageId(thread, 'reply', { email: 'grace@example.com' })).toBe('g2')
	})

	it('prefers the earlier message sent closest to the quoted date', () => {
		expect(quotedMessageId(thread, 'reply', { email: 'GRACE@example.com', date: NOW - 3 * DAY + 60 })).toBe(
			'g1',
		)
		expect(quotedMessageId(thread, 'reply', { email: 'alan@example.com', date: NOW })).toBe('a1')
	})

	it('looks only before the quoting message, or through the thread when it is not there', () => {
		expect(quotedMessageId(thread, 'a1', { email: 'grace@example.com' })).toBe('g1')
		expect(quotedMessageId(thread, 'gone', { email: 'ada@ownmail.com' })).toBe('reply')
	})

	it('finds nothing without an address or a message from it', () => {
		expect(quotedMessageId(thread, 'reply', {})).toBeUndefined()
		expect(quotedMessageId(thread, 'reply', { email: 'katherine@example.com' })).toBeUndefined()
		expect(quotedMessageId(thread, 'reply', { email: 'katherine@example.com', date: NOW })).toBeUndefined()
		expect(
			quotedMessageId([message('x', { from: undefined }), message('y')], 'y', {
				email: 'grace@example.com',
				date: 1,
			}),
		).toBeUndefined()
	})

	it('treats a message without a date as sent at zero', () => {
		const undated = [message('u'), message('d', { date: NOW }), message('r', { from: [ADA] })]
		expect(quotedMessageId(undated, 'r', { email: 'grace@example.com', date: 10 })).toBe('u')
	})
})
