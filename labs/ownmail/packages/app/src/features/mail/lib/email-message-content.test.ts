// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
	collapseQuotedHistory,
	prepareEmailMessageContent,
	preserveLegacyVmlCtas,
	rewriteCidImages,
	splitPlainQuotedHistory,
} from './email-message-content.js'
import { sanitizeEmailHtml } from './sanitize-email.js'

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html')
}

describe('inline Content-ID images', () => {
	it('rewrites exact inline attachment matches and removes an overriding srcset', () => {
		const document = parse(
			'<img src="cid:Logo%40Example.COM" srcset="https://tracker.example/pixel 2x" alt="Logo"><img src="https://example.com/photo.png">',
		)
		rewriteCidImages(document, 'message / 1', [
			{ id: 'attachment / 1', is_inline: true, content_id: '<logo@example.com>' },
			{ id: 'not-inline', is_inline: false, content_id: 'logo@example.com' },
			{ id: 'no-content-id', is_inline: true },
		])

		const fallback = document.querySelector('[role="img"]')
		expect(fallback?.getAttribute('aria-label')).toBe('Logo')
		expect(fallback?.textContent).toBe('Logo')
		expect(document.querySelector('img')?.getAttribute('src')).toBe('https://example.com/photo.png')
	})

	it('uses a server-attested controlled image token for resolved inline assets', () => {
		const document = parse('<img src="cid:logo@example" srcset="https://tracker.example/pixel 2x">')
		rewriteCidImages(
			document,
			'message-1',
			[{ id: 'attachment-1', is_inline: true, content_id: 'logo@example' }],
			{ 'attachment-1': 'signed.payload' },
		)
		const image = document.querySelector('img')
		expect(image?.getAttribute('src')).toBe('/email-images/signed.payload?mode=automatic&theme=light')
		expect(image?.hasAttribute('srcset')).toBe(false)
	})

	it('resolves attested CID artwork across picture, legacy background, CSS, and SVG representations', () => {
		const document = parse(`<picture>
			<source class="source" srcset="cid:logo@example 1x, cid:missing 2x, safe.png 3x">
			<source class="missing-source" srcset=", cid:missing 2x">
			<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
		</picture>
		<table class="legacy" background="cid:logo@example"><tr><td>Card</td></tr></table>
		<table class="missing-legacy" background="cid:missing"><tr><td>Missing</td></tr></table>
		<div class="inline" style="background-image:url(cid:logo@example)"></div>
		<style>.hero{background:url('cid:logo@example')}.missing{background:url(cid:missing)}.safe{background:url(data:image/png;base64,AAAA)}</style>
		<svg><image class="vector" href="cid:logo@example"></image></svg>`)
		rewriteCidImages(
			document,
			'message-1',
			[{ id: 'attachment-1', is_inline: true, content_id: 'logo@example' }],
			{ 'attachment-1': 'signed.payload' },
		)
		const expected = '/email-images/signed.payload?mode=automatic&theme=light'

		expect(document.querySelector('.source')?.getAttribute('srcset')).toBe(`${expected} 1x, safe.png 3x`)
		expect(document.querySelector('.missing-source')?.hasAttribute('srcset')).toBe(false)
		expect(document.querySelector('.legacy')?.getAttribute('background')).toBe(expected)
		expect(document.querySelector('.missing-legacy')?.hasAttribute('background')).toBe(false)
		expect(document.querySelector('.inline')?.getAttribute('style')).toContain(`url("${expected}")`)
		expect(document.querySelector('style')?.textContent).toContain(`url("${expected}")`)
		expect(document.querySelector('style')?.textContent).toContain('url("")')
		expect(document.querySelector('style')?.textContent).toContain('url(data:image/png;base64,AAAA)')
		expect(document.querySelector('.vector')?.getAttribute('href')).toBe(expected)
	})

	it('replaces unmatched and malformed CID references with inert accessible fallbacks', () => {
		const document = parse('<img src="cid:missing" alt="Company signature"><img src="CID:%E0%A4%A">')
		rewriteCidImages(document, 'm1', [])

		const fallbacks = document.querySelectorAll('[role="img"]')
		expect(document.querySelector('img')).toBeNull()
		expect(fallbacks[0]?.getAttribute('aria-label')).toBe('Company signature')
		expect(fallbacks[0]?.textContent).toBe('Company signature')
		expect(fallbacks[1]?.getAttribute('aria-label')).toBe('Inline image unavailable')
	})
})

describe('quoted HTML history', () => {
	it.each([
		['Gmail', '<div class="gmail_quote">Earlier Gmail message</div>'],
		['Yahoo', '<div class="yahoo_quoted">Earlier Yahoo message</div>'],
		['Yahoo id', '<div id="yahoo_quoted_42">Earlier Yahoo message</div>'],
		['Apple Mail', '<div class="AppleOriginalContents">Earlier Apple message</div>'],
	])('collapses an explicit %s provider wrapper', (_provider, quoted) => {
		const document = parse(`<p>Current reply</p>${quoted}`)
		collapseQuotedHistory(document)

		const details = document.querySelector('details.ownmail-quoted-history')
		expect(details?.hasAttribute('open')).toBe(false)
		expect(details?.querySelector('summary')?.textContent).toBe('Show quoted text')
		expect(details?.textContent).toContain('Earlier')
		expect(document.body.firstElementChild?.textContent).toContain('Current reply')
	})

	it.each([
		['Outlook', '<div id="divRplyFwdMsg">From: Old Sender</div>'],
		['Outlook header', '<div class="OutlookMessageHeader">From: Old Sender</div>'],
		['Outlook legacy', '<hr id="stopSpelling">'],
		['Thunderbird', '<div class="moz-cite-prefix">Earlier sender wrote:</div>'],
	])('collapses an explicit %s separator and all history after it', (_provider, separator) => {
		const document = parse(`<p>Current reply</p>${separator}\n <p>Earlier message</p>`)
		collapseQuotedHistory(document)

		const details = document.querySelector('details.ownmail-quoted-history')
		expect(details?.textContent).toContain('Earlier message')
		expect(details?.nextSibling).toBeNull()
	})

	it('requires a recognized lead-in before an Apple-style cite block', () => {
		const document = parse(
			'<p>On Friday, Alex wrote:</p> \n <br><br><blockquote type="cite">Earlier reply</blockquote><blockquote>Designed callout</blockquote>',
		)
		collapseQuotedHistory(document)

		expect(document.querySelector('details blockquote[type="cite"]')?.textContent).toContain('Earlier reply')
		expect(document.querySelectorAll('details > br')).toHaveLength(2)
		expect(document.querySelector('body > br')).toBeNull()
		expect(document.querySelector('body > blockquote:not([type])')?.textContent).toContain('Designed callout')
	})

	it('never collapses a bare blockquote or an unrecognized cite block', () => {
		const document = parse(
			'<blockquote type="cite">Citation without lead-in</blockquote><blockquote>Customer testimonial</blockquote><p>Notes:</p><blockquote type="cite">Another citation</blockquote>',
		)
		collapseQuotedHistory(document)

		expect(document.querySelector('details')).toBeNull()
		expect(document.querySelectorAll('blockquote')).toHaveLength(3)
	})

	it('does not nest disclosures for provider markers found inside quoted history', () => {
		const document = parse(`
			<div class="gmail_quote">
				<div class="yahoo_quoted">Nested Yahoo history</div>
				<div id="divRplyFwdMsg">Nested Outlook header</div>
				<p>On Friday, Sam wrote:</p><blockquote type="cite">Nested cite</blockquote>
			</div>
		`)
		collapseQuotedHistory(document)

		expect(document.querySelectorAll('details.ownmail-quoted-history')).toHaveLength(1)
	})

	it('flattens an inner marker even when its selector is processed before the outer marker', () => {
		const document = parse(`
			<div id="yahoo_quoted_outer">
				<div class="gmail_quote">Nested Gmail history</div>
			</div>
		`)
		collapseQuotedHistory(document)

		expect(document.querySelectorAll('details.ownmail-quoted-history')).toHaveLength(1)
		expect(document.querySelector('details')?.textContent).toContain('Nested Gmail history')
	})
})

describe('legacy VML calls to action', () => {
	it('turns an Outlook-only roundrect into a semantic fallback anchor', () => {
		const document = parse(
			'<v:roundrect href="https://example.com/confirm"><center>Confirm account</center></v:roundrect>',
		)
		preserveLegacyVmlCtas(document)

		const anchor = document.querySelector('a')
		expect(anchor?.getAttribute('href')).toBe('https://example.com/confirm')
		expect(anchor?.textContent).toBe('Confirm account')
	})

	it('uses a meaningful fallback label and leaves unsafe URL rejection to sanitization', () => {
		const prepared = prepareEmailMessageContent(
			'<v:roundrect href="javascript:alert(1)"></v:roundrect>',
			'm1',
		)
		const sanitized = sanitizeEmailHtml(prepared.html)

		expect(sanitized).toContain('Open link')
		expect(sanitized).not.toContain('javascript:')
	})

	it('recovers a safe CTA from a realistic MSO conditional comment before inert parsing', () => {
		const prepared = prepareEmailMessageContent(
			'<!--[if gte mso 9]><v:roundrect href="https://example.com/a?x=1&amp;y=2"><w:anchorlock/><center>Review &amp; approve</center></v:roundrect><![endif]--><p>After</p>',
			'm1',
		)
		const document = parse(prepared.html)
		const anchor = document.querySelector('a')

		expect(anchor?.getAttribute('href')).toBe('https://example.com/a?x=1&y=2')
		expect(anchor?.textContent).toBe('Review & approve')
		expect(document.body.textContent).toContain('After')
	})

	it('retains no-href VML text as non-interactive fallback content', () => {
		const direct = parse('<v:roundrect><center>Account status</center></v:roundrect>')
		preserveLegacyVmlCtas(direct)
		const conditional = prepareEmailMessageContent(
			'<!--[if mso]><v:roundrect><center>Status &#65; &#x1f680;</center></v:roundrect><![endif]-->',
			'm1',
		)

		expect(direct.querySelector('a')).toBeNull()
		expect(direct.body.textContent).toContain('Account status')
		expect(conditional.html).not.toContain('<a')
		expect(conditional.html).toContain('Status A 🚀')
	})

	it('decodes only inert text entities and labels an empty conditional CTA', () => {
		const prepared = prepareEmailMessageContent(
			'<!--[if mso]><v:roundrect href="https://example.com/text"><center>&lt;Go&gt; &quot;x&quot; &apos;y&apos; &#0;</center></v:roundrect><v:roundrect href="https://example.com/empty"><w:anchorlock/></v:roundrect><![endif]-->',
			'm1',
		)
		const document = parse(prepared.html)
		const links = document.querySelectorAll('a')

		expect(links[0]?.textContent).toBe(`<Go> "x" 'y' �`)
		expect(links[1]?.textContent).toBe('Open link')
	})

	it('keeps a conditional javascript CTA as text while sanitization rejects its URL', () => {
		const prepared = prepareEmailMessageContent(
			"<!--[if mso]><v:roundrect href='javascript:alert(1)'>Unsafe CTA</v:roundrect><![endif]-->",
			'm1',
		)
		const sanitized = sanitizeEmailHtml(prepared.html)

		expect(sanitized).toContain('Unsafe CTA')
		expect(sanitized).not.toContain('javascript:')
	})
})

describe('prose classification', () => {
	it('bounds simple semantic HTML with harmless typography', () => {
		const prepared = prepareEmailMessageContent(
			'<h2>Update</h2><p style="color: navy">A readable paragraph.</p>',
			'm1',
		)
		expect(prepared.isProse).toBe(true)
	})

	it.each([
		['empty markup', '<p> </p>'],
		['fixed table design', '<table width="600"><tr><td>Newsletter</td></tr></table>'],
		['image design', '<p>Newsletter</p><img src="https://example.com/hero.png">'],
		['stylesheet design', '<style>p{max-width:600px}</style><p>Newsletter</p>'],
		['legacy design attribute', '<div bgcolor="#fff">Newsletter</div>'],
		['body design attribute', '<body width="640">Newsletter</body>'],
		['inline layout', '<div style="display:grid">Newsletter</div>'],
		['body inline layout', '<body style="max-width:640px">Newsletter</body>'],
		['padded card', '<div style="padding:24px">Card content</div>'],
		['bordered card', '<div style="border:1px solid #ddd">Card content</div>'],
		['fixed-height card', '<div style="height:240px">Card content</div>'],
	])('does not constrain %s', (_label, html) => {
		expect(prepareEmailMessageContent(html, 'm1').isProse).toBe(false)
	})
})

describe('plaintext quoted history', () => {
	it('splits a recognized reply lead-in followed by conventional quoting', () => {
		expect(
			splitPlainQuotedHistory('Thanks, Alex.\n\nOn Friday, Sam wrote:\n> Earlier line\n> Another line'),
		).toEqual({
			visible: 'Thanks, Alex.',
			quoted: 'On Friday, Sam wrote:\n> Earlier line\n> Another line',
		})
	})

	it('supports a forwarded-message separator when quoted lines follow it', () => {
		expect(splitPlainQuotedHistory('Note\n-----Original Message-----\n\n> Old text').quoted).toContain(
			'Original Message',
		)
	})

	it.each([
		['an arbitrary standalone quote', 'A thought:\n> Keep this visible'],
		['a lead-in without quoted lines', 'On Friday, Sam wrote:\nEarlier unquoted text'],
		[
			'a later standalone quote after new text',
			'On Friday, Sam wrote:\nNew unquoted paragraph\n\n> Separate quote',
		],
	])('keeps %s fully visible', (_label, text) => {
		expect(splitPlainQuotedHistory(text)).toEqual({ visible: text })
	})
})
