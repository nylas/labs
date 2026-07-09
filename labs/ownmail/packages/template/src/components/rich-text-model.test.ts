// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	activeFormats,
	applyBlockShortcut,
	applyLink,
	type Block,
	type Doc,
	deleteRange,
	docIsEmpty,
	docText,
	docToHtml,
	emptyDoc,
	htmlToDoc,
	insertSoftBreak,
	insertText,
	linkAt,
	type Mark,
	outdentAt,
	seedToDoc,
	setBlockType,
	splitBlock,
	textToDoc,
	toggleMark,
} from './rich-text-model.js'

// Small builders keep the intent of each test legible instead of burying it in
// nested object literals.
function span(text: string, marks: Mark[] = [], href?: string): Block['spans'][number] {
	return { text, marks, ...(href ? { href } : {}) }
}
function para(...spans: Block['spans']): Block {
	return { type: 'paragraph', spans }
}

describe('rich-text-model: text measurement', () => {
	it('starts every document with a single empty paragraph so there is always a caret home', () => {
		expect(emptyDoc()).toEqual([{ type: 'paragraph', spans: [] }])
	})

	it('joins blocks with a boundary newline so the flat offset axis matches the model', () => {
		const doc: Doc = [para(span('hello')), para(span('world'))]
		expect(docText(doc)).toBe('hello\nworld')
	})

	it('treats whitespace-only content as empty so an untouched composer never autosaves', () => {
		expect(docIsEmpty(emptyDoc())).toBe(true)
		expect(docIsEmpty([para(span('   \n'))])).toBe(true)
		expect(docIsEmpty([para(span('hi'))])).toBe(false)
	})
})

describe('rich-text-model: toggleMark', () => {
	it('adds a mark to an unformatted selection so the toolbar button turns it on', () => {
		const doc = [para(span('hello'))]
		expect(toggleMark(doc, 0, 5, 'bold')).toEqual([para(span('hello', ['bold']))])
	})

	it('removes the mark when the whole selection already has it, matching editor toggle convention', () => {
		const doc = [para(span('hello', ['bold']))]
		expect(toggleMark(doc, 0, 5, 'bold')).toEqual([para(span('hello'))])
	})

	it('accepts a reversed selection so a right-to-left drag formats the same text', () => {
		const doc = [para(span('hello'))]
		expect(toggleMark(doc, 5, 0, 'italic')).toEqual([para(span('hello', ['italic']))])
	})

	it('is a no-op for a collapsed caret because there is nothing yet to format', () => {
		const doc = [para(span('hello'))]
		expect(toggleMark(doc, 2, 2, 'bold')).toBe(doc)
	})

	it('splits a span when only part of it is selected so formatting is surgical', () => {
		const doc = [para(span('hello'))]
		expect(toggleMark(doc, 1, 3, 'bold')).toEqual([para(span('h'), span('el', ['bold']), span('lo'))])
	})

	it('leaves spans outside the selection untouched so formatting never bleeds past the range', () => {
		const doc = [para(span('ab'), span('cd'))]
		// Select only 'a'; the trailing 'cd' span lies wholly outside the range.
		expect(toggleMark(doc, 0, 1, 'bold')).toEqual([para(span('a', ['bold']), span('bcd'))])
	})

	it('applies across a block boundary so a multi-line selection formats consistently', () => {
		const doc = [para(span('ab')), para(span('cd'))]
		// Offsets: 'ab' = 0..2, boundary at 2, 'cd' = 3..5. Select 'b'..'c'.
		const result = toggleMark(doc, 1, 4, 'bold')
		expect(result).toEqual([para(span('a'), span('b', ['bold'])), para(span('c', ['bold']), span('d'))])
	})

	it('reports a mark as not-fully-applied when only some of the selection carries it, so it adds rather than removes', () => {
		const doc = [para(span('ab', ['bold']), span('cd'))]
		const result = toggleMark(doc, 0, 4, 'bold')
		expect(result).toEqual([para(span('abcd', ['bold']))])
	})
})

describe('rich-text-model: applyLink', () => {
	it('links a selection to a safe https url so recipients get a working anchor', () => {
		const doc = [para(span('site'))]
		expect(applyLink(doc, 0, 4, 'https://example.com')).toEqual([
			para(span('site', [], 'https://example.com')),
		])
	})

	it('keeps mailto links because contacting by email is a legitimate link target', () => {
		const doc = [para(span('mail'))]
		expect(applyLink(doc, 0, 4, 'mailto:a@b.com')).toEqual([para(span('mail', [], 'mailto:a@b.com'))])
	})

	it('drops an unsafe javascript: scheme so a link can never smuggle script execution', () => {
		const doc = [para(span('x', [], 'https://ok.com'))]
		const result = applyLink(doc, 0, 1, 'javascript:alert(1)')
		expect(result).toEqual([para(span('x'))])
	})

	it('removes a link when given an empty href so users can un-link text', () => {
		const doc = [para(span('x', [], 'https://ok.com'))]
		expect(applyLink(doc, 0, 1, '  ')).toEqual([para(span('x'))])
	})

	it('accepts a reversed selection so link direction of drag does not matter', () => {
		const doc = [para(span('site'))]
		expect(applyLink(doc, 4, 0, 'https://example.com')).toEqual([
			para(span('site', [], 'https://example.com')),
		])
	})

	it('is a no-op for a collapsed caret because a link needs text to attach to', () => {
		const doc = [para(span('site'))]
		expect(applyLink(doc, 2, 2, 'https://example.com')).toBe(doc)
	})
})

describe('rich-text-model: activeFormats & linkAt', () => {
	it('reports each active inline mark so the toolbar can light up the pressed buttons', () => {
		const doc = [para(span('x', ['bold', 'italic', 'underline']))]
		expect(activeFormats(doc, 0, 1)).toMatchObject({ bold: true, italic: true, underline: true })
	})

	it('reports marks off when the selection mixes styled and plain text', () => {
		const doc = [para(span('a', ['bold']), span('b'))]
		expect(activeFormats(doc, 0, 2).bold).toBe(false)
	})

	it('samples the character before a collapsed caret so typing continues the current run', () => {
		const doc = [para(span('ab', ['bold']))]
		expect(activeFormats(doc, 2, 2).bold).toBe(true)
	})

	it('reports no marks at offset zero because there is no preceding character to sample', () => {
		const doc = [para(span('ab', ['bold']))]
		expect(activeFormats(doc, 0, 0).bold).toBe(false)
	})

	it('surfaces the current block type so the list/quote buttons reflect the caret', () => {
		const doc: Doc = [{ type: 'quote', spans: [span('q')] }]
		expect(activeFormats(doc, 0, 1).block).toBe('quote')
	})

	it('flags a link under the selection so the link button shows as active', () => {
		const doc = [para(span('x', [], 'https://ok.com'))]
		expect(activeFormats(doc, 0, 1).link).toBe(true)
		expect(activeFormats([para(span('x'))], 0, 1).link).toBe(false)
	})

	it('resolves the href at an offset (sampling the char before) for pre-filling the link editor', () => {
		const doc = [para(span('ab', [], 'https://ok.com'))]
		expect(linkAt(doc, 2)).toBe('https://ok.com')
		expect(linkAt(doc, 0)).toBe('https://ok.com')
		expect(linkAt([para(span('x'))], 1)).toBe('')
	})
})

describe('rich-text-model: setBlockType', () => {
	it('converts the selected block to a list so the toolbar can start a bulleted list', () => {
		const doc = [para(span('item'))]
		expect(setBlockType(doc, 0, 4, 'bullet')).toEqual([{ type: 'bullet', spans: [span('item')] }])
	})

	it('toggles back to a paragraph when every selected block is already that type', () => {
		const doc: Doc = [{ type: 'bullet', spans: [span('item')] }]
		expect(setBlockType(doc, 0, 4, 'bullet')).toEqual([para(span('item'))])
	})

	it('applies to every block the selection touches so a multi-line list forms in one action', () => {
		const doc = [para(span('a')), para(span('b'))]
		const result = setBlockType(doc, 0, 3, 'number')
		expect(result.every((block) => block.type === 'number')).toBe(true)
	})

	it('leaves blocks outside the selection untouched so unrelated lines keep their type', () => {
		// 'a' spans 0..1; the second block starts at offset 2, past the [0,1] range.
		const doc = [para(span('a')), para(span('b'))]
		const result = setBlockType(doc, 0, 1, 'quote')
		expect(result).toEqual([{ type: 'quote', spans: [span('a')] }, para(span('b'))])
	})
})

describe('rich-text-model: splitBlock', () => {
	it('splits a paragraph at the caret and places the caret at the start of the new block', () => {
		const doc = [para(span('hello'))]
		const result = splitBlock(doc, 2)
		expect(result.doc).toEqual([para(span('he')), para(span('llo'))])
		// New block starts after 'he' (2) + boundary (1) = 3.
		expect(result.caret).toBe(3)
	})

	it('preserves inline marks on both sides of a split so formatting survives Enter', () => {
		const doc = [para(span('bold', ['bold']))]
		const result = splitBlock(doc, 2)
		expect(result.doc).toEqual([para(span('bo', ['bold'])), para(span('ld', ['bold']))])
	})

	it('exits an empty list item to a paragraph instead of stacking blank items', () => {
		const doc: Doc = [{ type: 'bullet', spans: [] }]
		const result = splitBlock(doc, 0)
		expect(result.doc).toEqual([para()])
		expect(result.caret).toBe(0)
	})

	it('exits an empty quote line to a paragraph so pressing Enter twice ends a quote', () => {
		const doc: Doc = [{ type: 'quote', spans: [] }]
		expect(splitBlock(doc, 0).doc).toEqual([para()])
	})

	it('exits an empty list item in place, leaving surrounding blocks untouched', () => {
		// 'a' occupies 0..1, boundary at 1, the empty bullet item starts at offset 2.
		const doc: Doc = [para(span('a')), { type: 'bullet', spans: [] }]
		expect(splitBlock(doc, 2).doc).toEqual([para(span('a')), para()])
	})

	it('keeps the list type on both halves when splitting a non-empty list item', () => {
		const doc: Doc = [{ type: 'bullet', spans: [span('ab')] }]
		const result = splitBlock(doc, 1)
		expect(result.doc).toEqual([
			{ type: 'bullet', spans: [span('a')] },
			{ type: 'bullet', spans: [span('b')] },
		])
	})
})

describe('rich-text-model: insertText & insertSoftBreak', () => {
	it('drops the empty fragment when inserting an empty string, leaving the text intact', () => {
		// Normalisation must discard the zero-length span so no empty run pollutes the model.
		const doc = [para(span('hi'))]
		expect(insertText(doc, 0, 0, '').doc).toEqual([para(span('hi'))])
	})

	it('inserts a soft break and advances the caret so Shift+Enter stays within a block', () => {
		const doc = [para(span('ab'))]
		const result = insertSoftBreak(doc, 1)
		expect(docText(result.doc)).toBe('a\nb')
		expect(result.caret).toBe(2)
	})

	it('inserts text into an empty document so the first keystroke has somewhere to go', () => {
		const result = insertText(emptyDoc(), 0, 0, 'hi')
		expect(result.doc).toEqual([para(span('hi'))])
		expect(result.caret).toBe(2)
	})

	it('replaces a non-empty selection so typing over highlighted text overwrites it', () => {
		const doc = [para(span('hello'))]
		const result = insertText(doc, 1, 4, 'X')
		expect(docText(result.doc)).toBe('hXo')
		expect(result.caret).toBe(2)
	})

	it('inherits marks from the preceding character so typing continues a bold run', () => {
		const doc = [para(span('ab', ['bold']))]
		const result = insertText(doc, 2, 2, 'c')
		expect(result.doc).toEqual([para(span('abc', ['bold']))])
	})

	it('samples the first character when inserting at offset zero, since there is nothing before it', () => {
		// With no preceding character, insertText falls back to sampling offset 0 —
		// so typing at the very start of a bold word continues the bold run.
		const doc = [para(span('ab', ['bold']))]
		const result = insertText(doc, 0, 0, 'X')
		expect(result.doc).toEqual([para(span('Xab', ['bold']))])
	})

	it('turns an embedded newline into a soft break so pasted line breaks render as <br>', () => {
		const result = insertText(emptyDoc(), 0, 0, 'a\nb')
		expect(docText(result.doc)).toBe('a\nb')
	})

	it('inserts into the correct block of a multi-block document, leaving other blocks untouched', () => {
		// 'a' occupies 0..1, boundary at 1, the second paragraph starts at offset 2.
		const doc = [para(span('a')), para(span('b'))]
		const result = insertText(doc, 2, 2, 'X')
		expect(result.doc).toEqual([para(span('a')), para(span('Xb'))])
	})
})

describe('rich-text-model: deleteRange', () => {
	it('is a no-op for a collapsed range so an idle Backspace guard changes nothing', () => {
		const doc = [para(span('ab'))]
		expect(deleteRange(doc, 1, 1)).toBe(doc)
	})

	it('deletes within a single block so selecting and cutting text works', () => {
		const doc = [para(span('hello'))]
		expect(deleteRange(doc, 1, 4)).toEqual([para(span('ho'))])
	})

	it('merges two blocks when the range spans them, keeping the first block type', () => {
		const doc: Doc = [{ type: 'quote', spans: [span('ab')] }, para(span('cd'))]
		// 'ab'=0..2, boundary 2, 'cd'=3..5. Delete 'b'..'c' (1..4) → 'a'+'d'.
		const result = deleteRange(doc, 1, 4)
		expect(result).toEqual([{ type: 'quote', spans: [span('ad')] }])
	})

	it('accepts a reversed range so deletion does not care about drag direction', () => {
		const doc = [para(span('hello'))]
		expect(deleteRange(doc, 4, 1)).toEqual([para(span('ho'))])
	})

	it('clamps an out-of-range offset to the document end so a stale caret never crashes', () => {
		// An offset past the end resolves to the final block rather than throwing.
		const doc = [para(span('ab'))]
		expect(deleteRange(doc, 1, 999)).toEqual([para(span('a'))])
	})
})

describe('rich-text-model: docToHtml', () => {
	it('renders a paragraph and an empty block as <br> so blank lines stay editable', () => {
		expect(docToHtml([para(span('hi')), para()])).toBe('<p>hi</p><p><br></p>')
	})

	it('nests bold/italic/underline and wraps links so all marks survive send', () => {
		const doc = [para(span('x', ['bold', 'italic', 'underline'], 'https://ok.com'))]
		expect(docToHtml(doc)).toBe('<p><a href="https://ok.com"><u><em><strong>x</strong></em></u></a></p>')
	})

	it('escapes HTML metacharacters in text so user input can never inject markup', () => {
		expect(docToHtml([para(span('a & b < c > d'))])).toBe('<p>a &amp; b &lt; c &gt; d</p>')
	})

	it('escapes quotes and angle brackets inside the href attribute so links cannot break out', () => {
		const doc = [para(span('x', [], 'https://ok.com/?a="&<>'))]
		expect(docToHtml(doc)).toContain('href="https://ok.com/?a=&quot;&amp;&lt;&gt;"')
	})

	it('groups adjacent bullet blocks into one <ul> so a list renders as a real list', () => {
		const doc: Doc = [
			{ type: 'bullet', spans: [span('a')] },
			{ type: 'bullet', spans: [span('b')] },
		]
		expect(docToHtml(doc)).toBe('<ul><li>a</li><li>b</li></ul>')
	})

	it('groups adjacent number blocks into one <ol>', () => {
		const doc: Doc = [
			{ type: 'number', spans: [span('a')] },
			{ type: 'number', spans: [span('b')] },
		]
		expect(docToHtml(doc)).toBe('<ol><li>a</li><li>b</li></ol>')
	})

	it('keeps a bullet list and a following numbered list as separate lists', () => {
		const doc: Doc = [
			{ type: 'bullet', spans: [span('a')] },
			{ type: 'number', spans: [span('b')] },
		]
		expect(docToHtml(doc)).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>')
	})

	it('renders a quote block and soft breaks so multi-line quotes read correctly', () => {
		const doc: Doc = [{ type: 'quote', spans: [span('a\nb')] }]
		expect(docToHtml(doc)).toBe('<blockquote>a<br>b</blockquote>')
	})
})

describe('rich-text-model: htmlToDoc', () => {
	it('parses paragraphs and divs into paragraph blocks so browser-shaped markup normalises', () => {
		expect(htmlToDoc('<p>a</p><div>b</div>')).toEqual([para(span('a')), para(span('b'))])
	})

	it('parses headings as paragraphs because the composer has no heading block', () => {
		expect(htmlToDoc('<h2>Title</h2>')).toEqual([para(span('Title'))])
	})

	it('parses list and quote structure so pasted/opened rich drafts keep their shape', () => {
		expect(htmlToDoc('<ul><li>a</li></ul>')).toEqual([{ type: 'bullet', spans: [span('a')] }])
		expect(htmlToDoc('<ol><li>b</li></ol>')).toEqual([{ type: 'number', spans: [span('b')] }])
		expect(htmlToDoc('<blockquote>q</blockquote>')).toEqual([{ type: 'quote', spans: [span('q')] }])
	})

	it('collapses nested duplicate mark tags so <b><b>x</b></b> yields a single bold run', () => {
		expect(htmlToDoc('<p><b><b>x</b></b></p>')).toEqual([para(span('x', ['bold']))])
	})

	it('carries a link across a <br> inside an anchor so a wrapped link stays fully linked', () => {
		expect(htmlToDoc('<p><a href="https://ok.com">a<br>b</a></p>')).toEqual([
			para(span('a\nb', [], 'https://ok.com')),
		])
	})

	it('maps every inline tag variant to its mark so both b/strong and i/em are understood', () => {
		expect(htmlToDoc('<p><strong>a</strong><b>b</b></p>')).toEqual([para(span('ab', ['bold']))])
		expect(htmlToDoc('<p><em>a</em><i>b</i></p>')).toEqual([para(span('ab', ['italic']))])
		expect(htmlToDoc('<p><u>u</u></p>')).toEqual([para(span('u', ['underline']))])
	})

	it('keeps a safe anchor href but drops an unsafe one, leaving the text unlinked', () => {
		expect(htmlToDoc('<p><a href="https://ok.com">x</a></p>')).toEqual([
			para(span('x', [], 'https://ok.com')),
		])
		expect(htmlToDoc('<p><a href="javascript:alert(1)">x</a></p>')).toEqual([para(span('x'))])
	})

	it('turns a <br> into a soft break so single line breaks round-trip', () => {
		expect(htmlToDoc('<p>a<br>b</p>')).toEqual([para(span('a\nb'))])
	})

	it('passes through an unknown inline tag so wrapping markup like <span> keeps its text', () => {
		expect(htmlToDoc('<p><span>x</span>y</p>')).toEqual([para(span('xy'))])
	})

	it('treats an anchor with no href as plain text so a bare <a> never becomes a broken link', () => {
		expect(htmlToDoc('<p><a>x</a></p>')).toEqual([para(span('x'))])
	})

	it('treats a stray top-level <li> as a bullet item so orphaned list markup still parses', () => {
		expect(htmlToDoc('<li>x</li>')).toEqual([{ type: 'bullet', spans: [span('x')] }])
	})

	it('gathers a top-level inline element into a paragraph, preserving its formatting', () => {
		// A stray inline element at the contenteditable root (e.g. a browser leaves a
		// bare <b> outside any block) must keep BOTH its text and its mark — otherwise
		// re-reading the DOM would silently strip the user's bold.
		expect(htmlToDoc('<b>hi</b>')).toEqual([para(span('hi', ['bold']))])
	})

	it('keeps bare top-level text so nothing typed outside a block is lost', () => {
		expect(htmlToDoc('loose text')).toEqual([para(span('loose text'))])
	})

	it('reads a lone filler <br> as an empty block, not a soft break', () => {
		// An empty block is rendered as `<li><br></li>`; parsing it back must yield an
		// empty block so Enter on it exits the list rather than seeing a phantom newline.
		expect(htmlToDoc('<ul><li><br></li></ul>')).toEqual([{ type: 'bullet', spans: [] }])
		// A <br> AFTER text is a genuine soft break and is preserved.
		expect(htmlToDoc('<p>a<br></p>')).toEqual([para(span('a\n'))])
	})

	it('falls back to an empty document when there is no parseable content', () => {
		expect(htmlToDoc('')).toEqual(emptyDoc())
	})

	it('renders a hostile fragment as inert escaped text so nothing executable survives a round-trip', () => {
		const html = htmlToDoc('<script>alert(1)</script><img src=x onerror=alert(2)>hi')
		const out = docToHtml(html)
		expect(out).not.toContain('<script')
		expect(out).not.toContain('onerror')
	})
})

describe('rich-text-model: textToDoc & seedToDoc', () => {
	it('keeps a single line as one paragraph so a simple reply body seeds cleanly', () => {
		expect(textToDoc('hello')).toEqual([para(span('hello'))])
	})

	it('splits on blank lines into separate paragraphs so quoted replies keep their spacing', () => {
		expect(textToDoc('a\n\nb')).toEqual([para(span('a')), para(span('b'))])
	})

	it('treats a single newline as a soft break within one paragraph', () => {
		expect(textToDoc('a\nb')).toEqual([para(span('a\nb'))])
	})

	it('normalises CRLF so text pasted from Windows sources does not carry stray characters', () => {
		expect(textToDoc('a\r\nb')).toEqual([para(span('a\nb'))])
	})

	it('returns an empty document for empty text so a blank seed opens a blank composer', () => {
		expect(textToDoc('')).toEqual(emptyDoc())
	})

	it('preserves a leading blank paragraph so forwarded bodies keep their opening spacing', () => {
		// A forward body begins with two blank lines; index 0 must be kept.
		const doc = textToDoc('\n\nquoted')
		expect(doc[0]).toEqual(para())
	})

	it('routes empty or whitespace seeds to an empty document', () => {
		expect(seedToDoc('   ')).toEqual(emptyDoc())
	})

	it('routes an HTML-looking seed through the HTML parser (a draft body)', () => {
		expect(seedToDoc('<p><strong>hi</strong></p>')).toEqual([para(span('hi', ['bold']))])
	})

	it('routes a plain-text seed through the text parser (a reply body)', () => {
		expect(seedToDoc('just text')).toEqual([para(span('just text'))])
	})
})

describe('rich-text-model: applyBlockShortcut', () => {
	it('turns a leading "- " into a bullet list and strips the marker', () => {
		const doc = [para(span('- '))]
		const result = applyBlockShortcut(doc, 2)
		expect(result).toEqual({ doc: [{ type: 'bullet', spans: [] }], caret: 0 })
	})

	it('accepts "* " as an alternative bullet marker', () => {
		const doc = [para(span('* '))]
		expect(applyBlockShortcut(doc, 2)?.doc).toEqual([{ type: 'bullet', spans: [] }])
	})

	it('treats the non-breaking space browsers emit for a trailing space as a marker', () => {
		// Chromium renders the just-typed trailing space of "- " as U+00A0; the shortcut
		// must still fire, otherwise list auto-formatting silently breaks in real browsers.
		const doc = [para(span('- '))]
		expect(applyBlockShortcut(doc, 2)?.doc).toEqual([{ type: 'bullet', spans: [] }])
	})

	it('turns a leading "> " into a quote block', () => {
		const doc = [para(span('> '))]
		expect(applyBlockShortcut(doc, 2)?.doc).toEqual([{ type: 'quote', spans: [] }])
	})

	it('turns "1. " (and multi-digit "12. ") into a numbered list', () => {
		expect(applyBlockShortcut([para(span('1. '))], 3)?.doc).toEqual([{ type: 'number', spans: [] }])
		expect(applyBlockShortcut([para(span('12. '))], 4)?.doc).toEqual([{ type: 'number', spans: [] }])
	})

	it('returns null when the text before the caret is not a marker so normal typing is untouched', () => {
		expect(applyBlockShortcut([para(span('hello '))], 6)).toBeNull()
	})

	it('returns null when the block is already that type so the marker only triggers once', () => {
		const doc: Doc = [{ type: 'bullet', spans: [span('- ')] }]
		expect(applyBlockShortcut(doc, 2)).toBeNull()
	})
})

describe('rich-text-model: outdentAt', () => {
	it('returns null when there is a selection because outdent only applies to a caret', () => {
		const doc: Doc = [{ type: 'bullet', spans: [span('x')] }]
		expect(outdentAt(doc, 0, 1)).toBeNull()
	})

	it('returns null away from the block start so Backspace mid-line deletes normally', () => {
		const doc: Doc = [{ type: 'bullet', spans: [span('x')] }]
		expect(outdentAt(doc, 1, 1)).toBeNull()
	})

	it('returns null in a paragraph so Backspace at the start of a paragraph is native', () => {
		expect(outdentAt([para(span('x'))], 0, 0)).toBeNull()
	})

	it('outdents a list item at its start to a paragraph so Backspace exits the list', () => {
		const doc: Doc = [{ type: 'bullet', spans: [span('x')] }]
		expect(outdentAt(doc, 0, 0)).toEqual({ doc: [para(span('x'))], caret: 0 })
	})

	it('outdents a quote line at its start to a paragraph', () => {
		const doc: Doc = [{ type: 'quote', spans: [span('x')] }]
		expect(outdentAt(doc, 0, 0)?.doc).toEqual([para(span('x'))])
	})

	it('outdents only the targeted block, leaving earlier blocks intact in a multi-block document', () => {
		// 'x' occupies 0..1, boundary at 1, the bullet item starts at offset 2.
		const doc: Doc = [para(span('x')), { type: 'bullet', spans: [span('y')] }]
		expect(outdentAt(doc, 2, 2)?.doc).toEqual([para(span('x')), para(span('y'))])
	})
})
