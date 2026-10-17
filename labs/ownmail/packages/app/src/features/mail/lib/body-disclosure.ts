/**
 * What a message body tucks away (design.md "Reading", "Edge states"): the
 * quoted history and the signature that trail what the person wrote. The
 * reader shows the new text first and these behind quiet pills, so this module
 * takes them off the end of a body and describes them: one entry per quoted
 * earlier message (who, when, their words) and the signature's lines.
 *
 * Only a trailing history or signature is taken. Anything with new text after
 * it stays where the sender put it, and a body that would be left with no
 * text of its own is not split at all.
 */

import { cutAtWord } from './edge-states.js'
import { splitPlainQuotedHistory } from './email-message-content.js'

export type QuotedEntry = {
	/** The quoted sender's display name, or their address when the attribution has no name. */
	name: string
	email?: string
	/** The attribution's date as written ("Tue, Oct 13, 2026 at 6:02 PM"). */
	dateText?: string
	/** That message's own words, quotes inside it removed. */
	text: string
}

export type BodyDisclosure = { quoted: QuotedEntry[]; signature: string[] }

const LEAD_IN =
	/^(?:on\s+(.+?)\s+wrote:|le\s+.+\s+a écrit\s*:|am\s+.+\s+schrieb\s+.+:|el\s+.+\s+escribió\s*:)\s*$/i
const SEPARATOR = /^(?:-{2,}\s*(?:original|forwarded) message\s*-{2,}|begin forwarded message:)$/i
const HEADER_LINE = /^(?:from|sent|date|to|cc|subject|reply-to):/i
const HEADER_FROM = /^from:\s*(.+)$/i
const HEADER_DATE = /^(?:sent|date):\s*(.+)$/i
const SIGNATURE_DELIMITER = /^--\s?$/

/** "Grace Hopper <grace@x>", "grace@x", "\"Hopper, Grace\" <grace@x>" → name and address. */
function person(raw: string): { name: string; email?: string } {
	const text = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
	const angled = /^(.*?)\s*[<[]\s*([^<>[\]\s]+@[^<>[\]\s]+)\s*[>\]]$/.exec(text)
	if (angled) {
		const name = (angled[1] as string).replace(/^["'\s]+|["'\s]+$/g, '')
		return { name: name || (angled[2] as string), email: angled[2] as string }
	}
	if (/^[^\s@]+@[^\s@]+$/.test(text)) return { name: text, email: text }
	return { name: text.replace(/^["'\s]+|["'\s]+$/g, '') }
}

/**
 * Who and when from a reply attribution: "On Tue, Oct 13, 2026 at 6:02 PM
 * Grace Hopper <grace@x> wrote:". The date runs to the last time or year in
 * the line; the person is what follows it.
 */
export function parseAttribution(line: string): Omit<QuotedEntry, 'text'> | null {
	const lead = LEAD_IN.exec(line.replace(/\s+/g, ' ').trim())
	if (!lead) return null
	const body = lead[1]
	if (!body) return { name: '' }
	const split =
		/^(.*(?:\d{1,2}:\d{2}(?:\s?[AP]M)?|\d{4}))\s*,?\s+(.+)$/i.exec(body) ?? /^(.+),\s*([^,]+)$/.exec(body)
	if (!split) return { ...person(body) }
	return { ...person(split[2] as string), dateText: (split[1] as string).trim() }
}

/** The epoch seconds of an attribution date, when the browser can read it. */
export function attributionSeconds(dateText: string | undefined): number | null {
	if (!dateText) return null
	const parsed = Date.parse(dateText.replace(/\s+at\s+/i, ' ').replace(/\s+/g, ' '))
	return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

const QUOTE_MARK = /^\s*>/
const unquote = (line: string): string => line.replace(/^\s*> ?/, '')

/** Who and when from a mail client's header block ("From: …", "Sent: …") at the start of some lines. */
function headerAttribution(
	lines: string[],
): { attribution: Omit<QuotedEntry, 'text'>; count: number } | null {
	let count = 0
	while (count < lines.length && HEADER_LINE.test(unquote(lines[count] as string).trim())) count += 1
	if (count === 0) return null
	const block = lines.slice(0, count).map((line) => unquote(line).trim())
	const from = block.map((line) => HEADER_FROM.exec(line)?.[1]).find(Boolean)
	const date = block.map((line) => HEADER_DATE.exec(line)?.[1]).find(Boolean)
	return { attribution: { ...person(from ?? ''), ...(date ? { dateText: date.trim() } : {}) }, count }
}

/** Entries of a plain-text history: an attribution or header block, then `>`-quoted lines, nested once per level. */
function plainEntries(lines: string[]): QuotedEntry[] {
	const first = (lines[0] as string).trim()
	let attribution = parseAttribution(first)
	let rest = attribution || SEPARATOR.test(first) ? lines.slice(1) : lines
	if (!attribution) {
		const headers = headerAttribution(rest)
		if (headers) {
			attribution = headers.attribution
			rest = rest.slice(headers.count)
		}
	}
	const quoted = rest.some((line) => QUOTE_MARK.test(line))
	const own = quoted ? rest.filter((line) => QUOTE_MARK.test(line)).map(unquote) : rest
	const nestedAt = own.findIndex(
		(line, index) =>
			parseAttribution(line) !== null && own.slice(index + 1).some((next) => QUOTE_MARK.test(next)),
	)
	const ownLines = nestedAt === -1 ? own : own.slice(0, nestedAt)
	const entry: QuotedEntry = {
		name: attribution?.name ?? '',
		...attribution,
		text: collapse(ownLines.join(' ')),
	}
	return [entry, ...(nestedAt === -1 ? [] : plainEntries(own.slice(nestedAt)))]
}

/**
 * Split a plain-text body into the words the person wrote and what trails
 * them: quoted history (a recognised attribution or separator followed by
 * `>` quoting) and a signature after a `-- ` line.
 */
export function splitPlainBody(text: string): { visible: string } & BodyDisclosure {
	const content = splitPlainQuotedHistory(text)
	let visible = content.visible
	const quoted = content.quoted ? plainEntries(content.quoted.split('\n')) : []
	let signature: string[] = []
	const lines = visible.split('\n')
	const delimiter = lines.findLastIndex((line) => SIGNATURE_DELIMITER.test(line))
	if (delimiter > 0 && lines.slice(0, delimiter).some((line) => line.trim())) {
		signature = lines
			.slice(delimiter + 1)
			.map((line) => line.trim())
			.filter(Boolean)
		visible = lines.slice(0, delimiter).join('\n').trimEnd()
	}
	return { visible, quoted, signature }
}

const BLOCK_TAGS = new Set([
	'ADDRESS',
	'BLOCKQUOTE',
	'BR',
	'DIV',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HR',
	'LI',
	'P',
	'PRE',
	'TABLE',
	'TR',
])

const SKIPPED_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE', 'SUMMARY'])

/** The text of a node with a line break where a block or `<br>` ends, as a reader sees it. */
export function readableText(node: Node): string {
	let text = ''
	const walk = (current: Node) => {
		if (current.nodeType === Node.TEXT_NODE) {
			text += current.textContent
			return
		}
		const element = current.nodeType === Node.ELEMENT_NODE ? (current as Element) : null
		if (!element && current.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
		if (element && SKIPPED_TAGS.has(element.tagName)) return
		for (const child of current.childNodes) walk(child)
		if (element && BLOCK_TAGS.has(element.tagName)) text += '\n'
	}
	walk(node)
	return text
		.split('\n')
		.map((line) => line.replace(/[ \t ]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n')
}

const QUOTED_DETAILS = 'details.ownmail-quoted-history'
const TAKEN = 'data-ownmail-taken'
const SIGNATURE_SELECTOR =
	'.gmail_signature, .moz-signature, #Signature, #AppleMailSignature, [data-smartmail="gmail_signature"]'

/** Whether anything a reader would see (text or an image) follows `node`, other than the nodes being taken. */
function contentAfter(node: Element, taken: readonly Element[]): boolean {
	const body = node.ownerDocument.body
	const walker = node.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
	walker.currentNode = node
	let next = walker.nextNode()
	while (next) {
		const inside = node.contains(next) || taken.some((other) => other.contains(next))
		const visible =
			next.nodeType === Node.TEXT_NODE
				? (next.textContent as string).trim() !== ''
				: (next as Element).tagName === 'IMG'
		if (!inside && visible) return true
		next = walker.nextNode()
	}
	return false
}

/** Entries of an HTML history: the attribution before the first blockquote, its own words, then nested quotes. */
function htmlEntries(container: Element): QuotedEntry[] {
	const quote = container.querySelector('blockquote')
	if (!quote) {
		const lines = readableText(container).split('\n')
		return plainEntries(lines)
	}
	// The attribution is what the history says before its first quote.
	const range = container.ownerDocument.createRange()
	range.selectNodeContents(container)
	range.setEndBefore(quote)
	const attributionLines = readableText(range.cloneContents()).split('\n')
	const attribution = attributionLines.map(parseAttribution).findLast((value) => value !== null) ?? null

	const own = quote.cloneNode(true) as Element
	const nested = own.querySelector('blockquote')
	let nestedEntries: QuotedEntry[] = []
	if (nested) {
		// The nested quote travels with its own attribution: the wrapper that holds both.
		const parent = nested.parentElement as Element
		const wrapper = parent !== own && parent.classList.contains('gmail_quote') ? parent : nested
		const holder = own.ownerDocument.createElement('div')
		let lead = wrapper.previousSibling
		while (lead && !(lead.textContent as string).trim()) lead = lead.previousSibling
		if (wrapper === nested && lead && parseAttribution(readableText(lead).split('\n').at(-1) as string)) {
			holder.appendChild(lead.cloneNode(true))
			;(lead as ChildNode).remove()
		}
		holder.appendChild(wrapper.cloneNode(true))
		wrapper.remove()
		nestedEntries = htmlEntries(holder)
	}
	const entry: QuotedEntry = {
		name: attribution?.name ?? '',
		...attribution,
		text: collapse(readableText(own)),
	}
	return [entry, ...nestedEntries]
}

/**
 * Take a trailing quoted history (OwnMail's `details.ownmail-quoted-history`
 * wrapper from `collapseQuotedHistory`) and a trailing client-marked signature
 * off a prepared HTML body.
 */
export function splitHtmlBody(preparedHtml: string): { html: string } & BodyDisclosure {
	const document = new DOMParser().parseFromString(preparedHtml, 'text/html')
	// Last first: only what trails the message can be taken.
	const candidates = [...document.querySelectorAll(`${QUOTED_DETAILS}, ${SIGNATURE_SELECTOR}`)]
		.filter((element) => element.matches(QUOTED_DETAILS) || !element.closest(QUOTED_DETAILS))
		.filter((element, _index, all) => !all.some((other) => other !== element && other.contains(element)))
		.reverse()
	const taken: Element[] = []
	for (const candidate of candidates) {
		if (contentAfter(candidate, taken)) break
		taken.push(candidate)
	}
	const unchanged = { html: preparedHtml, quoted: [], signature: [] }
	if (taken.length === 0) return unchanged
	for (const element of taken) element.setAttribute(TAKEN, '')
	const remaining = document.body.cloneNode(true) as Element
	for (const element of remaining.querySelectorAll(`[${TAKEN}]`)) element.remove()
	if (!readableText(remaining) && !remaining.querySelector('img')) return unchanged

	const quoted: QuotedEntry[] = []
	const signature: string[] = []
	for (const element of taken.reverse()) {
		if (element.matches(QUOTED_DETAILS)) {
			element.querySelector(':scope > summary')?.remove()
			quoted.push(...htmlEntries(element))
		} else {
			const prefix = element.previousElementSibling
			if (prefix?.classList.contains('gmail_signature_prefix')) prefix.remove()
			signature.push(
				...readableText(element)
					.split('\n')
					.filter((line) => !SIGNATURE_DELIMITER.test(line)),
			)
		}
		element.remove()
	}
	return { html: document.documentElement.outerHTML, quoted, signature }
}

/** How an entry's words read under its header: cut near 72 characters when the full message is a click away. */
export function quotedExcerpt(entry: QuotedEntry, linked: boolean): string {
	return linked ? cutAtWord(entry.text, 72) : entry.text
}
