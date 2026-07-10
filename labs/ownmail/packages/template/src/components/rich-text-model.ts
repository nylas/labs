/**
 * A pure, framework-free document model for the compose editor.
 *
 * The WYSIWYG surface (`RichTextEditor`) is a `contentEditable` element, but it
 * never reasons about DOM ranges to apply formatting. Instead every structural
 * or inline edit is expressed as a total function over this model:
 *
 *     (doc, selectionStart, selectionEnd) => nextDoc
 *
 * The component reads the caret as a pair of character offsets, calls one of
 * these functions, re-renders canonical HTML, and restores the caret. Because
 * the interesting logic lives here — not in `execCommand` or hand-rolled Range
 * surgery — it is deterministic and exhaustively unit-testable.
 *
 * Offset space: the document is flattened to a single character axis. Each
 * block contributes its text (soft breaks count as one `\n`), and a single
 * boundary character sits between adjacent blocks. So for blocks of length
 * `l0, l1, …`, block `i` occupies `[startᵢ, startᵢ + lᵢ]` where
 * `startᵢ = Σ lⱼ (j<i) + i`. This mirrors `docText()` exactly, which is what
 * lets the component map DOM selections to offsets and back without drift.
 */

export type Mark = 'bold' | 'italic' | 'underline'
export type BlockType = 'paragraph' | 'bullet' | 'number' | 'quote'

export interface Span {
	text: string
	marks: Mark[]
	href?: string
}

export interface Block {
	type: BlockType
	spans: Span[]
}

export type Doc = Block[]

export const MARKS: readonly Mark[] = ['bold', 'italic', 'underline']

/** URL schemes we are willing to turn into links. Everything else is dropped. */
const SAFE_LINK = /^(https?:|mailto:)/i

const PLACEHOLDER: Block = { type: 'paragraph', spans: [] }

export function emptyDoc(): Doc {
	return [{ type: 'paragraph', spans: [] }]
}

/** A `Doc` is always non-empty; this centralises that invariant for the type checker. */
function blockAt(doc: Doc, index: number): Block {
	/* v8 ignore next -- the PLACEHOLDER fallback is unreachable: callers only pass in-range indices into a non-empty doc */
	return doc[index] ?? PLACEHOLDER
}

// ---- text measurement --------------------------------------------------------

function blockText(block: Block): string {
	return block.spans.map((span) => span.text).join('')
}

/** The document as a single string, blocks joined by the boundary `\n`. */
export function docText(doc: Doc): string {
	return doc.map(blockText).join('\n')
}

export function docIsEmpty(doc: Doc): boolean {
	return docText(doc).trim() === ''
}

/** Character offset at which block `index` starts in the flattened axis. */
function blockStart(doc: Doc, index: number): number {
	return doc.slice(0, index).reduce((offset, block) => offset + blockText(block).length + 1, 0)
}

/** Resolve a global offset to a `{ i, local }` position, clamped in range. */
function locate(doc: Doc, offset: number): { i: number; local: number } {
	let start = 0
	let fallback = { i: 0, local: 0 }
	for (const [i, block] of doc.entries()) {
		const len = blockText(block).length
		if (offset <= start + len) return { i, local: Math.max(0, offset - start) }
		fallback = { i, local: len }
		start += len + 1
	}
	return fallback
}

// ---- span helpers ------------------------------------------------------------

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
	return a.length === b.length && MARKS.every((mark) => a.includes(mark) === b.includes(mark))
}

/** Merge neighbouring spans that share identical formatting, drop empty spans. */
function normalizeSpans(spans: Span[]): Span[] {
	const out: Span[] = []
	for (const span of spans) {
		if (span.text === '') continue
		const prev = out[out.length - 1]
		if (prev && prev.href === span.href && sameMarks(prev.marks, span.marks)) {
			prev.text += span.text
		} else {
			out.push({ text: span.text, marks: [...span.marks].sort(), ...(span.href ? { href: span.href } : {}) })
		}
	}
	return out
}

/** Split a block's spans at a local offset, returning the pieces on each side. */
function splitSpans(spans: Span[], at: number): { left: Span[]; right: Span[] } {
	const left: Span[] = []
	const right: Span[] = []
	let cursor = 0
	for (const span of spans) {
		const end = cursor + span.text.length
		if (end <= at) {
			left.push(span)
		} else if (cursor >= at) {
			right.push(span)
		} else {
			const cut = at - cursor
			left.push({ ...span, text: span.text.slice(0, cut) })
			right.push({ ...span, text: span.text.slice(cut) })
		}
		cursor = end
	}
	return { left: normalizeSpans(left), right: normalizeSpans(right) }
}

/** Apply `edit` to each span (or span slice) covered by `[from, to)` in a block. */
function mapRange(spans: Span[], from: number, to: number, edit: (span: Span) => Span): Span[] {
	const result: Span[] = []
	let cursor = 0
	for (const span of spans) {
		const end = cursor + span.text.length
		const overlapFrom = Math.max(cursor, from)
		const overlapTo = Math.min(end, to)
		if (overlapFrom >= overlapTo) {
			result.push(span)
		} else {
			if (overlapFrom > cursor) result.push({ ...span, text: span.text.slice(0, overlapFrom - cursor) })
			result.push(edit({ ...span, text: span.text.slice(overlapFrom - cursor, overlapTo - cursor) }))
			if (overlapTo < end) result.push({ ...span, text: span.text.slice(overlapTo - cursor) })
		}
		cursor = end
	}
	return normalizeSpans(result)
}

function order(start: number, end: number): [number, number] {
	return start <= end ? [start, end] : [end, start]
}

/** Blocks whose text intersects `[from, to]` (inclusive so a caret selects one). */
function blocksInRange(doc: Doc, from: number, to: number): number[] {
	const indices: number[] = []
	for (const [i, block] of doc.entries()) {
		const start = blockStart(doc, i)
		const end = start + blockText(block).length
		if (from <= end && to >= start) indices.push(i)
	}
	return indices
}

// ---- inline formatting -------------------------------------------------------

/** Whether every character in `[from, to)` already carries `mark`. */
function rangeHasMark(doc: Doc, from: number, to: number, mark: Mark): boolean {
	for (const [i, block] of doc.entries()) {
		let cursor = blockStart(doc, i)
		for (const span of block.spans) {
			const end = cursor + span.text.length
			if (Math.max(cursor, from) < Math.min(end, to) && !span.marks.includes(mark)) return false
			cursor = end
		}
	}
	return true
}

/**
 * Toggle an inline mark across a selection. Matches editor convention: if the
 * whole selection already has the mark, remove it; otherwise add it everywhere.
 * A collapsed caret is a no-op (there is nothing to format yet).
 */
export function toggleMark(doc: Doc, start: number, end: number, mark: Mark): Doc {
	const [from, to] = order(start, end)
	if (from === to) return doc
	const remove = rangeHasMark(doc, from, to, mark)
	return doc.map((block, index) => {
		const base = blockStart(doc, index)
		const spans = mapRange(block.spans, from - base, to - base, (span) => ({
			...span,
			marks: remove ? span.marks.filter((m) => m !== mark) : [...new Set([...span.marks, mark])],
		}))
		return { ...block, spans }
	})
}

/**
 * Set (or clear) a link href across a selection. An empty/unsafe href removes
 * the link; a safe href applies it. A collapsed caret is a no-op.
 */
export function applyLink(doc: Doc, start: number, end: number, href: string): Doc {
	const [from, to] = order(start, end)
	if (from === to) return doc
	const trimmed = href.trim()
	const safe = trimmed && SAFE_LINK.test(trimmed) ? trimmed : ''
	return doc.map((block, index) => {
		const base = blockStart(doc, index)
		const spans = mapRange(block.spans, from - base, to - base, (span) => {
			const next = { ...span }
			if (safe) next.href = safe
			else delete next.href
			return next
		})
		return { ...block, spans }
	})
}

function spanCovering(doc: Doc, offset: number): Span | undefined {
	const { i, local } = locate(doc, offset)
	let cursor = 0
	for (const span of blockAt(doc, i).spans) {
		const end = cursor + span.text.length
		if (local >= cursor && local < end) return span
		cursor = end
	}
	return undefined
}

/** The link href at a given offset, sampling the covered span (caret-aware). */
export function linkAt(doc: Doc, offset: number): string {
	return spanCovering(doc, Math.max(0, offset - 1))?.href ?? spanCovering(doc, offset)?.href ?? ''
}

/** The formatting state to reflect in the toolbar for the current selection. */
export function activeFormats(
	doc: Doc,
	start: number,
	end: number,
): { bold: boolean; italic: boolean; underline: boolean; link: boolean; block: BlockType } {
	const [from, to] = order(start, end)
	// For a collapsed caret, sample the character immediately before it so the
	// toolbar reflects the run the user is about to extend (standard behaviour).
	const probeFrom = from === to ? Math.max(0, from - 1) : from
	const probeTo = from === to ? from : to
	const marks = probeFrom < probeTo
	return {
		bold: marks && rangeHasMark(doc, probeFrom, probeTo, 'bold'),
		italic: marks && rangeHasMark(doc, probeFrom, probeTo, 'italic'),
		underline: marks && rangeHasMark(doc, probeFrom, probeTo, 'underline'),
		link: linkAt(doc, from) !== '',
		block: blockAt(doc, locate(doc, from).i).type,
	}
}

// ---- block formatting --------------------------------------------------------

/**
 * Toggle a block type across the selected blocks. If every selected block is
 * already that type, revert to paragraph; otherwise set them all to the type.
 */
export function setBlockType(doc: Doc, start: number, end: number, type: BlockType): Doc {
	const [from, to] = order(start, end)
	const indices = blocksInRange(doc, from, to)
	const allType = indices.every((index) => blockAt(doc, index).type === type)
	const next: BlockType = allType ? 'paragraph' : type
	return doc.map((block, index) => (indices.includes(index) ? { ...block, type: next } : block))
}

// ---- structural edits (Enter / soft break) ----------------------------------

/**
 * Split the block at the (collapsed) caret into two blocks. An empty list or
 * quote block "exits" to a paragraph instead of adding another empty item —
 * the behaviour every mail client uses to end a list. Returns the new document
 * and the caret offset to restore.
 */
export function splitBlock(doc: Doc, offset: number): { doc: Doc; caret: number } {
	const { i: index, local } = locate(doc, offset)
	const block = blockAt(doc, index)
	if (block.type !== 'paragraph' && blockText(block).length === 0) {
		const next = doc.map((b, i) => (i === index ? { type: 'paragraph' as const, spans: b.spans } : b))
		return { doc: next, caret: blockStart(next, index) }
	}
	const { left, right } = splitSpans(block.spans, local)
	const rebuilt: Doc = [
		...doc.slice(0, index),
		{ type: block.type, spans: left },
		{ type: block.type, spans: right },
		...doc.slice(index + 1),
	]
	return { doc: rebuilt, caret: blockStart(rebuilt, index + 1) }
}

/**
 * Replace `[start, end)` with `text` inside a single block. Newlines become
 * soft breaks; callers use this for plain runs and paste.
 */
export function insertText(doc: Doc, start: number, end: number, text: string): { doc: Doc; caret: number } {
	const [from, to] = order(start, end)
	const withoutSelection = deleteRange(doc, from, to)
	const { i: index, local } = locate(withoutSelection, from)
	const block = blockAt(withoutSelection, index)
	const inherit = spanCovering(withoutSelection, from === 0 ? 0 : from - 1)
	const marks = inherit ? [...inherit.marks] : []
	const { left, right } = splitSpans(block.spans, local)
	const spans = normalizeSpans([...left, { text, marks }, ...right])
	const next = withoutSelection.map((b, i) => (i === index ? { ...b, spans } : b))
	return { doc: next, caret: from + text.length }
}

/** Delete `[from, to)`, merging the blocks the range spans. */
export function deleteRange(doc: Doc, start: number, end: number): Doc {
	const [from, to] = order(start, end)
	if (from === to) return doc
	const a = locate(doc, from)
	const b = locate(doc, to)
	const head = splitSpans(blockAt(doc, a.i).spans, a.local).left
	const tail = splitSpans(blockAt(doc, b.i).spans, b.local).right
	const merged: Block = { type: blockAt(doc, a.i).type, spans: normalizeSpans([...head, ...tail]) }
	return [...doc.slice(0, a.i), merged, ...doc.slice(b.i + 1)]
}

// ---- HTML serialisation ------------------------------------------------------

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
	return escapeHtml(text).replace(/"/g, '&quot;')
}

function spanHtml(span: Span): string {
	let html = escapeHtml(span.text).replace(/\n/g, '<br>')
	if (span.marks.includes('bold')) html = `<strong>${html}</strong>`
	if (span.marks.includes('italic')) html = `<em>${html}</em>`
	if (span.marks.includes('underline')) html = `<u>${html}</u>`
	if (span.href) html = `<a href="${escapeAttr(span.href)}">${html}</a>`
	return html
}

function blockInnerHtml(block: Block): string {
	const inner = block.spans.map(spanHtml).join('')
	return inner === '' ? '<br>' : inner
}

/** Group adjacent list blocks of the same type so they render in one list. */
function groupBlocks(doc: Doc): { type: BlockType; blocks: Block[] }[] {
	const groups: { type: BlockType; blocks: Block[] }[] = []
	for (const block of doc) {
		const last = groups[groups.length - 1]
		const listType = block.type === 'bullet' || block.type === 'number'
		if (last && listType && last.type === block.type) last.blocks.push(block)
		else groups.push({ type: block.type, blocks: [block] })
	}
	return groups
}

/** Canonical HTML for the editor DOM, drafts, and outgoing mail alike. */
export function docToHtml(doc: Doc): string {
	return groupBlocks(doc)
		.map((group) => {
			if (group.type === 'bullet' || group.type === 'number') {
				const tag = group.type === 'bullet' ? 'ul' : 'ol'
				return `<${tag}>${group.blocks.map((block) => `<li>${blockInnerHtml(block)}</li>`).join('')}</${tag}>`
			}
			// Non-list groups always hold exactly one block; mapping keeps it index-free.
			const tag = group.type === 'quote' ? 'blockquote' : 'p'
			return group.blocks.map((block) => `<${tag}>${blockInnerHtml(block)}</${tag}>`).join('')
		})
		.join('')
}

// ---- parsing -----------------------------------------------------------------

const BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL'])

function addMark(marks: Mark[], mark: Mark): Mark[] {
	return marks.includes(mark) ? marks : [...marks, mark]
}

/** Parse a single inline node, applying the mark its tag implies. */
function parseInlineNode(node: Node, marks: Mark[], href: string | undefined, out: Span[]): void {
	if (node.nodeType === 3 /* text */) {
		out.push({ text: (node as CharacterData).data, marks: [...marks], ...(href ? { href } : {}) })
		return
	}
	/* v8 ignore next -- DOMParser also yields comment nodes; they carry no editable content */
	if (node.nodeType !== 1) return
	const el = node as HTMLElement
	const tag = el.tagName
	if (tag === 'BR') {
		out.push({ text: '\n', marks: [...marks], ...(href ? { href } : {}) })
	} else if (tag === 'STRONG' || tag === 'B') {
		parseInline(el, addMark(marks, 'bold'), href, out)
	} else if (tag === 'EM' || tag === 'I') {
		parseInline(el, addMark(marks, 'italic'), href, out)
	} else if (tag === 'U') {
		parseInline(el, addMark(marks, 'underline'), href, out)
	} else if (tag === 'A') {
		const raw = el.getAttribute('href') ?? ''
		parseInline(el, marks, SAFE_LINK.test(raw) ? raw : href, out)
	} else {
		parseInline(el, marks, href, out)
	}
}

function parseInline(node: Node, marks: Mark[], href: string | undefined, out: Span[]): void {
	for (const child of Array.from(node.childNodes)) parseInlineNode(child, marks, href, out)
}

/** True when an element's only content is a single filler `<br>` (an empty block). */
function isFillerBreak(el: HTMLElement): boolean {
	return el.innerHTML === '<br>'
}

function collectBlocks(node: Node, listType: BlockType | null, out: Block[]): void {
	// Inline children that appear before a block element are gathered into an
	// implicit paragraph (or list item) so stray text is never dropped.
	let pending: Span[] = []
	const flush = () => {
		const spans = normalizeSpans(pending)
		if (spans.length > 0) out.push({ type: listType ?? 'paragraph', spans })
		pending = []
	}
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === 1 && BLOCK_TAGS.has((child as HTMLElement).tagName)) {
			flush()
			const el = child as HTMLElement
			const tag = el.tagName
			if (tag === 'UL') collectBlocks(el, 'bullet', out)
			else if (tag === 'OL') collectBlocks(el, 'number', out)
			else {
				const type: BlockType =
					tag === 'BLOCKQUOTE' ? 'quote' : tag === 'LI' ? (listType ?? 'bullet') : 'paragraph'
				const spans: Span[] = []
				// A lone `<br>` is filler for an otherwise-empty block, not a soft break;
				// treat the block as empty so pressing Enter on it exits the list/quote.
				if (!isFillerBreak(el)) parseInline(el, [], undefined, spans)
				out.push({ type, spans: normalizeSpans(spans) })
			}
		} else {
			// A bare text node or a stray inline element at this level: keep its text
			// (and any inline formatting) instead of dropping it.
			parseInlineNode(child, [], undefined, pending)
		}
	}
	flush()
}

/** Parse arbitrary (browser- or model-generated) HTML into a normalised doc. */
export function htmlToDoc(html: string): Doc {
	const parsed = new DOMParser().parseFromString(html, 'text/html')
	const blocks: Block[] = []
	collectBlocks(parsed.body, null, blocks)
	return blocks.length > 0 ? blocks : emptyDoc()
}

/** Seed a doc from plain text: blank lines split paragraphs, `\n` soft-breaks. */
export function textToDoc(text: string): Doc {
	const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
	// The filter always keeps index 0, so the result is guaranteed non-empty.
	return paragraphs
		.filter((para, index) => para !== '' || index === 0)
		.map((para) => ({ type: 'paragraph' as const, spans: para === '' ? [] : [{ text: para, marks: [] }] }))
}

const LOOKS_LIKE_HTML = /<(p|div|br|ul|ol|li|blockquote|strong|b|em|i|u|a|span|h[1-6])\b/i

/** Adopt a seed value that may be either HTML (a draft) or plain text (a reply). */
export function seedToDoc(raw: string): Doc {
	if (raw.trim() === '') return emptyDoc()
	return LOOKS_LIKE_HTML.test(raw) ? htmlToDoc(raw) : textToDoc(raw)
}

// ---- typing conveniences -----------------------------------------------------

function forceBlockType(doc: Doc, index: number, type: BlockType): Doc {
	return doc.map((block, i) => (i === index ? { ...block, type } : block))
}

function markerType(prefix: string): BlockType | null {
	if (prefix === '- ' || prefix === '* ') return 'bullet'
	if (prefix === '> ') return 'quote'
	if (/^\d+\. $/.test(prefix)) return 'number'
	return null
}

/**
 * Markdown-style shortcut: when the caret sits right after a line-leading marker
 * (`- `, `* `, `1. `, `> `), drop the marker and convert the block. Returns the
 * next doc + caret, or `null` when the text before the caret is not a marker.
 */
export function applyBlockShortcut(doc: Doc, caret: number): { doc: Doc; caret: number } | null {
	const { i: index, local } = locate(doc, caret)
	const start = blockStart(doc, index)
	// Browsers render a trailing space as a non-breaking space (); treat it as
	// a normal space so "- " still triggers the shortcut the instant it is typed.
	const prefix = docText(doc)
		.slice(start, start + local)
		.replace(/\u00A0/g, ' ')
	const type = markerType(prefix)
	if (!type || blockAt(doc, index).type === type) return null
	const stripped = deleteRange(doc, start, start + prefix.length)
	return { doc: forceBlockType(stripped, index, type), caret: start }
}

/**
 * Backspace at the very start of a list item or quote outdents it to a plain
 * paragraph rather than merging into the previous block. Returns `null` when the
 * caret is not at the start of such a block, so the caller falls back to native
 * deletion.
 */
export function outdentAt(doc: Doc, start: number, end: number): { doc: Doc; caret: number } | null {
	if (start !== end) return null
	const { i: index, local } = locate(doc, start)
	if (local !== 0 || blockAt(doc, index).type === 'paragraph') return null
	return { doc: forceBlockType(doc, index, 'paragraph'), caret: start }
}
