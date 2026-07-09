// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RichTextEditor } from './RichTextEditor.js'
import { writeOffsets } from './rich-text-dom.js'

// The editor keeps the browser in charge of plain typing and routes every
// formatting/structural command through the pure model, re-rendering canonical
// HTML and restoring the caret by offset. These tests drive it the way a user
// would — placing a real selection, then clicking/keying/pasting — and assert on
// both the rendered DOM and the canonical HTML reported through onChange.

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
			<RichTextEditor
				value={value}
				onChange={(html) => {
					onChange(html)
					setValue(html)
				}}
			/>
		)
	}
	const utils = render(<Harness />)
	const editor = utils.container.querySelector('[role="textbox"]') as HTMLElement
	return { ...utils, editor, onChange }
}

/** Select global offsets [start, end) and notify the editor, as a mouse would. */
function select(editor: HTMLElement, start: number, end = start) {
	act(() => {
		writeOffsets(editor, start, end)
		document.dispatchEvent(new Event('selectionchange'))
	})
}

function lastHtml(onChange: ReturnType<typeof vi.fn>): string {
	return onChange.mock.calls.at(-1)?.[0] as string
}

describe('RichTextEditor rendering', () => {
	it('shows the placeholder only while the document is empty', () => {
		const { editor } = setup()
		expect(screen.getByText('Write your message...')).toBeInTheDocument()
		act(() => {
			editor.innerHTML = '<p>hi</p>'
			select(editor, 2)
			fireEvent.input(editor)
		})
		expect(screen.queryByText('Write your message...')).not.toBeInTheDocument()
	})

	it('exposes an accessible multiline textbox and a formatting toolbar', () => {
		setup()
		expect(screen.getByRole('textbox')).toHaveAttribute('aria-multiline', 'true')
		for (const label of ['Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list', 'Quote', 'Link']) {
			expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
		}
	})
})

describe('RichTextEditor inline marks', () => {
	it('wraps the selection in <strong> when Bold is clicked', () => {
		const { editor, onChange } = setup('<p>hello world</p>')
		select(editor, 0, 5)
		// mousedown is suppressed so the click never steals the editor's selection.
		const bold = screen.getByRole('button', { name: 'Bold' })
		fireEvent.mouseDown(bold)
		fireEvent.click(bold)
		expect(editor.querySelector('strong')?.textContent).toBe('hello')
		expect(lastHtml(onChange)).toBe('<p><strong>hello</strong> world</p>')
	})

	it('applies italic and underline through their toolbar buttons', () => {
		const { editor } = setup('<p>abcd</p>')
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Italic' }))
		expect(editor.querySelector('em')?.textContent).toBe('abcd')
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Underline' }))
		expect(editor.querySelector('u')).not.toBeNull()
	})

	it('toggles bold with the ⌘B keyboard shortcut', () => {
		const { editor, onChange } = setup('<p>hello</p>')
		select(editor, 0, 5)
		fireEvent.keyDown(editor, { key: 'b', metaKey: true })
		expect(lastHtml(onChange)).toBe('<p><strong>hello</strong></p>')
	})

	it('italic/underline keyboard shortcuts fire too', () => {
		const { editor, onChange } = setup('<p>hi</p>')
		select(editor, 0, 2)
		fireEvent.keyDown(editor, { key: 'i', ctrlKey: true })
		expect(lastHtml(onChange)).toContain('<em>')
		select(editor, 0, 2)
		fireEvent.keyDown(editor, { key: 'u', ctrlKey: true })
		expect(lastHtml(onChange)).toContain('<u>')
	})

	it('reflects the active mark on the toolbar as the caret moves', () => {
		const { editor } = setup('<p><strong>bold</strong> plain</p>')
		select(editor, 1, 3)
		expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
		select(editor, 7, 9)
		expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false')
	})

	it('does nothing when a mark command runs with no selection present', () => {
		const { onChange } = setup('<p>hello</p>')
		document.getSelection()?.removeAllRanges()
		onChange.mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('RichTextEditor block formatting', () => {
	it('turns the selected line into a bulleted list and back to a paragraph', () => {
		const { editor } = setup('<p>item</p>')
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
		expect(editor.querySelector('ul li')?.textContent).toBe('item')
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
		expect(editor.querySelector('ul')).toBeNull()
		expect(editor.querySelector('p')?.textContent).toBe('item')
	})

	it('does nothing when a block command runs with no selection present', () => {
		const { onChange } = setup('<p>hi</p>')
		document.getSelection()?.removeAllRanges()
		onChange.mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Quote' }))
		expect(onChange).not.toHaveBeenCalled()
	})

	it('supports numbered lists and block quotes', () => {
		const { editor } = setup('<p>line</p>')
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }))
		expect(editor.querySelector('ol li')).not.toBeNull()
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Quote' }))
		expect(editor.querySelector('blockquote')).not.toBeNull()
	})
})

describe('RichTextEditor structural keys', () => {
	it('splits a paragraph at the caret on Enter', () => {
		const { editor } = setup('<p>abcd</p>')
		select(editor, 2)
		fireEvent.keyDown(editor, { key: 'Enter' })
		expect(editor.querySelectorAll('p')).toHaveLength(2)
		expect(editor.querySelectorAll('p')[0]?.textContent).toBe('ab')
		expect(editor.querySelectorAll('p')[1]?.textContent).toBe('cd')
	})

	it('inserts a soft break within the block on Shift+Enter', () => {
		const { editor, onChange } = setup('<p>abcd</p>')
		select(editor, 2)
		fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
		expect(editor.querySelectorAll('p')).toHaveLength(1)
		expect(lastHtml(onChange)).toBe('<p>ab<br>cd</p>')
	})

	it('replaces a selection with the split when Enter is pressed over a range', () => {
		const { editor } = setup('<p>abcd</p>')
		select(editor, 1, 3)
		fireEvent.keyDown(editor, { key: 'Enter' })
		expect(editor.querySelectorAll('p')).toHaveLength(2)
		expect(editor.querySelectorAll('p')[0]?.textContent).toBe('a')
		expect(editor.querySelectorAll('p')[1]?.textContent).toBe('d')
	})

	it('outdents a list item to a paragraph when Backspace is pressed at its start', () => {
		const { editor } = setup('<ul><li>item</li></ul>')
		select(editor, 0)
		fireEvent.keyDown(editor, { key: 'Backspace' })
		expect(editor.querySelector('ul')).toBeNull()
		expect(editor.querySelector('p')?.textContent).toBe('item')
	})

	it('leaves Backspace to the browser when the caret is mid-paragraph', () => {
		const { editor, onChange } = setup('<p>abc</p>')
		select(editor, 2)
		onChange.mockClear()
		fireEvent.keyDown(editor, { key: 'Backspace' })
		// No model command runs, so nothing is committed (native deletion handles it).
		expect(onChange).not.toHaveBeenCalled()
		expect(editor.querySelector('p')?.textContent).toBe('abc')
	})

	it('ignores modifier chords and bare keys it does not own', () => {
		const { editor, onChange } = setup('<p>abc</p>')
		select(editor, 0, 3)
		onChange.mockClear()
		fireEvent.keyDown(editor, { key: 'b', metaKey: true, shiftKey: true })
		fireEvent.keyDown(editor, { key: 'b', metaKey: true, altKey: true })
		fireEvent.keyDown(editor, { key: 'x' })
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('RichTextEditor markdown shortcuts', () => {
	function typeMarker(marker: string) {
		const { editor, onChange } = setup(`<p>${marker}</p>`)
		select(editor, marker.length)
		fireEvent.input(editor)
		return { editor, onChange }
	}

	it('converts a leading "- " into a bulleted list', () => {
		const { editor } = typeMarker('- ')
		expect(editor.querySelector('ul li')).not.toBeNull()
	})

	it('converts "1. " into a numbered list and "> " into a quote', () => {
		expect(typeMarker('1. ').editor.querySelector('ol li')).not.toBeNull()
		expect(typeMarker('> ').editor.querySelector('blockquote')).not.toBeNull()
	})

	it('emits canonical HTML on ordinary input without a shortcut', () => {
		const { editor, onChange } = setup('<p>hello</p>')
		act(() => {
			editor.innerHTML = '<p>hello!</p>'
			select(editor, 6)
			fireEvent.input(editor)
		})
		expect(lastHtml(onChange)).toBe('<p>hello!</p>')
	})

	it('skips the shortcut scan when the input happens over a selection range', () => {
		const { editor, onChange } = setup('<p>- x</p>')
		act(() => {
			select(editor, 0, 3)
			fireEvent.input(editor)
		})
		// A ranged caret means "- " is not a line-leading marker to consume.
		expect(editor.querySelector('ul')).toBeNull()
		expect(lastHtml(onChange)).toBe('<p>- x</p>')
	})
})

describe('RichTextEditor paste', () => {
	it('inserts pasted plain text at the caret', () => {
		const { editor, onChange } = setup('<p>ac</p>')
		select(editor, 1)
		fireEvent.paste(editor, { clipboardData: { getData: () => 'b' } })
		expect(lastHtml(onChange)).toBe('<p>abc</p>')
	})

	it('ignores an empty paste', () => {
		const { editor, onChange } = setup('<p>ac</p>')
		select(editor, 1)
		onChange.mockClear()
		fireEvent.paste(editor, { clipboardData: { getData: () => '' } })
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('RichTextEditor links', () => {
	it('opens the link editor for a selection and applies a URL', () => {
		const { editor, onChange } = setup('<p>click here</p>')
		select(editor, 0, 5)
		fireEvent.click(screen.getByRole('button', { name: 'Link' }))
		const input = screen.getByLabelText('Link URL')
		fireEvent.change(input, { target: { value: 'https://example.com' } })
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
		expect(editor.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
		expect(lastHtml(onChange)).toContain('<a href="https://example.com">click</a>')
	})

	it('removes a link when the URL is cleared to empty', () => {
		const { editor } = setup('<p><a href="https://x.com">link</a></p>')
		select(editor, 0, 4)
		fireEvent.click(screen.getByRole('button', { name: 'Link' }))
		// A pre-existing href is prefilled; clearing it turns the button into "Remove".
		fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: '' } })
		fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
		expect(editor.querySelector('a')).toBeNull()
	})

	it('applies the link on Enter and cancels on Escape', () => {
		const { editor } = setup('<p>word here</p>')
		select(editor, 0, 4)
		fireEvent.keyDown(editor, { key: 'k', metaKey: true })
		const input = screen.getByLabelText('Link URL')
		fireEvent.change(input, { target: { value: 'https://a.com' } })
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(editor.querySelector('a')).not.toBeNull()

		select(editor, 5, 8)
		fireEvent.keyDown(editor, { key: 'k', metaKey: true })
		const reopened = screen.getByLabelText('Link URL')
		fireEvent.keyDown(reopened, { key: 'Escape' })
		expect(screen.queryByLabelText('Link URL')).not.toBeInTheDocument()
	})

	it('does not open the link editor without a text selection', () => {
		const { editor } = setup('<p>word</p>')
		select(editor, 2)
		fireEvent.click(screen.getByRole('button', { name: 'Link' }))
		expect(screen.queryByLabelText('Link URL')).not.toBeInTheDocument()
	})
})

describe('RichTextEditor value synchronisation', () => {
	it('normalises a plain-text seed to canonical HTML and reports it upward', () => {
		const onChange = vi.fn()
		render(<RichTextEditor value="hello" onChange={onChange} />)
		expect(onChange).toHaveBeenCalledWith('<p>hello</p>')
	})

	it('re-seeds the editor when the parent supplies a different value', () => {
		const onChange = vi.fn()
		const { rerender, container } = render(<RichTextEditor value="<p>one</p>" onChange={onChange} />)
		const editor = container.querySelector('[role="textbox"]') as HTMLElement
		expect(editor.textContent).toBe('one')
		rerender(<RichTextEditor value="<p>two</p>" onChange={onChange} />)
		expect(editor.textContent).toBe('two')
	})

	it('does not re-seed (or clobber the caret) when the value matches its own output', () => {
		const onChange = vi.fn()
		const { rerender, container } = render(<RichTextEditor value="<p>same</p>" onChange={onChange} />)
		const editor = container.querySelector('[role="textbox"]') as HTMLElement
		const before = editor.firstChild
		rerender(<RichTextEditor value="<p>same</p>" onChange={onChange} />)
		expect(editor.firstChild).toBe(before)
	})
})

describe('RichTextEditor selection tracking', () => {
	it('refreshing the toolbar with no live selection is a harmless no-op', () => {
		const { editor } = setup('<p>hi</p>')
		document.getSelection()?.removeAllRanges()
		fireEvent.keyUp(editor)
		expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false')
	})

	it('ignores selectionchange events that land outside the editor', () => {
		const { editor } = setup('<p><strong>bold</strong></p>')
		select(editor, 1, 3)
		expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
		// Move the selection into an unrelated element; the toolbar must not update.
		const outside = document.createElement('p')
		outside.textContent = 'other'
		document.body.appendChild(outside)
		const range = document.createRange()
		range.selectNodeContents(outside)
		act(() => {
			const selection = document.getSelection()
			selection?.removeAllRanges()
			selection?.addRange(range)
			document.dispatchEvent(new Event('selectionchange'))
		})
		expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')
		outside.remove()
	})
})
