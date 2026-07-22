// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownToDraftBody } from '../lib/html-to-markdown.js'
import { writeLineRange } from '../lib/markdown-dom.js'
import { MarkdownEditor } from './MarkdownEditor.js'

// The editor keeps the browser in charge of plain typing inside the raw
// (active) lines and routes every structural command through the pure model.
// These tests drive it the way a user would — placing real selections, then
// keying/pasting/clicking — and assert on the live-preview DOM (raw vs
// rendered lines) and the markdown source reported through onChange.

afterEach(cleanup)
beforeEach(() => {
	document.getSelection()?.removeAllRanges()
})

/** A controlled harness mirroring how the composer wires the editor. */
function setup(initial = '') {
	const onChange = vi.fn()
	function Harness() {
		const [value, setValue] = useState(initial)
		return (
			<MarkdownEditor
				value={value}
				onChange={(markdown) => {
					onChange(markdown)
					setValue(markdown)
				}}
			/>
		)
	}
	const utils = render(<Harness />)
	const editor = utils.container.querySelector('[role="textbox"]') as HTMLElement
	return { ...utils, editor, onChange }
}

/** Place a DOM range between two positions and notify the editor. */
function selectNodes(
	startNode: Node,
	startOffset: number,
	endNode: Node = startNode,
	endOffset = startOffset,
) {
	act(() => {
		const range = document.createRange()
		range.setStart(startNode, startOffset)
		range.setEnd(endNode, endOffset)
		const selection = document.getSelection() as Selection
		selection.removeAllRanges()
		selection.addRange(range)
		document.dispatchEvent(new Event('selectionchange'))
	})
}

/** Select line/offset points (raw lines only) and notify the editor. */
function selectLines(editor: HTMLElement, line: number, offset: number, endLine = line, endOffset = offset) {
	act(() => {
		writeLineRange(editor, { line, offset }, { line: endLine, offset: endOffset })
		document.dispatchEvent(new Event('selectionchange'))
	})
}

function lineEl(editor: HTMLElement, index: number): HTMLElement {
	return editor.children[index] as HTMLElement
}

function textNode(editor: HTMLElement, index: number): Node {
	return lineEl(editor, index).firstChild as Node
}

function lastMarkdown(onChange: ReturnType<typeof vi.fn>): string {
	return onChange.mock.calls.at(-1)?.[0] as string
}

describe('MarkdownEditor rendering', () => {
	it('shows the placeholder only while the document is empty', () => {
		const { editor, onChange } = setup()
		expect(screen.getByText('Write your message...')).toBeInTheDocument()
		selectLines(editor, 0, 0)
		act(() => {
			lineEl(editor, 0).textContent = 'hi'
			fireEvent.input(editor)
		})
		expect(lastMarkdown(onChange)).toBe('hi')
		expect(screen.queryByText('Write your message...')).not.toBeInTheDocument()
	})

	it('exposes an accessible multiline textbox with no toolbar', () => {
		setup()
		expect(screen.getByRole('textbox')).toHaveAttribute('aria-multiline', 'true')
		expect(screen.queryByRole('button')).not.toBeInTheDocument()
	})

	it('seeds markdown as a fully rendered preview', () => {
		const { editor } = setup('# Hi\n**bold** x')
		expect(editor.innerHTML).toBe('<h1>Hi</h1><p><strong>bold</strong> x</p>')
	})

	it('converts a legacy HTML draft seed to markdown and reports it upward', () => {
		const { editor, onChange } = setup('<p><strong>hi</strong> there</p>')
		expect(lastMarkdown(onChange)).toBe('**hi** there')
		expect(editor.innerHTML).toBe('<p><strong>hi</strong> there</p>')
	})

	it('restores an enveloped markdown draft exactly, keeping literal tag text', () => {
		const { editor, onChange } = setup(markdownToDraftBody('use <br> here **now**'))
		expect(lastMarkdown(onChange)).toBe('use <br> here **now**')
		expect(editor.innerHTML).toBe('<p>use &lt;br&gt; here <strong>now</strong></p>')
	})

	it('re-seeds when the parent supplies a brand new value', () => {
		const onChange = vi.fn()
		const { container, rerender } = render(<MarkdownEditor value="a" onChange={onChange} />)
		const editor = container.querySelector('[role="textbox"]') as HTMLElement
		expect(editor.innerHTML).toBe('<p>a</p>')
		rerender(<MarkdownEditor value={'x\ny'} onChange={onChange} />)
		expect(editor.innerHTML).toBe('<p>x</p><p>y</p>')
		// The value was already canonical markdown both times: nothing to report.
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('MarkdownEditor live preview activation', () => {
	it('reveals raw markdown for the clicked line and maps the caret through hidden syntax', () => {
		const { editor } = setup('**hi** x\nplain')
		// Click inside the rendered <strong> between "h" and "i".
		selectNodes((editor.querySelector('strong') as HTMLElement).firstChild as Node, 1)
		expect(lineEl(editor, 0).className).toBe('md-raw')
		expect(lineEl(editor, 0).textContent).toBe('**hi** x')
		// The raw line keeps its formatting: markers dimmed, content still bold.
		expect(lineEl(editor, 0).innerHTML).toBe(
			'<strong><span class="md-syn">**</span>hi<span class="md-syn">**</span></strong> x',
		)
		expect(lineEl(editor, 1).outerHTML).toBe('<p>plain</p>')
		// Source column 3 sits between "h" and "i" inside the styled raw line.
		const selection = document.getSelection() as Selection
		expect(selection.anchorNode?.textContent).toBe('hi')
		expect(selection.anchorOffset).toBe(1)
	})

	it('does not re-render while the caret moves within the active line', () => {
		const { editor } = setup('abc')
		selectNodes(textNode(editor, 0), 1)
		const activeLine = lineEl(editor, 0)
		selectLines(editor, 0, 2)
		expect(lineEl(editor, 0)).toBe(activeLine)
	})

	it('ignores selections that live outside the editor', () => {
		const { editor } = setup('abc')
		const stray = document.createElement('p')
		stray.textContent = 'x'
		document.body.appendChild(stray)
		selectNodes(stray.firstChild as Node, 0)
		expect(lineEl(editor, 0).outerHTML).toBe('<p>abc</p>')
		stray.remove()
	})

	it('extending the selection into a rendered line maps its end through the syntax', () => {
		const { editor } = setup('ab\n**cd**')
		selectNodes(textNode(editor, 0), 1)
		// Extend from the raw first line into the still-rendered bold line.
		selectNodes(textNode(editor, 0), 1, (editor.querySelector('strong') as HTMLElement).firstChild as Node, 1)
		expect(lineEl(editor, 0).className).toBe('md-raw')
		expect(lineEl(editor, 1).className).toBe('md-raw')
		// Rendered offset 1 (between c and d) maps to source column 3 of '**cd**',
		// which lands between "c" and "d" in the styled raw line.
		const selection = document.getSelection() as Selection
		expect(selection.focusNode?.textContent).toBe('cd')
		expect(selection.focusOffset).toBe(1)
	})

	it('activates every line on select-all anchored at the root', () => {
		const { editor } = setup('**a**\nb')
		selectNodes(editor, 0, editor, 2)
		expect(lineEl(editor, 0).className).toBe('md-raw')
		expect(lineEl(editor, 1).className).toBe('md-raw')
	})

	it('renders everything pretty again on blur', () => {
		const { editor } = setup('**a**')
		selectNodes((editor.querySelector('strong') as HTMLElement).firstChild as Node, 0)
		expect(lineEl(editor, 0).className).toBe('md-raw')
		fireEvent.blur(editor)
		expect(editor.innerHTML).toBe('<p><strong>a</strong></p>')
	})

	it('defers activation while a mouse selection drag is in flight', () => {
		const { editor } = setup('**a**')
		fireEvent.mouseDown(editor)
		selectNodes((editor.querySelector('strong') as HTMLElement).firstChild as Node, 0)
		expect(lineEl(editor, 0).outerHTML).toBe('<p><strong>a</strong></p>')
		act(() => {
			fireEvent.mouseUp(document)
		})
		expect(lineEl(editor, 0).className).toBe('md-raw')
	})

	it('beforeinput activates the caret line when selectionchange has not fired yet', () => {
		const { editor, onChange } = setup('**a**')
		// Place the caret WITHOUT dispatching selectionchange: browsers deliver it
		// asynchronously, so the first keystroke can beat it.
		const range = document.createRange()
		range.setStart((editor.querySelector('strong') as HTMLElement).firstChild as Node, 1)
		range.collapse(true)
		const selection = document.getSelection() as Selection
		selection.removeAllRanges()
		selection.addRange(range)
		act(() => {
			editor.dispatchEvent(new Event('beforeinput', { bubbles: true }))
		})
		expect(lineEl(editor, 0).className).toBe('md-raw')
		// The browser applies the keystroke to the now-raw line; input re-reads it.
		act(() => {
			lineEl(editor, 0).textContent = '**ab**'
			fireEvent.input(editor)
		})
		expect(lastMarkdown(onChange)).toBe('**ab**')
	})

	it('beforeinput leaves an already-active line alone', () => {
		const { editor } = setup('abc')
		selectNodes(textNode(editor, 0), 1)
		const activeLine = lineEl(editor, 0)
		act(() => {
			editor.dispatchEvent(new Event('beforeinput', { bubbles: true }))
		})
		expect(lineEl(editor, 0)).toBe(activeLine)
	})

	it('beforeinput with no selection is a no-op', () => {
		const { editor } = setup('**a**')
		act(() => {
			editor.dispatchEvent(new Event('beforeinput', { bubbles: true }))
		})
		expect(lineEl(editor, 0).outerHTML).toBe('<p><strong>a</strong></p>')
	})

	it('a mouseup with nothing pending changes nothing', () => {
		const { editor } = setup('**a**')
		act(() => {
			fireEvent.mouseUp(document)
		})
		expect(lineEl(editor, 0).outerHTML).toBe('<p><strong>a</strong></p>')
	})
})

describe('MarkdownEditor typing', () => {
	it('re-reads the active lines on input and normalises no-break spaces', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		act(() => {
			lineEl(editor, 0).textContent = '- ab '
			fireEvent.input(editor)
		})
		expect(lastMarkdown(onChange)).toBe('- ab ')
	})

	it('ignores input events when no line is active', () => {
		const { editor, onChange } = setup('ab')
		fireEvent.input(editor)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('live-highlights the active line as the keystroke lands', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		act(() => {
			lineEl(editor, 0).textContent = '# ab'
			writeLineRange(editor, { line: 0, offset: 4 }, { line: 0, offset: 4 })
			fireEvent.input(editor)
		})
		expect(lastMarkdown(onChange)).toBe('# ab')
		// The raw line immediately picks up heading styling and a dimmed marker.
		expect(lineEl(editor, 0).outerHTML).toBe('<h1 class="md-raw"><span class="md-syn"># </span>ab</h1>')
		const selection = document.getSelection() as Selection
		expect(selection.anchorNode?.textContent).toBe('ab')
		expect(selection.anchorOffset).toBe(2)
	})

	it('skips the re-highlight when the selection cannot be read back', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		act(() => {
			lineEl(editor, 0).textContent = '# ab'
			document.getSelection()?.removeAllRanges()
			fireEvent.input(editor)
		})
		expect(lastMarkdown(onChange)).toBe('# ab')
		expect(lineEl(editor, 0).outerHTML).toBe('<p class="md-raw"># ab</p>')
	})

	it('defers the re-highlight during IME composition and applies it at the end', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		fireEvent.compositionStart(editor)
		act(() => {
			lineEl(editor, 0).textContent = '**ab**'
			writeLineRange(editor, { line: 0, offset: 6 }, { line: 0, offset: 6 })
			fireEvent.input(editor)
		})
		// Mid-composition the DOM is left alone (no md-syn spans yet).
		expect(lineEl(editor, 0).innerHTML).toBe('**ab**')
		expect(lastMarkdown(onChange)).toBe('**ab**')
		act(() => {
			fireEvent.compositionEnd(editor)
		})
		expect(lineEl(editor, 0).innerHTML).toBe(
			'<strong><span class="md-syn">**</span>ab<span class="md-syn">**</span></strong>',
		)
	})
})

describe('MarkdownEditor structural keys', () => {
	it('Enter splits the line and moves the caret to the new raw line', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		fireEvent.keyDown(editor, { key: 'Enter' })
		expect(lastMarkdown(onChange)).toBe('a\nb')
		expect(lineEl(editor, 0).outerHTML).toBe('<p>a</p>')
		expect(lineEl(editor, 1).className).toBe('md-raw')
		const selection = document.getSelection() as Selection
		expect(selection.anchorNode).toBe(textNode(editor, 1))
		expect(selection.anchorOffset).toBe(0)
	})

	it('Enter replaces a selection that spans lines', () => {
		const { editor, onChange } = setup('ab\ncd')
		selectNodes(textNode(editor, 0), 1, textNode(editor, 1), 1)
		fireEvent.keyDown(editor, { key: 'Enter' })
		expect(lastMarkdown(onChange)).toBe('a\nd')
	})

	it('Backspace at the start of a line merges it into the previous one', () => {
		const { editor, onChange } = setup('ab\ncd')
		selectNodes(textNode(editor, 1), 0)
		fireEvent.keyDown(editor, { key: 'Backspace' })
		expect(lastMarkdown(onChange)).toBe('abcd')
	})

	it('leaves Backspace to the browser mid-line and at the very start', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		expect(fireEvent.keyDown(editor, { key: 'Backspace' })).toBe(true)
		selectLines(editor, 0, 0)
		expect(fireEvent.keyDown(editor, { key: 'Backspace' })).toBe(true)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('Delete at the end of a line merges the next one in', () => {
		const { editor, onChange } = setup('ab\ncd')
		selectNodes(textNode(editor, 0), 2)
		fireEvent.keyDown(editor, { key: 'Delete' })
		expect(lastMarkdown(onChange)).toBe('abcd')
	})

	it('leaves Delete to the browser mid-line and at the end of the document', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		expect(fireEvent.keyDown(editor, { key: 'Delete' })).toBe(true)
		selectLines(editor, 0, 2)
		expect(fireEvent.keyDown(editor, { key: 'Delete' })).toBe(true)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('Backspace and Delete over a selection that spans lines edit through the model', () => {
		const first = setup('ab\ncd')
		selectNodes(textNode(first.editor, 0), 1, textNode(first.editor, 1), 1)
		fireEvent.keyDown(first.editor, { key: 'Backspace' })
		expect(lastMarkdown(first.onChange)).toBe('ad')
		cleanup()
		const second = setup('ab\ncd')
		selectNodes(textNode(second.editor, 0), 1, textNode(second.editor, 1), 1)
		fireEvent.keyDown(second.editor, { key: 'Delete' })
		expect(lastMarkdown(second.onChange)).toBe('ad')
	})

	it('typing over a selection that spans lines edits through the model', () => {
		const { editor, onChange } = setup('ab\ncd')
		selectNodes(textNode(editor, 0), 1, textNode(editor, 1), 1)
		fireEvent.keyDown(editor, { key: 'x' })
		expect(lastMarkdown(onChange)).toBe('axd')
	})

	it('lets a within-line selection replacement fall through to the browser', () => {
		const { editor, onChange } = setup('abc')
		selectNodes(textNode(editor, 0), 0, textNode(editor, 0), 2)
		expect(fireEvent.keyDown(editor, { key: 'x' })).toBe(true)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('ignores navigation keys', () => {
		const { editor, onChange } = setup('ab')
		expect(fireEvent.keyDown(editor, { key: 'ArrowLeft' })).toBe(true)
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('MarkdownEditor shortcuts', () => {
	it('⌘B wraps the selection in ** markers', () => {
		const { editor, onChange } = setup('hi x')
		selectNodes(textNode(editor, 0), 0, textNode(editor, 0), 2)
		fireEvent.keyDown(editor, { key: 'b', metaKey: true })
		expect(lastMarkdown(onChange)).toBe('**hi** x')
		expect(lineEl(editor, 0).textContent).toBe('**hi** x')
	})

	it('⌘I wraps in * and Ctrl works as the modifier too', () => {
		const { editor, onChange } = setup('hi')
		selectNodes(textNode(editor, 0), 0, textNode(editor, 0), 2)
		fireEvent.keyDown(editor, { key: 'i', ctrlKey: true })
		expect(lastMarkdown(onChange)).toBe('*hi*')
	})

	it('⌘K wraps the selection as a link and parks the caret in the url slot', () => {
		const { editor, onChange } = setup('hi x')
		selectNodes(textNode(editor, 0), 0, textNode(editor, 0), 2)
		fireEvent.keyDown(editor, { key: 'k', metaKey: true })
		expect(lastMarkdown(onChange)).toBe('[hi]() x')
		expect((document.getSelection() as Selection).anchorOffset).toBe(5)
	})

	it('⌘U is consumed but does nothing (markdown has no underline)', () => {
		const { editor, onChange } = setup('hi')
		selectNodes(textNode(editor, 0), 0, textNode(editor, 0), 2)
		expect(fireEvent.keyDown(editor, { key: 'u', metaKey: true })).toBe(false)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('does nothing when a shortcut fires with no selection present', () => {
		const { editor, onChange } = setup('hi')
		expect(fireEvent.keyDown(editor, { key: 'b', metaKey: true })).toBe(false)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('passes other modifier combos through to the browser', () => {
		const { editor, onChange } = setup('hi')
		expect(fireEvent.keyDown(editor, { key: 'a', metaKey: true })).toBe(true)
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('MarkdownEditor clipboard', () => {
	it('pastes plain text through the model, normalising newlines', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		fireEvent.paste(editor, { clipboardData: { getData: () => 'x\r\ny\rz' } })
		expect(lastMarkdown(onChange)).toBe('ax\ny\nzb')
		expect(editor.children).toHaveLength(3)
	})

	it('ignores pastes with no plain text payload', () => {
		const { editor, onChange } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		fireEvent.paste(editor, { clipboardData: { getData: () => '' } })
		expect(onChange).not.toHaveBeenCalled()
	})

	it('copies the markdown source of the selection', () => {
		const { editor } = setup('**a**\nb')
		selectNodes(editor, 0, editor, 2)
		const setData = vi.fn()
		fireEvent.copy(editor, { clipboardData: { setData } })
		expect(setData).toHaveBeenCalledWith('text/plain', '**a**\nb')
	})

	it('does not intercept a copy with a collapsed selection', () => {
		const { editor } = setup('ab')
		selectNodes(textNode(editor, 0), 1)
		const setData = vi.fn()
		fireEvent.copy(editor, { clipboardData: { setData } })
		expect(setData).not.toHaveBeenCalled()
	})

	it('cut hands out the source and deletes it through the model', () => {
		const { editor, onChange } = setup('**a**\nb')
		selectNodes(editor, 0, editor, 2)
		const setData = vi.fn()
		fireEvent.cut(editor, { clipboardData: { setData } })
		expect(setData).toHaveBeenCalledWith('text/plain', '**a**\nb')
		expect(lastMarkdown(onChange)).toBe('')
		expect(editor.innerHTML).toBe('<p class="md-raw"><br></p>')
	})
})
