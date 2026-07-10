import { describe, expect, it } from 'vitest'
import {
	docHtml,
	lineStartOffset,
	locateOffset,
	markdownIsEmpty,
	markdownToEmailHtml,
	parseLine,
	rawLineHtml,
	renderedToSource,
	renderLine,
	replaceRange,
	toggleInline,
	wrapLink,
} from './markdown-model.js'

describe('parseLine', () => {
	it('recognises heading levels one through three', () => {
		expect(parseLine('# Title')).toEqual({ kind: 'h1', contentStart: 2, ordinal: 0 })
		expect(parseLine('## Title')).toEqual({ kind: 'h2', contentStart: 3, ordinal: 0 })
		expect(parseLine('### Title')).toEqual({ kind: 'h3', contentStart: 4, ordinal: 0 })
	})

	it('treats deeper headings and missing marker spaces as plain paragraphs', () => {
		expect(parseLine('#### Title').kind).toBe('paragraph')
		expect(parseLine('#Title').kind).toBe('paragraph')
		expect(parseLine('-item').kind).toBe('paragraph')
	})

	it('recognises bullet markers with - and *', () => {
		expect(parseLine('- item')).toEqual({ kind: 'bullet', contentStart: 2, ordinal: 0 })
		expect(parseLine('* item')).toEqual({ kind: 'bullet', contentStart: 2, ordinal: 0 })
	})

	it('recognises numbered items and captures the typed ordinal', () => {
		expect(parseLine('12. item')).toEqual({ kind: 'number', contentStart: 4, ordinal: 12 })
	})

	it('rejects absurdly long numbers so pasted data stays text', () => {
		expect(parseLine('1234567890. item').kind).toBe('paragraph')
	})

	it('recognises quotes and defaults to paragraph', () => {
		expect(parseLine('> quoted')).toEqual({ kind: 'quote', contentStart: 2, ordinal: 0 })
		expect(parseLine('plain')).toEqual({ kind: 'paragraph', contentStart: 0, ordinal: 0 })
	})
})

describe('renderLine', () => {
	it('renders plain text with an identity source map', () => {
		expect(renderLine('abc')).toEqual({ html: 'abc', map: [0, 1, 2] })
	})

	it('hides the block marker and maps content to its source positions', () => {
		expect(renderLine('- ab')).toEqual({ html: 'ab', map: [2, 3] })
	})

	it('renders bold, mapping visible characters past the ** markers', () => {
		expect(renderLine('**hi**')).toEqual({ html: '<strong>hi</strong>', map: [2, 3] })
	})

	it('renders italic with * and _ alike', () => {
		expect(renderLine('*i*').html).toBe('<em>i</em>')
		expect(renderLine('_i_').html).toBe('<em>i</em>')
	})

	it('renders inline code literally, ignoring nested markdown', () => {
		expect(renderLine('`**x**`')).toEqual({ html: '<code>**x**</code>', map: [1, 2, 3, 4, 5] })
	})

	it('renders nested emphasis inside bold', () => {
		expect(renderLine('**a *b* c**').html).toBe('<strong>a <em>b</em> c</strong>')
	})

	it('renders safe links and hides the url', () => {
		expect(renderLine('[hi](https://x.dev)')).toEqual({
			html: '<a href="https://x.dev">hi</a>',
			map: [1, 2],
		})
	})

	it('keeps unsafe or malformed links literal', () => {
		expect(renderLine('[a](javascript:alert(1))').html).toBe('[a](javascript:alert(1))')
		expect(renderLine('[a](https://x').html).toBe('[a](https://x')
		expect(renderLine('[a]x').html).toBe('[a]x')
		expect(renderLine('[](https://x)').html).toBe('[](https://x)')
	})

	it('keeps a closing delimiter outside the enclosing span from matching', () => {
		// The ** would only close beyond the link text, so it stays literal.
		expect(renderLine('[**a](https://x)**').html).toBe('<a href="https://x">**a</a>**')
	})

	it('keeps a code backtick outside the enclosing span from matching', () => {
		expect(renderLine('*a`b*`').html).toBe('<em>a`b</em>`')
	})

	it('honours backslash escapes and maps to the escaped character', () => {
		expect(renderLine('a\\*b')).toEqual({ html: 'a*b', map: [0, 2, 3] })
	})

	it('keeps a trailing backslash literal', () => {
		expect(renderLine('a\\')).toEqual({ html: 'a\\', map: [0, 1] })
	})

	it('skips escaped delimiters when searching for a close', () => {
		// The \* neither closes the emphasis nor keeps its backslash when rendered.
		expect(renderLine('*a\\*b*').html).toBe('<em>a*b</em>')
	})

	it('leaves unmatched or empty delimiters literal', () => {
		expect(renderLine('**a').html).toBe('**a')
		expect(renderLine('****').html).toBe('****')
		expect(renderLine('`a').html).toBe('`a')
		expect(renderLine('a*b').html).toBe('a*b')
	})

	it('escapes HTML in text and attributes', () => {
		expect(renderLine('<b>&').html).toBe('&lt;b&gt;&amp;')
		expect(renderLine('[a](https://x.dev/?q="1")').html).toBe(
			'<a href="https://x.dev/?q=&quot;1&quot;">a</a>',
		)
	})

	it('stamps email inline styles onto code and links when provided', () => {
		const styled = renderLine('`c` [a](https://x.dev)', { code: 'color:red;', link: 'color:blue;' })
		expect(styled.html).toBe(
			'<code style="color:red;">c</code> <a href="https://x.dev" style="color:blue;">a</a>',
		)
	})
})

describe('rawLineHtml', () => {
	it('keeps every source character visible, dimming the syntax spans', () => {
		expect(rawLineHtml('**a**')).toBe(
			'<p class="md-raw"><strong><span class="md-syn">**</span>a<span class="md-syn">**</span></strong></p>',
		)
		expect(rawLineHtml('*i*')).toBe(
			'<p class="md-raw"><em><span class="md-syn">*</span>i<span class="md-syn">*</span></em></p>',
		)
	})

	it('keeps heading formatting on the active line, with a dimmed marker', () => {
		expect(rawLineHtml('## Hi')).toBe('<h2 class="md-raw"><span class="md-syn">## </span>Hi</h2>')
	})

	it('keeps quote styling and dims list markers inside a plain paragraph', () => {
		expect(rawLineHtml('> q')).toBe(
			'<blockquote class="md-raw"><span class="md-syn">&gt; </span>q</blockquote>',
		)
		expect(rawLineHtml('- item')).toBe('<p class="md-raw"><span class="md-syn">- </span>item</p>')
	})

	it('shows code backticks dimmed inside the code styling', () => {
		expect(rawLineHtml('`x`')).toBe(
			'<p class="md-raw"><code><span class="md-syn">`</span>x<span class="md-syn">`</span></code></p>',
		)
	})

	it('styles link text without creating a clickable anchor and dims the url', () => {
		expect(rawLineHtml('[a](https://x.dev)')).toBe(
			'<p class="md-raw"><span class="md-syn">[</span><span class="md-link">a</span>' +
				'<span class="md-syn">](https://x.dev)</span></p>',
		)
	})

	it('dims the backslash of an escape while showing the escaped character', () => {
		expect(rawLineHtml('a\\*b')).toBe('<p class="md-raw">a<span class="md-syn">\\</span>*b</p>')
	})

	it('renders an empty line as filler', () => {
		expect(rawLineHtml('')).toBe('<p class="md-raw"><br></p>')
	})

	it('concatenates to exactly the source text, so caret math stays identity', () => {
		for (const line of ['**a** and `c`', '## H *i*', '- [x](https://x.dev) \\* done']) {
			expect(rawLineHtml(line).replace(/<[^>]+>/g, '')).toBe(line)
		}
	})
})

describe('renderedToSource', () => {
	it('maps a rendered caret through the source map', () => {
		expect(renderedToSource(renderLine('**hi**'), 6, 1)).toBe(3)
	})

	it('maps the visual line start to the source line start, before hidden syntax', () => {
		expect(renderedToSource(renderLine('**hi**'), 6, 0)).toBe(0)
	})

	it('falls back to the line end past the last visible character', () => {
		expect(renderedToSource(renderLine('**hi**'), 6, 2)).toBe(6)
	})
})

describe('docHtml', () => {
	it('renders one element per line with markdown preview', () => {
		expect(docHtml('# T\n- a\n> q\nplain', null)).toBe(
			'<h1>T</h1><ul><li>a</li></ul><blockquote>q</blockquote><p>plain</p>',
		)
	})

	it('shows styled raw source with dimmed syntax for lines in the active range', () => {
		expect(docHtml('**a**\n<b>\nplain', { start: 0, end: 1 })).toBe(
			'<p class="md-raw"><strong><span class="md-syn">**</span>a<span class="md-syn">**</span></strong></p>' +
				'<p class="md-raw">&lt;b&gt;</p><p>plain</p>',
		)
	})

	it('renders empty lines as filler paragraphs, raw or not', () => {
		expect(docHtml('', null)).toBe('<p><br></p>')
		expect(docHtml('', { start: 0, end: 0 })).toBe('<p class="md-raw"><br></p>')
	})

	it('counts numbered runs up across single-item lists', () => {
		expect(docHtml('3. a\n7. b\nx\n1. c', null)).toBe(
			'<ol start="3"><li>a</li></ol><ol start="4"><li>b</li></ol><p>x</p><ol start="1"><li>c</li></ol>',
		)
	})

	it('keeps counting a numbered run through an active raw line', () => {
		expect(docHtml('1. a\n2. b\n3. c', { start: 1, end: 1 })).toBe(
			'<ol start="1"><li>a</li></ol><p class="md-raw"><span class="md-syn">2. </span>b</p><ol start="3"><li>c</li></ol>',
		)
	})
})

describe('offsets', () => {
	it('reports whether a document is effectively empty', () => {
		expect(markdownIsEmpty('  \n ')).toBe(true)
		expect(markdownIsEmpty('a')).toBe(false)
	})

	it('finds the start offset of a line', () => {
		expect(lineStartOffset('ab\ncd\ne', 0)).toBe(0)
		expect(lineStartOffset('ab\ncd\ne', 2)).toBe(6)
	})

	it('locates a global offset as line and column', () => {
		expect(locateOffset('ab\ncd', 4)).toEqual({ line: 1, column: 1 })
		expect(locateOffset('ab\ncd', 0)).toEqual({ line: 0, column: 0 })
	})

	it('clamps out-of-range offsets', () => {
		expect(locateOffset('ab', -1)).toEqual({ line: 0, column: 0 })
		expect(locateOffset('ab', 99)).toEqual({ line: 0, column: 2 })
	})
})

describe('replaceRange', () => {
	it('replaces a range and reports the caret after the insertion', () => {
		expect(replaceRange('hello', 1, 3, 'X')).toEqual({ source: 'hXlo', caret: 2 })
	})

	it('accepts a reversed selection', () => {
		expect(replaceRange('hello', 3, 1, 'X')).toEqual({ source: 'hXlo', caret: 2 })
	})
})

describe('toggleInline', () => {
	it('wraps a selection in the marker', () => {
		expect(toggleInline('hi there', 0, 2, '**')).toEqual({ source: '**hi** there', start: 2, end: 4 })
	})

	it('inserts an empty pair at a collapsed caret', () => {
		expect(toggleInline('hi', 1, 1, '*')).toEqual({ source: 'h**i', start: 2, end: 2 })
	})

	it('unwraps when the markers sit just outside the selection', () => {
		expect(toggleInline('**hi** there', 2, 4, '**')).toEqual({ source: 'hi there', start: 0, end: 2 })
	})

	it('unwraps when the selection includes the markers', () => {
		expect(toggleInline('**hi** there', 0, 6, '**')).toEqual({ source: 'hi there', start: 0, end: 2 })
	})

	it('wraps when the selection starts too close to the origin to be wrapped', () => {
		expect(toggleInline('hi', 0, 2, '**')).toEqual({ source: '**hi**', start: 2, end: 4 })
	})
})

describe('wrapLink', () => {
	it('wraps the selection and parks the caret between the parens', () => {
		expect(wrapLink('read this', 5, 9)).toEqual({ source: 'read [this]()', caret: 12 })
	})

	it('inserts an empty link at a collapsed caret', () => {
		expect(wrapLink('x', 1, 1)).toEqual({ source: 'x[]()', caret: 4 })
	})
})

describe('markdownToEmailHtml', () => {
	it('returns empty for an effectively empty message', () => {
		expect(markdownToEmailHtml('')).toBe('')
		expect(markdownToEmailHtml(' \n ')).toBe('')
	})

	it('wraps paragraphs in an inline-styled base container', () => {
		const html = markdownToEmailHtml('hello')
		expect(html).toContain('<div style="font-family:Arial')
		expect(html).toContain('<p style="margin:0 0 12px;">hello</p>')
	})

	it('skips blank separator lines', () => {
		const html = markdownToEmailHtml('a\n\nb')
		expect(html).toContain('<p style="margin:0 0 12px;">a</p><p style="margin:0 0 12px;">b</p>')
	})

	it('renders headings with their own styles', () => {
		expect(markdownToEmailHtml('# A')).toContain('<h1 style="margin:16px 0 12px;font-size:22px')
		expect(markdownToEmailHtml('## B')).toContain('<h2 style=')
		expect(markdownToEmailHtml('### C')).toContain('<h3 style=')
	})

	it('merges adjacent bullets into one list', () => {
		const html = markdownToEmailHtml('- a\n- b')
		expect(html.match(/<ul/g)).toHaveLength(1)
		expect(html).toContain('<li style="margin:0 0 4px;">a</li><li style="margin:0 0 4px;">b</li>')
	})

	it('merges numbered runs and only stamps start when it is not 1', () => {
		expect(markdownToEmailHtml('1. a\n2. b')).toContain('<ol style=')
		expect(markdownToEmailHtml('3. a\n4. b')).toContain('<ol start="3" style=')
	})

	it('splits a list when the marker kind changes', () => {
		const html = markdownToEmailHtml('- a\n1. b')
		expect(html).toContain('</ul><ol')
	})

	it('merges adjacent quote lines into one blockquote with line breaks', () => {
		const html = markdownToEmailHtml('> a\n> b')
		expect(html.match(/<blockquote/g)).toHaveLength(1)
		expect(html).toContain('>a<br>b</blockquote>')
	})

	it('closes an open quote when a list starts and vice versa', () => {
		expect(markdownToEmailHtml('> q\n- a')).toContain('</blockquote><ul')
		expect(markdownToEmailHtml('- a\n> q')).toContain('</ul><blockquote')
	})

	it('closes an open quote before a paragraph', () => {
		expect(markdownToEmailHtml('> q\np')).toContain('</blockquote><p')
	})

	it('flushes a trailing list and a trailing quote', () => {
		expect(markdownToEmailHtml('p\n- a')).toContain('</ul></div>')
		expect(markdownToEmailHtml('p\n> q')).toContain('</blockquote></div>')
	})

	it('styles inline code and links for mail clients', () => {
		const html = markdownToEmailHtml('`x` and [a](https://x.dev)')
		expect(html).toContain('<code style="font-family:Consolas')
		expect(html).toContain('<a href="https://x.dev" style="color:#2563eb;">a</a>')
	})
})
