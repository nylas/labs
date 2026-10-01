/**
 * Clean view: a small block model for email content.
 *
 * The Conversation view renders mail with the app's own typography instead of
 * the sender's markup. This module walks the live DOM that
 * `sanitizeEmailDocument` returns and normalises it into blocks (heading,
 * paragraph, list, quote, image, code, rule, quoted history) that React renders
 * as elements. No HTML string from a message ever reaches the app DOM: the
 * model carries text, and the only attributes it keeps are link targets on an
 * allow-list and image sources the sanitizer already controlled.
 *
 * Designed mail (newsletters, receipts, notifications) goes through the clean
 * pipeline first: classify on body signals, strip hidden and tracking content,
 * unwrap layout tables in reading order (keeping real data tables as tables),
 * normalise, pass a confidence gate, and fold boilerplate into one disclosure.
 * A message the gate is unsure about keeps the standard reader.
 *
 * Every step is deterministic code; nothing here calls a model or the network.
 */

import type { MailMessage } from '../state/mail-queries.js'
import { prepareEmailMessageContent, splitPlainQuotedHistory } from './email-message-content.js'
import { messageHasHtml } from './mail-ui-model.js'
import { sanitizedDocumentHasRemoteImages, sanitizeEmailDocument } from './sanitize-email.js'

export interface CleanSpan {
	text: string
	bold?: true
	italic?: true
	code?: true
	href?: string
	/** The link was drawn as a button (a call to action). */
	cta?: true
}

export interface CleanImage {
	type: 'image'
	alt: string
	src?: string
	href?: string
}

export type CleanBlock =
	| { type: 'heading'; level: 1 | 2 | 3; spans: CleanSpan[] }
	| { type: 'paragraph'; spans: CleanSpan[] }
	| { type: 'list'; ordered: boolean; items: CleanSpan[][] }
	| { type: 'quote'; blocks: CleanBlock[] }
	| CleanImage
	| { type: 'code'; text: string }
	| { type: 'rule' }
	/** Earlier messages quoted below a reply, as detected by `collapseQuotedHistory`. */
	| { type: 'history'; blocks: CleanBlock[] }
	/** The sender's signature, as marked by their mail client or found by the thread pass. */
	| { type: 'signature'; blocks: CleanBlock[] }
	/** A quoted line the thread already showed, kept as a short pointer above its answer. */
	| { type: 'reference'; text: string; author?: string }
	/** A real data table: rows of cells, with the first row a header when the sender marked one. */
	| { type: 'table'; header: boolean; rows: CleanSpan[][][]; caption?: string }
	/** Navigation, social rows and footers, folded into one disclosure and never deleted. */
	| { type: 'footer'; blocks: CleanBlock[]; links: number; unsubscribe: boolean }

/** What a message is, judged from its body alone. */
export type MailClass = 'prose' | 'reply' | 'transactional' | 'newsletter'

/** What the Conversation view shows for one message. */
export type MessageContent =
	| { kind: 'blocks'; blocks: CleanBlock[]; hasRemoteImages: boolean }
	/** Designed mail converted by the clean pipeline, shown as an article card. */
	| {
			kind: 'article'
			blocks: CleanBlock[]
			hasRemoteImages: boolean
			mailClass: Extract<MailClass, 'transactional' | 'newsletter'>
	  }
	/** The message keeps the standard reader's rendering. */
	| { kind: 'original' }

type Marks = Omit<CleanSpan, 'text'>
type Piece = CleanSpan | { image: CleanImage }

const SAFE_LINK = /^(?:https?:|mailto:)/i
/** Image sources the sanitizer leaves behind: the signed proxy route and inline data. */
const SAFE_IMAGE = /^(?:\/email-images\/|data:image\/)/i
const BLOCK_SELECTOR =
	'address,article,aside,blockquote,center,dd,details,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tbody,td,tfoot,th,thead,tr,ul'
const SKIPPED_TAGS = new Set(['STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'SUMMARY', 'TEMPLATE'])
/** Images at or below this size on both sides are emoji or icons and read as their alt text. */
const INLINE_IMAGE_MAX = 32
const QUOTED_HISTORY_CLASS = 'ownmail-quoted-history'
/** How Gmail, Thunderbird, Outlook and Apple Mail mark the signature they insert. */
const SIGNATURE_SELECTOR = '.gmail_signature, .moz-signature, #Signature, #AppleMailSignature'
const ORIGINAL: MessageContent = { kind: 'original' }
/** Images this small on either side are tracking pixels or spacers. */
const TRACKING_IMAGE_MAX = 2
/** A fill that is no fill at all: the page colour or nothing. */
const PLAIN_FILL = /^(?:#fff(?:fff)?|white|transparent|none|inherit|initial|unset)$/i
const STYLE_FILL = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/i
const STYLE_FONT_SIZE = /(?:^|;)\s*font-size\s*:\s*([\d.]+)(px|pt)/i
/** A styled line at least this large reads as a heading. */
const HEADING_FONT_PX = 18
const TITLE_FONT_PX = 24
const HEADING_MAX_CHARS = 120
/** Below this score the clean result is not trusted and the message renders as it does today. */
export const CONFIDENCE_THRESHOLD = 0.85
/** With less text than this outside links, a message with images is treated as image-only. */
const IMAGE_ONLY_TEXT = 140
/** A grid cell longer than this is prose in a layout column, not data. */
const DATA_CELL_MAX_CHARS = 60
/** What footers say: copyright, why you got this, how to stop it, the small print. */
const LEGAL =
	/©|\(c\)\s*\d{4}|all rights reserved|unsubscribe|opt[\s-]?out|privacy|terms\b|you(?:'|’| a)re receiving|view (?:this email )?in (?:your |a )?browser|preferences|no longer wish/i
/** A row this short that is nearly all links is navigation or a social row. */
const LINK_ROW_MAX_CHARS = 120
const LINK_ROW_DENSITY = 0.7
const FOLD_SCORE = 3
/** A one-time code: six to eight digits, or four or more next to a word that says so. */
const LONG_CODE = /(?<![\d/-])(?<!\d[.,])\d{6,8}(?![\d/-]|[.,]\d)/
const SHORT_CODE = /(?<![\d/-])(?<!\d[.,])\d{4,8}(?![\d/-]|[.,]\d)/
const CODE_WORD = /\b(?:code|pin|otp|passcode|password|verification|one[\s-]time)\b/i
const UNSUBSCRIBE = /unsubscribe|opt[\s-]?out|(?:manage|update|email)\s+(?:your\s+)?(?:email\s+)?preferences/i
const HIDDEN_STYLE =
	/(?:^|;)(?:display:none|visibility:hidden|mso-hide:all|opacity:0(?![.\d])|color:transparent|(?:font-size|max-height|line-height):0(?![.\d]))/
const HIDDEN_NAME = /(?:^|[\s_-])(?:preheader|preview-?text)(?:$|[\s_-])/i

const squash = (text: string): string => text.replace(/\s+/g, '')

function fillOf(element: Element): string {
	return (
		element.getAttribute('bgcolor') ??
		STYLE_FILL.exec(element.getAttribute('style') ?? '')?.[1] ??
		''
	).trim()
}

const hasFill = (element: Element): boolean => {
	const fill = fillOf(element)
	return fill !== '' && !PLAIN_FILL.test(fill)
}

/**
 * A link drawn as a button: the anchor is filled, or it is the only content of
 * a filled table cell (the usual "button built from a table"). The email
 * renderer reads this from computed styles; a sanitized document that is not
 * rendered has none, so this reads the inline styles and attributes instead.
 */
function isCallToAction(anchor: Element): boolean {
	if (hasFill(anchor)) return true
	const label = anchor.textContent.trim()
	const cell = anchor.closest('td, th')
	return label !== '' && cell !== null && hasFill(cell) && cell.textContent.trim() === label
}

/** The host of a link, used to name a linked image that has no description. */
function linkLabel(href: string): string {
	return href.replace(/^(?:https?:\/\/|mailto:)(?:www\.)?/i, '').split(/[/?#]/)[0] as string
}

function marksFor(element: Element, marks: Marks): Marks {
	const tag = element.tagName
	if (tag === 'STRONG' || tag === 'B') return { ...marks, bold: true }
	if (tag === 'EM' || tag === 'I') return { ...marks, italic: true }
	if (tag === 'CODE' || tag === 'TT' || tag === 'KBD') return { ...marks, code: true }
	if (tag === 'A') {
		const href = element.getAttribute('href')?.trim() ?? ''
		if (SAFE_LINK.test(href)) return { ...marks, href, ...(isCallToAction(element) ? { cta: true } : {}) }
	}
	return marks
}

function imagePiece(image: Element, marks: Marks): Piece {
	const alt = image.getAttribute('alt')?.trim() ?? ''
	const width = Number.parseFloat(image.getAttribute('width') ?? '')
	const height = Number.parseFloat(image.getAttribute('height') ?? '')
	if (width <= TRACKING_IMAGE_MAX || height <= TRACKING_IMAGE_MAX) return { text: '' }
	// A linked image with no description is named by where its link goes, so
	// the link itself is never lost.
	const label = alt || (marks.href ? linkLabel(marks.href) : '')
	if (width <= INLINE_IMAGE_MAX && height <= INLINE_IMAGE_MAX) return { text: label, ...marks }
	const src = image.getAttribute('src')?.trim() ?? ''
	// An unloaded image that says nothing and links nowhere carries no content.
	if (!label && !SAFE_IMAGE.test(src)) return { text: '' }
	return {
		image: {
			type: 'image',
			alt,
			...(SAFE_IMAGE.test(src) ? { src } : {}),
			...(marks.href ? { href: marks.href } : {}),
		},
	}
}

/** Flatten a node into inline pieces. Block elements met on the way become line breaks. */
function inlinePieces(node: Node, marks: Marks, out: Piece[]): void {
	if (node.nodeType === 3 /* text */) {
		out.push({ text: (node as CharacterData).data.replace(/\s+/g, ' '), ...marks })
		return
	}
	if (node.nodeType !== 1) return
	const element = node as Element
	const tag = element.tagName
	if (SKIPPED_TAGS.has(tag)) return
	if (tag === 'BR') {
		out.push({ text: '\n', ...marks })
		return
	}
	if (tag === 'IMG') {
		out.push(imagePiece(element, marks))
		return
	}
	const boundary = element.matches(BLOCK_SELECTOR)
	if (boundary) out.push({ text: '\n', ...marks })
	const inner = marksFor(element, marks)
	for (const child of Array.from(element.childNodes)) inlinePieces(child, inner, out)
	if (boundary) out.push({ text: '\n', ...marks })
}

function sameMarks(a: CleanSpan, b: CleanSpan): boolean {
	return (
		a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.href === b.href && a.cta === b.cta
	)
}

/** Merge neighbours with the same marks, tidy whitespace, and trim the run. */
function tidySpans(spans: CleanSpan[]): CleanSpan[] {
	const merged: CleanSpan[] = []
	for (const span of spans) {
		if (span.text === '') continue
		const previous = merged.at(-1)
		if (previous && sameMarks(previous, span)) previous.text += span.text
		else merged.push({ ...span })
	}
	for (const span of merged) {
		span.text = span.text
			.replace(/ *\n */g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/ {2,}/g, ' ')
	}
	while (merged.length > 0) {
		const first = merged[0] as CleanSpan
		first.text = first.text.replace(/^\s+/, '')
		if (first.text) break
		merged.shift()
	}
	while (merged.length > 0) {
		const last = merged.at(-1) as CleanSpan
		last.text = last.text.replace(/\s+$/, '')
		if (last.text) break
		merged.pop()
	}
	return merged
}

/** Emit text runs through `make`, with every image between them as its own block. */
function pushInline(pieces: Piece[], out: CleanBlock[], make: (spans: CleanSpan[]) => CleanBlock): void {
	let spans: CleanSpan[] = []
	const flush = () => {
		const tidy = tidySpans(spans)
		if (tidy.length > 0) out.push(make(tidy))
		spans = []
	}
	for (const piece of pieces) {
		if ('image' in piece) {
			flush()
			out.push(piece.image)
		} else spans.push(piece)
	}
	flush()
}

const paragraph = (spans: CleanSpan[]): CleanBlock => ({ type: 'paragraph', spans })

function listItems(list: Element, marks: Marks): CleanSpan[][] {
	const items: CleanSpan[][] = []
	for (const item of list.querySelectorAll('li')) {
		const pieces: Piece[] = []
		for (const child of Array.from(item.childNodes)) {
			// A nested list's items are visited on their own, in document order.
			if (child.nodeType === 1 && ['UL', 'OL'].includes((child as Element).tagName)) continue
			inlinePieces(child, marks, pieces)
		}
		const spans = tidySpans(pieces.map(pieceSpan))
		if (spans.length > 0) items.push(spans)
	}
	return items
}

function blockElement(element: Element, marks: Marks, out: CleanBlock[]): void {
	const tag = element.tagName
	if (tag === 'HR') {
		out.push({ type: 'rule' })
		return
	}
	if (tag === 'PRE') {
		const text = element.textContent.replace(/\s+$/, '')
		if (text.trim()) out.push({ type: 'code', text })
		return
	}
	if (/^H[1-6]$/.test(tag)) {
		const level = Math.min(Number(tag[1]), 3) as 1 | 2 | 3
		const pieces: Piece[] = []
		for (const child of Array.from(element.childNodes)) inlinePieces(child, marks, pieces)
		pushInline(pieces, out, (spans) => ({ type: 'heading', level, spans }))
		return
	}
	if (tag === 'UL' || tag === 'OL') {
		const items = listItems(element, marks)
		if (items.length > 0) out.push({ type: 'list', ordered: tag === 'OL', items })
		return
	}
	if (tag === 'TABLE' && isDataTable(element)) {
		out.push(dataTable(element, marks))
		return
	}
	const nested =
		tag === 'BLOCKQUOTE'
			? 'quote'
			: tag === 'DETAILS' && element.classList.contains(QUOTED_HISTORY_CLASS)
				? 'history'
				: element.matches(SIGNATURE_SELECTOR)
					? 'signature'
					: undefined
	if (nested) {
		const blocks: CleanBlock[] = []
		collectBlocks(element, marks, blocks)
		if (blocks.length > 0) out.push({ type: nested, blocks })
		return
	}
	const inner = marksFor(element, marks)
	const level = styledHeadingLevel(element)
	if (level) {
		const pieces: Piece[] = []
		for (const child of Array.from(element.childNodes)) inlinePieces(child, inner, pieces)
		pushInline(pieces, out, (spans) => ({ type: 'heading', level, spans }))
		return
	}
	collectBlocks(element, inner, out)
}

function fontSizePx(element: Element): number {
	const match = STYLE_FONT_SIZE.exec(element.getAttribute('style') ?? '')
	if (!match) return 0
	return Number.parseFloat(match[1] as string) * ((match[2] as string).toLowerCase() === 'pt' ? 4 / 3 : 1)
}

/**
 * Designed mail rarely uses heading tags: a headline is a table cell or div
 * with a large font. A short leaf block set that large is a heading, unless it
 * is a button.
 */
function styledHeadingLevel(element: Element): 1 | 2 | undefined {
	const text = element.textContent.trim()
	if (!text || text.length > HEADING_MAX_CHARS || element.querySelector(BLOCK_SELECTOR)) return undefined
	if (Array.from(element.querySelectorAll('a')).some(isCallToAction)) return undefined
	let size = fontSizePx(element)
	for (const inner of element.querySelectorAll('[style]')) {
		if (inner.textContent.trim() === text) size = Math.max(size, fontSizePx(inner))
	}
	return size >= TITLE_FONT_PX ? 1 : size >= HEADING_FONT_PX ? 2 : undefined
}

/** The rows of a table itself, not of tables nested inside it. */
function ownRows(table: Element): Element[] {
	return Array.from(table.querySelectorAll('tr')).filter((row) => row.closest('table') === table)
}

const ownCells = (row: Element): Element[] =>
	Array.from(row.children).filter((cell) => /^T[DH]$/.test(cell.tagName))

/**
 * Step 3: a table is data only if its author said so (`th`, `thead` or
 * `caption`), or it is a regular grid of short text cells. A table that holds
 * other tables, or is marked `role=presentation`, is layout.
 */
function isDataTable(table: Element): boolean {
	if (table.querySelector('table')) return false
	if (table.querySelector('th, thead, caption')) return true
	if (table.getAttribute('role') === 'presentation') return false
	const rows = ownRows(table).map(ownCells)
	const columns = rows[0]?.length ?? 0
	return (
		rows.length >= 2 &&
		columns >= 2 &&
		rows.every(
			(cells) =>
				cells.length === columns &&
				cells.every(
					(cell) =>
						!cell.hasAttribute('colspan') &&
						!cell.querySelector(BLOCK_SELECTOR) &&
						cell.textContent.trim().length <= DATA_CELL_MAX_CHARS,
				),
		) &&
		rows.some((cells) => cells.some((cell) => cell.textContent.trim() !== ''))
	)
}

function dataTable(table: Element, marks: Marks): CleanBlock {
	const rows = ownRows(table)
	const caption = table.querySelector('caption')?.textContent.replace(/\s+/g, ' ').trim()
	const first = rows[0]
	return {
		type: 'table',
		header: first !== undefined && (first.closest('thead') !== null || first.querySelector('th') !== null),
		rows: rows.map((row) =>
			ownCells(row).map((cell) => {
				const pieces: Piece[] = []
				for (const child of Array.from(cell.childNodes)) inlinePieces(child, marksFor(cell, marks), pieces)
				return tidySpans(pieces.map(pieceSpan))
			}),
		),
		...(caption ? { caption } : {}),
	}
}

/** An image inside running text (a list item, a table cell) reads as its description. */
function pieceSpan(piece: Piece): CleanSpan {
	return 'image' in piece
		? { text: piece.image.alt, ...(piece.image.href ? { href: piece.image.href } : {}) }
		: piece
}

/** A block element, or an inline wrapper (a link around a table, say) that contains one. */
function isBlockLevel(node: Node): node is Element {
	if (node.nodeType !== 1) return false
	const element = node as Element
	return element.matches(BLOCK_SELECTOR) || element.querySelector(BLOCK_SELECTOR) !== null
}

function collectBlocks(parent: Element, marks: Marks, out: CleanBlock[]): void {
	// Inline content between block elements is gathered into an implicit
	// paragraph, so stray text is never dropped.
	let pending: Piece[] = []
	const flush = () => {
		pushInline(pending, out, paragraph)
		pending = []
	}
	for (const child of Array.from(parent.childNodes)) {
		if (isBlockLevel(child)) {
			flush()
			blockElement(child, marks, out)
		} else inlinePieces(child, marks, pending)
	}
	flush()
}

/** Normalise a sanitized email subtree into the block model. */
export function normaliseBlocks(root: Element): CleanBlock[] {
	const blocks: CleanBlock[] = []
	collectBlocks(root, {}, blocks)
	return blocks
}

const spansText = (spans: CleanSpan[]): string => spans.map((span) => span.text).join('')

function blockText(block: CleanBlock): string {
	switch (block.type) {
		case 'heading':
		case 'paragraph':
			return spansText(block.spans)
		case 'list':
			return block.items.map(spansText).join('\n')
		case 'quote':
		case 'history':
		case 'signature':
		case 'footer':
			return blocksText(block.blocks)
		case 'table':
			return [
				...(block.caption ? [block.caption] : []),
				...block.rows.map((cells) => cells.map(spansText).join(' | ')),
			].join('\n')
		case 'reference':
			return block.text
		case 'image':
			return block.alt
		case 'code':
			return block.text
		case 'rule':
			return ''
	}
}

/** The text a reader sees in these blocks, one block per line with whitespace collapsed. */
export function blocksText(blocks: CleanBlock[]): string {
	return blocks
		.map((block) =>
			blockText(block)
				.replace(/[ \t]+/g, ' ')
				.trim(),
		)
		.filter(Boolean)
		.join('\n')
}

/** Plaintext keeps its paragraphs; a recognised reply separator starts the quoted history. */
function plainTextBlocks(text: string): CleanBlock[] {
	const content = splitPlainQuotedHistory(text)
	const paragraphs = (part: string): CleanBlock[] =>
		part
			.split(/\n{2,}/)
			.map((piece) => piece.trim())
			.filter(Boolean)
			.map((piece) => paragraph([{ text: piece }]))
	// The plaintext convention: a line holding only "-- " starts the signature.
	const [body, ...signature] = `\n${content.visible}`.split(/\n-- ?(?=\n|$)/)
	const blocks = paragraphs(body as string)
	const signed = paragraphs(signature.join('\n'))
	if (signed.length > 0) blocks.push({ type: 'signature', blocks: signed })
	if (content.quoted) blocks.push({ type: 'history', blocks: plainHistoryBlocks(content.quoted) })
	return blocks
}

/**
 * The quoted part of a plaintext reply, with its line structure kept: the
 * lead-in, each run of `>` lines as a quote, and every run of unquoted lines
 * as its own paragraph. Unquoted lines after a quote are something the sender
 * newly wrote (an answer between or below the quoted lines), so they must stay
 * separate from the quote or they would be folded away with it.
 */
function plainHistoryBlocks(quoted: string): CleanBlock[] {
	const blocks: CleanBlock[] = []
	let quoting = false
	let lines: string[] = []
	const flush = () => {
		const text = lines.join('\n').trim()
		lines = []
		if (!text) return
		const block = paragraph([{ text }])
		blocks.push(quoting ? { type: 'quote', blocks: [block] } : block)
	}
	for (const line of quoted.split('\n')) {
		if (!line.trim()) {
			// A blank line ends a paragraph of the sender's own text; inside a quote it is part of the quote.
			if (quoting) lines.push('')
			else flush()
			continue
		}
		const quotedLine = /^\s*>/.test(line)
		if (quotedLine !== quoting) {
			flush()
			quoting = quotedLine
		}
		lines.push(quotedLine ? line.replace(/^\s*(?:>\s?)+/, '') : line)
	}
	flush()
	return blocks
}

/** The plaintext the standard reader shows for a message without HTML. */
function plainBodyText(message: MailMessage): string {
	const body = typeof message.body === 'string' && message.body.trim() ? message.body : undefined
	const snippet = typeof message.snippet === 'string' ? message.snippet : ''
	return (body ?? snippet).replace(/\r\n?/g, '\n').trim()
}

export interface BodySignals {
	/** Deepest nesting of tables: layout tables nest, data tables rarely do. */
	tableDepth: number
	presentationTables: number
	images: number
	textLength: number
	links: number
	/** Share of the visible text that is link text. */
	linkDensity: number
	unsubscribeLinks: number
}

/** The body signals classification is built on. No headers are involved. */
export function bodySignals(body: Element): BodySignals {
	let tableDepth = 0
	for (const table of body.querySelectorAll('table')) {
		let depth = 1
		let outer = (table.parentElement as Element).closest('table')
		while (outer) {
			depth += 1
			outer = (outer.parentElement as Element).closest('table')
		}
		tableDepth = Math.max(tableDepth, depth)
	}
	const anchors = Array.from(body.querySelectorAll('a[href]'))
	const textLength = squash(body.textContent).length
	const linkText = anchors.reduce((total, anchor) => total + squash(anchor.textContent).length, 0)
	return {
		tableDepth,
		presentationTables: body.querySelectorAll('table[role="presentation"]').length,
		images: body.querySelectorAll('img').length,
		textLength,
		links: anchors.length,
		linkDensity: textLength > 0 ? linkText / textLength : 0,
		unsubscribeLinks: anchors.filter(
			(anchor) =>
				UNSUBSCRIBE.test(anchor.textContent) || UNSUBSCRIBE.test(anchor.getAttribute('href') as string),
		).length,
	}
}

/**
 * Step 1, classify. Bulk mail shows at least two of: an unsubscribe link (which
 * counts double), link-dense text, several images for little text, and deeply
 * nested or presentation tables. Otherwise a message with quoted history is a
 * reply chain, prose is prose, and the rest is transactional.
 */
export function classifyMail(body: Element, isProse: boolean, listUnsubscribe = false): MailClass {
	const signals = bodySignals(body)
	const bulk =
		// The List-Unsubscribe header is the sender declaring bulk mail; it weighs
		// the same as an unsubscribe link in the body.
		(listUnsubscribe || signals.unsubscribeLinks > 0 ? 2 : 0) +
		(signals.links >= 4 && signals.linkDensity >= 0.3 ? 1 : 0) +
		(signals.images >= 3 && signals.textLength / signals.images < 400 ? 1 : 0) +
		(signals.tableDepth >= 3 || signals.presentationTables >= 2 ? 1 : 0)
	if (bulk >= 2) return 'newsletter'
	if (body.querySelector(`details.${QUOTED_HISTORY_CLASS}`)) return 'reply'
	return isProse ? 'prose' : 'transactional'
}

function isHidden(element: Element): boolean {
	const style = squash(element.getAttribute('style') ?? '').toLowerCase()
	return (
		element.hasAttribute('hidden') ||
		HIDDEN_STYLE.test(style) ||
		HIDDEN_NAME.test(`${element.getAttribute('class') ?? ''} ${element.id}`)
	)
}

function imageSide(image: Element, side: 'width' | 'height'): number {
	const fromStyle = new RegExp(`(?:^|;)\\s*${side}\\s*:\\s*([\\d.]+)px`, 'i').exec(
		image.getAttribute('style') ?? '',
	)
	return Number.parseFloat(image.getAttribute(side) ?? fromStyle?.[1] ?? '')
}

/** Selectors a stylesheet hides by default, outside any media or container query. */
function hiddenSelectors(css: string): string[] {
	const selectors: string[] = []
	let depth = 0
	let ruleStart = 0
	let bodyStart = 0
	for (let index = 0; index < css.length; index += 1) {
		const character = css[index]
		if (character === '{') {
			if (depth === 0) bodyStart = index + 1
			depth += 1
		} else if (character === '}') {
			depth -= 1
			if (depth !== 0) continue
			const selector = css.slice(ruleStart, bodyStart - 1).trim()
			if (!selector.startsWith('@') && /display\s*:\s*none/i.test(css.slice(bodyStart, index))) {
				selectors.push(selector)
			}
			ruleStart = index + 1
		}
	}
	return selectors
}

/**
 * Step 2, strip: content no reader would see. Preheaders, `display:none`,
 * `mso-hide` and zero-size text go, and so do tracking pixels and spacers. A
 * block that a stylesheet hides by default is removed only when the same text
 * is still present elsewhere, which is how duplicated mobile and desktop copies
 * look; anything else stays, because hiding it could lose content.
 */
export function stripHiddenContent(document: Element): void {
	const body = document.querySelector('body') as HTMLElement
	for (const element of Array.from(body.querySelectorAll('*'))) {
		if (body.contains(element) && isHidden(element)) element.remove()
	}
	for (const image of Array.from(body.querySelectorAll('img'))) {
		if (imageSide(image, 'width') <= TRACKING_IMAGE_MAX || imageSide(image, 'height') <= TRACKING_IMAGE_MAX) {
			image.remove()
		}
	}
	for (const style of document.querySelectorAll('style')) {
		for (const selector of hiddenSelectors(style.textContent)) {
			let matches: Element[]
			try {
				matches = Array.from(body.querySelectorAll(selector))
			} catch {
				// A selector this engine cannot parse hides nothing here.
				continue
			}
			for (const element of matches) {
				const text = squash(element.textContent)
				const parent = element.parentNode as Node
				const next = element.nextSibling
				element.remove()
				if (text && !squash(body.textContent).includes(text)) parent.insertBefore(element, next)
			}
		}
	}
}

/** The text a reader can see in a stripped body, without whitespace. */
function visibleText(body: Element): string {
	const copy = body.cloneNode(true) as Element
	for (const skipped of copy.querySelectorAll('style, summary, title, template')) skipped.remove()
	return squash(copy.textContent)
}

function keptText(blocks: CleanBlock[]): string {
	return blocks
		.map((block) => {
			if (block.type === 'heading' || block.type === 'paragraph') return spansText(block.spans)
			if (block.type === 'list') return block.items.map(spansText).join('')
			const nested = nestedBlocks(block)
			if (nested) return keptText(nested)
			if (block.type === 'table') return `${block.caption ?? ''}${block.rows.flat().map(spansText).join('')}`
			return block.type === 'code' ? block.text : ''
		})
		.join('')
}

/**
 * Step 8, the confidence gate: the share of visible text the blocks retained,
 * with a penalty for a marked data table that had to be flattened and for content that
 * is mostly images, where the text is likely baked into the pictures.
 */
export function cleanConfidence(body: Element, blocks: CleanBlock[]): number {
	const visible = visibleText(body)
	if (blocks.length === 0 || visible.length === 0) return 0
	let score = Math.min(1, squash(keptText(blocks)).length / visible.length)
	// A table its author marked as data, but that could not be kept as one.
	const marked = Array.from(body.querySelectorAll('th, thead, caption'))
	if (marked.some((element) => !isDataTable(element.closest('table') as Element))) score -= 0.5
	if (body.querySelector('img')) {
		const copy = body.cloneNode(true) as Element
		for (const anchor of copy.querySelectorAll('a')) anchor.remove()
		if (visibleText(copy).length < IMAGE_ONLY_TEXT) score -= 0.5
	}
	return score
}

/**
 * Convert one message for the Conversation view. Prose and reply chains become
 * bubble blocks; designed mail becomes an article when the clean pipeline is
 * confident, and keeps the standard reader when it is not, when the reader
 * asked for original layouts (`cleanDesigned` false), or for drafts. Remote
 * images stay blocked until `allowRemoteImages` says the reader consented,
 * exactly as in the standard reader: the sanitizer removes their sources, and
 * this never restores them.
 */
export function messageContent(
	message: MailMessage,
	allowRemoteImages: boolean,
	cleanDesigned = true,
	/** The message carried a List-Unsubscribe header (attested by the server; body signals decide otherwise). */
	listUnsubscribe = false,
): MessageContent {
	if (message.ownmailDraft === true) return ORIGINAL
	if (!messageHasHtml(message)) {
		return { kind: 'blocks', blocks: plainTextBlocks(plainBodyText(message)), hasRemoteImages: false }
	}
	const prepared = prepareEmailMessageContent(
		message.body as string,
		message.id,
		message.attachments ?? [],
		message.ownmailImageTokens,
	)
	// The prepared document is a serialised <html> element, so it is never blank
	// and the sanitizer always returns a document.
	const blocked = sanitizeEmailDocument(prepared.html) as HTMLElement
	const hasRemoteImages = sanitizedDocumentHasRemoteImages(blocked)
	const sanitized =
		hasRemoteImages && allowRemoteImages
			? (sanitizeEmailDocument(prepared.html, { allowRemoteImages: true }) as HTMLElement)
			: blocked
	const body = sanitized.querySelector('body') as HTMLElement
	const mailClass = classifyMail(body, prepared.isProse, listUnsubscribe)
	const designed = mailClass === 'newsletter' || mailClass === 'transactional' ? mailClass : undefined
	if (!designed && prepared.isProse) {
		// Prose skips straight to normalisation.
		const blocks = normaliseBlocks(body)
		return blocks.length > 0 ? { kind: 'blocks', blocks, hasRemoteImages } : ORIGINAL
	}
	if (designed && !cleanDesigned) return ORIGINAL
	stripHiddenContent(sanitized)
	const blocks = normaliseBlocks(body)
	if (cleanConfidence(body, blocks) < CONFIDENCE_THRESHOLD) return ORIGINAL
	return designed
		? { kind: 'article', blocks: foldBoilerplate(blocks), hasRemoteImages, mailClass: designed }
		: { kind: 'blocks', blocks, hasRemoteImages }
}

/** The blocks inside a quote, quoted history, signature or footer. */
export function nestedBlocks(block: CleanBlock): CleanBlock[] | undefined {
	return block.type === 'quote' ||
		block.type === 'history' ||
		block.type === 'signature' ||
		block.type === 'footer'
		? block.blocks
		: undefined
}

function blockSpans(block: CleanBlock): CleanSpan[] {
	if (block.type === 'paragraph') return block.spans
	return block.type === 'list' ? block.items.flat() : []
}

/** A code someone has to type in must stay in plain sight, whatever else the block looks like. */
function holdsCode(text: string): boolean {
	return LONG_CODE.test(text) || (CODE_WORD.test(text) && SHORT_CODE.test(text))
}

/**
 * Step 4, fold boilerplate. Each paragraph or list is scored on what marks
 * navigation, social rows and footers: legal wording (2), a short row of two or
 * more links that is nearly all links (2), and sitting at the very start or in the closing part of
 * the message (1). Blocks scoring 3 or more move, in order, into one footer
 * disclosure at the end. Nothing is deleted, so unsubscribe stays reachable. A
 * call to action is never folded, and neither is a block holding a short
 * numeric code.
 */
export function foldBoilerplate(blocks: CleanBlock[]): CleanBlock[] {
	const kept: CleanBlock[] = []
	const folded: CleanBlock[] = []
	blocks.forEach((block, index) => {
		const spans = blockSpans(block)
		const text = spansText(spans)
		const linked = spans.reduce((total, span) => total + (span.href ? span.text.length : 0), 0)
		// One link on its own line is a "read more", not a row of navigation.
		const targets = new Set(spans.flatMap((span) => (span.href ? [span.href] : []))).size
		const edge = index === 0 || index >= blocks.length * 0.75
		const score =
			(LEGAL.test(text) ? 2 : 0) +
			(targets >= 2 && text.length <= LINK_ROW_MAX_CHARS && linked / text.length >= LINK_ROW_DENSITY
				? 2
				: 0) +
			(edge ? 1 : 0)
		const protectedBlock = spans.length === 0 || spans.some((span) => span.cta) || holdsCode(text)
		if (!protectedBlock && score >= FOLD_SCORE) folded.push(block)
		else kept.push(block)
	})
	// With everything folded there would be nothing left to read: fold nothing.
	if (folded.length === 0 || kept.length === 0) return blocks
	const links = folded.flatMap(blockSpans).filter((span) => span.href)
	return [
		...kept,
		{
			type: 'footer',
			blocks: folded,
			links: new Set(links.map((span) => span.href)).size,
			unsubscribe: links.some((span) => UNSUBSCRIBE.test(span.text) || UNSUBSCRIBE.test(span.href as string)),
		},
	]
}

function linksOf(blocks: CleanBlock[], out: Set<string>): void {
	for (const block of blocks) {
		if (block.type === 'heading' || block.type === 'paragraph') {
			for (const span of block.spans) if (span.href) out.add(span.href)
		} else if (block.type === 'list') {
			for (const span of block.items.flat()) if (span.href) out.add(span.href)
		} else if (block.type === 'table') {
			for (const span of block.rows.flat(2)) if (span.href) out.add(span.href)
		} else if (block.type === 'image') {
			if (block.href) out.add(block.href)
		} else linksOf(nestedBlocks(block) ?? [], out)
	}
}

/** Every link target the blocks keep reachable. */
export function blockLinks(blocks: CleanBlock[]): string[] {
	const links = new Set<string>()
	linksOf(blocks, links)
	return [...links]
}
