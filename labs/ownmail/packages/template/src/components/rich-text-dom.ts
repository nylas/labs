/**
 * DOM ⇆ offset glue for the compose editor.
 *
 * These functions translate between the editor's rendered `contentEditable` DOM
 * and the flat character-offset axis that `rich-text-model` operates on. They
 * are deliberately kept free of `window.getSelection()` (except the two thin
 * wrappers at the bottom) so the mapping logic can be unit-tested by passing
 * explicit nodes rather than staging a live selection.
 *
 * The offset axis must match `docText()`: each block contributes its text
 * (a `<br>` counts as one `\n`), and a single boundary character separates
 * adjacent blocks. Crucially, the DOM is segmented into blocks the SAME way the
 * parser (`htmlToDoc`) segments it — block-level elements are their own blocks,
 * list items are individual blocks, and any run of loose inline/text nodes at
 * the top level forms one implicit paragraph. That last case is not academic:
 * browsers routinely leave a bare text node at the editable root (e.g. the first
 * character typed into an empty editor), and formatting must still map correctly.
 */

const BLOCK_LEVEL = new Set(['P', 'BLOCKQUOTE', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/** Segment the editor root into blocks, each a list of the top-level nodes it owns. */
export function docBlocks(root: HTMLElement): Node[][] {
	const blocks: Node[][] = []
	let pending: Node[] = []
	const flush = () => {
		if (pending.length > 0) blocks.push(pending)
		pending = []
	}
	for (const child of Array.from(root.childNodes)) {
		if (child.nodeType === 1) {
			const tag = (child as HTMLElement).tagName
			if (tag === 'UL' || tag === 'OL') {
				flush()
				for (const li of Array.from((child as HTMLElement).children)) blocks.push([li])
				continue
			}
			if (BLOCK_LEVEL.has(tag)) {
				flush()
				blocks.push([child])
				continue
			}
		}
		// Text nodes and stray inline elements coalesce into an implicit paragraph.
		pending.push(child)
	}
	flush()
	return blocks
}

/** Character length of a node: text length, one per `<br>`, recursive for elements. */
function lenOf(node: Node): number {
	if (node.nodeType === 3) return (node as CharacterData).data.length
	if (node.nodeType === 1 && (node as HTMLElement).tagName === 'BR') return 1
	let total = 0
	for (const child of Array.from(node.childNodes)) total += lenOf(child)
	return total
}

function nodesLen(nodes: Node[]): number {
	return nodes.reduce((total, node) => total + lenOf(node), 0)
}

/** Characters within a block's nodes that precede `(node, nodeOffset)`, or `null`. */
function measure(nodes: Node[], node: Node, nodeOffset: number): number | null {
	if (!nodes.some((candidate) => candidate.contains(node))) return null
	let count = 0
	let found = false
	const visit = (current: Node): void => {
		if (found) return
		if (current === node && current.nodeType === 1) {
			count += Array.from(current.childNodes)
				.slice(0, nodeOffset)
				.reduce((sum, child) => sum + lenOf(child), 0)
			found = true
			return
		}
		if (current.nodeType === 3) {
			if (current === node) {
				count += nodeOffset
				found = true
			} else {
				count += (current as CharacterData).data.length
			}
			return
		}
		if (current.nodeType === 1 && (current as HTMLElement).tagName === 'BR') {
			// A `<br>` that IS the anchor node is caught above (element branch); here
			// it is only ever a passed-over break contributing one character.
			count += 1
			return
		}
		for (const child of Array.from(current.childNodes)) visit(child)
	}
	for (const n of nodes) visit(n)
	return count
}

/** Map a DOM position to a global character offset. */
export function offsetOf(root: HTMLElement, node: Node, nodeOffset: number): number {
	let global = 0
	for (const block of docBlocks(root)) {
		const local = measure(block, node, nodeOffset)
		if (local !== null) return global + local
		global += nodesLen(block) + 1
	}
	return Math.max(0, global - 1)
}

/** Map a global character offset to a DOM position for placing a caret. */
export function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
	const blocks = docBlocks(root)
	let global = 0
	for (const block of blocks) {
		const len = nodesLen(block)
		if (offset <= global + len) return locateInNodes(block, offset - global)
		global += len + 1
	}
	const last = blocks[blocks.length - 1]
	if (!last) return { node: root, offset: 0 }
	return locateInNodes(last, nodesLen(last))
}

function locateInNodes(nodes: Node[], local: number): { node: Node; offset: number } {
	let seen = 0
	let result: { node: Node; offset: number } | null = null
	const visit = (current: Node): void => {
		if (result) return
		if (current.nodeType === 3) {
			const length = (current as CharacterData).data.length
			if (local <= seen + length) result = { node: current, offset: local - seen }
			else seen += length
			return
		}
		if (current.nodeType === 1 && (current as HTMLElement).tagName === 'BR') {
			if (local <= seen) {
				const parent = current.parentNode as Node
				result = { node: parent, offset: Array.from(parent.childNodes).indexOf(current as ChildNode) }
			} else seen += 1
			return
		}
		for (const child of Array.from(current.childNodes)) visit(child)
	}
	for (const node of nodes) visit(node)
	// The caret is at or past the end of the block's content (e.g. right after a
	// trailing `<br>` from Shift+Enter, or an empty block). Anchor at the end, not
	// the start, so the next character lands on the new line rather than the top.
	return result ?? endOfNodes(nodes)
}

/** The DOM position at the very end of a block's content. */
function endOfNodes(nodes: Node[]): { node: Node; offset: number } {
	const last = nodes[nodes.length - 1] as Node
	// A block-level container (e.g. <p>, <li>) holds the caret at the end of its
	// children — that sits after a trailing <br>. A bare text/<br> at the root has
	// no such container, so anchor just after it in its parent.
	if (last.nodeType === 1 && (last as HTMLElement).tagName !== 'BR') {
		return { node: last, offset: last.childNodes.length }
	}
	const parent = last.parentNode as Node
	return { node: parent, offset: Array.from(parent.childNodes).indexOf(last as ChildNode) + 1 }
}

// ---- live-selection wrappers -------------------------------------------------

/** Read the current selection as global offsets, or `null` if it is elsewhere. */
export function readOffsets(root: HTMLElement): { start: number; end: number } | null {
	const selection = root.ownerDocument.getSelection()
	if (!selection || selection.rangeCount === 0) return null
	const range = selection.getRangeAt(0)
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
	return {
		start: offsetOf(root, range.startContainer, range.startOffset),
		end: offsetOf(root, range.endContainer, range.endOffset),
	}
}

/** Place the selection at the given global offsets. */
export function writeOffsets(root: HTMLElement, start: number, end: number): void {
	const selection = root.ownerDocument.getSelection()
	/* v8 ignore next -- guards a headless environment with selection disabled; jsdom always returns a Selection */
	if (!selection) return
	const from = pointAt(root, start)
	const to = pointAt(root, end)
	const range = root.ownerDocument.createRange()
	range.setStart(from.node, from.offset)
	range.setEnd(to.node, to.offset)
	selection.removeAllRanges()
	selection.addRange(range)
}
