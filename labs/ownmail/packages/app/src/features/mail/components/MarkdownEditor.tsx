import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '#shared/lib/utils'
import { seedToMarkdown } from '../lib/html-to-markdown.js'
import { type LinePoint, readLineRange, writeLineRange } from '../lib/markdown-dom.js'
import {
	docHtml,
	lineStartOffset,
	locateOffset,
	markdownIsEmpty,
	renderedToSource,
	renderLine,
	replaceRange,
	toggleInline,
	wrapLink,
} from '../lib/markdown-model.js'

interface MarkdownEditorProps {
	id?: string
	/** Markdown source. This is also what `onChange` reports upward. */
	value: string
	onChange: (markdown: string) => void
	placeholder?: string
	className?: string
	ariaLabel?: string
}

interface SourceSelection {
	/** Selection as global source offsets (start <= end, DOM ranges are ordered). */
	start: number
	end: number
	startLine: number
	endLine: number
}

/**
 * An Obsidian-style live markdown editor. The lines your selection touches
 * show their raw markdown source; every other line shows the rendered
 * preview, and blurring renders the whole document.
 *
 * The browser's `contentEditable` handles plain typing *within* the active
 * raw lines; every structural edit (Enter, deletes across lines, paste,
 * ⌘B/⌘I/⌘K markdown wrapping) is a pure transform over the source string
 * (`markdown-model`), after which we re-render and restore the caret by
 * source offset. The markdown source is what gets reported through
 * `onChange` — callers convert with `markdownToEmailHtml` when sending.
 */
export function MarkdownEditor({
	id,
	value,
	onChange,
	placeholder = 'Write your message...',
	className,
	ariaLabel = 'Message body',
}: MarkdownEditorProps) {
	const ref = useRef<HTMLDivElement>(null)
	const source = useRef('')
	/** Inclusive line range currently showing raw source, or null when blurred. */
	const active = useRef<{ start: number; end: number } | null>(null)
	// The markdown we last emitted. Guards the value-sync effect so a parent
	// re-render with our own output never re-seeds (and clobbers) the live
	// caret. Starts as null so the very first value — even '' — seeds the DOM.
	const lastEmitted = useRef<string | null>(null)
	// Mouse selection drags must not be interrupted by a re-render, so line
	// activation is deferred from mousedown until the document-level mouseup.
	const dragging = useRef(false)
	const pendingActivation = useRef(false)
	// Rewriting the DOM mid-IME-composition would drop the composition state;
	// the live syntax re-highlight waits for compositionend instead.
	const composing = useRef(false)
	const [empty, setEmpty] = useState(true)

	const emit = useCallback(
		(markdown: string) => {
			const emitted = markdownIsEmpty(markdown) ? '' : markdown
			lastEmitted.current = emitted
			setEmpty(markdownIsEmpty(markdown))
			onChange(emitted)
		},
		[onChange],
	)

	/** Re-render with the lines under `[selStart, selEnd]` raw, caret restored. */
	const applyRender = useCallback((nextSource: string, selStart: number, selEnd: number) => {
		const root = ref.current
		/* v8 ignore next -- render only ever runs from handlers on the mounted editable */
		if (!root) return
		// Callers always pass ordered offsets: DOM ranges are ordered, and the
		// model's edit helpers order their results.
		const a = locateOffset(nextSource, selStart)
		const b = locateOffset(nextSource, selEnd)
		source.current = nextSource
		active.current = { start: a.line, end: b.line }
		root.innerHTML = docHtml(nextSource, active.current)
		writeLineRange(root, { line: a.line, offset: a.column }, { line: b.line, offset: b.column })
	}, [])

	const commit = useCallback(
		(nextSource: string, selStart: number, selEnd = selStart) => {
			applyRender(nextSource, selStart, selEnd)
			emit(nextSource)
		},
		[applyRender, emit],
	)

	/**
	 * The current selection translated to source offsets: identity for raw
	 * lines, through the line's render map for preview lines.
	 */
	const readSelection = useCallback((): SourceSelection | null => {
		const root = ref.current
		/* v8 ignore next -- selection reads only run from handlers on the mounted editable */
		if (!root) return null
		const range = readLineRange(root)
		if (!range) return null
		const lines = source.current.split('\n')
		const toSource = (point: LinePoint): number => {
			const line = lines[point.line] as string
			const raw =
				active.current !== null && point.line >= active.current.start && point.line <= active.current.end
			const column = raw ? point.offset : renderedToSource(renderLine(line), line.length, point.offset)
			return lineStartOffset(source.current, point.line) + column
		}
		return {
			start: toSource(range.start),
			end: toSource(range.end),
			startLine: range.start.line,
			endLine: range.end.line,
		}
	}, [])

	/** Make the lines under the selection raw (and everything else pretty). */
	const syncActive = useCallback(() => {
		const selection = readSelection()
		if (!selection) return
		const current = active.current
		if (current && current.start === selection.startLine && current.end === selection.endLine) return
		if (dragging.current) {
			pendingActivation.current = true
			return
		}
		applyRender(source.current, selection.start, selection.end)
	}, [applyRender, readSelection])

	// Adopt an externally-supplied value (draft prefill, reply/forward reset,
	// legacy HTML drafts) by re-seeding the DOM fully rendered.
	useEffect(() => {
		const root = ref.current
		/* v8 ignore next -- the effect runs after mount, so the ref is always populated */
		if (!root) return
		if (value === lastEmitted.current) return
		const seeded = seedToMarkdown(value)
		source.current = seeded
		active.current = null
		root.innerHTML = docHtml(seeded, null)
		const emitted = markdownIsEmpty(seeded) ? '' : seeded
		lastEmitted.current = emitted
		setEmpty(markdownIsEmpty(seeded))
		// Normalise the parent's value to markdown so send/save never carry a
		// raw HTML seed.
		if (emitted !== value) onChange(emitted)
	}, [value, onChange])

	// Track the caret as it moves (click, arrows, ⌘A) to re-target raw lines.
	useEffect(() => {
		const doc = ref.current?.ownerDocument
		/* v8 ignore next -- the editor always mounts inside a document */
		if (!doc) return
		doc.addEventListener('selectionchange', syncActive)
		return () => doc.removeEventListener('selectionchange', syncActive)
	}, [syncActive])

	// Browsers deliver `selectionchange` asynchronously, so the first keystroke
	// after a click can arrive before the clicked line was activated — the input
	// would land in a *rendered* line and be lost. `beforeinput` fires before
	// the DOM mutates: activate the selection's lines right then, so the edit
	// always lands in raw source text.
	useEffect(() => {
		const root = ref.current
		/* v8 ignore next -- the effect runs after mount, so the ref is always populated */
		if (!root) return
		const onBeforeInput = () => {
			const range = readLineRange(root)
			if (!range) return
			const current = active.current
			if (current && range.start.line >= current.start && range.end.line <= current.end) return
			syncActive()
		}
		root.addEventListener('beforeinput', onBeforeInput)
		return () => root.removeEventListener('beforeinput', onBeforeInput)
	}, [syncActive])

	// End-of-drag: apply the activation that was deferred during the drag.
	useEffect(() => {
		const doc = ref.current?.ownerDocument
		/* v8 ignore next -- the editor always mounts inside a document */
		if (!doc) return
		const onMouseUp = () => {
			dragging.current = false
			if (pendingActivation.current) {
				pendingActivation.current = false
				syncActive()
			}
		}
		doc.addEventListener('mouseup', onMouseUp)
		return () => doc.removeEventListener('mouseup', onMouseUp)
	}, [syncActive])

	// Plain typing lands in raw lines only: re-read them, then re-render so the
	// active line's syntax highlighting tracks every keystroke. The raw DOM
	// text equals the source line, so the caret restores by identity offset.
	const onInput = useCallback(() => {
		const root = ref.current
		/* v8 ignore next -- input only fires on the mounted editable element */
		if (!root) return
		const range = active.current
		if (!range) return
		const lines = source.current.split('\n')
		for (let index = range.start; index <= range.end; index++) {
			// Browsers render trailing spaces as no-break spaces; the source must
			// keep plain spaces so block markers like "- " still parse.
			lines[index] = ((root.children.item(index) as Element).textContent as string).replace(/\u00A0/g, ' ')
		}
		source.current = lines.join('\n')
		if (!composing.current) {
			const selection = readLineRange(root)
			if (selection) {
				applyRender(
					source.current,
					lineStartOffset(source.current, selection.start.line) + selection.start.offset,
					lineStartOffset(source.current, selection.end.line) + selection.end.offset,
				)
			}
		}
		emit(source.current)
	}, [applyRender, emit])

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const mod = event.metaKey || event.ctrlKey
			const key = event.key.toLowerCase()
			if (
				mod &&
				!event.shiftKey &&
				!event.altKey &&
				(key === 'b' || key === 'i' || key === 'u' || key === 'k')
			) {
				// Always consumed: the browser would otherwise mutate the DOM with
				// presentational tags (⌘U underline has no markdown, so it is a no-op).
				event.preventDefault()
				const selection = readSelection()
				if (!selection) return
				if (key === 'b' || key === 'i') {
					const result = toggleInline(
						source.current,
						selection.start,
						selection.end,
						key === 'b' ? '**' : '*',
					)
					commit(result.source, result.start, result.end)
				} else if (key === 'k') {
					const result = wrapLink(source.current, selection.start, selection.end)
					commit(result.source, result.caret)
				}
				return
			}
			if (mod) return
			if (event.key === 'Enter') {
				event.preventDefault()
				const selection = readSelection()
				/* v8 ignore next -- Enter cannot fire without a selection inside the editable */
				if (!selection) return
				const result = replaceRange(source.current, selection.start, selection.end, '\n')
				commit(result.source, result.caret)
				return
			}
			if (event.key !== 'Backspace' && event.key !== 'Delete' && event.key.length !== 1) return
			const selection = readSelection()
			/* v8 ignore next -- editing keys cannot fire without a selection inside the editable */
			if (!selection) return
			// A selection spanning lines must be edited in the model: the browser
			// would merge our per-line elements and desync the source.
			if (selection.startLine !== selection.endLine) {
				event.preventDefault()
				const insert = event.key === 'Backspace' || event.key === 'Delete' ? '' : event.key
				const result = replaceRange(source.current, selection.start, selection.end, insert)
				commit(result.source, result.caret)
				return
			}
			if (selection.start !== selection.end) return
			const at = locateOffset(source.current, selection.start)
			if (event.key === 'Backspace' && at.column === 0 && at.line > 0) {
				// Merge with the previous line by deleting the boundary newline.
				event.preventDefault()
				const result = replaceRange(source.current, selection.start - 1, selection.start, '')
				commit(result.source, result.caret)
				return
			}
			const lines = source.current.split('\n')
			if (
				event.key === 'Delete' &&
				at.column === (lines[at.line] as string).length &&
				at.line < lines.length - 1
			) {
				event.preventDefault()
				const result = replaceRange(source.current, selection.start, selection.start + 1, '')
				commit(result.source, result.caret)
			}
		},
		[commit, readSelection],
	)

	const onPaste = useCallback(
		(event: React.ClipboardEvent<HTMLDivElement>) => {
			event.preventDefault()
			const text = event.clipboardData.getData('text/plain')
			if (!text) return
			const selection = readSelection()
			/* v8 ignore next -- a paste always lands on a selection within the editable */
			if (!selection) return
			const result = replaceRange(
				source.current,
				selection.start,
				selection.end,
				text.replace(/\r\n?/g, '\n'),
			)
			commit(result.source, result.caret)
		},
		[commit, readSelection],
	)

	// Copy/cut hand out markdown source (what you would get in Obsidian), and
	// cut must go through the model for the same reason multi-line deletes do.
	const onCopyOrCut = useCallback(
		(event: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
			const selection = readSelection()
			if (!selection || selection.start === selection.end) return
			event.preventDefault()
			event.clipboardData.setData('text/plain', source.current.slice(selection.start, selection.end))
			if (cut) {
				const result = replaceRange(source.current, selection.start, selection.end, '')
				commit(result.source, result.caret)
			}
		},
		[commit, readSelection],
	)

	const onBlur = useCallback(() => {
		const root = ref.current
		/* v8 ignore next -- blur only fires on the mounted editable element */
		if (!root) return
		active.current = null
		root.innerHTML = docHtml(source.current, null)
	}, [])

	return (
		<div className={cn('flex min-h-0 flex-1 flex-col', className)}>
			<div className="relative min-h-0 flex-1 overflow-y-auto">
				{empty ? (
					<p
						className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground"
						aria-hidden="true"
					>
						{placeholder}
					</p>
				) : null}
				{/* biome-ignore lint/a11y/useSemanticElements: a live markdown surface needs contentEditable, which input/textarea cannot provide */}
				<div
					id={id}
					ref={ref}
					contentEditable
					suppressContentEditableWarning
					role="textbox"
					tabIndex={0}
					aria-multiline="true"
					aria-label={ariaLabel}
					spellCheck
					onInput={onInput}
					onCompositionStart={() => {
						composing.current = true
					}}
					onCompositionEnd={() => {
						composing.current = false
						// Apply the syntax re-highlight deferred during composition.
						onInput()
					}}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					onCopy={(event) => onCopyOrCut(event, false)}
					onCut={(event) => onCopyOrCut(event, true)}
					onMouseDown={() => {
						dragging.current = true
					}}
					onBlur={onBlur}
					className="markdown-editor min-h-full px-3 py-3 text-sm leading-relaxed outline-none"
				/>
			</div>
		</div>
	)
}
