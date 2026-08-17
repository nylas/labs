// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'real-email-fixtures')
const fixtureFiles = readdirSync(fixtureDirectory).filter((file) => file.endsWith('.html'))
const genericVisibleWord =
	/^(?:a|we|the|mail|inbox|reader|messagex*|readable|newsletter|experience|redacted|address|https|fixtures|invalid)$/i

describe('scrubbed real-email fixtures', () => {
	it('contain several structurally distinct examples', () => {
		expect(fixtureFiles).toHaveLength(5)
	})

	it.each(fixtureFiles)('%s contains no direct identifiers or live resources', (file) => {
		const html = readFileSync(join(fixtureDirectory, file), 'utf8')
		const document = new JSDOM(html).window.document

		expect(html).not.toMatch(/\b[\w.+-]+@(?!fixtures\.invalid\b)[\w.-]+\.[A-Za-z]{2,}\b/u)
		expect(html).not.toMatch(/\bnyi_[A-Za-z0-9]+\b/u)
		for (const url of html.match(/(?:https?:)?\/\/[^\s"'<>)]*/giu) ?? []) {
			const normalized = url.replace(/^\/\//, 'https://')
			expect(
				normalized === 'https://fixtures.invalid' || normalized.startsWith('https://fixtures.invalid/'),
			).toBe(true)
		}

		expect(document.querySelector('script, iframe, object, embed, base')).toBeNull()
		for (const element of document.querySelectorAll('*')) {
			for (const token of element.classList) expect(token).toMatch(/^fixture-c\d+$/)
			if (element.id) expect(element.id).toMatch(/^fixture-i\d+$/)
			for (const attribute of element.getAttributeNames()) {
				if (attribute.startsWith('on')) throw new Error(`${file} contains an event handler attribute`)
				if (attribute.startsWith('data-')) expect(['data-ogsc', 'data-ogsb']).toContain(attribute)
			}
		}
		for (const style of document.querySelectorAll('style')) {
			const selectors = (style.textContent ?? '').replace(/url\([^)]*\)/giu, '')
			for (const selector of selectors.matchAll(/\.(-?[_A-Za-z][_A-Za-z0-9-]*)/g)) {
				expect(selector[1]).toMatch(/^fixture-c\d+$/)
			}
		}

		const visibleText = Array.from(document.querySelectorAll('body *'))
			.filter((element) => element.tagName !== 'STYLE')
			.map((element) =>
				Array.from(element.childNodes)
					.filter((node) => node.nodeType === node.TEXT_NODE)
					.map((node) => node.textContent ?? '')
					.join(' '),
			)
			.join(' ')
		const unexpectedWords = (visibleText.match(/[A-Za-z]+/g) ?? []).filter(
			(word) => !genericVisibleWord.test(word),
		)
		expect(unexpectedWords).toEqual([])
		expect(visibleText).not.toMatch(/[1-9]/)
	})
})
