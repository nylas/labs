import { describe, expect, it } from 'vitest'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import {
	asksYou,
	bounceFor,
	catchUpFacts,
	classifyBundle,
	dateSpanLabel,
	dayGroup,
	dayGroupHeading,
	emptyBodyNote,
	type FoldItem,
	fileFamilyKey,
	firstName,
	foldPlan,
	foldRunKey,
	isBounceMessage,
	isListAddress,
	isOrganisationName,
	isThreadFile,
	listLabel,
	messageNewText,
	newSinceDivider,
	type Person,
	participantsLabel,
	personHue,
	personName,
	REPLY_ALL_GUARD,
	readingStats,
	receiptAmount,
	recipientSummary,
	replyAllCount,
	rowParticipants,
	senderPerson,
	shortDayLabel,
	shownParticipants,
	sinceDayLabel,
	subjectChangeText,
	subjectStandIn,
	supersededInvites,
	systemEvents,
	threadFiles,
	threadMap,
	threadParticipants,
	toPerson,
	versionLabel,
	versionToken,
	withKnownName,
} from './thread-reading-model.js'

const DAY = 86_400
/** Thursday 15 October 2026, 12:00 UTC. */
const NOW = 1_792_065_600
const TZ = 'UTC'
const ago = (days: number, hours = 0) => NOW - days * DAY - hours * 3600

const OWNER = 'ada@ownmail.com'
const ADA = { name: 'Ada Lovelace', email: 'Ada@ownmail.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@ownmail.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@nasa.gov' }
const MARY = { name: 'Mary Jackson', email: 'mary@nasa.gov' }
const PM_LEADS = { email: 'pm-leads@vercel.com' }

type Who = { name?: string; email: string }

function msg(id: string, from: Who | undefined, to: Who[], extra: Partial<MailMessage> = {}): MailMessage {
	return { id, ...(from ? { from: [from] } : {}), to, ...extra }
}

const pdf = (id: string, filename: string, size = 2_100_000) => ({
	id,
	filename,
	size,
	content_type: 'application/pdf',
})

const person = (who: Who, isOwner = false): Person => ({ name: who.name ?? '', email: who.email, isOwner })

/** The Q3 roadmap thread in miniature: read history, three new messages, versions, an added person. */
function q3Thread(): MailMessage[] {
	return [
		msg('m1', GRACE, [ADA, ALAN], {
			cc: [KATHERINE],
			subject: 'Q3 roadmap',
			date: ago(17),
			body: 'Kicking off the Q3 roadmap review. Draft v1 is attached.',
			attachments: [pdf('a1', 'Q3-roadmap-v1.pdf')],
		}),
		msg('m2', ALAN, [GRACE], {
			cc: [ADA, KATHERINE],
			subject: 'Re: Q3 roadmap',
			date: ago(16),
			body: 'Looks good.',
		}),
		msg('m3', ADA, [GRACE], {
			cc: [ALAN, KATHERINE],
			subject: 'Re: Q3 roadmap',
			date: ago(15),
			body: 'Notes attached.',
			attachments: [{ id: 'a3', filename: 'planning-notes.docx', size: 40_000 }],
		}),
		msg('m4', KATHERINE, [GRACE], {
			cc: [ADA, ALAN],
			subject: 'Q3 product roadmap: final review before Friday',
			date: ago(14),
			body: 'Numbers look right.',
		}),
		msg('m5', GRACE, [ALAN], {
			cc: [ADA, KATHERINE],
			subject: 'Re: Q3 product roadmap: final review before Friday',
			date: ago(3),
			body: 'Here is v3.',
			attachments: [pdf('a5', 'Q3-roadmap-v3.pdf')],
		}),
		msg('m6', ALAN, [GRACE], {
			cc: [ADA, KATHERINE],
			subject: 'Re: Q3 product roadmap: final review before Friday',
			date: ago(1, -4),
			body: 'Grace, I went through v3 line by line.\n\nOn Tue, Grace Hopper wrote:\n> Here is v3.',
		}),
		msg('m7', GRACE, [ALAN, MARY], {
			cc: [ADA, KATHERINE],
			subject: 'Re: Q3 product roadmap: final review before Friday',
			date: ago(0, 2.5),
			body: 'Thanks Alan, both done. v4 is attached.',
			attachments: [pdf('a7', 'Q3-roadmap-v4.pdf')],
		}),
		msg('m8', MARY, [GRACE], {
			cc: [ADA, ALAN, KATHERINE],
			subject: 'Re: Q3 product roadmap: final review before Friday',
			date: ago(0, 2.3),
			body: 'Billing can make Q3 if legal signs off by the 20th. Ada, can you confirm that date with them?',
		}),
	]
}
const Q3_UNREAD = { unreadIds: ['m6', 'm7', 'm8'] }

describe('people', () => {
	it('names the owner "you" and everyone else by full or first name', () => {
		expect(personName(person(ADA, true), 'full')).toBe('you')
		expect(personName(person(GRACE), 'full')).toBe('Grace Hopper')
		expect(personName(person(GRACE), 'first')).toBe('Grace')
		expect(personName({ name: '', email: 'sam@example.com', isOwner: false }, 'full')).toBe('sam@example.com')
		// An address alone still gives a first name in sentence case.
		expect(personName({ name: '', email: 'sam@example.com', isOwner: false }, 'first')).toBe('Sam')
		expect(firstName({ name: '', email: 'alan.turing@bletchley.dev' })).toBe('Alan')
		expect(personName({ name: '', email: '', isOwner: false }, 'full')).toBe('Unknown sender')
		expect(personName({ name: '', email: '', isOwner: false }, 'first')).toBe('Someone')
	})

	it('keeps an organisation’s whole name and names a nameless list by its address', () => {
		expect(firstName({ name: 'Bright Smile Dental', email: 'hello@brightsmile.com' })).toBe(
			'Bright Smile Dental',
		)
		expect(firstName({ name: 'The Dispatch', email: 'digest@dispatch.email' })).toBe('The Dispatch')
		expect(firstName({ name: 'Mail Delivery Subsystem', email: 'mailer-daemon@ownmail.com' })).toBe(
			'Mail Delivery Subsystem',
		)
		// A role mailbox makes any two-word name an organisation's; one word is the whole name anyway.
		expect(firstName({ name: 'Northwind Legal', email: 'noreply@northwind.com' })).toBe('Northwind Legal')
		expect(firstName({ name: 'Voyage', email: 'trips@voyage.com' })).toBe('Voyage')
		expect(isOrganisationName('Voyage', 'hello@voyage.com')).toBe(false)
		expect(isOrganisationName('Grace Hopper', 'grace@ownmail.com')).toBe(false)
		expect(firstName({ name: '', email: 'eng-all@vercel.com' })).toBe('eng-all@')
		expect(firstName({ name: 'Engineering', email: 'eng-all@vercel.com' })).toBe('Engineering')
		expect(isListAddress(' All@vercel.com ')).toBe(true)
		expect(isListAddress('pm-leads@vercel.com')).toBe(false)
		expect(listLabel('eng-all@vercel.com')).toBe('eng-all@')
	})

	it('reads inverted and quoted display names', () => {
		expect(firstName({ name: 'Turing, Alan', email: '' })).toBe('Alan')
		expect(toPerson({ name: ' "Grace  Hopper" ', email: ' grace@ownmail.com ' }, OWNER)).toEqual({
			name: 'Grace Hopper',
			email: 'grace@ownmail.com',
			isOwner: false,
		})
		expect(toPerson(ADA, ' ADA@ownmail.com ').isOwner).toBe(true)
		expect(toPerson(ADA, '').isOwner).toBe(false)
		expect(toPerson(undefined, OWNER)).toEqual({ name: '', email: '', isOwner: false })
		expect(toPerson({ email: undefined } as unknown as Who, OWNER).email).toBe('')
		expect(senderPerson(msg('x', undefined, []), OWNER).email).toBe('')
	})

	it('lists everyone on a thread once, in order of first appearance, the owner last', () => {
		const people = threadParticipants(q3Thread(), OWNER)
		expect(people.map((p) => personName(p, 'first'))).toEqual(['Grace', 'Alan', 'Katherine', 'Mary', 'you'])
		expect(people.at(-1)).toEqual({ name: 'Ada Lovelace', email: 'Ada@ownmail.com', isOwner: true })
	})

	it('fills in a name a later message knows and skips empty addresses', () => {
		const people = threadParticipants(
			[
				msg('1', { email: 'sam@example.com' }, [{ email: ' ' }]),
				msg('2', { name: 'Sam Lee', email: 'SAM@example.com' }, []),
			],
			OWNER,
		)
		expect(people).toEqual([{ name: 'Sam Lee', email: 'sam@example.com', isOwner: false }])
		expect(threadParticipants([], OWNER)).toEqual([])
	})

	it('labels participants with the owner kept visible and the rest counted', () => {
		const people = threadParticipants(q3Thread(), OWNER)
		expect(participantsLabel(people)).toEqual({ names: 'Grace, Alan, Katherine, you', more: 1 })
		expect(participantsLabel(people, 0)).toEqual({ names: 'you', more: 4 })
		expect(participantsLabel(people.slice(0, 2))).toEqual({ names: 'Grace, Alan', more: 0 })
		expect(participantsLabel(people.slice(0, 4), 2)).toEqual({ names: 'Grace, Alan', more: 2 })
		expect(participantsLabel([])).toEqual({ names: '', more: 0 })
	})

	it('uses full names where two people share a first name', () => {
		const people = [person(ALAN), person({ name: 'Alan Kay', email: 'kay@example.com' }), person(GRACE)]
		expect(participantsLabel(people).names).toBe('Alan Turing, Alan Kay, Grace')
	})

	it('gives every address one stable hue from the canvas set', () => {
		const hue = personHue('grace@ownmail.com')
		expect([75, 250, 32, 158, 300, 200]).toContain(hue)
		expect(personHue(' GRACE@ownmail.com ')).toBe(hue)
		const hues = new Set(Array.from({ length: 60 }, (_, i) => personHue(`person${i}@example.com`)))
		expect(hues.size).toBe(6)
		expect([75, 250, 32, 158, 300, 200]).toContain(personHue(''))
	})

	it('draws the boards’ people in the canvas hues', () => {
		expect(personHue('alan@bletchley.dev')).toBe(250)
		expect(personHue('grace.hopper@vercel.com')).toBe(75)
		expect(personHue('katherine.johnson@vercel.com')).toBe(32)
		expect(personHue('mjackson@vercel.com')).toBe(300)
	})

	it('does not count a nameless list on Cc as a person on the thread', () => {
		const messages = [
			msg('a', GRACE, [ADA, ALAN], { cc: [PM_LEADS] }),
			msg('b', ALAN, [GRACE, ADA], { cc: [PM_LEADS, KATHERINE] }),
			msg('c', KATHERINE, [GRACE, ALAN, ADA], { cc: [PM_LEADS, MARY] }),
		]
		const people = threadParticipants(messages, OWNER)
		expect(people.map((p) => personName(p, 'first'))).toEqual(['Grace', 'Alan', 'Katherine', 'Mary', 'you'])
		expect(participantsLabel(people)).toEqual({ names: 'Grace, Alan, Katherine, you', more: 1 })
		// It is still a recipient.
		expect(recipientSummary(messages[0] as MailMessage, undefined, OWNER).text).toBe('to you, Alan +1')
		expect(replyAllCount(messages[0] as MailMessage, OWNER)).toBe(3)
		// A nameless address that writes, or is all there is, still counts.
		expect(threadParticipants([msg('d', { email: 'sam@example.com' }, [ADA])], OWNER)).toHaveLength(2)
		expect(threadParticipants([msg('e', ADA, [PM_LEADS])], OWNER).map((p) => p.email)).toEqual([
			PM_LEADS.email,
			ADA.email,
		])
	})
})

describe('mailing lists', () => {
	const ENG_ALL = { email: 'eng-all@vercel.com' }
	const members = Array.from({ length: 5 }, (_, i) => ({ name: `Alex ${i}`, email: `alex${i}@vercel.com` }))
	const announcement = msg('f1', ALAN, [ENG_ALL], { cc: members })

	it('names the list and counts the members it reached, as the header does', () => {
		const people = threadParticipants([announcement], OWNER)
		expect(people.map((p) => p.via)).toEqual([undefined, undefined, ...members.map(() => 'eng-all@')])
		expect(participantsLabel(people)).toEqual({ names: 'Alan, eng-all@', more: 5 })
		expect(shownParticipants(people).map((p) => p.email)).toEqual([ALAN.email, ENG_ALL.email])
		expect(recipientSummary(announcement, undefined, OWNER).text).toBe('to eng-all@ and 5 others')
	})

	it('still names a member who writes in the thread', () => {
		const reply = msg('f2', members[2], [ALAN, ENG_ALL])
		const people = threadParticipants([announcement, reply], OWNER)
		expect(participantsLabel(people)).toEqual({ names: 'Alan, eng-all@, Alex', more: 4 })
		// With the owner on the thread, "you" stays last.
		const withOwner = threadParticipants([announcement, msg('f3', ADA, [ENG_ALL])], OWNER)
		expect(participantsLabel(withOwner)).toEqual({ names: 'Alan, eng-all@, you', more: 5 })
	})

	it('summarises a list row the same way', () => {
		const row: MailThread = {
			id: 'list',
			participants: [ALAN, ENG_ALL, ...members, ADA],
			latest_draft_or_message: { id: 'l', from: [ALAN] },
		}
		expect(rowParticipants(row, OWNER)).toEqual({ names: 'Alan, eng-all@, you', more: 5 })
	})
})

describe('rowParticipants', () => {
	const thread = (participants: Who[] | undefined, latest?: Partial<MailMessage>): MailThread => ({
		id: 't',
		...(participants ? { participants } : {}),
		...(latest ? { latest_draft_or_message: { id: 'l', ...latest } } : {}),
	})

	it('puts the latest sender first and the owner last', () => {
		expect(rowParticipants(thread([GRACE, ALAN, KATHERINE, ADA, MARY], { from: [MARY] }), OWNER)).toEqual({
			names: 'Mary, Grace, Alan, you',
			more: 1,
		})
	})

	it('names a lone correspondent in full, with "you" only when the owner wrote last', () => {
		expect(rowParticipants(thread([ALAN, ADA], { from: [ADA] }), OWNER)).toEqual({
			names: 'Alan Turing, you',
			more: 0,
		})
		expect(rowParticipants(thread([KATHERINE, ADA], { from: [KATHERINE] }), OWNER)).toEqual({
			names: 'Katherine Johnson',
			more: 0,
		})
		expect(rowParticipants(thread([KATHERINE, ADA]), OWNER)).toEqual({ names: 'Katherine Johnson', more: 0 })
		expect(rowParticipants(thread([KATHERINE]), OWNER)).toEqual({ names: 'Katherine Johnson', more: 0 })
	})

	it('leaves out a nameless list address that is not the latest sender', () => {
		expect(
			rowParticipants(thread([GRACE, ADA, ALAN, KATHERINE, PM_LEADS, MARY], { from: [MARY] }), OWNER),
		).toEqual({ names: 'Mary, Grace, Alan, you', more: 1 })
		expect(rowParticipants(thread([PM_LEADS, ADA], { from: [PM_LEADS] }), OWNER).names).toBe(
			'pm-leads@vercel.com',
		)
	})

	it('falls back to the latest message and ignores a draft as the latest sender', () => {
		expect(rowParticipants(thread(undefined, { from: [ADA], to: [GRACE], cc: [ALAN] }), OWNER).names).toBe(
			'Grace, Alan, you',
		)
		expect(rowParticipants(thread([GRACE, ALAN], { from: [ALAN], ownmailDraft: true }), OWNER).names).toBe(
			'Grace, Alan',
		)
		expect(rowParticipants(thread(undefined, { to: [ADA] }), OWNER)).toEqual({ names: 'you', more: 0 })
		expect(rowParticipants(thread(undefined), OWNER)).toEqual({ names: '', more: 0 })
	})
})

describe('recipientSummary', () => {
	const [m1, m2, , , , m6, m7, m8] = q3Thread() as MailMessage[]

	it('names the owner first, then two people, then a count', () => {
		// Alan was not on the previous message, so this is not a reply to everyone on it.
		expect(recipientSummary(m6 as MailMessage, msg('p', GRACE, [ADA]), OWNER)).toEqual({
			text: 'to you, Grace +1',
			changed: false,
		})
		expect(recipientSummary(m6 as MailMessage, m2, OWNER)).toEqual({ text: 'to everyone', changed: false })
		expect(recipientSummary(m1 as MailMessage, undefined, OWNER)).toEqual({
			text: 'to you, Alan +1',
			changed: false,
		})
	})

	it('names a recipient whose address came alone by the name the thread knows', () => {
		const sent = msg('s', ADA, [{ email: 'alan@bletchley.dev' }])
		const known = [{ name: 'Alan Turing', email: 'Alan@bletchley.dev', isOwner: false }]
		expect(recipientSummary(sent, undefined, OWNER, known).text).toBe('to Alan')
		// Nobody in the thread named them: the address still reads as a first name.
		expect(recipientSummary(msg('b', ADA, [{ email: 'mary@nasa.gov' }]), undefined, OWNER, known).text).toBe(
			'to Mary',
		)
		expect(withKnownName({ name: 'Grace Hopper', email: 'grace@x.com', isOwner: false }, known).name).toBe(
			'Grace Hopper',
		)
	})

	it('says "to everyone" when the reply reaches everyone the last message involved', () => {
		expect(recipientSummary(m8 as MailMessage, m7, OWNER)).toEqual({ text: 'to everyone', changed: false })
	})

	it('summarises mail to a list by the list it came through', () => {
		const ENG_ALL = { email: 'eng-all@vercel.com' }
		const cc = Array.from({ length: 238 }, (_, i) => ({ name: `Person ${i}`, email: `p${i}@vercel.com` }))
		expect(recipientSummary({ ...msg('l', ALAN, [ENG_ALL]), cc }, undefined, OWNER)).toEqual({
			text: 'to eng-all@ and 238 others',
			changed: false,
			group: 'eng-all@',
		})
		expect(recipientSummary({ ...msg('l', ALAN, [ENG_ALL]), cc: [GRACE] }, undefined, OWNER)).toMatchObject({
			text: 'to eng-all@ and 1 other',
		})
		expect(recipientSummary(msg('l', ALAN, [ENG_ALL]), undefined, OWNER)).toMatchObject({
			text: 'to eng-all@',
		})
	})

	it('still says "to everyone" when a reply all adds someone', () => {
		// Grace adds Mary: the "Grace added Mary Jackson" line says so.
		expect(recipientSummary(m7 as MailMessage, m6, OWNER)).toEqual({ text: 'to everyone', changed: false })
	})

	it('marks recipients that leave out someone the previous message involved', () => {
		expect(recipientSummary(msg('r', ADA, [GRACE]), m6, OWNER)).toEqual({ text: 'to Grace', changed: true })
		expect(recipientSummary(msg('s', ALAN, [ADA, GRACE]), m7, OWNER)).toEqual({
			text: 'to you, Grace',
			changed: true,
		})
	})

	it('keeps names in a two-person exchange and handles no recipients', () => {
		const a = msg('a', ALAN, [ADA])
		const b = msg('b', ADA, [ALAN])
		expect(recipientSummary(b, a, OWNER)).toEqual({ text: 'to Alan', changed: false })
		expect(recipientSummary(msg('c', ADA, []), a, OWNER)).toEqual({
			text: 'to undisclosed recipients',
			changed: false,
		})
	})
})

describe('dates', () => {
	it('spans first to last with today and yesterday in words', () => {
		expect(dateSpanLabel(ago(17), NOW, NOW, TZ)).toBe('Sep 28 – today')
		expect(dateSpanLabel(NOW, ago(17), NOW, TZ)).toBe('Sep 28 – today')
		expect(dateSpanLabel(ago(16), ago(3), NOW, TZ)).toBe('Sep 29 – Oct 12')
		expect(dateSpanLabel(ago(1), ago(1, 2), NOW, TZ)).toBe('yesterday')
		expect(dateSpanLabel(0, ago(1), NOW, TZ)).toBe('yesterday')
		expect(dateSpanLabel(0, Number.NaN, NOW, TZ)).toBe('')
		expect(dateSpanLabel(ago(300), ago(17), NOW, TZ)).toBe('Dec 19, 2025 – Sep 28')
	})

	it('accepts now in milliseconds', () => {
		expect(dateSpanLabel(ago(17), NOW, NOW * 1000, TZ)).toBe('Sep 28 – today')
	})

	it('reads days in the reader’s time zone and falls back to UTC for an unknown zone', () => {
		// 02:00 UTC on Thursday is still Wednesday evening in Los Angeles.
		const early = NOW - 10 * 3600
		expect(sinceDayLabel(early, NOW, 'America/Los_Angeles')).toBe('yesterday')
		expect(sinceDayLabel(early, NOW, 'UTC')).toBe('earlier today')
		expect(sinceDayLabel(early, NOW, 'Not/AZone')).toBe('earlier today')
		expect(sinceDayLabel(early, NOW, 'Not/AZone')).toBe('earlier today')
	})

	it('names the day of the last read message', () => {
		expect(sinceDayLabel(ago(2), NOW, TZ)).toBe('Tuesday')
		expect(sinceDayLabel(ago(6), NOW, TZ)).toBe('Friday')
		expect(sinceDayLabel(ago(7), NOW, TZ)).toBe('Oct 8')
		expect(sinceDayLabel(NOW + DAY, NOW, TZ)).toBe('Oct 16')
		expect(shortDayLabel(ago(2), NOW, TZ)).toBe('Tue')
		expect(shortDayLabel(ago(1), NOW, TZ)).toBe('yesterday')
		expect(shortDayLabel(ago(0), NOW, TZ)).toBe('today')
		expect(shortDayLabel(ago(12), NOW, TZ)).toBe('Oct 3')
	})

	it('groups the list by day', () => {
		expect(dayGroup(ago(0, 3), NOW, TZ)).toBe('Today')
		expect(dayGroup(NOW + 3600, NOW, TZ)).toBe('Today')
		expect(dayGroup(ago(1), NOW, TZ)).toBe('Yesterday')
		expect(dayGroup(ago(6), NOW, TZ)).toBe('This week')
		expect(dayGroup(ago(7), NOW, TZ)).toBe('Earlier')
		expect(dayGroup(0, NOW, TZ)).toBe('Earlier')
		expect(dayGroupHeading(ago(2), NOW, TZ)).toBe('This week')
		expect(dayGroupHeading(ago(17), NOW, TZ)).toBe('September')
		expect(dayGroupHeading(ago(300), NOW, TZ)).toBe('December 2025')
		expect(dayGroupHeading(0, NOW, TZ)).toBe('Earlier')
	})
})

describe('messageNewText', () => {
	it('drops plain-text quoted history and the signature', () => {
		const text = messageNewText(
			msg('p', ALAN, [], {
				body: 'Grace, two things.\n\nOtherwise ready.\n\n-- \nAlan Turing\nPrincipal Engineer\n\nOn Tue, Grace Hopper wrote:\n> Here is v3.',
			}),
		)
		expect(text).toBe('Grace, two things.\nOtherwise ready.')
	})

	it('cuts HTML at its quoted history and client signature', () => {
		expect(
			messageNewText(
				msg('h', ALAN, [], {
					body: '<div>Thanks Alan.</div><div><br></div><div class="gmail_quote">On Tue, Alan wrote:<blockquote>old</blockquote></div>',
				}),
			),
		).toBe('Thanks Alan.')
		expect(messageNewText(msg('h2', ALAN, [], { body: '<p>Hi</p><blockquote>old</blockquote>' }))).toBe('Hi')
		expect(messageNewText(msg('h3', ALAN, [], { body: '<blockquote>only quoted</blockquote>' }))).toBe('')
		expect(
			messageNewText(msg('h4', ALAN, [], { body: '<p>See below</p><div id="Signature">Alan</div>' })),
		).toBe('See below')
	})

	it('finds an unmarked contact signature by the sender’s name', () => {
		const body =
			'<p>Sounds good.</p><p>Alan Turing<br>Principal Engineer<br>alan@bletchley.dev<br>+44 20 7946 0958</p>'
		expect(messageNewText(msg('s', ALAN, [], { body }))).toBe('Sounds good.')
	})

	it('reads drafts as text and tolerates missing bodies', () => {
		expect(messageNewText(msg('d', ADA, [], { body: 'Draft text', ownmailDraft: true }))).toBe('Draft text')
		expect(messageNewText(msg('d2', ADA, [], { ownmailDraft: true }))).toBe('')
		expect(messageNewText(msg('e', ADA, [], { snippet: 'Snippet only' }))).toBe('Snippet only')
	})
})

describe('asksYou', () => {
	const [, , , , , m6, , m8] = q3Thread() as MailMessage[]

	it('finds a question that names the owner', () => {
		expect(asksYou(m8 as MailMessage, OWNER, 'Ada')).toBe(true)
	})

	it('finds a line addressed to the owner', () => {
		expect(
			asksYou(msg('x', GRACE, [ADA], { body: 'Hi Ada,\n\nPlease review the deck.' }), OWNER, 'Ada'),
		).toBe(true)
	})

	it('finds "you" in a question, unless it is addressed to someone else', () => {
		expect(asksYou(msg('y', GRACE, [ADA], { body: 'Can you send me the hotel?' }), OWNER, 'Ada')).toBe(true)
		expect(
			asksYou(msg('z', GRACE, [ADA, ALAN], { body: 'Alan, can you send me the hotel?' }), OWNER, 'Ada'),
		).toBe(false)
		expect(asksYou(msg('q', GRACE, [ADA], { body: 'Is ada@ownmail.com right?' }), OWNER, '')).toBe(true)
	})

	it('finds a question that names the owner even when it addresses someone else first', () => {
		expect(
			asksYou(msg('g', MARY, [ADA, GRACE], { body: 'Grace, can you and Ada confirm?' }), OWNER, 'Ada'),
		).toBe(true)
	})

	it('ignores statements, quoted questions and the owner’s own mail', () => {
		expect(asksYou(m6 as MailMessage, OWNER, 'Ada')).toBe(false)
		expect(asksYou(msg('o', ADA, [GRACE], { body: 'Grace, can you confirm?' }), OWNER, 'Ada')).toBe(false)
		expect(
			asksYou(
				msg('h', GRACE, [ADA], { body: 'Done.\n\nOn Mon, Ada wrote:\n> Ada, can you check?' }),
				OWNER,
				'Ada',
			),
		).toBe(false)
		expect(asksYou(msg('n', GRACE, [ADA], { body: 'Ada’s team shipped it.' }), OWNER, 'Ada')).toBe(false)
		expect(asksYou(msg('e', GRACE, [ADA]), OWNER, 'Ada')).toBe(false)
	})

	it('reads a question wrapped across lines or closed by a quote mark', () => {
		expect(asksYou(msg('w', GRACE, [ADA], { body: 'Will you\nbe there?”' }), OWNER, '')).toBe(true)
	})
})

describe('newSinceDivider', () => {
	it('sits before the first message unread at open', () => {
		expect(newSinceDivider(q3Thread(), Q3_UNREAD, NOW, TZ)).toEqual({
			beforeIndex: 5,
			count: 3,
			label: '3 new since Monday',
			since: 'Monday',
		})
	})

	it('prefers when the reader last read the thread, in seconds or milliseconds', () => {
		expect(newSinceDivider(q3Thread(), { ...Q3_UNREAD, lastReadAt: ago(2) }, NOW, TZ)).toMatchObject({
			label: '3 new since Tuesday',
			since: 'Tuesday',
		})
		expect(newSinceDivider(q3Thread(), { ...Q3_UNREAD, lastReadAt: ago(2) * 1000 }, NOW, TZ)?.since).toBe(
			'Tuesday',
		)
		expect(newSinceDivider(q3Thread(), { ...Q3_UNREAD, lastReadAt: 0 }, NOW, TZ)?.since).toBe('Monday')
	})

	it('is hidden when nothing or everything was unread', () => {
		expect(newSinceDivider(q3Thread(), { unreadIds: [] }, NOW, TZ)).toBeNull()
		expect(newSinceDivider(q3Thread(), { unreadIds: ['m1', 'm2'] }, NOW, TZ)).toBeNull()
		expect(newSinceDivider([], { unreadIds: ['m1'] }, NOW, TZ)).toBeNull()
	})

	it('drops the day when the last read message has no date', () => {
		const messages = [msg('a', GRACE, [ADA]), msg('b', GRACE, [ADA], { date: NOW })]
		expect(newSinceDivider(messages, { unreadIds: ['b'] }, NOW, TZ)).toMatchObject({
			label: '1 new',
			since: null,
		})
	})
})

describe('foldPlan', () => {
	const base = {
		owner: OWNER,
		ownerFirstName: 'Ada',
		expandedRuns: new Set<string>(),
		openIds: new Set<string>(),
		now: NOW,
		tz: TZ,
	}
	/** A long read thread: m0..m(n-1), all from rotating senders, none naming Ada. */
	function longThread(n: number): MailMessage[] {
		const senders = [GRACE, ALAN, KATHERINE, ADA, MARY, { name: 'Ben Lee', email: 'ben@example.com' }]
		return Array.from({ length: n }, (_, i) =>
			msg(`m${i}`, senders[i % senders.length], [GRACE], { date: ago(n - i), body: `Note ${i}.` }),
		)
	}
	const kinds = (items: FoldItem[]) =>
		items.map((item) =>
			item.kind === 'folded' ? `folded:${item.indices.join(',')}` : `${item.kind}:${item.index}`,
		)

	it('opens unread and latest, keeps the first and neighbours as lines, folds the rest', () => {
		const messages = longThread(14)
		const items = foldPlan(messages, { ...base, unreadIds: ['m11', 'm12', 'm13'] })
		expect(kinds(items)).toEqual([
			'line:0',
			'folded:1,2,3,4,5,6,7,8,9',
			'line:10',
			'open:11',
			'open:12',
			'open:13',
		])
		const folded = items[1] as Extract<FoldItem, { kind: 'folded' }>
		expect(folded.names).toBe('Alan, Katherine, you, Mary +2')
		expect(folded.span).toBe('Oct 2 – Oct 10')
		expect(folded.avatars.map((p) => personName(p, 'first'))).toEqual(['Alan', 'Katherine', 'you'])
		expect(folded.ids).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'])
		expect(folded.key).toBe('m1')
		expect(foldRunKey(messages, folded.indices)).toBe('m1')
	})

	it('folds the open messages’ read neighbours too on a phone (board 03)', () => {
		const messages = longThread(14)
		const items = foldPlan(messages, { ...base, unreadIds: ['m11', 'm12', 'm13'], neighbourLines: false })
		expect(kinds(items)).toEqual(['line:0', 'folded:1,2,3,4,5,6,7,8,9,10', 'open:11', 'open:12', 'open:13'])
		// A short run between open messages is still lines.
		const short = foldPlan(messages.slice(0, 4), { ...base, unreadIds: ['m3'], neighbourLines: false })
		expect(kinds(short)).toEqual(['line:0', 'line:1', 'line:2', 'open:3'])
	})

	it('leaves the span empty and shows only others when a folded run has no dates and no owner', () => {
		const messages = Array.from({ length: 8 }, (_, i) =>
			msg(`m${i}`, i % 2 ? ALAN : GRACE, [KATHERINE], { date: undefined, body: `Note ${i}.` }),
		)
		const folded = foldPlan(messages, { ...base, unreadIds: [] }).find((item) => item.kind === 'folded')
		expect(folded).toMatchObject({ kind: 'folded', span: '' })
		expect((folded as Extract<FoldItem, { kind: 'folded' }>).avatars.some((p) => p.isOwner)).toBe(false)
	})

	it('expands a run into one-line rows when the reader opened it', () => {
		const messages = longThread(6)
		const items = foldPlan(messages, { ...base, unreadIds: [], expandedRuns: new Set(['m1']) })
		expect(kinds(items)).toEqual(['line:0', 'line:1', 'line:2', 'line:3', 'line:4', 'open:5'])
	})

	it('keeps an expanded run as lines after the reader opens one of its rows', () => {
		const messages = longThread(14)
		const opts = { ...base, unreadIds: ['m11', 'm12', 'm13'] }
		const folded = foldPlan(messages, opts).find((item) => item.kind === 'folded')
		const expandedRuns = new Set(folded?.kind === 'folded' ? folded.ids : [])
		const items = foldPlan(messages, { ...opts, expandedRuns, openIds: new Set(['m5']) })
		expect(items.some((item) => item.kind === 'folded')).toBe(false)
		expect(kinds(items).slice(0, 8)).toEqual([
			'line:0',
			'line:1',
			'line:2',
			'line:3',
			'line:4',
			'open:5',
			'line:6',
			'line:7',
		])
		// Any one id of a run is enough to keep it expanded.
		const tail = foldPlan(messages, { ...opts, expandedRuns: new Set(['m8']), openIds: new Set(['m5']) })
		expect(kinds(tail)).toContain('folded:1,2,3')
		expect(kinds(tail)).toContain('line:7')
	})

	it('names a folded run’s senders in the order they spoke, the owner as “you”', () => {
		// The board's run: Alan, you, Katherine, Alan, Grace, you, Katherine, Alan, Grace.
		const order = [ALAN, ADA, KATHERINE, ALAN, GRACE, ADA, KATHERINE, ALAN, GRACE]
		const messages = [
			msg('m0', GRACE, [ADA], { date: ago(18) }),
			...order.map((from, i) => msg(`r${i}`, from, [GRACE], { date: ago(17 - i) })),
			msg('m10', KATHERINE, [ADA], { date: ago(3) }),
			msg('m11', ALAN, [ADA], { date: ago(2) }),
		]
		const folded = foldPlan(messages, { ...base, unreadIds: ['m11'] }).find((item) => item.kind === 'folded')
		expect(folded).toMatchObject({ names: 'Alan, you, Katherine, Grace' })
		// The stack follows the names, face over name: AT, AL, KJ here; AT, KJ, AL on the boards.
		expect(folded?.kind === 'folded' && folded.avatars.map((p) => personName(p, 'first'))).toEqual([
			'Alan',
			'you',
			'Katherine',
		])
	})

	it('does not fold a run across a message that could not load', () => {
		const messages = longThread(10)
		const items = foldPlan(messages, { ...base, unreadIds: [], breaksAfter: new Set([4]) })
		expect(kinds(items)).toEqual(['line:0', 'folded:1,2,3,4', 'folded:5,6,7', 'line:8', 'open:9'])
	})

	it('shows runs shorter than three as lines', () => {
		const messages = longThread(5)
		expect(kinds(foldPlan(messages, { ...base, unreadIds: [] }))).toEqual([
			'line:0',
			'line:1',
			'line:2',
			'line:3',
			'open:4',
		])
	})

	it('opens starred, targeted, reader-opened and owner-naming messages', () => {
		const messages = longThread(12)
		;(messages[2] as MailMessage).starred = true
		;(messages[6] as MailMessage).body = 'Ada should see this.'
		const items = foldPlan(messages, {
			...base,
			unreadIds: [],
			targetId: 'm4',
			openIds: new Set(['m9']),
		})
		expect(kinds(items)).toEqual([
			'line:0',
			'line:1',
			'open:2',
			'line:3',
			'open:4',
			'line:5',
			'open:6',
			'line:7',
			'line:8',
			'open:9',
			'line:10',
			'open:11',
		])
	})

	it('handles a single message, an all-unread thread and an empty one', () => {
		expect(kinds(foldPlan(longThread(1), { ...base, unreadIds: [] }))).toEqual(['open:0'])
		const all = longThread(4)
		expect(kinds(foldPlan(all, { ...base, unreadIds: all.map((m) => m.id) }))).toEqual([
			'open:0',
			'open:1',
			'open:2',
			'open:3',
		])
		expect(foldPlan([], { ...base, unreadIds: [] })).toEqual([])
	})

	it('folds undated runs without a span and defaults the clock and zone', () => {
		const messages = longThread(6).map(({ date: _date, ...rest }) => rest)
		const { now: _now, tz: _tz, ...defaults } = base
		const folded = foldPlan(messages, { ...defaults, unreadIds: [] }).find((item) => item.kind === 'folded')
		expect(folded).toMatchObject({ kind: 'folded', indices: [1, 2, 3], span: '' })
	})

	it('names the owner in a folded run as "you" and skips messages without a sender', () => {
		const messages = [
			msg('a', GRACE, [ADA], { date: ago(5) }),
			msg('b', ADA, [GRACE], { date: ago(4) }),
			msg('c', undefined, [GRACE], { date: ago(4) }),
			msg('d', ADA, [GRACE], { date: ago(3) }),
			msg('e', GRACE, [ADA], { date: ago(2) }),
			msg('f', GRACE, [ADA], { date: ago(1) }),
		]
		const folded = foldPlan(messages, { ...base, unreadIds: [] }).find((item) => item.kind === 'folded')
		expect(folded).toMatchObject({ indices: [1, 2, 3], names: 'you', span: 'Oct 11 – Oct 12' })
	})
})

describe('systemEvents', () => {
	it('reports who was added and a changed subject, above the message that changed it', () => {
		expect(systemEvents(q3Thread(), OWNER)).toEqual([
			{
				afterIndex: 2,
				text: 'Subject changed: “Q3 roadmap” → “… final review before Friday”',
			},
			{ afterIndex: 5, text: 'Grace added Mary Jackson' },
		])
	})

	it('reports who was removed, and the owner as the actor', () => {
		const messages = [
			msg('a', GRACE, [ADA, ALAN], { cc: [KATHERINE] }),
			msg('b', ALAN, [GRACE], { cc: [ADA] }),
			msg('c', ADA, [ALAN], { cc: [MARY, { email: 'ben@example.com' }] }),
		]
		expect(systemEvents(messages, OWNER)).toEqual([
			{ afterIndex: 0, text: 'Alan removed Katherine' },
			{ afterIndex: 1, text: 'You added Mary Jackson and ben@example.com' },
		])
	})

	it('does not read a reply to one person, a list reply or a bounce as removing anyone', () => {
		const list = { email: 'eng-all@vercel.com' }
		const dev = { name: 'Dev Patel', email: 'dev@vercel.com' }
		const lena = { name: 'Lena Fischer', email: 'lena@vercel.com' }
		expect(
			systemEvents(
				[msg('a', dev, [list]), msg('b', lena, [list]), msg('c', dev, [list]), msg('d', ALAN, [list])],
				OWNER,
			),
		).toEqual([])
		expect(
			systemEvents(
				[msg('a', GRACE, [ADA, ALAN, KATHERINE]), msg('b', ADA, [GRACE], { subject: 'Re: x' })],
				OWNER,
			),
		).toEqual([])
		const daemon = { name: 'Mail Delivery Subsystem', email: 'mailer-daemon@ownmail.com' }
		expect(
			systemEvents(
				[
					msg('a', ADA, [{ name: 'Meridian Bank', email: 'statements@meridianbank.com' }], {
						subject: 'Question about the June statement',
					}),
					msg('b', daemon, [ADA], { subject: 'Undeliverable: Question about the June statement' }),
				],
				OWNER,
			),
		).toEqual([])
	})

	it('does not count a reply sent only to a new address as adding them', () => {
		const other = { name: 'Mary Jackson', email: 'mjackson@vercel.com' }
		expect(
			systemEvents(
				[msg('a', other, [ADA], { subject: 'Billing' }), msg('b', ADA, [MARY], { subject: 'Re: Billing' })],
				OWNER,
			),
		).toEqual([])
	})

	it('ignores automated subject prefixes, invitations and bounces', () => {
		const ics = { id: 'i', filename: 'invite.ics', content_type: 'text/calendar' }
		expect(
			systemEvents(
				[
					msg('a', KATHERINE, [ADA, GRACE], {
						subject: 'Design review: token migration',
						attachments: [ics],
					}),
					msg('b', KATHERINE, [ADA, GRACE], {
						subject: 'Updated invitation: Design review: token migration @ Thu 2pm',
						attachments: [ics],
					}),
					msg('c', ADA, [KATHERINE, GRACE], {
						subject: 'Accepted: Design review: token migration @ Thu 2pm',
					}),
					msg('d', GRACE, [KATHERINE, ADA], { subject: 'Automatic reply: Design review: token migration' }),
					msg('e', { email: 'mailer-daemon@vercel.com' }, [ADA], {
						subject: 'Delivery Status Notification (Failure)',
					}),
					msg('f', KATHERINE, [ADA, GRACE], { subject: 'Re: Design review: token migration' }),
				],
				OWNER,
			),
		).toEqual([])
		expect(
			systemEvents(
				[
					msg('a', GRACE, [ADA, ALAN], { subject: 'Plan' }),
					msg('b', { email: 'mailer-daemon@vercel.com' }, [ADA], { subject: 'Undeliverable: Plan' }),
					msg('c', ALAN, [ADA, GRACE], { subject: 'Budget' }),
				],
				OWNER,
			),
		).toEqual([{ afterIndex: 1, text: 'Subject changed: “Plan” → “Budget”' }])
	})

	it('ignores forwards, Bcc-only mail, missing subjects and a single message', () => {
		const messages = [
			msg('a', GRACE, [ADA, ALAN], { subject: 'Plan' }),
			msg('b', ALAN, [], { bcc: [ADA] }),
			msg('c', ALAN, [ADA], { subject: 'Fwd: Plan' }),
			msg('d', undefined, [ADA, ALAN, GRACE]),
		]
		expect(systemEvents(messages, OWNER)).toEqual([])
		expect(systemEvents([msg('a', GRACE, [ADA])], OWNER)).toEqual([])
	})

	it('elides a subject only where the new one restates the old', () => {
		expect(subjectChangeText('Q3 roadmap', 'Q3 roadmap: final review')).toBe(
			'Subject changed: “Q3 roadmap” → “… final review”',
		)
		expect(subjectChangeText('Plan', 'Budget')).toBe('Subject changed: “Plan” → “Budget”')
		expect(subjectChangeText('Plan', 'Budget: plan')).toBe('Subject changed: “Plan” → “Budget: plan”')
		expect(subjectChangeText('!!', 'Budget: plan')).toBe('Subject changed: “!!” → “Budget: plan”')
		expect(subjectChangeText('Plan', 'plan')).toBe('Subject changed: “Plan” → “plan”')
	})
})

describe('files', () => {
	it('collects each file once, newest first, with versions folded under the newest', () => {
		const files = threadFiles(q3Thread(), OWNER)
		expect(files.map((f) => f.filename)).toEqual(['Q3-roadmap-v4.pdf', 'planning-notes.docx'])
		const [roadmap, notes] = files as [(typeof files)[number], (typeof files)[number]]
		expect(roadmap.olderVersions.map((f) => f.filename)).toEqual(['Q3-roadmap-v3.pdf', 'Q3-roadmap-v1.pdf'])
		expect(roadmap.versionOf).toBe('Q3-roadmap-v3.pdf')
		expect(roadmap.from).toEqual(person(GRACE))
		expect(notes).toMatchObject({ contentType: '', size: 40_000, from: person(ADA, true), olderVersions: [] })
		expect(versionLabel(roadmap, NOW, TZ)).toBe('replaces v3 from Mon')
		expect(versionLabel(notes, NOW, TZ)).toBeNull()
	})

	it('skips inline images, signature logos and invitations, and lists an attachment id once', () => {
		const messages = [
			msg('a', GRACE, [ADA], {
				date: 10,
				attachments: [
					{ id: '1', filename: 'image001.png', content_type: 'image/png', size: 90_000 },
					{ id: '2', filename: 'photo.jpg', content_type: 'image/jpeg', size: 2_000 },
					{ id: '3', filename: 'inline.png', content_type: 'image/png', is_inline: true },
					{ id: '4', filename: 'cid.png', content_type: 'image/png', content_id: 'x', size: 90_000 },
					{ id: '5', filename: 'invite.ics', content_type: 'text/calendar' },
					{ id: '6', filename: 'sync-flow.png', content_type: 'image/png', size: 1_400_000 },
					{ id: '7', content_type: 'image/png' },
					{ id: '8', filename: 'report.pdf', size: 10 },
				],
			}),
			// The same id listed twice is one file.
			msg('a2', GRACE, [ADA], { date: 15, attachments: [{ id: '8', filename: 'report.pdf', size: 10 }] }),
		]
		expect(threadFiles(messages, OWNER).map((f) => f.attachmentId)).toEqual(['6', '7', '8'])
		expect(threadFiles(messages, OWNER)[1]?.filename).toBe('Untitled attachment')
		// Distinct ids are distinct files, even with one name and size: the newer
		// leads and the earlier stays on the shelf as its earlier version.
		const twice = [
			...messages,
			msg('b', ALAN, [ADA], { date: 20, attachments: [{ id: '9', filename: 'report.pdf', size: 10 }] }),
		]
		const report = threadFiles(twice, OWNER).find((f) => f.filename === 'report.pdf')
		expect(report?.attachmentId).toBe('9')
		expect(report?.olderVersions.map((f) => f.attachmentId)).toEqual(['8'])
		expect(threadFiles([], OWNER)).toEqual([])
	})

	it('folds -final, (1) and dotted versions into one family', () => {
		expect(fileFamilyKey('Q3-roadmap-v4.pdf')).toBe('q3-roadmap.pdf')
		expect(fileFamilyKey('Contract FINAL.docx')).toBe('contract.docx')
		expect(fileFamilyKey('contract (1).docx')).toBe('contract.docx')
		expect(fileFamilyKey('deck_v1.2-final (2).key')).toBe('deck.key')
		expect(fileFamilyKey('v2.pdf')).toBe('v2.pdf')
		expect(fileFamilyKey('README')).toBe('readme')
		expect(versionToken('Q3-roadmap-v3.pdf')).toBe('v3')
		expect(versionToken('deck v1.2.key')).toBe('v1.2')
		expect(versionToken('contract (1).docx')).toBe('(1)')
		expect(versionToken('contract-Final.docx')).toBe('final')
		expect(versionToken('contract.docx')).toBe('contract.docx')
	})

	it('orders a family by date and says when the replaced version has no date', () => {
		const messages = [
			msg('b', GRACE, [ADA], { attachments: [pdf('2', 'plan-v2.pdf', 2)] }),
			msg('a', GRACE, [ADA], { attachments: [pdf('1', 'plan-v1.pdf', 1)] }),
		]
		const [file] = threadFiles(messages, OWNER)
		expect(file?.filename).toBe('plan-v1.pdf')
		expect(versionLabel(file as NonNullable<typeof file>, NOW, TZ)).toBe('replaces v2')
	})

	it('classifies attachments directly', () => {
		expect(isThreadFile({ id: '1', filename: 'a.pdf' })).toBe(true)
		expect(isThreadFile({ id: '2', filename: 'logo.png', content_type: 'image/png' })).toBe(false)
		expect(isThreadFile({ id: '3', filename: 'shot.png', content_type: 'IMAGE/PNG' })).toBe(true)
	})
})

describe('catchUpFacts', () => {
	it('states the facts about the new messages', () => {
		const facts = catchUpFacts(q3Thread(), Q3_UNREAD, OWNER, 'Ada')
		expect(facts).toEqual({
			newCount: 3,
			joined: [person(MARY)],
			replacedFiles: [{ file: 'Q3-roadmap-v4.pdf', replaces: 'v3' }],
			questionsToYou: [{ messageId: 'm8', from: person(MARY) }],
		})
	})

	it('has nothing to say without unread messages, and nobody joins an all-new thread', () => {
		expect(catchUpFacts(q3Thread(), { unreadIds: [] }, OWNER, 'Ada')).toEqual({
			newCount: 0,
			joined: [],
			replacedFiles: [],
			questionsToYou: [],
		})
		const all = q3Thread()
		const facts = catchUpFacts(all, { unreadIds: all.map((m) => m.id) }, OWNER, 'Ada')
		expect(facts.newCount).toBe(8)
		expect(facts.joined).toEqual([])
	})
})

describe('threadMap', () => {
	it('lists every message with chips, events and where you stopped', () => {
		const { entries, stoppedBeforeIndex } = threadMap(q3Thread(), Q3_UNREAD, OWNER)
		expect(stoppedBeforeIndex).toBe(5)
		expect(entries.map((e) => e.chips)).toEqual([
			['v1'],
			[],
			['docx'],
			[],
			['v3'],
			[],
			['v4', '+ Mary'],
			['asks you'],
		])
		expect(entries[3]?.event).toBe('Subject changed: “Q3 roadmap” → “… final review before Friday”')
		expect(entries[0]).toMatchObject({ messageId: 'm1', from: person(GRACE), date: ago(17), unread: false })
		expect(entries[0]).not.toHaveProperty('event')
		expect(entries[7]?.unread).toBe(true)
	})

	it('falls back to the file type, then the name, and marks removed people', () => {
		const messages = [
			msg('a', GRACE, [ADA, ALAN, KATHERINE], {
				attachments: [
					{ id: '1', filename: 'notes.txt' },
					{ id: '2', filename: 'Makefile' },
				],
			}),
			msg('b', GRACE, [ADA, ALAN], { attachments: [{ id: '3', filename: 'notes (1).txt' }] }),
			msg('c', GRACE, [ADA], { attachments: [{ id: '4', filename: 'notes final.txt' }] }),
		]
		const { entries, stoppedBeforeIndex } = threadMap(messages, { unreadIds: ['a'] }, OWNER, 'Ada')
		expect(entries.map((e) => e.chips)).toEqual([['txt', 'Makefile'], ['(1)', '− Katherine'], ['final']])
		expect(stoppedBeforeIndex).toBeNull()
		expect(
			threadMap(
				[
					msg('x', GRACE, [ADA], { attachments: [{ id: '1', filename: 'Makefile' }] }),
					msg('y', GRACE, [ADA], { attachments: [{ id: '2', filename: 'makefile', size: 3 }] }),
				],
				{ unreadIds: [] },
				OWNER,
			).entries.map((e) => e.chips),
		).toEqual([['Makefile'], ['makefile']])
	})

	it('learns the owner’s first name from the thread when not given', () => {
		const messages = [msg('a', ADA, [GRACE]), msg('b', GRACE, [ADA], { body: 'Ada, ready?' })]
		expect(threadMap(messages, { unreadIds: [] }, OWNER).entries[1]?.chips).toEqual(['asks you'])
		expect(
			threadMap([msg('c', GRACE, [{ email: OWNER }], { body: 'Done.' })], { unreadIds: [] }, OWNER).entries[0]
				?.chips,
		).toEqual([])
	})
})

describe('message edge states', () => {
	it('stands in the first line for a missing subject', () => {
		expect(subjectStandIn('  Q3   roadmap ', 'x')).toEqual({ text: 'Q3 roadmap', isStandIn: false })
		expect(subjectStandIn(undefined, 'Can you send me the Lisbon hotel confirmation for the 24th?')).toEqual({
			text: 'Can you send me the Lisbon hotel…',
			isStandIn: true,
		})
		expect(subjectStandIn('(no subject)', '<p>Short line</p><p>More</p>')).toEqual({
			text: 'Short line',
			isStandIn: true,
		})
		expect(subjectStandIn('', 'x'.repeat(60))).toEqual({ text: `${'x'.repeat(40)}…`, isStandIn: true })
		expect(subjectStandIn('', '')).toEqual({ text: 'No subject', isStandIn: false })
	})

	it('says when a message has no text and what it carried', () => {
		const contract = { id: 'f', filename: 'contract-signed.pdf' }
		expect(emptyBodyNote(msg('a', GRACE, [ADA], { attachments: [contract] }), OWNER)).toBe(
			'No message text. Grace sent 1 file.',
		)
		expect(
			emptyBodyNote(
				msg('b', ADA, [GRACE], { body: ' ', attachments: [contract, { id: 'g', filename: 'b.pdf' }] }),
				OWNER,
			),
		).toBe('No message text. You sent 2 files.')
		expect(emptyBodyNote(msg('c', GRACE, [ADA]), OWNER)).toBe('No message text.')
		expect(emptyBodyNote(msg('d', GRACE, [ADA], { body: 'Hi' }), OWNER)).toBeNull()
		expect(emptyBodyNote(msg('e', GRACE, [ADA], { body: '<div><img src="x"></div>' }), OWNER)).toBeNull()
	})

	it('estimates reading time at 238 words a minute', () => {
		expect(readingStats('')).toEqual({ words: 0, minutes: 0 })
		expect(readingStats('One two, three.')).toEqual({ words: 3, minutes: 1 })
		expect(readingStats(Array.from({ length: 1500 }, () => 'word').join(' '))).toEqual({
			words: 1500,
			minutes: 6,
		})
		expect(readingStats('don’t re-read شكراً 42')).toEqual({ words: 4, minutes: 1 })
	})

	it('counts who Reply all would reach', () => {
		const message = msg('a', ALAN, [ADA, GRACE], { cc: [KATHERINE, { email: 'grace@ownmail.com' }] })
		expect(replyAllCount(message, OWNER)).toBe(3)
		expect(replyAllCount({ ...message, reply_to: [MARY] }, OWNER)).toBe(3)
		expect(replyAllCount(msg('b', undefined, [ADA]), OWNER)).toBe(0)
		const list = msg(
			'c',
			ALAN,
			Array.from({ length: 30 }, (_, i) => ({ email: `p${i}@example.com` })),
		)
		expect(replyAllCount(list, OWNER)).toBeGreaterThan(REPLY_ALL_GUARD)
	})
})

describe('supersededInvites', () => {
	const ics = { id: 'i', filename: 'invite.ics', content_type: 'text/calendar' }
	const invite = (id: string, subject: string, date?: number) =>
		msg(id, KATHERINE, [ADA], { subject, attachments: [ics], ...(date ? { date } : {}) })

	it('groups invitations for one event and keeps the newest', () => {
		const messages = [
			invite('v1', 'Invitation: Design review: token migration @ Thu 1pm', 10),
			msg('x', GRACE, [ADA], { subject: 'Unrelated' }),
			invite('v3', 'Updated invitation: Design review: token migration @ Thu 2pm', 30),
			invite('v2', 'Updated invitation: Design review: token migration @ Thu 1:30pm', 20),
			invite('other', 'Invitation: Standup', 15),
		]
		const result = supersededInvites(messages)
		expect([...result.values()]).toEqual([{ latestId: 'v3', versions: ['v1', 'v2', 'v3'] }])
		expect([...result.keys()]).toEqual(['katherine@nasa.gov|design review: token migration'])
	})

	it('prefers the iCal UID when the caller knows it, and keeps order for undated invites', () => {
		const messages = [invite('a', 'One'), invite('b', 'Two')]
		const result = supersededInvites(messages, () => 'uid-1')
		expect(result.get('uid-1')).toEqual({ latestId: 'b', versions: ['a', 'b'] })
		expect(supersededInvites([msg('n', undefined, [], { attachments: [ics] })]).size).toBe(0)
	})
})

describe('bounceFor', () => {
	const sent = msg('s', ADA, [MARY], { cc: [{ email: ' ' }], bcc: [GRACE] })

	it('finds a bounce of the owner’s message and the address it names', () => {
		const bounce = msg('b', { email: 'MAILER-DAEMON@nasa.gov' }, [ADA], {
			subject: 'Undeliverable: Question about the June statement',
			snippet: 'Delivery to grace@ownmail.com failed.',
		})
		expect(bounceFor([sent, bounce], OWNER)).toEqual([
			{ bounceId: 'b', originalId: 's', address: 'grace@ownmail.com' },
		])
	})

	it('falls back to the first recipient', () => {
		const bounce = msg('b', { email: 'robot@nasa.gov' }, [ADA], {
			subject: 'Mail delivery failed: returning message',
		})
		expect(bounceFor([sent, bounce], OWNER)).toEqual([
			{ bounceId: 'b', originalId: 's', address: 'mary@nasa.gov' },
		])
		expect(bounceFor([msg('o', ADA, []), bounce], OWNER)).toEqual([
			{ bounceId: 'b', originalId: 'o', address: '' },
		])
	})

	it('ignores bounces of other people’s mail and ordinary mail', () => {
		const bounce = msg('b', { email: 'postmaster@nasa.gov' }, [ADA])
		expect(bounceFor([msg('g', GRACE, [MARY]), bounce], OWNER)).toEqual([])
		expect(bounceFor([bounce], OWNER)).toEqual([])
		expect(bounceFor([sent, msg('r', MARY, [ADA], { subject: 'Re: hi' })], OWNER)).toEqual([])
		expect(
			isBounceMessage(msg('x', undefined, [], { subject: 'Delivery Status Notification (Failure)' })),
		).toBe(true)
		expect(isBounceMessage(msg('y', undefined, []))).toBe(false)
	})
})

describe('classifyBundle', () => {
	const thread = (extra: Partial<MailThread>): MailThread => ({ id: 't', ...extra })

	it('bundles receipts with an amount', () => {
		const stripe = thread({
			subject: 'Invoice #2041 has been paid',
			snippet: 'You received a payment of $4,200.00 from…',
		})
		expect(classifyBundle(stripe)).toBe('receipt')
		expect(receiptAmount(stripe)).toBe('$4,200.00')
		expect(classifyBundle(thread({ subject: 'Your receipt from Apple', snippet: 'Total 2.99 USD' }))).toBe(
			'receipt',
		)
		expect(receiptAmount(thread({ subject: 'Your receipt', snippet: 'Total 2.99  USD' }))).toBe('2.99 USD')
	})

	it('bundles newsletters by sender, unsubscribe text or List-Unsubscribe', () => {
		expect(
			classifyBundle(thread({ participants: [{ email: 'newsletter@dispatch.com' }], subject: 'Issue 12' })),
		).toBe('newsletter')
		expect(
			classifyBundle(
				thread({
					latest_draft_or_message: {
						id: 'l',
						from: [{ email: 'noreply@figma.com' }],
						subject: 'Config',
						snippet: 'x',
					},
				}),
			),
		).toBe('newsletter')
		expect(classifyBundle(thread({ snippet: 'Read more. Unsubscribe here.' }))).toBe('newsletter')
		expect(classifyBundle(thread({ subject: 'Weekly' }), { listUnsubscribe: true })).toBe('newsletter')
	})

	it('leaves conversations, drafts and plain mail alone', () => {
		expect(classifyBundle(thread({ subject: 'Lunch?', participants: [GRACE, ADA] }))).toBeNull()
		expect(classifyBundle(thread({ subject: 'Order $5', participants: [GRACE, ALAN, ADA] }))).toBeNull()
		expect(
			classifyBundle(
				thread({ subject: 'Order $5', latest_draft_or_message: { id: 'd', ownmailDraft: true } }),
			),
		).toBeNull()
		expect(classifyBundle(thread({ subject: 'Your order shipped' }))).toBeNull()
		expect(receiptAmount(thread({}))).toBeNull()
	})
})

describe('messages without To', () => {
	// Providers omit empty recipient lists entirely; nothing may assume they are there.
	const bare = (id: string, from: Who, extra: Partial<MailMessage> = {}): MailMessage => ({
		id,
		from: [from],
		...extra,
	})

	it('reads them as having no recipients', () => {
		const first = bare('a', ADA, { attachments: [{ id: 'i', filename: 'inline.png', is_inline: true }] })
		const bounce = bare('b', { email: 'mailer-daemon@nasa.gov' })
		expect(recipientSummary(first, undefined, OWNER).text).toBe('to undisclosed recipients')
		expect(replyAllCount(bare('r', GRACE, { cc: [ALAN] }), OWNER)).toBe(2)
		expect(systemEvents([first, bare('c', GRACE)], OWNER)).toEqual([])
		expect(bounceFor([first, bounce], OWNER)).toEqual([{ bounceId: 'b', originalId: 'a', address: '' }])
		expect(threadMap([first], { unreadIds: [] }, OWNER, 'Ada').entries[0]?.chips).toEqual([])
		expect(threadParticipants([first], OWNER)).toEqual([person(ADA, true)])
	})
})

describe('an owner-only thread', () => {
	// Notes to self: every message from and to the owner.
	const notes = [
		msg('n1', ADA, [ADA], { subject: 'Notes', date: ago(3), body: 'Ada, remember the Lisbon hotel?' }),
		msg('n2', ADA, [ADA], { subject: 'Re: Notes', date: ago(2), body: 'Ada: book it.' }),
		msg('n3', ADA, [ADA], { subject: 'Re: Notes', date: ago(1), body: 'Done.' }),
		msg('n4', ADA, [ADA], { subject: 'Re: Notes', date: ago(0, 1), body: 'Ada, anything else?' }),
	]

	it('names the only person "you"', () => {
		const people = threadParticipants(notes, OWNER)
		expect(people).toEqual([person(ADA, true)])
		expect(participantsLabel(people)).toEqual({ names: 'you', more: 0 })
		expect(
			rowParticipants({ id: 't', participants: [ADA], latest_draft_or_message: notes[3] }, OWNER),
		).toEqual({
			names: 'you',
			more: 0,
		})
		expect(recipientSummary(notes[1] as MailMessage, notes[0], OWNER)).toEqual({
			text: 'to you',
			changed: false,
		})
		expect(replyAllCount(notes[1] as MailMessage, OWNER)).toBe(0)
	})

	it('never opens the owner’s own mail for naming the owner, and never asks', () => {
		const items = foldPlan(notes, {
			owner: OWNER,
			ownerFirstName: 'Ada',
			unreadIds: [],
			expandedRuns: new Set(),
			openIds: new Set(),
			now: NOW,
			tz: TZ,
		})
		expect(items.map((item) => item.kind)).toEqual(['line', 'line', 'line', 'open'])
		expect(catchUpFacts(notes, { unreadIds: ['n3', 'n4'] }, OWNER, 'Ada')).toEqual({
			newCount: 2,
			joined: [],
			replacedFiles: [],
			questionsToYou: [],
		})
		const map = threadMap(notes, { unreadIds: ['n3', 'n4'] }, OWNER)
		expect(map.stoppedBeforeIndex).toBe(2)
		expect(map.entries.map((e) => e.chips)).toEqual([[], [], [], []])
		expect(map.entries.every((e) => e.from.isOwner)).toBe(true)
		expect(systemEvents(notes, OWNER)).toEqual([])
		expect(newSinceDivider(notes, { unreadIds: ['n3', 'n4'] }, NOW, TZ)?.label).toBe('2 new since Tuesday')
	})
})
