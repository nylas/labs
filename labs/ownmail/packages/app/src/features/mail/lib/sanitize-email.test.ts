// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml, sanitizeProviderCss } from './sanitize-email.js'

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
		expect(sanitizeEmailHtml(`<style>${css}</style><p class="title">Hi</p>`)).toContain(css)
	})

	it('drops stylesheets that can restyle the custom-element host', () => {
		const exploit = ':host{position:fixed!important;inset:0!important;z-index:99999!important}'
		const out = sanitizeEmailHtml(`<style>${exploit}</style><p>Safe content</p>`)
		expect(out).toBe('<p>Safe content</p>')
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
