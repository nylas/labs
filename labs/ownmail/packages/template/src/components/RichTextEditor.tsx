import { Bold, Italic, Link2, List, ListOrdered, Quote, Underline } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { readOffsets, writeOffsets } from './rich-text-dom.js'
import {
	activeFormats,
	applyBlockShortcut,
	applyLink,
	type BlockType,
	type Doc,
	deleteRange,
	docIsEmpty,
	docToHtml,
	htmlToDoc,
	insertText,
	linkAt,
	type Mark,
	outdentAt,
	seedToDoc,
	setBlockType,
	splitBlock,
	toggleMark,
} from './rich-text-model.js'
import { cn } from './ui-model.js'

interface Format {
	bold: boolean
	italic: boolean
	underline: boolean
	link: boolean
	block: BlockType
}

const NO_FORMAT: Format = { bold: false, italic: false, underline: false, link: false, block: 'paragraph' }

interface RichTextEditorProps {
	id?: string
	value: string
	onChange: (html: string) => void
	placeholder?: string
	className?: string
	ariaLabel?: string
}

/**
 * A model-driven WYSIWYG editor. Plain typing, IME composition and caret motion
 * are left to the browser's `contentEditable`; every formatting and structural
 * command (bold/italic/underline, lists, quotes, links, Enter, paste, markdown
 * shortcuts) is expressed as a pure transform over the `rich-text-model` doc,
 * after which we re-render canonical HTML and restore the caret by offset. The
 * canonical HTML is reported through `onChange` and is what gets sent/saved.
 */
export function RichTextEditor({
	id,
	value,
	onChange,
	placeholder = 'Write your message...',
	className,
	ariaLabel = 'Message body',
}: RichTextEditorProps) {
	const ref = useRef<HTMLDivElement>(null)
	// The HTML we last rendered/emitted. Guards the value-sync effect so a parent
	// re-render with our own output never re-seeds (and clobbers) the live caret.
	const lastEmitted = useRef<string>('')
	const [format, setFormat] = useState<Format>(NO_FORMAT)
	const [empty, setEmpty] = useState(true)
	const [link, setLink] = useState<{ start: number; end: number; value: string } | null>(null)
	const linkInputRef = useRef<HTMLInputElement>(null)

	/* v8 ignore next -- the `?? ''` guards an unmounted ref; every caller runs after mount */
	const currentDoc = useCallback((): Doc => htmlToDoc(ref.current?.innerHTML ?? ''), [])

	// The value reported upward: canonical HTML, or '' for an empty document so
	// the composer's "is anything typed?" checks (autosave, send) stay simple.
	const serialize = useCallback((doc: Doc): string => (docIsEmpty(doc) ? '' : docToHtml(doc)), [])

	const refreshFormat = useCallback(() => {
		const root = ref.current
		/* v8 ignore next -- refreshFormat only fires from DOM events on the mounted editable */
		if (!root) return
		const range = readOffsets(root)
		if (!range) return
		setFormat(activeFormats(currentDoc(), range.start, range.end))
	}, [currentDoc])

	const commit = useCallback(
		(doc: Doc, caretStart: number, caretEnd = caretStart) => {
			const root = ref.current
			/* v8 ignore next -- commit is only ever invoked from handlers that run after mount, so the ref is always set */
			if (!root) return
			// The DOM always needs a real block to host the caret, even when empty.
			root.innerHTML = docToHtml(doc)
			const emitted = serialize(doc)
			lastEmitted.current = emitted
			writeOffsets(root, caretStart, caretEnd)
			setEmpty(docIsEmpty(doc))
			setFormat(activeFormats(doc, caretStart, caretEnd))
			onChange(emitted)
		},
		[onChange, serialize],
	)

	// Adopt an externally-supplied value (draft prefill, reply/forward reset) by
	// re-seeding the DOM. Skipped while `value` matches our own last emission.
	useEffect(() => {
		const root = ref.current
		/* v8 ignore next -- the effect runs after mount, so the ref is always populated */
		if (!root) return
		if (value === lastEmitted.current) return
		const doc = seedToDoc(value)
		root.innerHTML = docToHtml(doc)
		const emitted = serialize(doc)
		lastEmitted.current = emitted
		setEmpty(docIsEmpty(doc))
		// Normalise the parent's value to canonical HTML so send/save never carry a
		// raw plain-text or browser-shaped seed.
		if (emitted !== value) onChange(emitted)
	}, [value, onChange, serialize])

	const emitFromDom = useCallback(() => {
		const doc = currentDoc()
		const emitted = serialize(doc)
		lastEmitted.current = emitted
		setEmpty(docIsEmpty(doc))
		onChange(emitted)
	}, [currentDoc, onChange, serialize])

	const onInput = useCallback(() => {
		const root = ref.current
		/* v8 ignore next -- input only fires on the mounted editable element */
		if (!root) return
		const range = readOffsets(root)
		if (range && range.start === range.end) {
			const shortcut = applyBlockShortcut(currentDoc(), range.start)
			if (shortcut) {
				commit(shortcut.doc, shortcut.caret)
				return
			}
		}
		emitFromDom()
		refreshFormat()
	}, [commit, currentDoc, emitFromDom, refreshFormat])

	const runMark = useCallback(
		(mark: Mark) => {
			const root = ref.current
			/* v8 ignore next -- toolbar/keyboard handlers only run once the editable is mounted */
			if (!root) return
			const range = readOffsets(root)
			if (!range) return
			commit(toggleMark(currentDoc(), range.start, range.end, mark), range.start, range.end)
		},
		[commit, currentDoc],
	)

	const runBlock = useCallback(
		(type: BlockType) => {
			const root = ref.current
			/* v8 ignore next -- toolbar handlers only run once the editable is mounted */
			if (!root) return
			const range = readOffsets(root)
			if (!range) return
			commit(setBlockType(currentDoc(), range.start, range.end, type), range.start, range.end)
		},
		[commit, currentDoc],
	)

	const openLink = useCallback(() => {
		const root = ref.current
		/* v8 ignore next -- the link command only runs once the editable is mounted */
		if (!root) return
		const range = readOffsets(root)
		if (!range || range.start === range.end) return
		setLink({ start: range.start, end: range.end, value: linkAt(currentDoc(), range.start) })
	}, [currentDoc])

	const applyLinkDraft = useCallback(() => {
		/* v8 ignore next -- the link editor UI only renders (and can only fire this) while a draft exists */
		if (!link) return
		commit(applyLink(currentDoc(), link.start, link.end, link.value), link.start, link.end)
		setLink(null)
		ref.current?.focus()
	}, [commit, currentDoc, link])

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const root = ref.current
			/* v8 ignore next -- key events only reach the mounted editable element */
			if (!root) return
			const mod = event.metaKey || event.ctrlKey
			const key = event.key.toLowerCase()
			if (
				mod &&
				!event.shiftKey &&
				!event.altKey &&
				(key === 'b' || key === 'i' || key === 'u' || key === 'k')
			) {
				event.preventDefault()
				if (key === 'b') runMark('bold')
				else if (key === 'i') runMark('italic')
				else if (key === 'u') runMark('underline')
				else openLink()
				return
			}
			// Shift+Enter (soft break) is left to the browser: it manages the trailing
			// `<br>` filler and caret in ways a controlled re-render cannot (a caret
			// cannot sit after a trailing `<br>`). onInput re-parses to stay in sync.
			if (event.key === 'Enter' && !event.shiftKey) {
				const range = readOffsets(root)
				/* v8 ignore next -- Enter cannot fire without a selection inside the editable */
				if (!range) return
				event.preventDefault()
				const doc =
					range.start === range.end ? currentDoc() : deleteRange(currentDoc(), range.start, range.end)
				const result = splitBlock(doc, Math.min(range.start, range.end))
				commit(result.doc, result.caret)
				return
			}
			if (event.key === 'Backspace') {
				const range = readOffsets(root)
				/* v8 ignore next -- Backspace cannot fire without a selection inside the editable */
				if (!range) return
				const outdent = outdentAt(currentDoc(), range.start, range.end)
				if (outdent) {
					event.preventDefault()
					commit(outdent.doc, outdent.caret)
				}
			}
		},
		[commit, currentDoc, openLink, runMark],
	)

	const onPaste = useCallback(
		(event: React.ClipboardEvent<HTMLDivElement>) => {
			const root = ref.current
			/* v8 ignore next -- paste only targets the mounted editable element */
			if (!root) return
			event.preventDefault()
			const text = event.clipboardData.getData('text/plain')
			if (!text) return
			const range = readOffsets(root)
			/* v8 ignore next -- a paste always lands on a selection within the editable */
			if (!range) return
			const result = insertText(currentDoc(), range.start, range.end, text)
			commit(result.doc, result.caret)
		},
		[commit, currentDoc],
	)

	// Keep the toolbar in sync with the caret as the user clicks or arrows around.
	useEffect(() => {
		const doc = ref.current?.ownerDocument
		/* v8 ignore next -- the editor always mounts inside a document */
		if (!doc) return
		const handler = () => {
			const root = ref.current
			const selection = doc.getSelection()
			if (
				root &&
				selection &&
				selection.rangeCount > 0 &&
				root.contains(selection.getRangeAt(0).startContainer)
			) {
				refreshFormat()
			}
		}
		doc.addEventListener('selectionchange', handler)
		return () => doc.removeEventListener('selectionchange', handler)
	}, [refreshFormat])

	useEffect(() => {
		if (link) linkInputRef.current?.focus()
	}, [link])

	return (
		<div className={cn('flex min-h-0 flex-1 flex-col', className)}>
			<div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
				<ToolbarButton label="Bold" shortcut="⌘B" active={format.bold} onClick={() => runMark('bold')}>
					<Bold className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton label="Italic" shortcut="⌘I" active={format.italic} onClick={() => runMark('italic')}>
					<Italic className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					label="Underline"
					shortcut="⌘U"
					active={format.underline}
					onClick={() => runMark('underline')}
				>
					<Underline className="h-4 w-4" />
				</ToolbarButton>
				<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
				<ToolbarButton
					label="Bulleted list"
					active={format.block === 'bullet'}
					onClick={() => runBlock('bullet')}
				>
					<List className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton
					label="Numbered list"
					active={format.block === 'number'}
					onClick={() => runBlock('number')}
				>
					<ListOrdered className="h-4 w-4" />
				</ToolbarButton>
				<ToolbarButton label="Quote" active={format.block === 'quote'} onClick={() => runBlock('quote')}>
					<Quote className="h-4 w-4" />
				</ToolbarButton>
				<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
				<ToolbarButton label="Link" shortcut="⌘K" active={format.link} onClick={openLink}>
					<Link2 className="h-4 w-4" />
				</ToolbarButton>
			</div>

			{link ? (
				<div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
					<input
						ref={linkInputRef}
						type="url"
						value={link.value}
						aria-label="Link URL"
						placeholder="https://example.com"
						onChange={(event) => setLink({ ...link, value: event.target.value })}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault()
								applyLinkDraft()
							} else if (event.key === 'Escape') {
								event.preventDefault()
								setLink(null)
								ref.current?.focus()
							}
						}}
						className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
					/>
					<button
						type="button"
						onClick={applyLinkDraft}
						className="rounded bg-foreground px-2.5 py-1 text-xs font-semibold text-background"
					>
						{link.value.trim() ? 'Apply' : 'Remove'}
					</button>
				</div>
			) : null}

			<div className="relative min-h-0 flex-1 overflow-y-auto">
				{empty ? (
					<p
						className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground"
						aria-hidden="true"
					>
						{placeholder}
					</p>
				) : null}
				{/* biome-ignore lint/a11y/useSemanticElements: a rich-text surface needs contentEditable, which input/textarea cannot provide */}
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
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					onMouseUp={refreshFormat}
					onKeyUp={refreshFormat}
					className="rich-text-editor min-h-full px-3 py-3 text-sm leading-relaxed outline-none"
				/>
			</div>
		</div>
	)
}

function ToolbarButton({
	label,
	shortcut,
	active,
	onClick,
	children,
}: {
	label: string
	shortcut?: string
	active?: boolean
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			title={shortcut ? `${label} (${shortcut})` : label}
			// Keep the editor's selection alive: buttons must not steal focus on press.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className={cn(
				'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
				active && 'bg-muted text-foreground',
			)}
		>
			{children}
		</button>
	)
}
