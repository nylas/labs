type InlineAttachment = {
	id: string
	content_id?: string
	is_inline?: boolean
}

export type PreparedEmailContent = {
	html: string
	isProse: boolean
}

const QUOTED_WRAPPER_SELECTORS = [
	'.gmail_quote',
	'.gmail_extra .gmail_quote',
	'.yahoo_quoted',
	'[id^="yahoo_quoted"]',
	'.AppleOriginalContents',
]

const QUOTED_SEPARATOR_SELECTORS = [
	'#divRplyFwdMsg',
	'.OutlookMessageHeader',
	'hr#stopSpelling',
	'.moz-cite-prefix',
]

const QUOTE_LEAD_IN = /^(?:on .+ wrote:|le .+ a écrit\s*:|am .+ schrieb .+:|el .+ escribió\s*:)/i
const PLAIN_QUOTE_SEPARATOR = /^(?:-{2,}\s*(?:original|forwarded) message\s*-{2,}|begin forwarded message:)$/i
const MSO_CONDITIONAL_COMMENT = /<!--\s*\[if\s+[^\]]*\bmso\b[^\]]*\]>([\s\S]*?)<!\[endif\]\s*-->/gi
const VML_ROUNDRECT = /<v:roundrect\b([^>]*)>([\s\S]*?)<\/v:roundrect\s*>/gi
const QUOTED_HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const CENTER_CONTENT = /<center\b[^>]*>([\s\S]*?)<\/center\s*>/i

type LegacyVmlCta = { href?: string; text: string }

export type PlainQuotedContent = {
	visible: string
	quoted?: string
}

/**
 * Split plaintext history only when a recognized reply separator is followed by
 * conventional `>` quoting. An isolated quote remains part of the visible body.
 */
export function splitPlainQuotedHistory(text: string): PlainQuotedContent {
	const lines = text.split('\n')
	for (let index = 0; index < lines.length; index += 1) {
		const line = (lines[index] as string).trim()
		if (!QUOTE_LEAD_IN.test(line) && !PLAIN_QUOTE_SEPARATOR.test(line)) continue
		let quoteStart = index + 1
		while (quoteStart < lines.length && !(lines[quoteStart] as string).trim()) quoteStart += 1
		if (quoteStart >= lines.length || !/^\s*>/.test(lines[quoteStart] as string)) continue
		return {
			visible: lines.slice(0, index).join('\n').trimEnd(),
			quoted: lines.slice(index).join('\n').trim(),
		}
	}
	return { visible: text }
}

/**
 * Prepare untrusted provider markup for the existing sanitizer/render boundary.
 * This function only adds inert presentation markup and same-origin attachment
 * URLs. The returned HTML must still pass through EmailHtml's sanitizer.
 */
export function prepareEmailMessageContent(
	html: string,
	messageId: string,
	attachments: InlineAttachment[] = [],
	imageTokens: Record<string, string> = {},
): PreparedEmailContent {
	const parseableHtml = html.replace(MSO_CONDITIONAL_COMMENT, (_comment, contents: string) => {
		return extractVmlCtas(contents)
			.map((cta) => {
				const text = escapeHtml(cta.text)
				return cta.href ? `<a href="${escapeHtml(cta.href)}">${text}</a>` : `<span>${text}</span>`
			})
			.join('')
	})
	const document = new DOMParser().parseFromString(parseableHtml, 'text/html')
	preserveLegacyVmlCtas(document)
	rewriteCidImages(document, messageId, attachments, imageTokens)
	collapseQuotedHistory(document)
	return {
		html: document.documentElement.outerHTML,
		isProse: isLikelyProseDocument(document),
	}
}

/** Preserve a usable link when an old Outlook email supplies only a VML button. */
export function preserveLegacyVmlCtas(document: Document): void {
	for (const element of document.querySelectorAll('*')) {
		if (element.tagName.toLowerCase() !== 'v:roundrect') continue
		const href = element.getAttribute('href')
		element.replaceWith(
			createVmlFallback(document, {
				...(href ? { href } : {}),
				text: element.textContent?.trim() || 'Open link',
			}),
		)
	}
}

function extractVmlCtas(contents: string): LegacyVmlCta[] {
	const ctas: LegacyVmlCta[] = []
	for (const match of contents.matchAll(VML_ROUNDRECT)) {
		const attributes = match[1] as string
		const body = match[2] as string
		const hrefMatch = attributes.match(QUOTED_HREF)
		const encodedHref = hrefMatch?.[1] ?? hrefMatch?.[2]
		const href = encodedHref ? decodeLimitedHtmlEntities(encodedHref) : undefined
		const textMarkup = body.match(CENTER_CONTENT)?.[1] ?? body
		const text = decodeLimitedHtmlEntities(textMarkup.replace(/<[^>]*>/g, ' '))
			.replace(/\s+/g, ' ')
			.trim()
		ctas.push({ ...(href ? { href } : {}), text: text || 'Open link' })
	}
	return ctas
}

function decodeLimitedHtmlEntities(value: string): string {
	return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos);/gi, (entity, decimal, hex) => {
		if (decimal) return safeCodePoint(Number.parseInt(decimal, 10))
		if (hex) return safeCodePoint(Number.parseInt(hex, 16))
		const named = entity.toLowerCase()
		if (named === '&amp;') return '&'
		if (named === '&lt;') return '<'
		if (named === '&gt;') return '>'
		if (named === '&quot;') return '"'
		return "'"
	})
}

function safeCodePoint(value: number): string {
	return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd'
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

function createVmlFallback(document: Document, cta: LegacyVmlCta): HTMLElement {
	const fallback = document.createElement(cta.href ? 'a' : 'span')
	if (cta.href) fallback.setAttribute('href', cta.href)
	fallback.textContent = cta.text
	return fallback
}

/** Rewrite only exact inline Content-ID image references to the authenticated route. */
export function rewriteCidImages(
	document: Document,
	messageId: string,
	attachments: InlineAttachment[],
	imageTokens: Record<string, string> = {},
): void {
	const contentIds = new Map<string, InlineAttachment>()
	for (const attachment of attachments) {
		if (!attachment.is_inline || !attachment.content_id) continue
		contentIds.set(normalizeContentId(attachment.content_id), attachment)
	}

	for (const image of document.querySelectorAll<HTMLImageElement>('img[src]')) {
		const source = (image.getAttribute('src') as string).trim()
		if (!source.toLowerCase().startsWith('cid:')) continue
		const attachment = contentIds.get(normalizeContentId(source.slice(4)))
		if (attachment) {
			const token = imageTokens[attachment.id]
			image.setAttribute(
				'src',
				token
					? `/email-images/${token}?mode=automatic&theme=light`
					: `/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(messageId)}`,
			)
			// A provider srcset can otherwise override the safely resolved src.
			image.removeAttribute('srcset')
			continue
		}

		const fallback = document.createElement('span')
		const label = image.getAttribute('alt')?.trim() || 'Inline image unavailable'
		fallback.setAttribute('role', 'img')
		fallback.setAttribute('aria-label', label)
		fallback.textContent = label
		image.replaceWith(fallback)
	}
}

/**
 * Collapse provider-attested quoted history. A bare blockquote is deliberately
 * insufficient: ordinary prose and designed callouts commonly use blockquotes.
 */
export function collapseQuotedHistory(document: Document): void {
	for (const selector of QUOTED_WRAPPER_SELECTORS) {
		for (const wrapper of document.querySelectorAll(selector)) {
			if (wrapper.closest('details.ownmail-quoted-history')) continue
			wrapQuotedNodes(document, [wrapper])
		}
	}

	for (const selector of QUOTED_SEPARATOR_SELECTORS) {
		for (const separator of document.querySelectorAll(selector)) {
			if (separator.closest('details.ownmail-quoted-history')) continue
			const nodes: Node[] = []
			let current: Node | null = separator
			while (current) {
				nodes.push(current)
				current = current.nextSibling
			}
			wrapQuotedNodes(document, nodes)
		}
	}

	for (const blockquote of document.querySelectorAll('blockquote[type="cite"]')) {
		if (blockquote.closest('details.ownmail-quoted-history')) continue
		const previous = previousMeaningfulSibling(blockquote)
		if (!previous || !QUOTE_LEAD_IN.test((previous.textContent as string).trim())) continue
		wrapQuotedNodes(document, siblingRange(previous, blockquote))
	}
}

function siblingRange(first: Node, last: Node): Node[] {
	const nodes: Node[] = []
	let current: Node | null = first
	while (current) {
		nodes.push(current)
		if (current === last) break
		current = current.nextSibling
	}
	return nodes
}

function wrapQuotedNodes(document: Document, nodes: Node[]): void {
	// Every caller supplies attached nodes returned by a query on this document.
	const first = nodes[0] as Node
	const parent = first.parentNode as Node
	for (const node of nodes) flattenQuotedDisclosures(node)
	const details = document.createElement('details')
	details.className = 'ownmail-quoted-history'
	details.style.setProperty('margin-block', '1em', 'important')
	details.style.setProperty('border-block-start', '1px solid currentColor', 'important')

	const summary = document.createElement('summary')
	summary.textContent = 'Show quoted text'
	summary.style.setProperty('cursor', 'pointer', 'important')
	summary.style.setProperty('padding-block', '0.75em', 'important')
	summary.style.setProperty('font-size', '0.875em', 'important')
	summary.style.setProperty('font-weight', '600', 'important')
	details.appendChild(summary)

	parent.insertBefore(details, first)
	for (const node of nodes) details.appendChild(node)
}

function flattenQuotedDisclosures(node: Node): void {
	if (node.nodeType !== Node.ELEMENT_NODE) return
	for (const nested of (node as Element).querySelectorAll('details.ownmail-quoted-history')) {
		const content = Array.from(nested.childNodes).filter(
			(child) => !(child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName === 'SUMMARY'),
		)
		nested.replaceWith(...content)
	}
}

function previousMeaningfulSibling(node: Node): Node | null {
	let previous = node.previousSibling
	while (previous) {
		if (previous.nodeType === Node.TEXT_NODE && !previous.textContent?.trim()) {
			previous = previous.previousSibling
			continue
		}
		if (previous.nodeType === Node.ELEMENT_NODE && (previous as Element).tagName === 'BR') {
			previous = previous.previousSibling
			continue
		}
		break
	}
	return previous
}

function normalizeContentId(value: string): string {
	let normalized = value.trim()
	try {
		normalized = decodeURIComponent(normalized)
	} catch {
		// A malformed provider Content-ID simply cannot match an attachment.
	}
	return normalized.replace(/^<|>$/g, '').trim().toLowerCase()
}

function isLikelyProseDocument(document: Document): boolean {
	const body = document.body
	if (!body.textContent?.trim()) return false
	if (document.querySelector('style') || body.querySelector('table, img, svg, canvas, video, audio')) {
		return false
	}
	const legacyDesignSelector = '[width], [height], [bgcolor], [background]'
	if (body.matches(legacyDesignSelector) || body.querySelector(legacyDesignSelector)) return false

	const styledElements = [
		...(body.hasAttribute('style') ? [body] : []),
		...body.querySelectorAll<HTMLElement>('[style]'),
	]
	for (const element of styledElements) {
		const style = element.getAttribute('style') as string
		if (
			/(?:^|;)\s*(?:(?:min-|max-)?(?:width|height)|display|position|float|background(?:-image)?|padding(?:-[\w-]+)?|border(?:-[\w-]+)?)\s*:/i.test(
				style,
			)
		) {
			return false
		}
	}
	return true
}
