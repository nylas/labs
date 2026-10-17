// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	attributionSeconds,
	parseAttribution,
	quotedExcerpt,
	readableText,
	splitHtmlBody,
	splitPlainBody,
} from './body-disclosure.js'
import { prepareEmailMessageContent } from './email-message-content.js'

const quoted = (author: string, date: string, inner: string) =>
	`<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On ${date} ${author} wrote:<br></div><blockquote class="gmail_quote">${inner}</blockquote></div>`

const prepare = (html: string) => prepareEmailMessageContent(html, 'm1').html

describe('parseAttribution', () => {
	it('splits the date from the person at the last time or year', () => {
		expect(parseAttribution('On Tue, Oct 13, 2026 at 6:02 PM Grace Hopper <grace@x.com> wrote:')).toEqual({
			name: 'Grace Hopper',
			email: 'grace@x.com',
			dateText: 'Tue, Oct 13, 2026 at 6:02 PM',
		})
		expect(parseAttribution('On 13 Oct 2026, grace@x.com wrote:')).toEqual({
			name: 'grace@x.com',
			email: 'grace@x.com',
			dateText: '13 Oct 2026',
		})
		expect(parseAttribution('On Mon, 12 Oct 2026 "Hopper, Grace" &lt;grace@x.com&gt; wrote:')).toEqual({
			name: 'Hopper, Grace',
			email: 'grace@x.com',
			dateText: 'Mon, 12 Oct 2026',
		})
	})

	it('falls back to the last comma, then to the whole text as a name', () => {
		expect(parseAttribution('On Friday, Sam wrote:')).toEqual({ name: 'Sam', dateText: 'Friday' })
		expect(parseAttribution('On Grace <grace@x.com> wrote:')).toEqual({ name: 'Grace', email: 'grace@x.com' })
		expect(parseAttribution('On <grace@x.com> wrote:')).toEqual({ name: 'grace@x.com', email: 'grace@x.com' })
	})

	it('knows other languages’ lead-ins without reading them, and rejects other lines', () => {
		expect(parseAttribution('Le 13 oct. 2026, Grace a écrit :')).toEqual({ name: '' })
		expect(parseAttribution('Just a line')).toBeNull()
	})
})

describe('attributionSeconds', () => {
	it('reads an attribution date, ignoring "at"', () => {
		expect(attributionSeconds('Tue, Oct 13, 2026 at 6:02 PM')).toBe(
			Math.floor(new Date(2026, 9, 13, 18, 2).getTime() / 1000),
		)
		expect(attributionSeconds('Friday')).toBeNull()
		expect(attributionSeconds(undefined)).toBeNull()
	})
})

describe('splitPlainBody', () => {
	it('takes nested quoted history and a signature off the end', () => {
		const body = [
			'Thanks, both done.',
			'',
			'-- ',
			'Grace Hopper',
			'+1 555 0100',
			'',
			'On Tue, Oct 13, 2026 at 6:02 PM Alan Turing <alan@x.com> wrote:',
			'> Two things before we lock it.',
			'> On Mon, Oct 12, 2026 at 9:00 AM Grace Hopper <grace@x.com> wrote:',
			'>> Here is v3.',
		].join('\n')
		expect(splitPlainBody(body)).toEqual({
			visible: 'Thanks, both done.',
			signature: ['Grace Hopper', '+1 555 0100'],
			quoted: [
				{
					name: 'Alan Turing',
					email: 'alan@x.com',
					dateText: 'Tue, Oct 13, 2026 at 6:02 PM',
					text: 'Two things before we lock it.',
				},
				{
					name: 'Grace Hopper',
					email: 'grace@x.com',
					dateText: 'Mon, Oct 12, 2026 at 9:00 AM',
					text: 'Here is v3.',
				},
			],
		})
	})

	it('reads a forwarded or original-message separator and its header block', () => {
		const body = [
			'See below.',
			'',
			'-----Original Message-----',
			'> From: Grace Hopper <grace@x.com>',
			'> Sent: Tue, Oct 13, 2026 6:02 PM',
			'>',
			'> Here is v3.',
		].join('\n')
		expect(splitPlainBody(body).quoted).toEqual([
			{
				name: 'Grace Hopper',
				email: 'grace@x.com',
				dateText: 'Tue, Oct 13, 2026 6:02 PM',
				text: 'Here is v3.',
			},
		])
	})

	it('reads a separator whose header block runs to the end', () => {
		const lines = ['-----Original Message-----', '> From: Grace <grace@x.com>']
		expect(splitPlainBody(['Answer', '', ...lines].join('\n')).quoted).toEqual([
			{ name: 'Grace', email: 'grace@x.com', text: '' },
		])
	})

	it('reads a separator with no header block, or a header block without a sender', () => {
		expect(splitPlainBody('Answer\n\n-----Original Message-----\n> Old words').quoted).toEqual([
			{ name: '', text: 'Old words' },
		])
		expect(splitPlainBody('Answer\n\n-----Original Message-----\n> Sent: Tue\n> Old words').quoted).toEqual([
			{ name: '', dateText: 'Tue', text: 'Old words' },
		])
	})

	it('keeps a body with no signature delimiter, or only a delimiter, as it is', () => {
		expect(splitPlainBody('Just this.')).toEqual({ visible: 'Just this.', quoted: [], signature: [] })
		expect(splitPlainBody('--\nGrace')).toEqual({ visible: '--\nGrace', quoted: [], signature: [] })
	})
})

describe('readableText', () => {
	it('breaks lines where blocks and <br> end, and skips styles and summaries', () => {
		const element = document.createElement('div')
		element.innerHTML =
			'<p>One <b>two</b></p><style>p{}</style><summary>Show</summary>Three<br>Four&nbsp;&nbsp;five<!-- note -->'
		expect(readableText(element)).toBe('One two\nThree\nFour five')
	})
})

describe('splitHtmlBody', () => {
	it('takes a trailing signature and nested quoted history off a prepared body', () => {
		const body = `<div dir="ltr"><p>Otherwise this is ready.</p><div class="gmail_signature_prefix">-- </div><div class="gmail_signature">Alan Turing<br>Principal Engineer</div></div>${quoted(
			'Grace Hopper &lt;grace@x.com&gt;',
			'Tue, Oct 13, 2026 at 6:02 PM',
			`<p>Here is v3.</p>${quoted('Alan Turing &lt;alan@x.com&gt;', 'Mon, Oct 12, 2026 at 9:00 AM', '<p>Signed off.</p>')}`,
		)}`
		const split = splitHtmlBody(prepare(body))
		expect(split.signature).toEqual(['Alan Turing', 'Principal Engineer'])
		expect(split.quoted).toEqual([
			{
				name: 'Grace Hopper',
				email: 'grace@x.com',
				dateText: 'Tue, Oct 13, 2026 at 6:02 PM',
				text: 'Here is v3.',
			},
			{
				name: 'Alan Turing',
				email: 'alan@x.com',
				dateText: 'Mon, Oct 12, 2026 at 9:00 AM',
				text: 'Signed off.',
			},
		])
		expect(split.html).toContain('Otherwise this is ready.')
		expect(split.html).not.toContain('ownmail-quoted-history')
		expect(split.html).not.toContain('gmail_signature')
		expect(split.html).not.toContain('data-ownmail-taken')
	})

	it('reads a nested blockquote whose attribution sits beside it', () => {
		const inner =
			'<p>Here is v3.</p><div>On Mon, Oct 12, 2026 at 9:00 AM Alan &lt;alan@x.com&gt; wrote:</div>\n<blockquote><p>Old</p></blockquote>'
		const split = splitHtmlBody(
			prepare(`<p>Answer</p>${quoted('Grace &lt;grace@x.com&gt;', 'Tue, Oct 13, 2026', inner)}`),
		)
		expect(split.quoted.map((entry) => [entry.name, entry.text])).toEqual([
			['Grace', 'Here is v3.'],
			['Alan', 'Old'],
		])
	})

	it('reads a nested blockquote with no attribution of its own', () => {
		const inner = '<p>Here is v3.</p><blockquote><p>Old</p></blockquote>'
		const split = splitHtmlBody(
			prepare(`<p>Answer</p>${quoted('Grace &lt;grace@x.com&gt;', 'Tue, Oct 13, 2026', inner)}`),
		)
		expect(split.quoted.map((entry) => [entry.name, entry.text])).toEqual([
			['Grace', 'Here is v3.'],
			['', 'Old'],
		])
	})

	it('reads a nested blockquote wrapped in an ordinary element', () => {
		const inner = '<p>Here is v3.</p><div><blockquote><p>Old</p></blockquote></div>'
		const split = splitHtmlBody(
			prepare(`<p>Answer</p>${quoted('Grace &lt;grace@x.com&gt;', 'Tue, Oct 13, 2026', inner)}`),
		)
		expect(split.quoted.map((entry) => entry.text)).toEqual(['Here is v3.', 'Old'])
	})

	it('reads history whose disclosure has no summary, and a signature that starts its parent', () => {
		const body =
			'<p>Hi</p><div><div class="gmail_signature">Grace</div></div><details class="ownmail-quoted-history"><div>On Fri, Sam &lt;sam@x.com&gt; wrote:</div><blockquote>Old</blockquote></details>'
		const split = splitHtmlBody(body)
		expect(split.signature).toEqual(['Grace'])
		expect(split.quoted).toEqual([{ name: 'Sam', email: 'sam@x.com', dateText: 'Fri', text: 'Old' }])
	})

	it('reads Outlook history that has a header block and no blockquote', () => {
		const body =
			'<p>Answer</p><div id="divRplyFwdMsg"><b>From:</b> Grace Hopper &lt;grace@x.com&gt;<br><b>Sent:</b> Tue, Oct 13, 2026 6:02 PM<br><br></div><div>Here is v3.</div>'
		const split = splitHtmlBody(prepare(body))
		expect(split.quoted).toEqual([
			{
				name: 'Grace Hopper',
				email: 'grace@x.com',
				dateText: 'Tue, Oct 13, 2026 6:02 PM',
				text: 'Here is v3.',
			},
		])
	})

	it('leaves history that has new text after it where the sender put it', () => {
		const body = `<p>Current reply</p>${quoted('Sam', 'Friday', '<p>Old</p>')}<p>An answer below the quote.</p>`
		const prepared = prepare(body)
		expect(splitHtmlBody(prepared)).toEqual({ html: prepared, quoted: [], signature: [] })
	})

	it('leaves a body that would have no text of its own whole', () => {
		const prepared = prepare(quoted('Sam', 'Friday', '<p>Old</p>'))
		expect(splitHtmlBody(prepared)).toEqual({ html: prepared, quoted: [], signature: [] })
		const unquoted = prepare('<p>Plain words.</p>')
		expect(splitHtmlBody(unquoted)).toEqual({ html: unquoted, quoted: [], signature: [] })
	})

	it('keeps a body whose only remaining content is an image', () => {
		const split = splitHtmlBody(
			prepare(
				'<img alt="chart" src="https://example.com/chart.png"><div class="gmail_signature">Grace</div>',
			),
		)
		expect(split.signature).toEqual(['Grace'])
		expect(split.html).toContain('<img')
	})

	it('stops at a trailing image after the signature', () => {
		const prepared = prepare('<p>Hi</p><div class="gmail_signature">Grace</div><img alt="logo">')
		expect(splitHtmlBody(prepared).signature).toEqual([])
	})

	it('drops a signature delimiter line inside the signature, and reads a signature marked twice once', () => {
		const split = splitHtmlBody(prepare('<p>Hi</p><div class="moz-signature">-- <br>Grace</div>'))
		expect(split.signature).toEqual(['Grace'])
		const twice = splitHtmlBody(
			prepare('<p>Hi</p><div class="gmail_signature"><div id="Signature">Grace</div></div>'),
		)
		expect(twice.signature).toEqual(['Grace'])
	})
})

describe('splitHtmlBody keeps what it cannot summarise', () => {
	it('leaves a forwarded message in the body: it is the content, not history', () => {
		const forward = prepare(
			'<p>FYI</p><div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>From: Voyage &lt;trips@voyage.com&gt;<br></div><table width="640"><tr><td><h1>Your trip</h1><a href="https://voyage.com/manage">Manage booking</a></td></tr></table></div>',
		)
		expect(splitHtmlBody(forward)).toEqual({ html: forward, quoted: [], signature: [] })
	})

	it('splits an Outlook chain at each header block and keeps each message’s paragraphs', () => {
		const chain = prepare(
			'<p>Sounds good.</p><div id="divRplyFwdMsg"><b>From:</b> Grace Hopper &lt;grace@x.com&gt;<br><b>Sent:</b> Tuesday<br></div><p>Here is v3.</p><p>Billing moved.</p><hr><p><b>From:</b> Alan &lt;alan@x.com&gt;<br><b>Sent:</b> Monday</p><p>Can you send v3?</p>',
		)
		expect(splitHtmlBody(chain).quoted).toEqual([
			{
				name: 'Grace Hopper',
				email: 'grace@x.com',
				dateText: 'Tuesday',
				text: 'Here is v3.\nBilling moved.',
			},
			{ name: 'Alan', email: 'alan@x.com', dateText: 'Monday', text: 'Can you send v3?' },
		])
	})

	it('starts the next chain message at its "Original Message" line, and not at a lone From: line', () => {
		const chain = prepare(
			'<p>Sounds good.</p><div id="divRplyFwdMsg"><b>From:</b> Grace &lt;grace@x.com&gt;<br><b>Sent:</b> Tuesday<br></div><p>Here.</p><p>From: the venue, a quote.</p><p>-----Original Message-----</p><p>From: Alan &lt;alan@x.com&gt;<br>Date: Monday</p><p>Venue?</p>',
		)
		expect(splitHtmlBody(chain).quoted).toEqual([
			{ name: 'Grace', email: 'grace@x.com', dateText: 'Tuesday', text: 'Here.\nFrom: the venue, a quote.' },
			{ name: 'Alan', email: 'alan@x.com', dateText: 'Monday', text: 'Venue?' },
		])
	})

	it('leaves a signature with no words (a logo) where it is, rather than an empty pill', () => {
		const logo = prepare('<p>Hi</p><div class="gmail_signature"><img alt="" width="120" height="40"></div>')
		expect(splitHtmlBody(logo)).toEqual({ html: logo, quoted: [], signature: [] })
		const dashes = prepare('<p>Hi</p><div class="gmail_signature">--</div>')
		expect(splitHtmlBody(dashes).signature).toEqual([])
	})

	it('keeps the history and a rich signature as documents under the message’s styles', () => {
		const split = splitHtmlBody(
			prepare(
				`<style>p{color:red}</style><p>Thanks!</p><div class="gmail_signature">Grace<br><a href="https://cal.example.com">Book a time</a></div>${quoted('Sam &lt;sam@x.com&gt;', 'Fri', '<p>See <a href="https://example.com/plan">the plan</a></p>')}`,
			),
		)
		expect(split.quotedHtml).toMatch(/^<!doctype html><html><head><style>/)
		expect(split.quotedHtml).toContain('href="https://example.com/plan"')
		expect(split.quotedHtml).not.toContain('Show quoted text')
		expect(split.signatureHtml).toContain('href="https://cal.example.com"')
		const plain = splitHtmlBody(prepare('<p>Hi</p><div class="gmail_signature">Grace</div>'))
		expect(plain.signatureHtml).toBeUndefined()
		expect(plain.quotedHtml).toBeUndefined()
	})
})

describe('splitPlainBody entries', () => {
	it('marks a forwarded message, and reflows each entry into paragraphs', () => {
		const body = [
			'Passing this on.',
			'',
			'---------- Forwarded message ---------',
			'> From: Voyage <trips@voyage.com>',
			'>',
			'> Your flight TP 123 leaves Lisbon at 9:40 on Thursday morning, and the',
			'> boarding gate closes twenty minutes before departure.',
			'>',
			'> Manage your booking online.',
		].join('\n')
		expect(splitPlainBody(body).quoted).toEqual([
			{
				name: 'Voyage',
				email: 'trips@voyage.com',
				forwarded: true,
				text: 'Your flight TP 123 leaves Lisbon at 9:40 on Thursday morning, and the boarding gate closes twenty minutes before departure.\n\nManage your booking online.',
			},
		])
	})
})

describe('quotedExcerpt', () => {
	it('cuts linked entries near 72 characters and shows the rest in full', () => {
		const entry = { name: 'Grace', text: `${'word '.repeat(30)}end` }
		expect(quotedExcerpt(entry, true).endsWith('…')).toBe(true)
		expect(quotedExcerpt(entry, false)).toBe(entry.text)
	})
})
