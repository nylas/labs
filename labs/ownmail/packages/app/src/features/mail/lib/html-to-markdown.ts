/**
 * HTML → markdown for seeding the compose editor.
 *
 * Drafts written before the live-markdown composer stored canonical WYSIWYG
 * HTML (`<p>/<ul>/<ol>/<blockquote>` with `strong/em/u/a/br`). When such a
 * draft — or any other HTML-looking seed — is loaded, this module converts it
 * to markdown source once; from then on the draft round-trips as markdown.
 *
 * The conversion is intentionally conservative: it flattens the block
 * structure the old editor could produce, keeps bold/italic/links, drops
 * underline (markdown has no marker for it) and escapes anything that would
 * otherwise be re-interpreted as markdown syntax, so text content survives
 * verbatim.
 */

import { parseLine } from './markdown-model.js'

type Mark = 'bold' | 'italic'

interface Span {
	text: string
	marks: Mark[]
	href?: string
}

type BlockType = 'paragraph' | 'bullet' | 'number' | 'quote' | 'h1' | 'h2' | 'h3'

interface Block {
	type: BlockType
	spans: Span[]
}

const SAFE_LINK = /^(https?:|mailto:)/i
const BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL'])
const HEADING_TYPE: Record<string, BlockType> = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3' }

function addMark(marks: Mark[], mark: Mark): Mark[] {
	return marks.includes(mark) ? marks : [...marks, mark]
}

/** Parse a single inline node, applying the mark its tag implies. */
function parseInlineNode(node: Node, marks: Mark[], href: string | undefined, out: Span[]): void {
	if (node.nodeType === 3 /* text */) {
		out.push({ text: (node as CharacterData).data, marks: [...marks], ...(href ? { href } : {}) })
		return
	}
	/* v8 ignore next -- DOMParser also yields comment nodes; they carry no convertible content -- @preserve */
	if (node.nodeType !== 1) return
	const el = node as HTMLElement
	const tag = el.tagName
	if (tag === 'BR') {
		out.push({ text: '\n', marks: [...marks], ...(href ? { href } : {}) })
	} else if (tag === 'STRONG' || tag === 'B') {
		parseInline(el, addMark(marks, 'bold'), href, out)
	} else if (tag === 'EM' || tag === 'I') {
		parseInline(el, addMark(marks, 'italic'), href, out)
	} else if (tag === 'A') {
		const raw = el.getAttribute('href') ?? ''
		parseInline(el, marks, SAFE_LINK.test(raw) ? raw : href, out)
	} else {
		// Underline and any other inline wrapper: keep the text, drop the styling.
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
		if (pending.some((span) => span.text !== '')) out.push({ type: listType ?? 'paragraph', spans: pending })
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
				const heading = HEADING_TYPE[tag]
				const type: BlockType =
					tag === 'BLOCKQUOTE' ? 'quote' : tag === 'LI' ? (listType ?? 'bullet') : (heading ?? 'paragraph')
				const spans: Span[] = []
				// A lone `<br>` is filler for an otherwise-empty block, not a soft break.
				if (!isFillerBreak(el)) parseInline(el, [], undefined, spans)
				out.push({ type, spans })
			}
		} else {
			parseInlineNode(child, [], undefined, pending)
		}
	}
	flush()
}

// ---- markdown serialisation ----------------------------------------------------

/** Escape every character the inline markdown parser would treat as syntax. */
function escapeInline(text: string): string {
	return text.replace(/[\\*_`[\]]/g, (char) => `\\${char}`)
}

function spanMarkdown(span: Span): string {
	if (span.text === '') return ''
	let text = escapeInline(span.text)
	if (span.marks.includes('bold') && span.marks.includes('italic')) text = `**_${text}_**`
	else if (span.marks.includes('bold')) text = `**${text}**`
	else if (span.marks.includes('italic')) text = `_${text}_`
	if (span.href) text = `[${text}](${span.href.replace(/\)/g, '%29')})`
	return text
}

/** Split a block's spans on soft breaks so each editor line stands alone. */
function blockLines(spans: Span[]): Span[][] {
	const lines: Span[][] = [[]]
	for (const span of spans) {
		for (const [index, piece] of span.text.split('\n').entries()) {
			if (index > 0) lines.push([])
			;(lines[lines.length - 1] as Span[]).push({ ...span, text: piece })
		}
	}
	return lines
}

const MARKER: Record<Exclude<BlockType, 'number'>, string> = {
	paragraph: '',
	bullet: '- ',
	quote: '> ',
	h1: '# ',
	h2: '## ',
	h3: '### ',
}

/** Convert HTML (a legacy draft, or any HTML-looking seed) to markdown source. */
export function htmlToMarkdown(html: string): string {
	const parsed = new DOMParser().parseFromString(html, 'text/html')
	const blocks: Block[] = []
	collectBlocks(parsed.body, null, blocks)
	const lines: string[] = []
	let ordinal = 0
	for (const block of blocks) {
		ordinal = block.type === 'number' ? ordinal + 1 : 0
		for (const spans of blockLines(block.spans)) {
			const content = spans.map(spanMarkdown).join('')
			if (block.type === 'number') {
				lines.push(`${ordinal}. ${content}`)
			} else {
				const line = MARKER[block.type] + content
				// A paragraph whose text happens to start like a marker ("- x") must
				// not turn into a list on reload; a leading escape keeps it text.
				lines.push(block.type === 'paragraph' && parseLine(line).kind !== 'paragraph' ? `\\${line}` : line)
			}
		}
	}
	return lines.join('\n')
}

const LOOKS_LIKE_HTML = /<(p|div|br|ul|ol|li|blockquote|strong|b|em|i|u|a|span|h[1-6])\b/i

/**
 * Drafts saved by the markdown composer are wrapped in this envelope. Markdown
 * legitimately contains tag-looking text (`<b>`, `use <br> here`), so a
 * heuristic cannot tell new markdown drafts from legacy HTML drafts — the
 * envelope makes the distinction explicit while staying valid HTML, so draft
 * snippets and previews still render the source as plain text.
 */
const MARKDOWN_DRAFT_ATTR = 'data-ownmail-markdown'

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap markdown source for draft storage so reloading never has to guess. */
export function markdownToDraftBody(markdown: string): string {
	return `<pre ${MARKDOWN_DRAFT_ATTR}="1">${escapeHtml(markdown)}</pre>`
}

/** Decode only OwnMail's explicit draft-storage envelope. */
export function ownMailDraftMarkdown(raw: string): string | undefined {
	if (!raw.includes(MARKDOWN_DRAFT_ATTR)) return undefined
	const opening = /<pre\b(?=[^>]*\sdata-ownmail-markdown\s*=\s*(?:"1"|'1'|1(?=\s|>)))[^>]*>/i.exec(raw)
	if (!opening) return undefined
	const contentStart = opening.index + opening[0].length
	const closing = /<\/pre\s*>/i.exec(raw.slice(contentStart))
	if (!closing) return undefined
	return raw
		.slice(contentStart, contentStart + closing.index)
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&amp;/gi, '&')
}

/**
 * Adopt a seed: an enveloped markdown draft round-trips exactly; other HTML
 * (a legacy WYSIWYG draft) converts; plain text is already markdown.
 */
export function seedToMarkdown(raw: string): string {
	if (raw.trim() === '') return ''
	// Providers may rewrap stored bodies, so locate the exact versioned envelope
	// rather than depending on an exact prefix match.
	const markdown = ownMailDraftMarkdown(raw)
	if (markdown !== undefined) return markdown
	return LOOKS_LIKE_HTML.test(raw) ? htmlToMarkdown(raw) : raw.replace(/\r\n?/g, '\n')
}
