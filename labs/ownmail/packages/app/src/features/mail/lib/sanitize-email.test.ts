// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	rewritePaneMediaQueries,
	sanitizeEmailDocument,
	sanitizeEmailHtml,
	sanitizeProviderCss,
} from './sanitize-email.js'

describe('rewritePaneMediaQueries', () => {
	it('converts common width breakpoints to the named reading-pane container', () => {
		expect(
			rewritePaneMediaQueries(
				'@media only screen and (min-width: 20rem) and (max-width:600px){.mobile{display:block}}',
			),
		).toBe('@container ownmail-email (min-width: 20rem) and (max-width:600px){.mobile{display:block}}')
	})

	it('converts comma-separated width lists into pane queries', () => {
		expect(
			rewritePaneMediaQueries(
				'@media screen and (max-width:600px), screen and (max-width:40rem){.x{display:block}}',
			),
		).toBe(
			'@container ownmail-email (max-width:600px){.x{display:block}}@container ownmail-email (max-width:40rem){.x{display:block}}',
		)
	})

	it('maps archaic device-width branches to the reading pane', () => {
		expect(
			rewritePaneMediaQueries(
				'@media only screen and (max-width:600px), only screen and (max-device-width:40rem){.x{display:block}}',
			),
		).toBe(
			'@container ownmail-email (max-width:600px){.x{display:block}}@container ownmail-email (max-width:40rem){.x{display:block}}',
		)
	})

	it('deduplicates equivalent width and device-width branches', () => {
		expect(
			rewritePaneMediaQueries(
				'@media only screen and (max-width:600px), only screen and (max-device-width:600px){.x{display:block}}',
			),
		).toBe('@container ownmail-email (max-width:600px){.x{display:block}}')
	})

	it('preserves unsupported viewport branches while converting width-only branches', () => {
		expect(rewritePaneMediaQueries('@media print, (max-width:600px){.x{display:block}}')).toBe(
			'@media print{.x{display:block}}@container ownmail-email (max-width:600px){.x{display:block}}',
		)
	})

	it('leaves non-width, mixed, and malformed media rules unchanged', () => {
		const css = [
			'@media (prefers-color-scheme:dark){body{background:#000}}',
			'@media (max-width:600px) and (orientation:portrait){.x{display:block}}',
		].join('')
		expect(rewritePaneMediaQueries(css)).toBe(css)
		const malformed = '@media (max-width:600px){.x{color:red}'
		expect(rewritePaneMediaQueries(malformed)).toBe(malformed)
	})

	it('does not split media-list commas inside quoted or escaped content', () => {
		const css = String.raw`@media "a\"b,c", 'd\'e,f', \screen and (max-width:600px){.x{display:block}}`
		expect(rewritePaneMediaQueries(css)).toBe(css)
	})

	it('preserves viewport media semantics when Original layout requests them', () => {
		const documentElement = sanitizeEmailDocument(
			'<style>@media (max-width:600px){.mobile{display:block}}</style><p>Body</p>',
			{ rewriteViewportMedia: false },
		)
		expect(documentElement?.querySelector('style')?.textContent).toContain('@media (max-width:600px)')
	})
})

describe('sanitizeEmailHtml', () => {
	it('returns an empty string unchanged', () => {
		expect(sanitizeEmailHtml('')).toBe('')
	})

	it('strips <script> tags', () => {
		const out = sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>')
		expect(out).toContain('<p>Hi</p>')
		expect(out).not.toContain('<script')
		expect(out).not.toContain('alert(1)')
	})

	it('strips inline event handlers', () => {
		const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)" />')
		expect(out).not.toContain('onerror')
	})

	it('neutralizes javascript: URLs on links', () => {
		const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
		expect(out).not.toContain('javascript:')
	})

	it('drops phishing-prone form controls', () => {
		const out = sanitizeEmailHtml('<form action="https://evil.com"><input name="pw" /></form>')
		expect(out).not.toContain('<form')
		expect(out).not.toContain('<input')
	})

	it('keeps presentational HTML: links, images, tables, and inline styles', () => {
		const out = sanitizeEmailHtml(
			'<table><tr><td style="color:red"><a href="https://ok.com">ok</a><img src="https://ok.com/a.png" /></td></tr></table>',
		)
		expect(out).toContain('<table')
		expect(out).toContain('href="https://ok.com"')
		expect(out).toContain('src="https://ok.com/a.png"')
		expect(out).toContain('style="color:red"')
	})

	it('keeps ordinary scoped email stylesheet rules', () => {
		const css = '@media (max-width:600px){.card{width:100%}} .title{color:#434245}'
		const output = sanitizeEmailHtml(`<style>${css}</style><p class="title">Hi</p>`)
		expect(output).toContain(
			'@container ownmail-email (max-width:600px){.card{width:100%}} .title{color:#434245}',
		)
	})

	it('preserves safe document, body, and directionality attributes for faithful rendering', () => {
		const documentElement = sanitizeEmailDocument(`
			<html lang="ar" dir="rtl">
				<head><style>body.sender-canvas { background: navy; color: white; }</style></head>
				<body class="sender-canvas" id="message" style="margin:12px" onload="alert(1)">
					<p>مرحبا</p>
				</body>
			</html>
		`)
		const body = documentElement?.querySelector('body')

		expect(documentElement?.getAttribute('lang')).toBe('ar')
		expect(documentElement?.getAttribute('dir')).toBe('rtl')
		expect(documentElement?.querySelector('style')?.textContent).toContain('body.sender-canvas')
		expect(body?.getAttribute('class')).toBe('sender-canvas')
		expect(body?.getAttribute('id')).toBe('message')
		expect(body?.getAttribute('style')).toBe('margin:12px')
		expect(body?.hasAttribute('onload')).toBe(false)
	})

	it('drops stylesheets that can restyle the custom-element host', () => {
		const exploit = ':host{position:fixed!important;inset:0!important;z-index:99999!important}'
		const out = sanitizeEmailHtml(`<style>${exploit}</style><p>Safe content</p>`)
		expect(out).toBe('<p>Safe content</p>')
	})

	it('handles adjacent styles independently without reconstructing provider markup', () => {
		const out = sanitizeEmailHtml(
			'<style>.first{color:red}</style>' +
				'<style>:host{position:fixed}</style>' +
				'<style>.last{color:blue}</style><p>Content</p>',
		)
		expect(out).toBe('<style>.first{color:red}</style><style>.last{color:blue}</style><p>Content</p>')
	})

	it('moves a vetted body-nested style to the detached output without duplicating it', () => {
		const out = sanitizeEmailHtml(
			'<section><style media="screen and (max-width:600px)">.card{width:100%}</style><p class="card">Hi</p></section>',
		)
		expect(out).toBe(
			'<style media="screen and (max-width:600px)">.card{width:100%}</style><section><p class="card">Hi</p></section>',
		)
	})

	it('uses DOM parsing semantics for malformed style closing markup', () => {
		const out = sanitizeEmailHtml('<style>.safe{color:red}</style junk><p>After</p>')
		expect(out).toBe('<style>.safe{color:red}</style><p>After</p>')
	})

	it('fails closed for nested style-like text containing a host selector', () => {
		const out = sanitizeEmailHtml('<style>.safe{color:red}<style>:host{position:fixed}</style><p>After</p>')
		expect(out).toBe('<p>After</p>')
	})

	it('does not reconstruct malformed split style tags', () => {
		const out = sanitizeEmailHtml('<sty<style>le>:host{position:fixed}</style><p>Safe</p>')
		expect(out).not.toContain('<style')
		expect(out).toContain('Safe')
	})

	it('fails closed for host selectors hidden with CSS escapes or comments', () => {
		expect(sanitizeProviderCss(String.raw`:h\6f st { position: fixed }`)).toBe('')
		expect(sanitizeProviderCss(':h/**/ost { position: fixed }')).toBe('')
		expect(sanitizeProviderCss(':host/**/-context(.dark) { position: fixed }')).toBe('')
	})

	it('replaces invalid CSS escape code points during security inspection', () => {
		const css = String.raw`.label-\110000 { color: red }`
		expect(sanitizeProviderCss(css)).toBe(css)
	})

	it('drops imported stylesheets before they can load uninspected rules', () => {
		expect(sanitizeProviderCss('@import url("https://evil.example/host.css"); p { color: red }')).toBe('')
		expect(sanitizeProviderCss('@im/**/port "https://evil.example/host.css";')).toBe('')
		expect(sanitizeProviderCss(String.raw`@\69 mport "https://evil.example/host.css";`)).toBe('')
	})
})
