// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { disableLinks, inertLinksHtml } from './inert-links.js'
import { sanitizedDocumentHasRemoteImages, sanitizeEmailDocument } from './sanitize-email.js'

describe('inert links', () => {
	it('takes every destination out of a link and keeps its words', () => {
		const root = document.createElement('div')
		root.innerHTML = [
			'<a class="a" href="https://meridian-secure.co/verify" target="_blank" ping="https://t.example">Verify</a>',
			'<map><area class="area" href="https://area.example" alt="Area"></map>',
			'<svg><a class="svg" xlink:href="https://svg.example"><text>Svg</text></a></svg>',
		].join('')
		disableLinks(root)
		const link = root.querySelector('.a') as HTMLElement
		expect(link).toHaveTextContent('Verify')
		for (const attribute of ['href', 'target', 'ping']) expect(link).not.toHaveAttribute(attribute)
		expect(root.querySelector('.area')).not.toHaveAttribute('href')
		expect(root.querySelector('.svg')).not.toHaveAttribute('xlink:href')
		expect(root.innerHTML).not.toContain('https:')
	})

	it('returns a whole document with no live link in it, which the sanitizer reads as plain text', () => {
		const html = inertLinksHtml('<p><a href="https://x.example">Go</a></p>')
		expect(html.startsWith('<!doctype html><html>')).toBe(true)
		expect(html).not.toContain('href=')
		expect(html).toContain('>Go</a>')
		const sanitized = sanitizeEmailDocument(html) as HTMLElement
		expect(sanitizedDocumentHasRemoteImages(sanitized)).toBe(false)
	})
})
