import { describe, expect, it } from 'vitest'
import { MAX_RAW_HEADERS_LENGTH, messageHeaderFacts, rawHeaderText } from './header-facts.js'

const h = (name: string, value: string) => ({ name, value })
/** The receiving server's own hop, which it writes above everything the sender wrote. */
const received = (host: string) =>
	h('Received', `from mail.sender.example (198.51.100.7) by ${host} with ESMTPS id x1`)

function base64Url(text: string): string {
	const bytes = new TextEncoder().encode(text)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

describe('messageHeaderFacts', () => {
	it('answers plain facts for a message without headers', () => {
		const empty = { verified: false, authFailed: false, listUnsubscribe: false }
		expect(messageHeaderFacts(undefined, 'a@example.com')).toEqual(empty)
		expect(messageHeaderFacts('From: x' as never)).toEqual(empty)
		expect(
			messageHeaderFacts([
				null,
				'Date',
				{ name: 7, value: 'x' },
				{ name: '  ', value: 'x' },
				{ name: 'Date', value: 9 },
			]),
		).toEqual(empty)
	})

	it('verifies a DMARC pass from the topmost Authentication-Results only', () => {
		const facts = messageHeaderFacts(
			[
				received('mx.ownmail.com'),
				h(
					'Authentication-Results',
					'mx.ownmail.com; dkim=pass header.d=bletchley.dev; dmarc=pass header.from=bletchley.dev',
				),
				h('Authentication-Results', 'forged.example; dmarc=fail'),
			],
			'alan@bletchley.dev',
		)
		expect(facts).toMatchObject({ verified: true, authFailed: false })
	})

	it('never aligns across organizations under a multi-label public suffix', () => {
		const pass = (identity: string) => [
			received('mx2.example.net'),
			h(
				'Authentication-Results',
				`mx2.example.net; spf=pass smtp.mailfrom=${identity}; dkim=pass header.d=${identity}`,
			),
		]
		expect(messageHeaderFacts(pass('attacker.ne.jp'), 'help@victim.ne.jp').verified).toBe(false)
		expect(messageHeaderFacts(pass('attacker.co.uk'), 'help@victim.co.uk').verified).toBe(false)
		// Siblings of one organization are not resolved without the public suffix list: no badge, never a wrong one.
		expect(messageHeaderFacts(pass('bounces.example.com'), 'alerts@accounts.example.com').verified).toBe(
			false,
		)
		expect(messageHeaderFacts(pass('mail.example.com'), 'alerts@example.com').verified).toBe(true)
	})

	it('verifies aligned SPF and DKIM passes without DMARC, and refuses unaligned ones', () => {
		const aligned = [
			received('mx2.example.net'),
			h(
				'authentication-results',
				'mx2.example.net; spf=pass (sender ok) smtp.mailfrom=bounce@mail.vercel.com; dkim=pass header.i=@vercel.com',
			),
		]
		expect(messageHeaderFacts(aligned, 'grace.hopper@vercel.com').verified).toBe(true)
		const unaligned = [
			received('mx2.example.net'),
			h(
				'Authentication-Results',
				'mx2.example.net; spf=pass smtp.mailfrom=other.com; dkim=pass header.d="vercel.com"',
			),
		]
		expect(messageHeaderFacts(unaligned, 'grace.hopper@vercel.com').verified).toBe(false)
		const spfOnly = [
			received('mx2.example.net'),
			h('Authentication-Results', 'mx2.example.net; spf=pass smtp.mailfrom=vercel.com; dkim=none'),
		]
		expect(messageHeaderFacts(spfOnly, 'grace.hopper@vercel.com').verified).toBe(false)
		const noDomain = [
			received('mx2.example.net'),
			h('Authentication-Results', 'mx2.example.net; spf=pass; dkim=pass'),
		]
		expect(messageHeaderFacts(noDomain, 'grace.hopper@vercel.com').verified).toBe(false)
		expect(messageHeaderFacts(aligned).verified).toBe(false)
	})

	it('reports failed sender checks, ignoring results written inside comments', () => {
		const failed = messageHeaderFacts(
			[
				received('mx.ownmail.com'),
				h(
					'Authentication-Results',
					'mx.ownmail.com; spf=softfail smtp.mailfrom=meridian-secure.co; dkim=none; dmarc=fail (dmarc=pass p=reject) header.from=meridian-secure.co',
				),
			],
			'alerts@meridian-secure.co',
		)
		expect(failed).toMatchObject({ verified: false, authFailed: true })
		const failedEvenIfAligned = messageHeaderFacts(
			[
				received('mx.ownmail.com'),
				h(
					'Authentication-Results',
					'mx.ownmail.com; spf=pass smtp.mailfrom=a.com; dkim=pass header.d=a.com; dmarc=fail header.from=a.com',
				),
			],
			'x@a.com',
		)
		expect(failedEvenIfAligned).toMatchObject({ verified: false, authFailed: true })
		// A DMARC verdict about another identity, or none at all, is no verdict on this sender, and blocks the fallback.
		const verdict = (dmarc: string) =>
			messageHeaderFacts(
				[
					received('mx.ownmail.com'),
					h(
						'Authentication-Results',
						`mx.ownmail.com; spf=pass smtp.mailfrom=a.com; dkim=pass header.d=a.com; ${dmarc}`,
					),
				],
				'x@a.com',
			)
		expect(verdict('dmarc=pass header.from=attacker.example')).toMatchObject({
			verified: false,
			authFailed: false,
		})
		expect(verdict('dmarc=fail header.from=attacker.example')).toMatchObject({
			verified: false,
			authFailed: false,
		})
		expect(verdict('dmarc=fail')).toMatchObject({ verified: false, authFailed: false })
		expect(
			messageHeaderFacts([
				received('mx.ownmail.com'),
				h('Authentication-Results', 'mx.ownmail.com; dmarc=pass'),
			]),
		).toMatchObject({ verified: false })
		expect(
			messageHeaderFacts(
				[received('mx.ownmail.com'), h('Authentication-Results', 'mx.ownmail.com; unknown=pass; garbage')],
				'x@a.com',
			),
		).toMatchObject({
			verified: false,
			authFailed: false,
		})
	})

	it('trusts Authentication-Results only from the receiving provider', () => {
		const pass =
			'dkim=pass header.d=bank.com; spf=pass smtp.mailfrom=bank.com; dmarc=pass header.from=bank.com'
		const fail = 'dmarc=fail header.from=bank.com'
		const facts = (...headers: Array<{ name: string; value: string }>) =>
			messageHeaderFacts(headers, 'help@bank.com')
		const untrusted = { verified: false, authFailed: false }

		// No receiving hop, a foreign authserv-id, or no id from a non-Microsoft receiver: the sender may have written it.
		expect(facts(h('Authentication-Results', `mx.google.com; ${pass}`))).toMatchObject(untrusted)
		expect(
			facts(received('imap.fastmail.example'), h('Authentication-Results', `mx.bank.com; ${pass}`)),
		).toMatchObject(untrusted)
		expect(
			facts(received('imap.fastmail.example'), h('Authentication-Results', `mx.bank.com; ${fail}`)),
		).toMatchObject(untrusted)
		expect(facts(received('imap.fastmail.example'), h('Authentication-Results', pass))).toMatchObject(
			untrusted,
		)
		expect(
			facts(received('imap.fastmail.example'), h('Authentication-Results', `mx.google.com; ${pass}`)),
		).toMatchObject(untrusted)
		// A sibling host on the receiver's site is not the receiver: the sender may have written it.
		expect(
			facts(
				received('mx3.messagingengine.com'),
				h('Authentication-Results', `evil.messagingengine.com; ${pass}`),
			),
		).toMatchObject(untrusted)
		expect(
			facts(
				received('mx3.messagingengine.com'),
				h('Authentication-Results', `mx3.messagingengine.com; ${pass}`),
			),
		).toMatchObject({ verified: true, authFailed: false })
		// A forged hop below the receiver's own does not count.
		expect(
			facts(
				received('imap.fastmail.example'),
				received('mx.google.com'),
				h('Authentication-Results', `mx.google.com; ${pass}`),
			),
		).toMatchObject(untrusted)

		// The receiving host itself (with an optional version), Google behind its last hop, and Microsoft 365's id-less header are trusted.
		expect(
			facts(
				received('mx3.messagingengine.com'),
				h('Authentication-Results', `mx3.messagingengine.com 1; ${pass}`),
			),
		).toMatchObject({ verified: true })
		expect(
			facts(received('mx.example.co.uk.'), h('Authentication-Results', `mx.example.co.uk; ${pass}`)),
		).toMatchObject({ verified: true })
		expect(
			facts(received('mail.example.co.uk'), h('Authentication-Results', `mx.example.co.uk; ${pass}`)),
		).toMatchObject(untrusted)
		expect(
			facts(received('mail.other.co.uk'), h('Authentication-Results', `mx.example.co.uk; ${pass}`)),
		).toMatchObject(untrusted)
		expect(
			facts(received('mx.google.com'), h('Authentication-Results', `mx.google.com; ${pass}`)),
		).toMatchObject({ verified: true })
		// A bare IPv6 hop proves no provider: a forged mx.google.com header behind it says nothing.
		expect(
			facts(
				h('Received', 'by 2002:a05:6a10:a0ce:b0:4c3:6e7a:2f1e with SMTP id x14csp1;'),
				received('mx.google.com'),
				h('Authentication-Results', `mx.google.com; ${pass}`),
			),
		).toMatchObject(untrusted)
		// A header without an authserv-id carries nothing the receiver attested, even behind a Microsoft hop.
		expect(
			facts(
				received('BN8PR12MB.namprd12.prod.outlook.com'),
				h('Authentication-Results', `spf=pass smtp.mailfrom=bank.com; ${fail}`),
			),
		).toMatchObject(untrusted)
		expect(
			facts(
				received('BN8PR12MB.namprd12.prod.outlook.com'),
				h('Authentication-Results', `spf=pass (ok) smtp.mailfrom=bank.com; dmarc=pass header.from=bank.com`),
			),
		).toMatchObject(untrusted)
	})

	it('never reads a lower Authentication-Results in place of an unusable topmost one', () => {
		const forged = h('Authentication-Results', 'mx.ownmail.com; dmarc=pass header.from=bank.com')
		const oversized = h(
			'Authentication-Results',
			`mx.ownmail.com; dmarc=fail header.from=bank.com; ${Array.from({ length: 300 }, (_, i) => `dkim=pass header.d=s${i}.bank.com`).join('; ')}`,
		)
		expect(oversized.value.length).toBeGreaterThan(8_192)
		const facts = (...headers: Array<{ name: string; value: string }>) =>
			messageHeaderFacts([received('mx.ownmail.com'), ...headers], 'help@bank.com')
		expect(facts(oversized, forged)).toMatchObject({ verified: false, authFailed: false })
		expect(facts(h('Authentication-Results', ''), forged)).toMatchObject({
			verified: false,
			authFailed: false,
		})
		expect(facts(h('Authentication-Results', '   '), forged)).toMatchObject({
			verified: false,
			authFailed: false,
		})
		expect(facts(forged)).toMatchObject({ verified: true })
		// An unusable topmost Received leaves nothing to trust.
		expect(
			messageHeaderFacts([h('Received', ''), received('mx.ownmail.com'), forged], 'help@bank.com'),
		).toMatchObject({ verified: false })
		// The same holds for any header: an over-long Reply-To hides no lower one.
		expect(
			messageHeaderFacts(
				[h('Reply-To', `${'a'.repeat(8_200)}@x.example`), h('Reply-To', 'decoy@x.example')],
				'help@bank.com',
			).replyTo,
		).toBeUndefined()
	})

	it('reads the address, not quoted display names or comments that look like one', () => {
		const replyTo = (value: string) => messageHeaderFacts([h('Reply-To', value)], 'help@bank.com').replyTo
		expect(replyTo('"Support <help@bank.com>" <collect@evil.example>')).toBe('collect@evil.example')
		expect(replyTo('"Support <other@bank.com>" <collect@evil.example>')).toBe('collect@evil.example')
		expect(replyTo('"Say \\"hi\\" <help@bank.com>" <collect@evil.example>')).toBe('collect@evil.example')
		expect(replyTo('(help@bank.com) collect@evil.example')).toBe('collect@evil.example')
		expect(
			messageHeaderFacts([
				h('From', '"Bank <help@bank.com>" <x@evil.example>'),
				h('Reply-To', 'help@bank.com'),
			]).replyTo,
		).toBe('help@bank.com')
	})

	it('prefers the provider-parsed Reply-To and reads the header only without it', () => {
		const headers = [h('Reply-To', 'header@evil.example')]
		expect(messageHeaderFacts(headers, 'help@bank.com', 'collect@evil.example').replyTo).toBe(
			'collect@evil.example',
		)
		expect(messageHeaderFacts(headers, 'help@bank.com', 'HELP@bank.com').replyTo).toBeUndefined()
		expect(messageHeaderFacts(headers, 'help@bank.com', 'not an address').replyTo).toBe('header@evil.example')
	})

	it('returns only a differing Reply-To address, never the display name', () => {
		const facts = messageHeaderFacts(
			[h('Reply-To', '"Grace (personal)" <grace.personal@fastmail.com>')],
			'grace.hopper@vercel.com',
		)
		expect(facts.replyTo).toBe('grace.personal@fastmail.com')
		expect(JSON.stringify(facts)).not.toContain('personal)')
		expect(
			messageHeaderFacts([h('Reply-To', 'Grace.Hopper@Vercel.com')], 'grace.hopper@vercel.com').replyTo,
		).toBeUndefined()
		expect(
			messageHeaderFacts([h('Reply-To', '<not an address>')], 'grace.hopper@vercel.com').replyTo,
		).toBeUndefined()
		expect(messageHeaderFacts([h('Reply-To', 'a@b.co, c@d.co')], 'grace.hopper@vercel.com').replyTo).toBe(
			'a@b.co',
		)
	})

	it('falls back to the From header when the provider gave no sender address', () => {
		const headers = [h('From', 'Grace <grace.hopper@vercel.com>'), h('Reply-To', 'grace.hopper@vercel.com')]
		expect(messageHeaderFacts(headers).replyTo).toBeUndefined()
		expect(messageHeaderFacts(headers, 'not-an-address').replyTo).toBeUndefined()
		expect(messageHeaderFacts([h('Reply-To', 'grace.hopper@vercel.com')]).replyTo).toBe(
			'grace.hopper@vercel.com',
		)
	})

	it('reads a validated List-Id', () => {
		expect(messageHeaderFacts([h('List-Id', 'Engineering <eng-all.vercel.com>')]).listId).toBe(
			'eng-all.vercel.com',
		)
		expect(messageHeaderFacts([h('List-Id', 'pm-leads.vercel.com')]).listId).toBe('pm-leads.vercel.com')
		expect(messageHeaderFacts([h('List-Id', '<bad id with spaces>')]).listId).toBeUndefined()
		expect(messageHeaderFacts([h('List-Id', `<${'a'.repeat(256)}>`)]).listId).toBeUndefined()
	})

	it('prefers an https unsubscribe link and keeps a mailto only without one', () => {
		const both = messageHeaderFacts([
			h(
				'List-Unsubscribe',
				'<mailto:leave@dispatch.email?subject=unsubscribe>, <https://dispatch.email/u/abc>',
			),
		])
		expect(both).toMatchObject({ listUnsubscribe: true, unsubscribeUrl: 'https://dispatch.email/u/abc' })
		expect(both.unsubscribeMailto).toBeUndefined()

		const mailto = messageHeaderFacts([
			h('List-Unsubscribe', '<http://insecure.example/u>, <mailto:leave%40list.example?subject=Remove%0Ame>'),
		])
		expect(mailto).toMatchObject({
			listUnsubscribe: true,
			unsubscribeMailto: 'mailto:leave@list.example?subject=Remove%20me',
		})
		expect(mailto.unsubscribeUrl).toBeUndefined()
		expect(messageHeaderFacts([h('List-Unsubscribe', '<mailto:leave@list.example>')]).unsubscribeMailto).toBe(
			'mailto:leave@list.example',
		)
	})

	it('drops unsafe or malformed unsubscribe targets but still notes the header', () => {
		const unsafe = messageHeaderFacts([
			h(
				'List-Unsubscribe',
				`<https://user:pw@evil.example/u>, <https://${'a'.repeat(2050)}.example>, <javascript:alert(1)>, <https://[bad>, <mailto:%E0%A4%A>, <mailto:not-an-address>`,
			),
		])
		expect(unsafe).toEqual({ verified: false, authFailed: false, listUnsubscribe: true })
		expect(messageHeaderFacts([h('List-Unsubscribe', 'no brackets')])).toMatchObject({
			listUnsubscribe: true,
		})
		expect(messageHeaderFacts([h('List-Unsubscribe', '  ')]).listUnsubscribe).toBe(false)
	})

	it('reads the sender time zone from the Date header', () => {
		const offset = (value: string) => messageHeaderFacts([h('Date', value)]).dateOffsetMinutes
		expect(offset('Wed, 14 Oct 2026 07:12:00 -0700')).toBe(-420)
		expect(offset('Wed, 14 Oct 2026 16:12:00 +0200 (CEST)')).toBe(120)
		expect(offset('Wed, 14 Oct 2026 16:12:00 +0530')).toBe(330)
		expect(offset('Wed, 14 Oct 2026 14:12:00 +0000')).toBe(0)
		expect(offset('Wed, 14 Oct 2026 07:12:00 PDT')).toBe(-420)
		expect(offset('Wed, 14 Oct 2026 14:12:00 GMT')).toBe(0)
		expect(offset('Wed, 14 Oct 2026 14:12:00 -0000')).toBeUndefined()
		expect(offset('Wed, 14 Oct 2026 14:12:00 +1500')).toBeUndefined()
		expect(offset('Wed, 14 Oct 2026 14:12:00 +0175')).toBeUndefined()
		expect(offset('Wed, 14 Oct 2026 14:12:00 XYZ')).toBeUndefined()
		expect(offset('yesterday')).toBeUndefined()
	})

	it('ignores over-long header values', () => {
		expect(messageHeaderFacts([h('Reply-To', `${'a'.repeat(8_200)}@example.com`)]).replyTo).toBeUndefined()
		expect(messageHeaderFacts([h('Reply-To', `${'a'.repeat(250)}@example.com`)]).replyTo).toBeUndefined()
	})
})

describe('rawHeaderText', () => {
	it('returns the header block with CRLF endings and control characters removed', () => {
		const raw = base64Url(
			'From: Alan <alan@bletchley.dev>\nSubject: Hi\u0007 there\n\tfolded\r\n\r\nBody text\r\n',
		)
		expect(rawHeaderText(raw)).toBe('From: Alan <alan@bletchley.dev>\r\nSubject: Hi there\r\n\tfolded')
		expect(rawHeaderText(`${raw}==`)).not.toContain('Body text')
	})

	it('treats a message without a body separator as all headers', () => {
		expect(rawHeaderText(base64Url('X-Only: header'))).toBe('X-Only: header')
	})

	it('caps the text at a line boundary', () => {
		const line = `X-Filler: ${'x'.repeat(990)}`
		const raw = base64Url(`${Array.from({ length: 80 }, () => line).join('\r\n')}\r\n\r\nbody`)
		const text = rawHeaderText(raw) as string
		expect(text.length).toBeLessThanOrEqual(MAX_RAW_HEADERS_LENGTH)
		expect(text.endsWith('x')).toBe(true)
		const single = rawHeaderText(base64Url(`X-Long: ${'y'.repeat(70_000)}`)) as string
		expect(single.length).toBe(MAX_RAW_HEADERS_LENGTH)
	})

	it('rejects payloads that are not base64url raw mail', () => {
		expect(rawHeaderText(undefined)).toBeNull()
		expect(rawHeaderText('')).toBeNull()
		expect(rawHeaderText('not base64!')).toBeNull()
		expect(rawHeaderText(base64Url('\r\n\r\nbody only'))).toBeNull()
		expect(rawHeaderText('QUJD' + 'R')).toBe('ABC')
	})
})
