/**
 * A pure, framework-free model for the Obsidian-style live markdown composer.
 *
 * The source of truth is a plain markdown string. Each `\n`-separated line is
 * one block. The editor (`MarkdownEditor`) renders every line as one top-level
 * element: lines touched by the selection show their raw markdown source, all
 * other lines show rendered markdown — the "live preview" behaviour.
 *
 * Because rendered lines hide their syntax (`**`, `- `, `[](…)`), a caret
 * placed in a rendered line must be translated back to a position in the
 * source. `renderLine` therefore returns, alongside the HTML, a map from each
 * *visible* character to the source index it came from; `renderedToSource`
 * resolves a rendered caret through that map.
 *
 * Supported syntax is deliberately small and email-friendly: `#`–`###`
 * headings, `- `/`* ` bullets, `1. ` numbered items, `> ` quotes, `**bold**`,
 * `*italic*`/`_italic_`, `` `code` ``, `[text](url)` and `\` escapes.
 *
 * `markdownToEmailHtml` serialises the same syntax to HTML for outgoing mail:
 * every element carries inline styles (no `<style>` block, no classes), which
 * is the form that survives Gmail, Outlook and friends intact.
 */

export type LineKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'quote'

export interface LineInfo {
	kind: LineKind
	/** Index at which the line's content starts (just past the block marker). */
	contentStart: number
	/** The integer typed for a `number` line (`3. ` → 3); 0 for other kinds. */
	ordinal: number
}

const HEADING = /^#{1,3} /
const BULLET = /^[-*] /
const NUMBER = /^\d{1,9}\. /
const QUOTE = /^> /

/** URL schemes we are willing to turn into links. Everything else stays literal. */
const SAFE_LINK = /^(https?:|mailto:)/i

export function parseLine(line: string): LineInfo {
	const heading = HEADING.exec(line)
	if (heading) {
		const level = heading[0].length - 1
		return { kind: `h${level}` as LineKind, contentStart: level + 1, ordinal: 0 }
	}
	if (BULLET.test(line)) return { kind: 'bullet', contentStart: 2, ordinal: 0 }
	const number = NUMBER.exec(line)
	if (number)
		return { kind: 'number', contentStart: number[0].length, ordinal: Number.parseInt(number[0], 10) }
	if (QUOTE.test(line)) return { kind: 'quote', contentStart: 2, ordinal: 0 }
	return { kind: 'paragraph', contentStart: 0, ordinal: 0 }
}

// ---- HTML escaping -------------------------------------------------------------

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
	return escapeHtml(text).replace(/"/g, '&quot;')
}

// ---- inline rendering ----------------------------------------------------------

/** Optional inline styles stamped onto tags when rendering for email. */
export interface InlineStyles {
	code?: string
	link?: string
}

export interface RenderedLine {
	/** Inner HTML for the line's content (block wrapper not included). */
	html: string
	/** For each visible character of the rendered line, its source index. */
	map: number[]
}

type Delimiter = 'bold' | 'italic' | 'code' | 'link'

/** Find `delim` in `[from, to)`, skipping `\`-escaped occurrences. */
function findClose(line: string, delim: string, from: number, to: number): number {
	let cursor = from
	while (cursor < to) {
		const found = line.indexOf(delim, cursor)
		if (found === -1 || found + delim.length > to) return -1
		if (line.charAt(found - 1) === '\\') {
			cursor = found + 1
			continue
		}
		return found
	}
	return -1
}

interface InlineSink {
	html: string[]
	map: number[]
	styles: InlineStyles
	/**
	 * Preview mode hides the syntax; reveal mode (the active line) keeps every
	 * source character visible, wrapping the syntax in dimmed `md-syn` spans so
	 * formatting still applies while the markdown stays editable.
	 */
	reveal: boolean
}

function emitChar(sink: InlineSink, char: string, at: number): void {
	sink.html.push(escapeHtml(char))
	sink.map.push(at)
}

/** Emit syntax characters: dimmed in reveal mode, dropped in preview mode. */
function emitSyntax(sink: InlineSink, text: string, from: number): void {
	if (!sink.reveal || text === '') return
	sink.html.push('<span class="md-syn">')
	for (let i = 0; i < text.length; i++) emitChar(sink, text.charAt(i), from + i)
	sink.html.push('</span>')
}

function styleAttr(style: string | undefined): string {
	return style ? ` style="${style}"` : ''
}

/** Render `line[from, to)` into the sink, honouring the `allowed` delimiter set. */
function renderSpan(
	line: string,
	from: number,
	to: number,
	allowed: readonly Delimiter[],
	sink: InlineSink,
): void {
	let i = from
	while (i < to) {
		const char = line.charAt(i)
		if (char === '\\' && i + 1 < to) {
			emitSyntax(sink, '\\', i)
			emitChar(sink, line.charAt(i + 1), i + 1)
			i += 2
			continue
		}
		if (char === '`' && allowed.includes('code')) {
			const close = findCodeClose(line, i + 1, to)
			if (close > i + 1) {
				sink.html.push(`<code${styleAttr(sink.styles.code)}>`)
				emitSyntax(sink, '`', i)
				// Code spans are literal: no escapes, no nested syntax.
				for (let c = i + 1; c < close; c++) emitChar(sink, line.charAt(c), c)
				emitSyntax(sink, '`', close)
				sink.html.push('</code>')
				i = close + 1
				continue
			}
		}
		if (line.startsWith('**', i) && allowed.includes('bold')) {
			const close = findClose(line, '**', i + 2, to)
			if (close > i + 2) {
				sink.html.push('<strong>')
				emitSyntax(sink, '**', i)
				renderSpan(line, i + 2, close, exclude(allowed, 'bold'), sink)
				emitSyntax(sink, '**', close)
				sink.html.push('</strong>')
				i = close + 2
				continue
			}
		}
		if ((char === '*' || char === '_') && allowed.includes('italic')) {
			const close = findClose(line, char, i + 1, to)
			if (close > i + 1) {
				sink.html.push('<em>')
				emitSyntax(sink, char, i)
				renderSpan(line, i + 1, close, exclude(allowed, 'italic'), sink)
				emitSyntax(sink, char, close)
				sink.html.push('</em>')
				i = close + 1
				continue
			}
		}
		if (char === '[' && allowed.includes('link')) {
			const link = matchLink(line, i, to)
			if (link) {
				if (sink.reveal) {
					// Not a real anchor while editing: clicks must place the caret.
					emitSyntax(sink, '[', i)
					sink.html.push('<span class="md-link">')
					renderSpan(line, i + 1, link.textEnd, exclude(allowed, 'link'), sink)
					sink.html.push('</span>')
					emitSyntax(sink, line.slice(link.textEnd, link.end), link.textEnd)
				} else {
					sink.html.push(`<a href="${escapeAttr(link.href)}"${styleAttr(sink.styles.link)}>`)
					renderSpan(line, i + 1, link.textEnd, exclude(allowed, 'link'), sink)
					sink.html.push('</a>')
				}
				i = link.end
				continue
			}
		}
		emitChar(sink, char, i)
		i++
	}
}

/** Code closes on the next backtick; unlike emphasis it takes content literally. */
function findCodeClose(line: string, from: number, to: number): number {
	const found = line.indexOf('`', from)
	return found !== -1 && found < to ? found : -1
}

function exclude(allowed: readonly Delimiter[], drop: Delimiter): Delimiter[] {
	return allowed.filter((delimiter) => delimiter !== drop)
}

/** Match `[text](url)` at `at`; the url must be a safe scheme and text non-empty. */
function matchLink(
	line: string,
	at: number,
	to: number,
): { textEnd: number; href: string; end: number } | null {
	const textEnd = findClose(line, ']', at + 1, to)
	if (textEnd <= at + 1 || line.charAt(textEnd + 1) !== '(') return null
	const hrefEnd = line.indexOf(')', textEnd + 2)
	if (hrefEnd === -1 || hrefEnd >= to) return null
	const href = line.slice(textEnd + 2, hrefEnd)
	if (!SAFE_LINK.test(href)) return null
	return { textEnd, href, end: hrefEnd + 1 }
}

const ALL_DELIMITERS: readonly Delimiter[] = ['bold', 'italic', 'code', 'link']

/** Render a full line's content (past its block marker) with a source map. */
export function renderLine(line: string, styles: InlineStyles = {}): RenderedLine {
	const sink: InlineSink = { html: [], map: [], styles, reveal: false }
	renderSpan(line, parseLine(line).contentStart, line.length, ALL_DELIMITERS, sink)
	return { html: sink.html.join(''), map: sink.map }
}

/**
 * The active (raw) line: every source character stays visible and editable —
 * the DOM text equals the source line exactly — but formatting still applies
 * and the syntax characters are wrapped in dimmed `md-syn` spans, the way
 * Obsidian's live preview styles the line under the cursor.
 */
export function rawLineHtml(line: string): string {
	const info = parseLine(line)
	const sink: InlineSink = { html: [], map: [], styles: {}, reveal: true }
	emitSyntax(sink, line.slice(0, info.contentStart), 0)
	renderSpan(line, info.contentStart, line.length, ALL_DELIMITERS, sink)
	const inner = sink.html.join('') || '<br>'
	const tag =
		info.kind === 'h1' || info.kind === 'h2' || info.kind === 'h3'
			? info.kind
			: info.kind === 'quote'
				? 'blockquote'
				: 'p'
	return `<${tag} class="md-raw">${inner}</${tag}>`
}

/** Resolve a caret in a rendered line's visible text to a source index. */
export function renderedToSource(rendered: RenderedLine, lineLength: number, offset: number): number {
	// The visual line start means the source line start — before any hidden
	// marker — so whole-line selections include the syntax they cover.
	if (offset === 0) return 0
	const mapped = rendered.map[offset]
	return mapped === undefined ? lineLength : mapped
}

// ---- editor document HTML ------------------------------------------------------

/** Inclusive range of line indices whose raw markdown source is showing. */
export interface ActiveRange {
	start: number
	end: number
}

function renderedBlockHtml(line: string, info: LineInfo, listStart: number): string {
	const inner = renderLine(line).html || '<br>'
	if (info.kind === 'bullet') return `<ul><li>${inner}</li></ul>`
	if (info.kind === 'number') return `<ol start="${listStart}"><li>${inner}</li></ol>`
	if (info.kind === 'quote') return `<blockquote>${inner}</blockquote>`
	if (info.kind === 'paragraph') return `<p>${inner}</p>`
	return `<${info.kind}>${inner}</${info.kind}>`
}

/**
 * The editor DOM: one top-level element per source line. Lines inside `active`
 * show their raw source (class `md-raw`), everything else shows the rendered
 * preview. Line index == child index, which is what `markdown-dom` relies on.
 * Numbered items render one `<ol start=…>` per line, so a run `1. / 2. / 3.`
 * still counts up even though each line is its own list element.
 */
export function docHtml(source: string, active: ActiveRange | null): string {
	const parts: string[] = []
	// 0 means "the previous line was not a numbered item".
	let runNumber = 0
	for (const [index, line] of source.split('\n').entries()) {
		const info = parseLine(line)
		runNumber = info.kind === 'number' ? (runNumber === 0 ? info.ordinal : runNumber + 1) : 0
		if (active && index >= active.start && index <= active.end) {
			parts.push(rawLineHtml(line))
		} else {
			parts.push(renderedBlockHtml(line, info, runNumber))
		}
	}
	return parts.join('')
}

// ---- source offsets ------------------------------------------------------------

export function markdownIsEmpty(source: string): boolean {
	return source.trim() === ''
}

/** Offset of the first character of line `index` (lines joined by `\n`). */
export function lineStartOffset(source: string, index: number): number {
	let offset = 0
	for (let i = 0; i < index; i++) offset = source.indexOf('\n', offset) + 1
	return offset
}

/** Resolve a global source offset to its line index and column. */
export function locateOffset(source: string, offset: number): { line: number; column: number } {
	const clamped = Math.max(0, Math.min(offset, source.length))
	const before = source.slice(0, clamped)
	return { line: before.split('\n').length - 1, column: clamped - (before.lastIndexOf('\n') + 1) }
}

// ---- edits ---------------------------------------------------------------------

function order(start: number, end: number): [number, number] {
	return start <= end ? [start, end] : [end, start]
}

/** Replace `[start, end)` with `text`; the caret lands after the insertion. */
export function replaceRange(
	source: string,
	start: number,
	end: number,
	text: string,
): { source: string; caret: number } {
	const [from, to] = order(start, end)
	return { source: source.slice(0, from) + text + source.slice(to), caret: from + text.length }
}

/**
 * Toggle an inline marker (`**`, `*`) around the selection. Unwraps when the
 * selection is already wrapped (markers just outside or just inside it);
 * otherwise wraps. A collapsed caret gets an empty pair to type into.
 */
export function toggleInline(
	source: string,
	start: number,
	end: number,
	marker: string,
): { source: string; start: number; end: number } {
	const [from, to] = order(start, end)
	const width = marker.length
	if (
		from >= width &&
		source.slice(from - width, from) === marker &&
		source.slice(to, to + width) === marker
	) {
		return {
			source: source.slice(0, from - width) + source.slice(from, to) + source.slice(to + width),
			start: from - width,
			end: to - width,
		}
	}
	if (
		to - from >= 2 * width &&
		source.slice(from, from + width) === marker &&
		source.slice(to - width, to) === marker
	) {
		return {
			source: source.slice(0, from) + source.slice(from + width, to - width) + source.slice(to),
			start: from,
			end: to - 2 * width,
		}
	}
	return {
		source: source.slice(0, from) + marker + source.slice(from, to) + marker + source.slice(to),
		start: from + width,
		end: to + width,
	}
}

/** Wrap the selection as `[text](…)` and put the caret between the parens. */
export function wrapLink(source: string, start: number, end: number): { source: string; caret: number } {
	const [from, to] = order(start, end)
	return {
		source: `${source.slice(0, from)}[${source.slice(from, to)}]()${source.slice(to)}`,
		caret: to + 3,
	}
}

// ---- email HTML ----------------------------------------------------------------

const EMAIL = {
	base: 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;',
	p: 'margin:0 0 12px;',
	h1: 'margin:16px 0 12px;font-size:22px;line-height:1.3;font-weight:bold;',
	h2: 'margin:16px 0 12px;font-size:18px;line-height:1.3;font-weight:bold;',
	h3: 'margin:16px 0 12px;font-size:16px;line-height:1.3;font-weight:bold;',
	list: 'margin:0 0 12px;padding:0 0 0 24px;',
	li: 'margin:0 0 4px;',
	quote: 'margin:0 0 12px;padding:0 0 0 12px;border-left:3px solid #d1d5db;color:#6b7280;',
	code: 'font-family:Consolas,Menlo,monospace;font-size:13px;background-color:#f3f4f6;padding:1px 4px;border-radius:3px;',
	link: 'color:#2563eb;',
} as const

const EMAIL_INLINE: InlineStyles = { code: EMAIL.code, link: EMAIL.link }

/**
 * Serialise markdown to HTML for an outgoing email. Adjacent list items merge
 * into one list, adjacent quote lines merge into one blockquote, and blank
 * lines only separate blocks. Everything is inline-styled so it renders the
 * same across mail clients; returns '' when the message is effectively empty.
 */
export function markdownToEmailHtml(source: string): string {
	if (markdownIsEmpty(source)) return ''
	const parts: string[] = []
	let list: { tag: 'ul' | 'ol'; start: number; items: string[] } | null = null
	let quote: string[] = []
	const flushList = () => {
		if (!list) return
		const start = list.tag === 'ol' && list.start !== 1 ? ` start="${list.start}"` : ''
		parts.push(`<${list.tag}${start} style="${EMAIL.list}">${list.items.join('')}</${list.tag}>`)
		list = null
	}
	const flushQuote = () => {
		if (quote.length === 0) return
		parts.push(`<blockquote style="${EMAIL.quote}">${quote.join('<br>')}</blockquote>`)
		quote = []
	}
	for (const line of source.split('\n')) {
		const info = parseLine(line)
		if (info.kind === 'bullet' || info.kind === 'number') {
			flushQuote()
			const tag = info.kind === 'bullet' ? 'ul' : 'ol'
			if (!list || list.tag !== tag) {
				flushList()
				list = { tag, start: info.ordinal, items: [] }
			}
			list.items.push(`<li style="${EMAIL.li}">${renderLine(line, EMAIL_INLINE).html}</li>`)
			continue
		}
		flushList()
		if (info.kind === 'quote') {
			quote.push(renderLine(line, EMAIL_INLINE).html)
			continue
		}
		flushQuote()
		if (line === '') continue
		if (info.kind === 'paragraph') {
			parts.push(`<p style="${EMAIL.p}">${renderLine(line, EMAIL_INLINE).html}</p>`)
		} else {
			parts.push(
				`<${info.kind} style="${EMAIL[info.kind]}">${renderLine(line, EMAIL_INLINE).html}</${info.kind}>`,
			)
		}
	}
	flushList()
	flushQuote()
	return `<div style="${EMAIL.base}">${parts.join('')}</div>`
}
