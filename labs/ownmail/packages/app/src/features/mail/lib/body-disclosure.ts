/**
 * What a message body tucks away (design.md "Reading", "Edge states"): the
 * quoted history and the signature that trail what the person wrote. The
 * reader shows the new text first and these behind quiet pills, so this module
 * takes them off the end of a body and describes them: one entry per quoted
 * earlier message (who, when, their words) and the signature's lines. For an
 * HTML body it also keeps what it took as HTML, so the reader can show the
 * original with its links and images through the same sanitizer.
 *
 * Only a trailing history or signature is taken. Anything with new text after
 * it stays where the sender put it, and a body that would be left with no
 * text of its own is not split at all. A forwarded message is the content,
 * not history, so it stays in the body; a signature with no words (a logo)
 * stays too, rather than becoming an empty pill.
 */

import { cutAtWord, reflowPlainText } from './edge-states.js'
import { splitPlainQuotedHistory } from './email-message-content.js'

export type QuotedEntry = {
	/** The quoted sender's display name, or their address when the attribution has no name. */
	name: string
	email?: string
	/** The attribution's date as written ("Tue, Oct 13, 2026 at 6:02 PM"). */
	dateText?: string
	/** That message's own words, quotes inside it removed; paragraphs on their own lines. */
	text: string
	/** A forwarded message: not an earlier message of this thread, so it never links to one. */
	forwarded?: boolean
}

export type BodyDisclosure = {
	quoted: QuotedEntry[]
	signature: string[]
	/** The taken history as a sanitizable document, links and images intact (HTML bodies only). */
	quotedHtml?: string
	/** The taken signature as a document, when it carries links or images (HTML bodies only). */
	signatureHtml?: string
}

const LEAD_IN =
	/^(?:on\s+(.+?)\s+wrote:|le\s+.+\s+a écrit\s*:|am\s+.+\s+schrieb\s+.+:|el\s+.+\s+escribió\s*:)\s*$/i
const SEPARATOR = /^(?:-{2,}\s*(?:original|forwarded) message\s*-{2,}|begin forwarded message:)$/i
const FORWARD = /^(?:-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:)$/i
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

/**
 * Where the next earlier message starts in an unquoted chain (Outlook writes
 * each one under its own "From: … Sent: …" block, often after a rule or an
 * "-----Original Message-----" line): the index of that block, or -1.
 */
function nextHeaderBlock(lines: string[]): number {
	for (let index = 1; index < lines.length; index += 1) {
		const line = (lines[index] as string).trim()
		if (!HEADER_FROM.test(line)) continue
		// A From: line is itself a header line, so there is always a block; it needs a second line.
		if ((headerAttribution(lines.slice(index)) as { count: number }).count < 2) continue
		return SEPARATOR.test((lines[index - 1] as string).trim()) ? index - 1 : index
	}
	return -1
}

/** An entry's words: plain text reflows into paragraphs; HTML text keeps one line per block. */
function entryText(lines: string[], reflow: boolean): string {
	const text = lines.join('\n').trim()
	if (!reflow) return text
	return reflowPlainText(text)
		.map((block) => block.text)
		.join('\n\n')
}

/**
 * Entries of a history: an attribution, separator or header block, then that
 * message's words. `>`-quoted lines nest once per level; an unquoted chain
 * splits at each repeated header block.
 */
function plainEntries(lines: string[], reflow = true): QuotedEntry[] {
	const first = (lines[0] as string).trim()
	let attribution = parseAttribution(first)
	const forwarded = FORWARD.test(first)
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
	const nestedAt = quoted
		? own.findIndex(
				(line, index) =>
					parseAttribution(line) !== null && own.slice(index + 1).some((next) => QUOTE_MARK.test(next)),
			)
		: nextHeaderBlock(own)
	const ownLines = nestedAt === -1 ? own : own.slice(0, nestedAt)
	const entry: QuotedEntry = {
		name: attribution?.name ?? '',
		...attribution,
		text: entryText(ownLines, reflow),
		...(forwarded ? { forwarded } : {}),
	}
	return [entry, ...(nestedAt === -1 ? [] : plainEntries(own.slice(nestedAt), reflow))]
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
		return plainEntries(lines, false)
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
		text: readableText(own),
	}
	return [entry, ...nestedEntries]
}

/** The readable text of a history wrapper, without its "Show quoted text" summary. */
function historyText(details: Element): string {
	const copy = details.cloneNode(true) as Element
	copy.querySelector(':scope > summary')?.remove()
	return readableText(copy)
}

/** Whether a taken part must stay in the body: a forwarded message, or a signature with no words. */
function staysInBody(element: Element): boolean {
	if (element.matches(QUOTED_DETAILS)) return FORWARD.test(historyText(element).split('\n')[0] as string)
	return signatureLines(element).length === 0
}

/** A signature's lines as a reader sees them, without the "-- " that opens it. */
function signatureLines(element: Element): string[] {
	return readableText(element)
		.split('\n')
		.filter((line) => line !== '' && !SIGNATURE_DELIMITER.test(line))
}

/** A standalone document of some taken nodes, under the message's own styles. */
function fragmentDocument(document: Document, elements: Element[]): string {
	const body = elements.map((element) => element.innerHTML).join('')
	return `<!doctype html><html><head>${document.head.innerHTML}</head><body>${body}</body></html>`
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
		if (contentAfter(candidate, taken) || staysInBody(candidate)) break
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
	const histories: Element[] = []
	const signatures: Element[] = []
	for (const element of taken.reverse()) {
		if (element.matches(QUOTED_DETAILS)) {
			element.querySelector(':scope > summary')?.remove()
			quoted.push(...htmlEntries(element))
			histories.push(element)
		} else {
			const prefix = element.previousElementSibling
			if (prefix?.classList.contains('gmail_signature_prefix')) prefix.remove()
			signature.push(...signatureLines(element))
			signatures.push(element)
		}
		element.remove()
	}
	const rich = signatures.some((element) => element.querySelector('a[href], img'))
	return {
		html: document.documentElement.outerHTML,
		quoted,
		signature,
		...(histories.length > 0 ? { quotedHtml: fragmentDocument(document, histories) } : {}),
		...(rich ? { signatureHtml: fragmentDocument(document, signatures) } : {}),
	}
}

/** How an entry's words read under its header: cut near 72 characters when the full message is a click away. */
export function quotedExcerpt(entry: QuotedEntry, linked: boolean): string {
	return linked ? cutAtWord(entry.text, 72) : entry.text
}
