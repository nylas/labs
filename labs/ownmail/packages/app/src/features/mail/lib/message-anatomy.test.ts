// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'
import {
	copyableAddresses,
	headerSenderName,
	headerTimeLabel,
	longDateLabel,
	lookalikeSender,
	mailingList,
	parseSignature,
	personChips,
	removedFromReply,
	replyToAddress,
	senderLocalTime,
	senderSignature,
	signatureLines,
	zoneAbbreviation,
	zoneOffsetMinutes,
} from './message-anatomy.js'
import type { Person } from './thread-reading-model.js'

const DAY = 86_400
/** Thursday 15 October 2026, 12:00 UTC. */
const NOW = 1_792_065_600
/** Wednesday 14 October 2026, 4:12 PM UTC: Alan's message on the boards. */
const WED = Date.UTC(2026, 9, 14, 16, 12) / 1000
/** A winter moment, when the US and Europe are on standard time. */
const JANUARY = Date.UTC(2026, 0, 14, 12, 0) / 1000

const OWNER = 'ada@ownmail.com'
const ADA = { name: 'Ada Lovelace', email: 'Ada@ownmail.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@vercel.com' }
const PM_LEADS = { email: 'pm-leads@vercel.com' }

type Who = { name?: string; email: string }

function msg(id: string, from: Who | undefined, to: Who[], extra: Partial<MailMessage> = {}): MailMessage {
	return { id, ...(from ? { from: [from] } : {}), to, ...extra } as MailMessage
}

const person = (who: Who, isOwner = false): Person => ({ name: who.name ?? '', email: who.email, isOwner })
const facts = (extra: Partial<MessageHeaderFacts> = {}): MessageHeaderFacts => ({
	verified: false,
	authFailed: false,
	listUnsubscribe: false,
	...extra,
})

describe('headerTimeLabel', () => {
	it('says the time today, the weekday this week, the date this year and the year before that', () => {
		expect(headerTimeLabel(NOW - 3 * 3600, NOW, 'UTC')).toBe('9:00 AM')
		expect(headerTimeLabel(WED, NOW, 'UTC')).toBe('Wed 4:12 PM')
		expect(headerTimeLabel(NOW - 10 * DAY, NOW, 'UTC')).toBe('Oct 5, 12:00 PM')
		expect(headerTimeLabel(NOW - 400 * DAY, NOW, 'UTC')).toBe('Sep 10, 2025')
	})

	it('reads now in milliseconds, dates a future message, and falls back to UTC for an unknown zone', () => {
		expect(headerTimeLabel(WED, NOW * 1000, 'Mars/Olympus_Mons')).toBe('Wed 4:12 PM')
		expect(headerTimeLabel(NOW + DAY, NOW, 'UTC')).toBe('Oct 16, 12:00 PM')
		expect(headerTimeLabel(WED, NOW, 'America/Los_Angeles')).toBe('Wed 9:12 AM')
	})
})

describe('longDateLabel', () => {
	it('writes the full date and time', () => {
		expect(longDateLabel(WED, 'UTC')).toBe('Wed, Oct 14, 2026, 4:12 PM')
	})
})

describe('time zones', () => {
	it('reads a zone offset at a moment', () => {
		expect(zoneOffsetMinutes(WED, 'America/Los_Angeles')).toBe(-420)
		expect(zoneOffsetMinutes(JANUARY, 'America/Los_Angeles')).toBe(-480)
		expect(zoneOffsetMinutes(WED, 'Asia/Kolkata')).toBe(330)
		expect(zoneOffsetMinutes(WED, 'UTC')).toBe(0)
	})

	it('reads whatever the runtime’s ICU writes for a zone offset, signed or not', () => {
		// "GMT" (UTC), "GMT+05:30" and "GMT−07:00" (a true minus sign) vary by ICU
		// version, so each shape is checked whatever this machine's zone data writes.
		const parts = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
		try {
			for (const [value, minutes] of [
				['GMT', 0],
				['GMT+05:30', 330],
				['GMT-07:00', -420],
				['GMT−08:00', -480],
			] as const) {
				parts.mockReturnValueOnce([{ type: 'timeZoneName', value }])
				expect(zoneOffsetMinutes(WED, 'Asia/Kolkata')).toBe(minutes)
			}
		} finally {
			parts.mockRestore()
		}
	})

	it('names an offset after the first well-known zone that has it then', () => {
		expect(zoneAbbreviation(-420, WED)).toBe('PDT')
		expect(zoneAbbreviation(-420, JANUARY)).toBe('MST')
		expect(zoneAbbreviation(60, WED)).toBe('BST')
		expect(zoneAbbreviation(120, WED)).toBe('CEST')
		expect(zoneAbbreviation(0, JANUARY)).toBe('GMT')
	})

	it('falls back to a UTC offset when no well-known zone has it', () => {
		expect(zoneAbbreviation(0, WED)).toBe('UTC')
		expect(zoneAbbreviation(345, WED)).toBe('UTC+5:45')
		expect(zoneAbbreviation(-60, WED)).toBe('UTC−1')
	})

	it('gives the sender’s own clock only when it differs from the reader’s', () => {
		expect(senderLocalTime(WED, -420, 'Europe/Berlin')).toEqual({ time: '9:12 AM', zone: 'PDT' })
		expect(senderLocalTime(WED, 120, 'Europe/Berlin')).toBeNull()
		expect(senderLocalTime(WED, undefined, 'Europe/Berlin')).toBeNull()
		expect(senderLocalTime(WED, Number.NaN, 'Europe/Berlin')).toBeNull()
	})
})

describe('lookalikeSender', () => {
	const known = [person({ name: 'Meridian Bank', email: 'statements@meridianbank.com' })]
	const fake = msg('m', { name: 'Meridian Bank', email: 'alerts@Meridian-Secure.co' }, [ADA])

	it('flags a known name writing from another organisation', () => {
		expect(lookalikeSender(fake, known, OWNER)).toEqual({
			name: 'Meridian Bank',
			usualDomain: 'meridianbank.com',
			domain: 'meridian-secure.co',
		})
		expect(
			lookalikeSender(fake, [person({ name: ' meridian  bank ', email: 'x@meridianbank.com' })], OWNER),
		).not.toBeNull()
	})

	it('trusts the same organisation, strangers, the owner and nameless senders', () => {
		const sub = msg('m', { name: 'Meridian Bank', email: 'alerts@mail.meridianbank.com' }, [ADA])
		expect(lookalikeSender(sub, known, OWNER)).toBeNull()
		expect(
			lookalikeSender(
				fake,
				[...known, person({ name: 'Meridian Bank', email: 'x@meridian-secure.co' })],
				OWNER,
			),
		).toBeNull()
		expect(lookalikeSender(fake, [person(GRACE)], OWNER)).toBeNull()
		expect(lookalikeSender(fake, [person({ name: 'Meridian Bank', email: '' })], OWNER)).toBeNull()
		expect(
			lookalikeSender(fake, [person({ name: 'Meridian Bank', email: 'm@ownmail.com' }, true)], OWNER),
		).toBeNull()
		expect(lookalikeSender(msg('m', ADA, [GRACE]), [person(ADA)], OWNER)).toBeNull()
		expect(lookalikeSender(msg('m', { email: 'alerts@meridian-secure.co' }, [ADA]), known, OWNER)).toBeNull()
		expect(lookalikeSender(msg('m', undefined, [ADA]), known, OWNER)).toBeNull()
	})

	it('does not let the sender’s own address vouch for it', () => {
		const saved = person({ name: 'Meridian Bank', email: 'ALERTS@meridian-secure.co' })
		expect(lookalikeSender(fake, [...known, saved], OWNER)).toEqual({
			name: 'Meridian Bank',
			usualDomain: 'meridianbank.com',
			domain: 'meridian-secure.co',
		})
		expect(lookalikeSender(fake, [saved], OWNER)).toBeNull()
	})

	it('names sibling hosts of one domain by their hosts, under any suffix', () => {
		const sibling = msg('m', { name: 'Meridian Bank', email: 'alerts@news.meridian.co.uk' }, [ADA])
		expect(
			lookalikeSender(sibling, [person({ name: 'Meridian Bank', email: 'x@mail.meridian.co.uk' })], OWNER),
		).toEqual({ name: 'Meridian Bank', usualDomain: 'mail.meridian.co.uk', domain: 'news.meridian.co.uk' })
		const plain = msg('m', { name: 'Meridian Bank', email: 'alerts@news.meridianbank.com' }, [ADA])
		expect(
			lookalikeSender(plain, [person({ name: 'Meridian Bank', email: 'x@mail.meridianbank.com' })], OWNER),
		).toEqual({
			name: 'Meridian Bank',
			usualDomain: 'mail.meridianbank.com',
			domain: 'news.meridianbank.com',
		})
		const pages = msg('m', { name: 'Victim', email: 'a@attacker.github.io' }, [ADA])
		expect(lookalikeSender(pages, [person({ name: 'Victim', email: 'a@victim.github.io' })], OWNER)).toEqual({
			name: 'Victim',
			usualDomain: 'victim.github.io',
			domain: 'attacker.github.io',
		})
	})

	it('names an address without a domain as it is', () => {
		const odd = msg('m', { name: 'Meridian Bank', email: 'meridian' }, [ADA])
		expect(lookalikeSender(odd, known, OWNER)).toEqual({
			name: 'Meridian Bank',
			usualDomain: 'meridianbank.com',
			domain: '',
		})
	})
})

describe('replyToAddress', () => {
	it('prefers the server’s Reply-To fact', () => {
		expect(
			replyToAddress(msg('m', GRACE, [ADA]), facts({ replyTo: 'grace.personal@fastmail.com' }), OWNER),
		).toBe('grace.personal@fastmail.com')
	})

	it('falls back to the message’s own Reply-To when it differs from the sender', () => {
		const message = msg('m', GRACE, [ADA], { reply_to: [{ email: ' grace.personal@fastmail.com ' }] })
		expect(replyToAddress(message, undefined, OWNER)).toBe('grace.personal@fastmail.com')
		expect(replyToAddress(message, facts(), OWNER)).toBe('grace.personal@fastmail.com')
	})

	it('says nothing for the same address, no Reply-To, or the owner’s own mail', () => {
		expect(
			replyToAddress(msg('m', GRACE, [ADA], { reply_to: [{ email: 'GRACE@vercel.com' }] }), undefined, OWNER),
		).toBeNull()
		expect(replyToAddress(msg('m', GRACE, [ADA], { reply_to: [] }), undefined, OWNER)).toBeNull()
		expect(replyToAddress(msg('m', GRACE, [ADA]), undefined, OWNER)).toBeNull()
		expect(replyToAddress(msg('m', ADA, [GRACE]), facts({ replyTo: 'x@y.com' }), OWNER)).toBeNull()
	})
})

describe('removedFromReply', () => {
	const prev = msg('m1', KATHERINE, [ALAN, GRACE, ADA])
	const reply = msg('m2', ALAN, [ADA, GRACE], { subject: 'Re: Token migration' })

	it('names who a reply all dropped, never the owner', () => {
		expect(removedFromReply(reply, prev, OWNER)).toEqual([person(KATHERINE)])
		const withoutOwner = msg('m2', ALAN, [GRACE, KATHERINE])
		expect(removedFromReply(withoutOwner, prev, OWNER)).toEqual([])
	})

	it('counts nothing without a previous message, for a reply to one person, or from the owner', () => {
		expect(removedFromReply(reply, undefined, OWNER)).toEqual([])
		expect(removedFromReply(msg('m2', ALAN, [ADA]), prev, OWNER)).toEqual([])
		expect(removedFromReply(msg('m2', ADA, [GRACE, ALAN]), prev, OWNER)).toEqual([])
	})

	it('ignores forwards, bounces and invitations', () => {
		expect(removedFromReply({ ...reply, subject: 'Fwd: Token migration' }, prev, OWNER)).toEqual([])
		expect(
			removedFromReply({ ...reply, from: [{ email: 'mailer-daemon@ownmail.com' }] }, prev, OWNER),
		).toEqual([])
		expect(removedFromReply(reply, { ...prev, subject: 'Undeliverable: x' }, OWNER)).toEqual([])
		const invite = {
			...reply,
			attachments: [{ id: 'a', filename: 'invite.ics', content_type: 'text/calendar', size: 1 }],
		}
		expect(removedFromReply(invite, prev, OWNER)).toEqual([])
	})

	it('reads messages without sender or recipients', () => {
		expect(
			removedFromReply(msg('m2', undefined, [ADA, GRACE]), msg('m1', undefined, [ADA, GRACE, ALAN]), OWNER),
		).toEqual([person(ALAN)])
		expect(removedFromReply({ id: 'm2', from: [ALAN] } as MailMessage, prev, OWNER)).toEqual([])
	})
})

describe('mailingList', () => {
	const copied = Array.from({ length: 238 }, (_, index) => ({
		name: `P ${index}`,
		email: `p${index}@vercel.com`,
	}))
	const freeze = msg('m', ALAN, [{ email: 'eng-all@vercel.com' }], { cc: copied })

	it('counts the people a list message shows when the list is the only To', () => {
		expect(mailingList(freeze, facts({ listId: 'eng-all.vercel.com' }), OWNER)).toEqual({
			label: 'eng-all@',
			count: 240,
		})
		expect(mailingList(freeze, undefined, OWNER)).toEqual({ label: 'eng-all@', count: 240 })
		const withOwner = { ...freeze, cc: [...copied, ADA] }
		expect(mailingList(withOwner, undefined, OWNER)).toEqual({ label: 'eng-all@', count: 240 })
		expect(mailingList({ ...freeze, from: undefined }, undefined, OWNER)).toEqual({
			label: 'eng-all@',
			count: 239,
		})
	})

	it('finds the list by List-Id, its local part, or the address alone', () => {
		const byLocal = msg('m', ALAN, [ADA, { email: 'Eng@lists.vercel.com' }])
		expect(mailingList(byLocal, facts({ listId: 'eng.vercel.com' }), OWNER)).toEqual({ label: 'eng@' })
		expect(mailingList(msg('m', ALAN, [{ email: 'all@vercel.com' }]), undefined, OWNER)).toEqual({
			label: 'all@',
		})
		expect(mailingList(msg('m', ALAN, [ADA, { email: 'pm-list@vercel.com' }]), undefined, OWNER)).toEqual({
			label: 'pm-list@',
		})
	})

	it('finds a copied list by its List-Id, and never names the owner as the list', () => {
		const copiedList = msg('m', ALAN, [GRACE], { cc: [{ email: 'design@vercel.com' }] })
		expect(mailingList(copiedList, facts({ listId: 'Design.Vercel.com' }), OWNER)).toEqual({
			label: 'design@',
		})
		expect(mailingList(msg('m', ALAN, [ADA]), facts({ listId: 'ada.lists.example' }), OWNER)).toEqual({})
	})

	it('makes up no address when the List-Id names no recipient', () => {
		const github = msg('m', { name: 'GitHub', email: 'notifications@github.com' }, [ADA])
		expect(mailingList(github, facts({ listId: 'labs.nylas.github.com' }), OWNER)).toEqual({})
		expect(
			mailingList(msg('m', ALAN, [ADA], { cc: [GRACE] }), facts({ listId: 'abc123.mcsv.net' }), OWNER),
		).toEqual({})
	})

	it('states no size for a small visible count, or when the list is not the sole To', () => {
		const small = msg('m', ALAN, [{ email: 'eng-all@vercel.com' }], { cc: [GRACE] })
		expect(mailingList(small, facts({ listId: 'eng-all.vercel.com' }), OWNER)).toEqual({ label: 'eng-all@' })
		const listCopied = msg('m', ALAN, [GRACE], { cc: [{ email: 'eng-all@vercel.com' }, ...copied] })
		expect(mailingList(listCopied, facts({ listId: 'eng-all.vercel.com' }), OWNER)).toEqual({
			label: 'eng-all@',
		})
		expect(mailingList(msg('m', ALAN, [{ email: 'eng-all@vercel.com' }]), undefined, OWNER)).toEqual({
			label: 'eng-all@',
		})
	})

	it('is null for ordinary mail', () => {
		expect(mailingList(msg('m', ALAN, [ADA, PM_LEADS]), facts(), OWNER)).toBeNull()
		expect(mailingList({ id: 'm' } as MailMessage, undefined, OWNER)).toBeNull()
	})
})

describe('personChips', () => {
	it('names the owner "You", people by name and a nameless address in full', () => {
		expect(
			personChips(
				[
					ADA,
					GRACE,
					PM_LEADS,
					{ email: 'ceo@attacker.example' },
					{ name: 'Grace', email: 'GRACE@vercel.com' },
					{ email: '' },
				],
				OWNER,
			),
		).toEqual([
			{ person: person(ADA, true), label: 'You', isList: false },
			{ person: person(GRACE), label: 'Grace Hopper', isList: false },
			{ person: person(PM_LEADS), label: 'pm-leads@vercel.com', isList: false },
			{ person: person({ email: 'ceo@attacker.example' }), label: 'ceo@attacker.example', isList: false },
		])
		expect(personChips(undefined, OWNER)).toEqual([])
	})

	it('shortens a list to its local part, with its member count when known', () => {
		const lists = [PM_LEADS, { email: 'eng-all@vercel.com' }, { email: 'design@vercel.com' }, GRACE]
		expect(
			personChips(lists, OWNER, {
				listId: 'Design.Vercel.com',
				listSizes: { 'pm-leads@vercel.com': 12.4, 'grace@vercel.com': 3 },
			}),
		).toEqual([
			{ person: person(PM_LEADS), label: 'pm-leads@', isList: true, count: 12 },
			{ person: person({ email: 'eng-all@vercel.com' }), label: 'eng-all@', isList: true },
			{ person: person({ email: 'design@vercel.com' }), label: 'design@', isList: true },
			{ person: person(GRACE), label: 'Grace Hopper', isList: true, count: 3 },
		])
	})

	it('ignores list sizes that are not counts, and never marks the owner as a list', () => {
		expect(
			personChips([PM_LEADS, ADA], OWNER, {
				listSizes: { 'pm-leads@vercel.com': 0, 'ada@ownmail.com': 4 },
			}),
		).toEqual([
			{ person: person(PM_LEADS), label: 'pm-leads@vercel.com', isList: false },
			{ person: person(ADA, true), label: 'You', isList: false },
		])
		expect(personChips([PM_LEADS], OWNER, { listSizes: { 'pm-leads@vercel.com': Number.NaN } })).toEqual([
			{ person: person(PM_LEADS), label: 'pm-leads@vercel.com', isList: false },
		])
	})
})

describe('copyableAddresses', () => {
	it('lists everyone but the owner once, with names where known', () => {
		const message = msg('m', ALAN, [ADA, GRACE], {
			cc: [KATHERINE, PM_LEADS],
			bcc: [{ email: 'grace@vercel.com' }],
			reply_to: [{ email: 'alan@home.dev' }],
		})
		expect(copyableAddresses(message, OWNER)).toBe(
			'Alan Turing <alan@bletchley.dev>, Grace Hopper <grace@vercel.com>, Katherine Johnson <katherine@vercel.com>, pm-leads@vercel.com, alan@home.dev',
		)
		expect(copyableAddresses({ id: 'm' } as MailMessage, OWNER)).toBe('')
	})
})

describe('headerSenderName', () => {
	it('is the full name, "You" for the owner', () => {
		expect(headerSenderName(msg('m', ALAN, [ADA]), OWNER)).toBe('Alan Turing')
		expect(headerSenderName(msg('m', ADA, [ALAN]), OWNER)).toBe('You')
		expect(headerSenderName(msg('m', undefined, [ADA]), OWNER)).toBe('Unknown sender')
	})
})

const alanHtml = `<div dir="ltr"><p>Otherwise this is ready.</p><div class="gmail_signature">Alan Turing<br>Principal Engineer, Bletchley<br>alan@bletchley.dev<br>+44 20 7946 0958</div></div><blockquote>On Tue, Grace wrote: v3 attached</blockquote>`

describe('signatureLines', () => {
	it('reads a signature the sender’s client marked', () => {
		expect(signatureLines(msg('m', ALAN, [ADA], { body: alanHtml }))).toEqual([
			'Alan Turing',
			'Principal Engineer, Bletchley',
			'alan@bletchley.dev',
			'+44 20 7946 0958',
		])
	})

	it('finds an unmarked closing contact block in plain text', () => {
		const body =
			'Thanks, see you Friday.\n\nAlan Turing\nPrincipal Engineer\nalan@bletchley.dev\n+44 20 7946 0958'
		expect(signatureLines(msg('m', ALAN, [ADA], { body }))).toEqual([
			'Alan Turing',
			'Principal Engineer',
			'alan@bletchley.dev',
			'+44 20 7946 0958',
		])
	})

	it('looks only above the quoted history', () => {
		const body =
			'Thanks, see you Friday.\n\nAlan Turing\nPrincipal Engineer\nalan@bletchley.dev\n+44 20 7946 0958\n\nOn Tue, Grace Hopper wrote:\n> Here is v3.\n> Grace Hopper\n> grace@vercel.com\n> +1 555 010 0000'
		expect(signatureLines(msg('m', ALAN, [ADA], { body }))).toEqual([
			'Alan Turing',
			'Principal Engineer',
			'alan@bletchley.dev',
			'+44 20 7946 0958',
		])
	})

	it('is null for a marked signature with nothing in it but dashes', () => {
		const body = '<p>Saturday works.</p><div class="gmail_signature">--</div>'
		expect(signatureLines(msg('m', ALAN, [ADA], { body }))).toBeNull()
	})

	it('keeps a signature that has text after it', () => {
		const body = 'Thanks.\n\n-- \nAlan Turing\n+44 20 7946 0958\n\nP.S. Bring the map.'
		expect(signatureLines(msg('m', ALAN, [ADA], { body }))).toEqual(['Alan Turing', '+44 20 7946 0958'])
	})

	it('is null without a signature, for an empty dash line, for drafts and for empty mail', () => {
		expect(signatureLines(msg('m', ALAN, [ADA], { body: 'Saturday works.' }))).toBeNull()
		expect(signatureLines(msg('m', ALAN, [ADA], { body: 'Saturday works.\n\n--' }))).toBeNull()
		expect(signatureLines(msg('m', ALAN, [ADA], { body: alanHtml, ownmailDraft: true }))).toBeNull()
		expect(signatureLines(msg('m', undefined, [ADA], { body: '' }))).toBeNull()
	})
})

describe('parseSignature', () => {
	it('takes a title, an address and a phone number, skipping the name and labels', () => {
		expect(
			parseSignature(
				[
					'Alan Turing',
					'Alan',
					'Principal Engineer, Bletchley',
					'E: alan@bletchley.dev',
					'Mobile: +44 20 7946 0958',
				],
				ALAN,
			),
		).toEqual({
			title: 'Principal Engineer, Bletchley',
			email: 'alan@bletchley.dev',
			phone: '+44 20 7946 0958',
		})
	})

	it('keeps the first of each and skips links, long lines and lines without letters', () => {
		expect(
			parseSignature(
				[
					'https://bletchley.dev',
					'www.bletchley.dev',
					'x'.repeat(61),
					'|| ··',
					'Call me at 020 7946 0958 any time this week',
					'Second title',
					'a@b.dev',
					'c@d.dev',
					'+1 555 010 0000',
					'+1 555 010 1111',
				],
				{ name: '', email: 'alan@bletchley.dev' },
			),
		).toEqual({
			title: 'Call me at 020 7946 0958 any time this week',
			email: 'a@b.dev',
			phone: '+1 555 010 0000',
		})
	})

	it('is null when nothing useful is left', () => {
		expect(parseSignature(['Alan Turing', 'https://bletchley.dev'], ALAN)).toBeNull()
	})
})

describe('senderSignature', () => {
	it('parses the signature the message carries, or is null', () => {
		expect(senderSignature(msg('m', ALAN, [ADA], { body: alanHtml }), OWNER)).toEqual({
			title: 'Principal Engineer, Bletchley',
			email: 'alan@bletchley.dev',
			phone: '+44 20 7946 0958',
		})
		expect(senderSignature(msg('m', ALAN, [ADA], { body: 'Saturday works.' }), OWNER)).toBeNull()
	})
})
