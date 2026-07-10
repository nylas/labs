// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { linePointOf, readLineRange, writeLineRange } from './markdown-dom.js'
import { rawLineHtml } from './markdown-model.js'

function mount(html: string): HTMLElement {
	const root = document.createElement('div')
	root.innerHTML = html
	document.body.appendChild(root)
	return root
}

afterEach(() => {
	document.body.innerHTML = ''
	document.getSelection()?.removeAllRanges()
})

describe('linePointOf', () => {
	it('maps a text-node position to its line and visible offset', () => {
		const root = mount('<p>ab</p><p>cd</p>')
		const second = root.children[1] as HTMLElement
		expect(linePointOf(root, second.firstChild as Node, 1)).toEqual({ line: 1, offset: 1 })
	})

	it('counts text across nested inline elements in document order', () => {
		const root = mount('<p>a<strong>bc</strong>d</p>')
		const strongText = (root.querySelector('strong') as HTMLElement).firstChild as Node
		expect(linePointOf(root, strongText, 1)).toEqual({ line: 0, offset: 2 })
	})

	it('resolves an element anchor by summing the text of prior children', () => {
		const root = mount('<p>a<strong>bc</strong>d</p>')
		expect(linePointOf(root, root.children[0] as Node, 2)).toEqual({ line: 0, offset: 3 })
	})

	it('treats offsets on the root itself as whole-line anchors', () => {
		const root = mount('<p>ab</p><p>cde</p>')
		expect(linePointOf(root, root, 1)).toEqual({ line: 1, offset: 0 })
		// A select-all ends past the last child: anchor at the end of the last line.
		expect(linePointOf(root, root, 2)).toEqual({ line: 1, offset: 3 })
	})

	it('finds positions inside list-item lines', () => {
		const root = mount('<ul><li>ab</li></ul>')
		const text = (root.querySelector('li') as HTMLElement).firstChild as Node
		expect(linePointOf(root, text, 2)).toEqual({ line: 0, offset: 2 })
	})

	it('returns null for nodes outside the editor', () => {
		const root = mount('<p>ab</p>')
		const stray = document.createElement('p')
		stray.textContent = 'x'
		document.body.appendChild(stray)
		expect(linePointOf(root, stray.firstChild as Node, 0)).toBeNull()
	})
})

describe('readLineRange', () => {
	it('returns null when there is no selection', () => {
		const root = mount('<p>ab</p>')
		document.getSelection()?.removeAllRanges()
		expect(readLineRange(root)).toBeNull()
	})

	it('returns null when the selection lives outside the editor', () => {
		const root = mount('<p>ab</p>')
		const stray = document.createElement('p')
		stray.textContent = 'xy'
		document.body.appendChild(stray)
		const range = document.createRange()
		range.setStart(stray.firstChild as Node, 0)
		range.setEnd(stray.firstChild as Node, 1)
		const selection = document.getSelection() as Selection
		selection.removeAllRanges()
		selection.addRange(range)
		expect(readLineRange(root)).toBeNull()
	})

	it('reads a selection spanning lines as ordered line points', () => {
		const root = mount('<p>ab</p><p>cd</p>')
		const range = document.createRange()
		range.setStart((root.children[0] as HTMLElement).firstChild as Node, 1)
		range.setEnd((root.children[1] as HTMLElement).firstChild as Node, 2)
		const selection = document.getSelection() as Selection
		selection.removeAllRanges()
		selection.addRange(range)
		expect(readLineRange(root)).toEqual({ start: { line: 0, offset: 1 }, end: { line: 1, offset: 2 } })
	})
})

describe('writeLineRange', () => {
	it('places a collapsed caret inside a raw line text node', () => {
		const root = mount('<p class="md-raw">**a**</p><p>b</p>')
		writeLineRange(root, { line: 0, offset: 3 }, { line: 0, offset: 3 })
		const selection = document.getSelection() as Selection
		expect(selection.anchorNode).toBe((root.children[0] as HTMLElement).firstChild)
		expect(selection.anchorOffset).toBe(3)
		expect(selection.isCollapsed).toBe(true)
	})

	it('anchors at the element when the line is empty filler', () => {
		const root = mount('<p class="md-raw"><br></p>')
		writeLineRange(root, { line: 0, offset: 0 }, { line: 0, offset: 0 })
		const selection = document.getSelection() as Selection
		expect(selection.anchorNode).toBe(root.children[0])
		expect(selection.anchorOffset).toBe(0)
	})

	it('walks syntax-highlight spans to place the caret mid-line', () => {
		const root = mount(
			'<p class="md-raw"><strong><span class="md-syn">**</span>a<span class="md-syn">**</span></strong>x</p>',
		)
		writeLineRange(root, { line: 0, offset: 3 }, { line: 0, offset: 3 })
		const selection = document.getSelection() as Selection
		expect(selection.anchorNode?.textContent).toBe('a')
		expect(selection.anchorOffset).toBe(1)
	})

	it('raw line HTML concatenates to exactly the source text, so caret math stays identity', () => {
		// resolvePoint places carets by walking text nodes; that is only sound if
		// the raw line's visible text equals the source line character for character.
		for (const line of ['**a** and `c`', '## H *i*', '- [x](https://x.dev) \\* done']) {
			const probe = document.createElement('div')
			probe.innerHTML = rawLineHtml(line)
			expect(probe.textContent).toBe(line)
		}
	})

	it('writes a range spanning two raw lines that reads back identically', () => {
		const root = mount('<p class="md-raw">ab</p><p class="md-raw">cd</p>')
		writeLineRange(root, { line: 0, offset: 1 }, { line: 1, offset: 2 })
		expect(readLineRange(root)).toEqual({ start: { line: 0, offset: 1 }, end: { line: 1, offset: 2 } })
	})
})
