import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const MAX_SOURCE_BYTES = 2_000_000
const FIXTURE_ORIGIN = 'https://fixtures.invalid'
const GENERIC_WORDS = new Map([
	[1, 'a'],
	[2, 'we'],
	[3, 'the'],
	[4, 'mail'],
	[5, 'inbox'],
	[6, 'reader'],
	[7, 'message'],
	[8, 'readable'],
	[9, 'newsletter'],
	[10, 'experience'],
])

function usage() {
	throw new Error('Usage: node scripts/redact-email-fixtures.mjs <source-response.json>:<output.html> [...]')
}

function escapedRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function genericWord(length) {
	return GENERIC_WORDS.get(length) ?? `message${'x'.repeat(Math.max(0, length - 7))}`
}

function preserveCase(replacement, original) {
	if (original === original.toUpperCase()) return replacement.toUpperCase()
	if (original[0] === original[0]?.toUpperCase()) {
		return `${replacement[0]?.toUpperCase() ?? ''}${replacement.slice(1)}`
	}
	return replacement
}

function redactText(value) {
	return value
		.replace(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu, (word) =>
			preserveCase(genericWord(Array.from(word).length), word),
		)
		.replace(/\d/g, '0')
}

function replaceCssToken(css, prefix, original, replacement) {
	const token = escapedRegExp(original)
	return css.replace(
		new RegExp(`${escapedRegExp(prefix)}${token}(?![\\w-])`, 'gu'),
		`${prefix}${replacement}`,
	)
}

function redactCss(css, classNames, ids) {
	let redacted = css.replace(/\/\*[\s\S]*?\*\//g, '')
	for (const [original, replacement] of classNames) {
		redacted = replaceCssToken(redacted, '.', original, replacement)
	}
	for (const [original, replacement] of ids) {
		redacted = replaceCssToken(redacted, '#', original, replacement)
	}
	redacted = redacted
		.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/giu, `url("${FIXTURE_ORIGIN}/media/background.png")`)
		.replace(/(font-family\s*:\s*)[^;}]+/giu, '$1Arial, sans-serif')
		.replace(
			/(content\s*:\s*)(["'])(.*?)\2/giu,
			(_match, prefix, quote, content) => `${prefix}${quote}${redactText(content)}${quote}`,
		)
	return redacted
}

function fixtureMediaUrl(element, index) {
	const type = element.tagName.toLowerCase() === 'source' ? 'artwork' : 'image'
	return `${FIXTURE_ORIGIN}/media/${type}-${index}.png`
}

function redactDocument(html) {
	const dom = new JSDOM(html)
	const { document, NodeFilter } = dom.window
	for (const element of document.querySelectorAll('script, iframe, object, embed, base')) element.remove()

	const commentWalker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT)
	const comments = []
	while (commentWalker.nextNode()) comments.push(commentWalker.currentNode)
	for (const comment of comments) comment.remove()

	const classTokens = new Set()
	const idTokens = new Set()
	for (const element of document.querySelectorAll('*')) {
		for (const token of element.classList) classTokens.add(token)
		if (element.id) idTokens.add(element.id)
	}
	for (const style of document.querySelectorAll('style')) {
		for (const match of style.textContent?.matchAll(/\.(-?[_A-Za-z][_A-Za-z0-9-]*)/g) ?? []) {
			if (match[1]) classTokens.add(match[1])
		}
	}
	const classNames = new Map(
		Array.from(classTokens)
			.sort()
			.map((token, index) => [token, `fixture-c${index + 1}`]),
	)
	const ids = new Map(
		Array.from(idTokens)
			.sort()
			.map((token, index) => [token, `fixture-i${index + 1}`]),
	)

	for (const style of document.querySelectorAll('style')) {
		style.textContent = redactCss(style.textContent ?? '', classNames, ids)
	}

	let mediaIndex = 0
	for (const element of document.querySelectorAll('*')) {
		if (element.classList.length > 0) {
			element.setAttribute(
				'class',
				Array.from(element.classList)
					.map((token) => classNames.get(token))
					.filter(Boolean)
					.join(' '),
			)
		}
		if (element.id) element.id = ids.get(element.id) ?? ''

		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase()
			if (name === 'xmlns' || name.startsWith('xmlns:')) {
				element.removeAttribute(attribute.name)
				continue
			}
			if (name.startsWith('on')) {
				element.removeAttribute(attribute.name)
				continue
			}
			if (name.startsWith('data-') && !['data-ogsc', 'data-ogsb'].includes(name)) {
				element.removeAttribute(attribute.name)
				continue
			}
			if (name === 'style') {
				element.setAttribute(attribute.name, redactCss(attribute.value, classNames, ids))
				continue
			}
			if (['src', 'poster', 'background'].includes(name)) {
				mediaIndex += 1
				element.setAttribute(attribute.name, fixtureMediaUrl(element, mediaIndex))
				continue
			}
			if (name === 'srcset') {
				mediaIndex += 1
				element.setAttribute(attribute.name, `${fixtureMediaUrl(element, mediaIndex)} 1x`)
				continue
			}
			if (name === 'href' || name === 'xlink:href') {
				if (attribute.value.startsWith('#')) {
					const target = ids.get(attribute.value.slice(1))
					if (target) element.setAttribute(attribute.name, `#${target}`)
					else element.removeAttribute(attribute.name)
				} else {
					element.setAttribute(attribute.name, `${FIXTURE_ORIGIN}/action`)
				}
				continue
			}
			if (['alt', 'aria-label', 'aria-description', 'title', 'value', 'name', 'placeholder'].includes(name)) {
				element.setAttribute(attribute.name, redactText(attribute.value))
			}
		}
	}

	const textWalker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT)
	const textNodes = []
	while (textWalker.nextNode()) {
		const parent = textWalker.currentNode.parentElement
		if (parent?.tagName !== 'STYLE') textNodes.push(textWalker.currentNode)
	}
	for (const node of textNodes) node.nodeValue = redactText(node.nodeValue ?? '')

	const serialized = `<!doctype html>\n${document.documentElement.outerHTML}\n`
	return serialized
		.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, 'redacted-address')
		.replace(/(?:https?:)?\/\/(?!fixtures\.invalid)[^\s"'<>)]*/giu, FIXTURE_ORIGIN)
}

function sensitiveValues(message) {
	const values = []
	for (const field of ['from', 'to', 'cc', 'bcc', 'reply_to']) {
		for (const contact of message[field] ?? []) {
			if (typeof contact?.email === 'string') values.push(contact.email)
			if (typeof contact?.name === 'string' && contact.name.trim().length >= 4) values.push(contact.name)
		}
	}
	return values
}

function assertRedacted(output, message) {
	if (/\b[\w.+-]+@(?!fixtures\.invalid\b)[\w.-]+\.[A-Za-z]{2,}\b/u.test(output)) {
		throw new Error('Redacted fixture still contains an email address')
	}
	const urls = output.match(/(?:https?:)?\/\/[^\s"'<>)]*/giu) ?? []
	if (
		urls.some((url) => {
			const normalized = url.replace(/^\/\//, 'https://')
			return normalized !== FIXTURE_ORIGIN && !normalized.startsWith(`${FIXTURE_ORIGIN}/`)
		})
	) {
		throw new Error('Redacted fixture still contains a non-fixture URL')
	}
	const normalized = output.toLocaleLowerCase('en-US')
	for (const value of sensitiveValues(message)) {
		if (normalized.includes(value.toLocaleLowerCase('en-US'))) {
			throw new Error('Redacted fixture still contains message contact metadata')
		}
	}
}

async function main() {
	const pairs = process.argv.slice(2)
	if (pairs.length === 0) usage()
	for (const pair of pairs) {
		const separator = pair.indexOf(':')
		if (separator <= 0 || separator === pair.length - 1) usage()
		const sourcePath = resolve(pair.slice(0, separator))
		const outputPath = resolve(pair.slice(separator + 1))
		if (!sourcePath.endsWith('.json') || !outputPath.endsWith('.html')) usage()
		const source = await readFile(sourcePath, 'utf8')
		if (Buffer.byteLength(source) > MAX_SOURCE_BYTES)
			throw new Error(`Source is too large: ${basename(sourcePath)}`)
		const payload = JSON.parse(source)
		const message = payload?.data?.data
		if (!message || typeof message.body !== 'string')
			throw new Error(`Missing message body: ${basename(sourcePath)}`)
		const output = redactDocument(message.body)
		assertRedacted(output, message)
		await writeFile(outputPath, output, { encoding: 'utf8', mode: 0o600 })
		process.stdout.write(`Redacted ${basename(sourcePath)} -> ${basename(outputPath)}\n`)
	}
}

await main()
