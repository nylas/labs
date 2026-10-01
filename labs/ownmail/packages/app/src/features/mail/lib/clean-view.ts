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

/** What the Conversation view shows for one message. */
export type MessageContent =
	| { kind: 'blocks'; blocks: CleanBlock[]; hasRemoteImages: boolean }
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
const ORIGINAL: MessageContent = { kind: 'original' }

function marksFor(element: Element, marks: Marks): Marks {
	const tag = element.tagName
	if (tag === 'STRONG' || tag === 'B') return { ...marks, bold: true }
	if (tag === 'EM' || tag === 'I') return { ...marks, italic: true }
	if (tag === 'CODE' || tag === 'TT' || tag === 'KBD') return { ...marks, code: true }
	if (tag === 'A') {
		const href = element.getAttribute('href')?.trim() ?? ''
		if (SAFE_LINK.test(href)) return { ...marks, href }
	}
	return marks
}

function imagePiece(image: Element, marks: Marks): Piece {
	const alt = image.getAttribute('alt')?.trim() ?? ''
	const width = Number.parseFloat(image.getAttribute('width') ?? '')
	const height = Number.parseFloat(image.getAttribute('height') ?? '')
	if (width <= INLINE_IMAGE_MAX && height <= INLINE_IMAGE_MAX) return { text: alt, ...marks }
	const src = image.getAttribute('src')?.trim() ?? ''
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
	return a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.href === b.href
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
		const spans = tidySpans(
			pieces.map((piece) =>
				'image' in piece
					? { text: piece.image.alt, ...(piece.image.href ? { href: piece.image.href } : {}) }
					: piece,
			),
		)
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
	const nested =
		tag === 'BLOCKQUOTE'
			? 'quote'
			: tag === 'DETAILS' && element.classList.contains(QUOTED_HISTORY_CLASS)
				? 'history'
				: undefined
	if (nested) {
		const blocks: CleanBlock[] = []
		collectBlocks(element, marks, blocks)
		if (blocks.length > 0) out.push({ type: nested, blocks })
		return
	}
	collectBlocks(element, marksFor(element, marks), out)
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
			return blocksText(block.blocks)
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
	const blocks: CleanBlock[] = content.visible
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => paragraph([{ text: part }]))
	if (content.quoted) blocks.push({ type: 'history', blocks: [paragraph([{ text: content.quoted }])] })
	return blocks
}

/** The plaintext the standard reader shows for a message without HTML. */
function plainBodyText(message: MailMessage): string {
	const body = typeof message.body === 'string' && message.body.trim() ? message.body : undefined
	const snippet = typeof message.snippet === 'string' ? message.snippet : ''
	return (body ?? snippet).replace(/\r\n?/g, '\n').trim()
}

/**
 * Convert one message for the Conversation view. Prose becomes blocks; drafts
 * and designed mail keep the standard reader. Remote images stay blocked until
 * `allowRemoteImages` says the reader consented, exactly as in the standard
 * reader: the sanitizer removes their sources, and this never restores them.
 */
export function messageContent(message: MailMessage, allowRemoteImages: boolean): MessageContent {
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
	if (!prepared.isProse) return ORIGINAL
	// The prepared document is a serialised <html> element, so it is never blank
	// and the sanitizer always returns a document.
	const blocked = sanitizeEmailDocument(prepared.html) as HTMLElement
	const hasRemoteImages = sanitizedDocumentHasRemoteImages(blocked)
	const sanitized =
		hasRemoteImages && allowRemoteImages
			? (sanitizeEmailDocument(prepared.html, { allowRemoteImages: true }) as HTMLElement)
			: blocked
	const blocks = normaliseBlocks(sanitized.querySelector('body') as HTMLElement)
	return blocks.length > 0 ? { kind: 'blocks', blocks, hasRemoteImages } : ORIGINAL
}
