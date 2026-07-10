// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { docBlocks, offsetOf, pointAt, readOffsets, writeOffsets } from './rich-text-dom.js'

// These functions translate between the editor's rendered DOM and the flat
// character-offset axis the model uses. Getting them right is what keeps the
// caret from jumping after a formatting command, so every mapping — text nodes,
// element anchors, `<br>` soft breaks, block boundaries, and out-of-range
// clamps — is pinned down here against explicit DOM nodes.

function mount(html: string): HTMLDivElement {
	const root = document.createElement('div')
	root.innerHTML = html
	document.body.appendChild(root)
	return root
}

afterEach(() => {
	document.body.innerHTML = ''
	vi.restoreAllMocks()
})

describe('docBlocks', () => {
	it('treats each list item as its own block so list offsets line up with the model', () => {
		const root = mount('<p>a</p><ul><li>b</li><li>c</li></ul><ol><li>d</li></ol>')
		const text = docBlocks(root).map((nodes) => nodes.map((n) => n.textContent).join(''))
		expect(text).toEqual(['a', 'b', 'c', 'd'])
	})

	it('coalesces loose top-level text and inline nodes into one implicit paragraph', () => {
		// Browsers leave bare text at the editable root (e.g. the first char typed into
		// an empty editor); it must still segment into a single block for offset mapping.
		const root = mount('plain<strong>bold</strong>')
		const blocks = docBlocks(root)
		expect(blocks).toHaveLength(1)
		expect(blocks[0]?.map((n) => n.textContent).join('')).toBe('plainbold')
	})
})

describe('offsetOf', () => {
	it('maps a caret inside the first block to its plain character offset', () => {
		const root = mount('<p>hello</p><p>world</p>')
		const hello = root.children[0]?.firstChild as Node
		expect(offsetOf(root, hello, 2)).toBe(2)
	})

	it('adds one boundary character per preceding block so blocks never overlap', () => {
		const root = mount('<p>hello</p><p>world</p>')
		const world = root.children[1]?.firstChild as Node
		// "world" starts at 5 (len of block 0) + 1 (boundary) = 6.
		expect(offsetOf(root, world, 0)).toBe(6)
		expect(offsetOf(root, world, 3)).toBe(9)
	})

	it('counts a <br> as one character when measuring within a block', () => {
		const root = mount('<p>a<br>b</p>')
		const b = root.children[0]?.lastChild as Node
		// text "a" (1) + <br> (1) → caret at start of "b" is offset 2.
		expect(offsetOf(root, b, 0)).toBe(2)
	})

	it('resolves a selection anchored directly on a <br> node to the offset before it', () => {
		const root = mount('<p>a<br>b</p>')
		const br = root.querySelector('br') as Node
		// "a" contributes 1; the caret sitting on the <br> itself is offset 1.
		expect(offsetOf(root, br, 0)).toBe(1)
	})

	it('measures an element-anchored selection by summing the children before it', () => {
		const root = mount('<p>ab<strong>cd</strong></p>')
		const p = root.children[0] as Node
		// Anchored at (p, 1): everything before child index 1 is the "ab" text node.
		expect(offsetOf(root, p, 1)).toBe(2)
	})

	it('maps a caret inside a bare top-level text node (no block wrapper)', () => {
		// The exact shape Chromium leaves after typing the first character.
		const root = mount('Hello team')
		expect(offsetOf(root, root.firstChild as Node, 5)).toBe(5)
	})

	it('falls back to the end when the node lives outside every block', () => {
		const root = mount('<p>hello</p><p>world</p>')
		const orphan = document.createTextNode('elsewhere')
		// Two 5-char blocks + two boundaries = 12; the clamp reports 11.
		expect(offsetOf(root, orphan, 0)).toBe(11)
	})
})

describe('pointAt', () => {
	it('round-trips an offset back to the same DOM position offsetOf produced', () => {
		const root = mount('<p>hello</p><p>world</p>')
		const point = pointAt(root, 9)
		expect(point.node.textContent).toBe('world')
		expect(point.offset).toBe(3)
	})

	it('lands at the start of a block when the offset is exactly its boundary', () => {
		const root = mount('<p>hello</p><p>world</p>')
		const point = pointAt(root, 6)
		expect(point.node.textContent).toBe('world')
		expect(point.offset).toBe(0)
	})

	it('places the caret after a <br> when the offset points past it', () => {
		const root = mount('<p>a<br>b</p>')
		const point = pointAt(root, 2)
		expect(point.node.textContent).toBe('b')
		expect(point.offset).toBe(0)
	})

	it('anchors after a trailing <br> so a Shift+Enter caret lands on the new line', () => {
		// `<p>text<br></p>` is what "text" + a trailing soft break renders to; offset 5
		// (after the break) must resolve to the END of the block, not its start.
		const root = mount('<p>text<br></p>')
		const point = pointAt(root, 5)
		expect((point.node as HTMLElement).tagName).toBe('P')
		expect(point.offset).toBe(2) // after both the text node and the <br>
	})

	it('anchors after a trailing <br> in loose top-level content (no block wrapper)', () => {
		const root = mount('text<br>')
		const point = pointAt(root, 5)
		expect(point.node).toBe(root)
		expect(point.offset).toBe(2) // after the text node and the <br> within the root
	})

	it('anchors at a leading <br> element position for an empty block', () => {
		const root = mount('<p><br></p>')
		const point = pointAt(root, 0)
		expect((point.node as HTMLElement).tagName).toBe('P')
		expect(point.offset).toBe(0)
	})

	it('anchors in the block itself when it has neither text nor a <br>', () => {
		const root = mount('<p></p>')
		const point = pointAt(root, 0)
		expect((point.node as HTMLElement).tagName).toBe('P')
		expect(point.offset).toBe(0)
	})

	it('stops at the first matching node and ignores later siblings in the block', () => {
		// Offset 1 resolves inside the leading text node; the <strong> and trailing
		// text after it must not disturb the result once it is found.
		const root = mount('<p>a<strong>b</strong>c</p>')
		const point = pointAt(root, 1)
		expect(point.node.textContent).toBe('a')
		expect(point.offset).toBe(1)
	})

	it('clamps an over-long offset to the end of the last block', () => {
		const root = mount('<p>hi</p>')
		const point = pointAt(root, 999)
		expect(point.node.textContent).toBe('hi')
		expect(point.offset).toBe(2)
	})

	it('returns the root itself when there are no blocks to place a caret in', () => {
		const root = mount('')
		const point = pointAt(root, 5)
		expect(point.node).toBe(root)
		expect(point.offset).toBe(0)
	})
})

describe('readOffsets', () => {
	it('reports the live selection as start/end offsets on the flat axis', () => {
		const root = mount('<p>hello</p><p>world</p>')
		const hello = root.children[0]?.firstChild as Node
		const world = root.children[1]?.firstChild as Node
		const range = document.createRange()
		range.setStart(hello, 1)
		range.setEnd(world, 4)
		const selection = document.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)
		expect(readOffsets(root)).toEqual({ start: 1, end: 10 })
	})

	it('returns null when nothing is selected so callers can bail out', () => {
		const root = mount('<p>hello</p>')
		document.getSelection()?.removeAllRanges()
		expect(readOffsets(root)).toBeNull()
	})

	it('returns null when the selection is outside the editor root', () => {
		const root = mount('<p>hello</p>')
		const outside = mount('<p>elsewhere</p>')
		const node = outside.children[0]?.firstChild as Node
		const range = document.createRange()
		range.setStart(node, 0)
		range.setEnd(node, 1)
		const selection = document.getSelection()
		selection?.removeAllRanges()
		selection?.addRange(range)
		expect(readOffsets(root)).toBeNull()
	})

	it('returns null when the environment exposes no selection at all', () => {
		const root = mount('<p>hello</p>')
		vi.spyOn(document, 'getSelection').mockReturnValue(null)
		expect(readOffsets(root)).toBeNull()
	})
})

describe('writeOffsets', () => {
	it('places a selection whose offsets read back to the values written', () => {
		const root = mount('<p>hello</p><p>world</p>')
		writeOffsets(root, 2, 8)
		expect(readOffsets(root)).toEqual({ start: 2, end: 8 })
	})

	it('round-trips a caret placed right after a trailing soft break', () => {
		// Regression: the caret after a trailing <br> used to collapse to offset 0.
		const root = mount('<p>text<br></p>')
		writeOffsets(root, 5, 5)
		expect(readOffsets(root)).toEqual({ start: 5, end: 5 })
	})
})
