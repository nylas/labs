// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	htmlToMarkdown,
	markdownToDraftBody,
	ownMailDraftMarkdown,
	seedToMarkdown,
} from './html-to-markdown.js'
import { parseLine, renderLine } from './markdown-model.js'

describe('htmlToMarkdown', () => {
	it('converts the old editor canonical inline marks, dropping underline', () => {
		expect(htmlToMarkdown('<p>hello <strong>bold</strong> <em>it</em> <u>under</u></p>')).toBe(
			'hello **bold** _it_ under',
		)
	})

	it('accepts b and i aliases and deduplicates nested identical marks', () => {
		expect(htmlToMarkdown('<p><b>a</b><i>b</i></p>')).toBe('**a**_b_')
		expect(htmlToMarkdown('<p><strong><strong>a</strong></strong></p>')).toBe('**a**')
	})

	it('serialises bold italic as **_…_**, which round-trips through the renderer', () => {
		const markdown = htmlToMarkdown('<p><strong><em>x</em></strong></p>')
		expect(markdown).toBe('**_x_**')
		expect(renderLine(markdown).html).toBe('<strong><em>x</em></strong>')
	})

	it('converts safe links and drops unsafe ones to plain text', () => {
		expect(htmlToMarkdown('<p><a href="https://x.dev">a</a></p>')).toBe('[a](https://x.dev)')
		expect(htmlToMarkdown('<p><a href="javascript:alert(1)">a</a></p>')).toBe('a')
		expect(htmlToMarkdown('<p><a>a</a></p>')).toBe('a')
	})

	it('escapes closing parens in link targets so the link survives re-parsing', () => {
		const markdown = htmlToMarkdown('<p><a href="https://x.dev/a)b">a</a></p>')
		expect(markdown).toBe('[a](https://x.dev/a%29b)')
		expect(renderLine(markdown).html).toBe('<a href="https://x.dev/a%29b">a</a>')
	})

	it('converts bullet and numbered lists with counted ordinals', () => {
		expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
		expect(htmlToMarkdown('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b')
	})

	it('restarts numbering for a second list', () => {
		expect(htmlToMarkdown('<ol><li>a</li></ol><p>x</p><ol><li>b</li></ol>')).toBe('1. a\nx\n1. b')
	})

	it('treats a stray li as a bullet item', () => {
		expect(htmlToMarkdown('<li>a</li>')).toBe('- a')
	})

	it('converts quotes and headings, clamping deep headings to h3', () => {
		expect(htmlToMarkdown('<blockquote>q</blockquote>')).toBe('> q')
		expect(htmlToMarkdown('<h1>a</h1><h2>b</h2><h3>c</h3><h5>d</h5>')).toBe('# a\n## b\n### c\n### d')
	})

	it('turns soft breaks into separate lines and keeps filler breaks empty', () => {
		expect(htmlToMarkdown('<p>a<br>b</p>')).toBe('a\nb')
		// A break inside a link splits into one link per line.
		expect(htmlToMarkdown('<p><a href="https://x.dev">a<br>b</a></p>')).toBe(
			'[a](https://x.dev)\n[b](https://x.dev)',
		)
		expect(htmlToMarkdown('<p>x</p><p><br></p><p>y</p>')).toBe('x\n\ny')
	})

	it('gathers bare root text into an implicit paragraph', () => {
		expect(htmlToMarkdown('hi <b>x</b>')).toBe('hi **x**')
		expect(htmlToMarkdown('lead<p>para</p>')).toBe('lead\npara')
	})

	it('escapes characters that would re-parse as markdown syntax', () => {
		const markdown = htmlToMarkdown('<p>2*3 _x_ `c` [y] a\\b</p>')
		expect(markdown).toBe('2\\*3 \\_x\\_ \\`c\\` \\[y\\] a\\\\b')
		expect(renderLine(markdown).html).toBe('2*3 _x_ `c` [y] a\\b')
	})

	it('escapes a paragraph that would otherwise become a block marker', () => {
		const markdown = htmlToMarkdown('<p>- item</p>')
		expect(markdown).toBe('\\- item')
		expect(parseLine(markdown).kind).toBe('paragraph')
		expect(renderLine(markdown).html).toBe('- item')
	})

	it('keeps empty paragraphs as empty lines', () => {
		expect(htmlToMarkdown('<p></p><p>a</p>')).toBe('\na')
	})

	it('returns an empty string for empty input', () => {
		expect(htmlToMarkdown('')).toBe('')
	})
})

describe('markdown draft envelope', () => {
	it('wraps markdown as escaped HTML that strips back to the source text', () => {
		expect(markdownToDraftBody('# Hi\n**a** & b')).toBe(
			'<pre data-ownmail-markdown="1"># Hi\n**a** &amp; b</pre>',
		)
	})

	it('round-trips markdown exactly, including literal tag-looking text', () => {
		for (const markdown of [
			'use <br> here',
			'a <b>literal</b> tag',
			'# H\n- x\n\n<span>',
			'1 < 2 && 3 > 2',
		]) {
			expect(seedToMarkdown(markdownToDraftBody(markdown))).toBe(markdown)
		}
	})

	it('finds the envelope even when a provider rewraps the stored body', () => {
		const stored = `<div>${markdownToDraftBody('**hi** <b>')}</div>`
		expect(seedToMarkdown(stored)).toBe('**hi** <b>')
	})

	it('falls back to the heuristic when the marker only appears as text', () => {
		expect(seedToMarkdown('mentioning data-ownmail-markdown in prose')).toBe(
			'mentioning data-ownmail-markdown in prose',
		)
	})

	it('decodes only the versioned OwnMail draft envelope', () => {
		expect(ownMailDraftMarkdown(markdownToDraftBody('# Hi\n**ready**'))).toBe('# Hi\n**ready**')
		expect(ownMailDraftMarkdown('<div><pre data-ownmail-markdown="1">wrapped</pre></div>')).toBe('wrapped')
		expect(ownMailDraftMarkdown('<pre data-ownmail-markdown="2">future</pre>')).toBeUndefined()
		expect(ownMailDraftMarkdown('<pre x-data-ownmail-markdown="1">spoof</pre>')).toBeUndefined()
		expect(ownMailDraftMarkdown('<pre data-ownmail-markdown="1">unfinished')).toBeUndefined()
		expect(ownMailDraftMarkdown('<pre>plain</pre>')).toBeUndefined()
	})
})

describe('seedToMarkdown', () => {
	it('returns empty for blank seeds', () => {
		expect(seedToMarkdown('')).toBe('')
		expect(seedToMarkdown('  \n ')).toBe('')
	})

	it('converts HTML-looking seeds', () => {
		expect(seedToMarkdown('<p><strong>hi</strong></p>')).toBe('**hi**')
	})

	it('passes plain text through with newline normalisation', () => {
		expect(seedToMarkdown('a\r\nb\rc')).toBe('a\nb\nc')
		expect(seedToMarkdown('# already markdown')).toBe('# already markdown')
	})
})
