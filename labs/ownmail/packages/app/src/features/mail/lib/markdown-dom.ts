/**
 * DOM ⇆ line/offset glue for the markdown editor.
 *
 * `docHtml` renders exactly one top-level element per source line, so a line's
 * index is its child index under the editor root. Positions are expressed as
 * `{ line, offset }` where `offset` counts the element's *visible* text
 * characters — for a raw (active) line that equals the source column, for a
 * rendered line the component translates it through the line's source map.
 *
 * Kept free of component state so the mapping logic is unit-testable with
 * plain DOM fixtures.
 */

export interface LinePoint {
	line: number
	/** Character offset into the line element's visible text. */
	offset: number
}

export interface LineRange {
	start: LinePoint
	end: LinePoint
}

/** Visible text characters inside `node`, counted over its text descendants. */
function textLength(node: Node): number {
	if (node.nodeType === 3) return (node as CharacterData).data.length
	let total = 0
	for (const child of Array.from(node.childNodes)) total += textLength(child)
	return total
}

/** Visible text characters inside `container` that precede `(node, nodeOffset)`. */
function textBefore(container: Node, node: Node, nodeOffset: number): number {
	let count = 0
	let found = false
	const visit = (current: Node): void => {
		if (found) return
		if (current === node) {
			if (current.nodeType === 3) {
				count += nodeOffset
			} else {
				for (const child of Array.from(current.childNodes).slice(0, nodeOffset)) {
					count += textLength(child)
				}
			}
			found = true
			return
		}
		if (current.nodeType === 3) {
			count += (current as CharacterData).data.length
			return
		}
		for (const child of Array.from(current.childNodes)) visit(child)
	}
	visit(container)
	return count
}

/** Map a DOM position to a line point. `null` when the node is not in a line. */
export function linePointOf(root: HTMLElement, node: Node, nodeOffset: number): LinePoint | null {
	const children = Array.from(root.children)
	if (node === root) {
		// Anchors on the root itself index whole lines (e.g. select-all).
		if (nodeOffset >= children.length) {
			const last = children.length - 1
			return { line: last, offset: textLength(children[last] as Element) }
		}
		return { line: nodeOffset, offset: 0 }
	}
	let top: Node = node
	while (top.parentNode && top.parentNode !== root) top = top.parentNode
	const line = children.indexOf(top as Element)
	if (line === -1) return null
	return { line, offset: textBefore(top, node, nodeOffset) }
}

/** Read the current selection as line points, or `null` if it is elsewhere. */
export function readLineRange(root: HTMLElement): LineRange | null {
	const selection = root.ownerDocument.getSelection()
	if (!selection || selection.rangeCount === 0) return null
	const range = selection.getRangeAt(0)
	const start = linePointOf(root, range.startContainer, range.startOffset)
	const end = linePointOf(root, range.endContainer, range.endOffset)
	return start && end ? { start, end } : null
}

/**
 * Resolve a line point to a concrete DOM position for placing a caret. Only
 * raw (active) lines are ever targeted; their text nodes (plain runs and
 * syntax-highlight spans) concatenate to exactly the source line, so walking
 * them in order lands on the right node. An empty line holds only the filler
 * `<br>`, so the caret anchors on the element itself.
 */
function resolvePoint(root: HTMLElement, point: LinePoint): { node: Node; offset: number } {
	const element = root.children.item(point.line) as Element
	const walker = root.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
	let remaining = point.offset
	let text = walker.nextNode()
	while (text) {
		const length = (text as CharacterData).data.length
		if (remaining <= length) return { node: text, offset: remaining }
		remaining -= length
		text = walker.nextNode()
	}
	return { node: element, offset: 0 }
}

/** Place the selection at the given line points. */
export function writeLineRange(root: HTMLElement, start: LinePoint, end: LinePoint): void {
	const selection = root.ownerDocument.getSelection()
	/* v8 ignore next -- guards a headless environment with selection disabled; jsdom always returns a Selection -- @preserve */
	if (!selection) return
	const from = resolvePoint(root, start)
	const to = resolvePoint(root, end)
	const range = root.ownerDocument.createRange()
	range.setStart(from.node, from.offset)
	range.setEnd(to.node, to.offset)
	selection.removeAllRanges()
	selection.addRange(range)
}
