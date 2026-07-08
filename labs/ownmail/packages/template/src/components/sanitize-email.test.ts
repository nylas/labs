/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from './sanitize-email.js'

describe('sanitizeEmailHtml', () => {
	it('strips script tags', () => {
		expect(sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>')
	})

	it('strips spaced script end tags', () => {
		expect(sanitizeEmailHtml('<p>Hello</p><script>alert(1)</script ><p>Goodbye</p>')).toBe(
			'<p>Hello</p><p>Goodbye</p>',
		)
	})

	it('strips inline event handlers', () => {
		expect(sanitizeEmailHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x">')
	})

	it('blocks javascript: urls in links', () => {
		expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
	})
})
