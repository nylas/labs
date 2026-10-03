// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownToDraftBody } from '#features/mail/lib/html-to-markdown'
import { markdownToEmailHtml } from '#features/mail/lib/markdown-model'
import type { MailDraft } from '#features/mail/state/mail-queries'

// All server calls are mocked so a render never touches the network; tests assert
// the right fn is called with the right payload.
const saveDraft = vi.fn()
const saveComposeRecipients = vi.fn()
const sendDraft = vi.fn()
const deleteDraft = vi.fn()
const recipientInputMock = vi.hoisted(() => ({ keepDraftLocal: false }))
vi.mock('#server/fns', () => ({
	saveDraft: (a: any) => saveDraft(a),
	saveComposeRecipients: (a: any) => saveComposeRecipients(a),
	sendDraft: (a: any) => sendDraft(a),
	deleteDraft: (a: any) => deleteDraft(a),
	markThreadRead: vi.fn(),
	updateThreadState: vi.fn(),
}))

// The "To" autocomplete is its own unit, so it is replaced with a minimal stand-in.
// `keepDraftLocal` models a recipient typed but not yet committed as a chip: the
// composer must read it through the imperative `getCurrentValue` seam on send.
vi.mock('#shared/components/RecipientInput', async () => {
	const React = await vi.importActual<typeof import('react')>('react')
	return {
		RecipientInput: React.forwardRef(function MockRecipientInput(
			{ id, value, onChange, onEdit, placeholder, disabled, invalid, describedBy, inputClassName }: any,
			ref,
		) {
			const [localDraft, setLocalDraft] = React.useState<string | null>(null)
			const currentValue = React.useRef(value)
			currentValue.current = localDraft ?? value
			React.useImperativeHandle(ref, () => ({ getCurrentValue: () => currentValue.current }), [])
			return (
				<input
					id={id}
					className={inputClassName}
					aria-label="To"
					aria-invalid={invalid || undefined}
					aria-describedby={describedBy}
					value={localDraft ?? value}
					placeholder={placeholder}
					disabled={disabled}
					onChange={
						disabled
							? undefined
							: (event) => {
									currentValue.current = event.target.value
									if (recipientInputMock.keepDraftLocal) setLocalDraft(event.target.value)
									else onChange(event.target.value)
									onEdit?.()
								}
					}
				/>
			)
		}),
	}
})
// The markdown editor is a unit of its own (see MarkdownEditor.render.test.tsx);
// here it stands in as a plain textarea so composer flows — prefill, send, autosave,
// minimize — are asserted on the markdown source the editor reports upward.
vi.mock('./MarkdownEditor.js', () => ({
	MarkdownEditor: ({ id, value, onChange, placeholder, readOnly }: any) => (
		<textarea
			id={id}
			placeholder={placeholder ?? 'Write your message...'}
			value={value}
			readOnly={readOnly}
			onChange={readOnly ? undefined : (event) => onChange(event.target.value)}
		/>
	),
}))

import { type ComposeSeed, ComposeWindow, type ComposeWindowHandle } from './ComposeWindow.js'

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	for (const slot of document.querySelectorAll('[data-slot="inline-composer"]')) slot.remove()
})
beforeEach(() => {
	vi.clearAllMocks()
	recipientInputMock.keepDraftLocal = false
	window.localStorage.removeItem('ownmail:user-preferences:v1')
	saveDraft.mockResolvedValue({ draftId: 'new-draft', created: true })
	saveComposeRecipients.mockResolvedValue({ contacts: [] })
	sendDraft.mockResolvedValue({ removedDraftId: 'new-draft' })
	deleteDraft.mockImplementation(async ({ data }: any) => ({ removedDraftId: data.draftId }))
})

function draftSeed(draft: Partial<MailDraft>): ComposeSeed {
	return { kind: 'draft', draft: draft as MailDraft }
}

/** The fields a reply, forward or prefilled link carries; a reply-to id makes it a reply. */
function fieldsSeed(fields: { to?: string; subject?: string; body?: string; replyToMessageId?: string }) {
	return { kind: fields.replyToMessageId ? 'reply' : 'new', ...fields } as ComposeSeed
}

function renderWindow({
	seed = { kind: 'new' },
	inlineSlot,
}: {
	seed?: ComposeSeed
	inlineSlot?: HTMLElement | null
} = {}) {
	const onClosed = vi.fn()
	const onSent = vi.fn()
	const handle = createRef<ComposeWindowHandle>()
	const view = render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<ComposeWindow
				seed={seed}
				inlineSlot={inlineSlot}
				onClosed={onClosed}
				onSent={onSent}
				handleRef={handle}
			/>
		</QueryClientProvider>,
	)
	return { ...view, onClosed, onSent, handle }
}

function inlineSlotElement() {
	const slot = document.createElement('div')
	slot.setAttribute('data-slot', 'inline-composer')
	document.body.appendChild(slot)
	return slot
}

function fileInput(container: HTMLElement) {
	return (container.querySelector('input[type="file"]') ??
		document.querySelector('input[type="file"]')) as HTMLInputElement
}

function bodyField() {
	return screen.getByPlaceholderText('Write your message...') as HTMLTextAreaElement
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {}
	let reject: (reason?: unknown) => void = () => {}
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function mockMobileViewport() {
	vi.stubGlobal(
		'matchMedia',
		vi.fn((query: string) => ({
			matches: query === '(max-width: 47.999rem)',
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	)
}

describe('ComposeWindow prefill', () => {
	it('prefills recipients, subject and body from an existing draft so edits continue where left off', () => {
		renderWindow({
			seed: draftSeed({
				id: 'd0',
				to: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
				subject: 'Draft subject',
				body: 'Draft body',
			}),
		})
		expect(screen.getByLabelText('To')).toHaveValue('a@x.com, b@x.com')
		expect(screen.getByLabelText('Subject')).toHaveValue('Draft subject')
		expect(bodyField()).toHaveValue('Draft body')
	})

	it('opens a draft that has no recipients, subject or body as an empty composer, not a crash', () => {
		renderWindow({ seed: draftSeed({ id: 'd0' }) })
		expect(screen.getByLabelText('To')).toHaveValue('')
		expect(screen.getByLabelText('Subject')).toHaveValue('')
		expect(bodyField()).toHaveValue('')
	})

	it('converts an enveloped markdown draft back to its source before prefilling the editor', () => {
		renderWindow({ seed: draftSeed({ id: 'd0', body: markdownToDraftBody('**Draft body**') }) })
		expect(bodyField()).toHaveValue('**Draft body**')
	})

	it('does not decode a draft with browser DOM APIs while server-rendering', () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
		Object.defineProperty(globalThis, 'DOMParser', { value: undefined, configurable: true })
		try {
			expect(() =>
				renderToString(
					<QueryClientProvider client={new QueryClient()}>
						<ComposeWindow
							seed={draftSeed({ id: 'd0', body: markdownToDraftBody('**Draft body**') })}
							onClosed={() => {}}
							onSent={() => {}}
						/>
					</QueryClientProvider>,
				),
			).not.toThrow()
		} finally {
			if (original) Object.defineProperty(globalThis, 'DOMParser', original)
		}
	})

	it('prefills from reply fields and shows the reply subject in the window title', () => {
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Re: Hi', body: 'quoted' }) })
		expect(screen.getByLabelText('To')).toHaveValue('a@b.com')
		expect(screen.getByText('Re: Hi')).toBeInTheDocument()
	})

	it('starts empty and titles the window "New message" for a blank compose', () => {
		renderWindow()
		expect(screen.getByLabelText('To')).toHaveValue('')
		expect(screen.getByText('New message')).toBeInTheDocument()
	})
})

describe('ComposeWindow initial focus', () => {
	it('focuses the recipient field for a brand-new message', async () => {
		renderWindow()
		await waitFor(() => expect(screen.getByLabelText('To')).toHaveFocus())
	})

	it('focuses the body when replying, even when reply metadata is incomplete', async () => {
		renderWindow({ seed: fieldsSeed({ replyToMessageId: 'm9' }) })
		await waitFor(() => expect(bodyField()).toHaveFocus())
	})

	it('focuses the subject when a new message already has recipients', async () => {
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com' }) })
		await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveFocus())
	})

	it('focuses the body when a non-reply message already has recipients and a subject', async () => {
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hello' }) })
		await waitFor(() => expect(bodyField()).toHaveFocus())
	})

	it('focuses the first missing field when reopening a draft', async () => {
		renderWindow({ seed: draftSeed({ id: 'd0', to: [], subject: 'Saved subject', body: 'Saved body' }) })
		await waitFor(() => expect(screen.getByLabelText('To')).toHaveFocus())
	})

	it('focuses the body when reopening a complete draft', async () => {
		renderWindow({
			seed: draftSeed({ id: 'd0', to: [{ email: 'a@b.com' }], subject: 'Saved subject', body: 'Saved body' }),
		})
		await waitFor(() => expect(bodyField()).toHaveFocus())
	})
})

describe('ComposeWindow inline reply', () => {
	it('puts a reply in its thread under the last message instead of floating over it', () => {
		const slot = inlineSlotElement()
		renderWindow({
			seed: fieldsSeed({ to: 'a@b.com', subject: 'Re: Hi', replyToMessageId: 'm1' }),
			inlineSlot: slot,
		})
		// A reply belongs to the conversation it answers (design.md "Reading"), so it is a
		// region in the thread's flow, not a floating dialog over it.
		expect(screen.queryByRole('dialog', { name: 'Compose message' })).not.toBeInTheDocument()
		const reply = screen.getByRole('region', { name: 'Reply' })
		expect(reply).toHaveAttribute('data-presentation', 'inline')
		expect(reply).toHaveClass('compose-panel-inline')
		expect(reply).not.toHaveClass('glass-panel', 'fixed')
		expect(slot).toContainElement(reply)
		// Nothing floats, so there is nothing to minimise out of the way.
		expect(screen.getByRole('button', { name: 'Minimize composer' })).toHaveClass('hidden')
		expect(screen.getByLabelText('Subject')).toHaveValue('Re: Hi')
	})

	it('keeps a new message floating even when a thread offers a place for a reply', () => {
		const slot = inlineSlotElement()
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com' }), inlineSlot: slot })
		expect(screen.getByRole('dialog', { name: 'Compose message' })).toHaveAttribute(
			'data-presentation',
			'floating',
		)
		expect(slot).toBeEmptyDOMElement()
	})

	it('floats a reply full-screen on a phone, where the thread has no room for it', async () => {
		mockMobileViewport()
		const slot = inlineSlotElement()
		renderWindow({ seed: fieldsSeed({ replyToMessageId: 'm1' }), inlineSlot: slot })
		const panel = await screen.findByRole('dialog', { name: 'Compose message' })
		await waitFor(() => expect(panel).toHaveAttribute('data-presentation', 'floating'))
		expect(slot).toBeEmptyDOMElement()
	})
})

describe('ComposeWindow window controls', () => {
	it('uses a safe-area-aware full viewport on mobile and retains the floating desktop composer', () => {
		renderWindow()
		const panel = screen.getByRole('dialog', { name: 'Compose message' })
		expect(panel).toHaveClass('compose-panel')
		expect(panel).toHaveAttribute('data-minimized', 'false')
		expect(panel).not.toHaveAttribute('aria-modal')
		expect(panel).toHaveClass('max-md:pr-[env(safe-area-inset-right)]')
		expect(panel).toHaveClass('max-md:pl-[env(safe-area-inset-left)]')
		expect(screen.getByRole('button', { name: 'Minimize composer' })).toHaveClass('hidden', 'md:flex')
		expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
			'size-9',
			'max-md:size-11',
			'[@media(any-pointer:coarse)]:size-11',
		)
		// design.md "Glass layer": the window floats over the page, so it is panel glass; the
		// title bar is the panel's own surface, not an inverted slab that flips with the theme.
		expect(panel).toHaveClass('glass-panel')
		expect(panel).not.toHaveAttribute('data-glass')
		expect(panel.firstElementChild).not.toHaveClass('bg-foreground')
		expect(panel.firstElementChild).toHaveClass('text-foreground')
	})

	it('is modal and contains keyboard focus throughout the mobile breakpoint', async () => {
		mockMobileViewport()
		renderWindow()
		const panel = screen.getByRole('dialog', { name: 'Compose message' })
		await waitFor(() => expect(panel).toHaveAttribute('aria-modal', 'true'))
		await waitFor(() => expect(screen.getByLabelText('To')).toHaveFocus())
		// A full-screen editor has nothing beneath it to show, so on a phone the panel is solid.
		expect(panel).toHaveAttribute('data-glass', 'solid')

		const outside = document.createElement('button')
		document.body.appendChild(outside)
		outside.focus()
		fireEvent.keyDown(outside, { key: 'Tab', shiftKey: true })
		expect(panel).toContainElement(document.activeElement as HTMLElement)

		outside.focus()
		fireEvent.keyDown(outside, { key: 'Tab' })
		expect(panel).toContainElement(document.activeElement as HTMLElement)
		outside.remove()
	})

	it('keeps Tab on the panel itself when none of its controls are visible, so focus never escapes the modal', async () => {
		mockMobileViewport()
		renderWindow()
		const panel = screen.getByRole('dialog', { name: 'Compose message' })
		await waitFor(() => expect(panel).toHaveAttribute('aria-modal', 'true'))
		const computed = window.getComputedStyle
		vi.spyOn(window, 'getComputedStyle').mockImplementation(
			(element) => ({ ...computed(element), display: 'none' }) as CSSStyleDeclaration,
		)
		const outside = document.createElement('button')
		document.body.appendChild(outside)
		outside.focus()
		fireEvent.keyDown(outside, { key: 'Tab' })
		expect(panel).toHaveFocus()
		outside.remove()
		vi.mocked(window.getComputedStyle).mockRestore()
	})

	it('leaves Tab between inner controls to the browser, trapping only at the edges', async () => {
		mockMobileViewport()
		renderWindow()
		const panel = screen.getByRole('dialog', { name: 'Compose message' })
		await waitFor(() => expect(panel).toHaveAttribute('aria-modal', 'true'))
		const subject = screen.getByLabelText('Subject')
		subject.focus()

		// fireEvent returns false when the handler prevented the default move.
		expect(fireEvent.keyDown(subject, { key: 'Tab' })).toBe(true)
		expect(fireEvent.keyDown(subject, { key: 'Tab', shiftKey: true })).toBe(true)
		expect(subject).toHaveFocus()

		// Only Tab is trapped: keys typed into the editor are never swallowed.
		const outside = document.createElement('button')
		document.body.appendChild(outside)
		outside.focus()
		expect(fireEvent.keyDown(outside, { key: 'ArrowDown' })).toBe(true)
		expect(outside).toHaveFocus()
		outside.remove()
	})

	it('uses shared buttons for 44px mobile header and footer controls, with one focus ring per row', () => {
		renderWindow()
		expect(screen.getByLabelText('To').parentElement).toHaveClass(
			'min-h-12',
			'focus-within:ring-[3px]',
			'focus-within:ring-ring',
		)
		expect(screen.getByLabelText('Subject').closest('label')).toHaveClass(
			'min-h-12',
			'focus-within:ring-[3px]',
			'focus-within:ring-ring',
		)
		expect(screen.getByLabelText('Subject')).toHaveClass('h-12')

		// One focus ring per row: the To field leaves it to its row, like Subject does.
		expect(screen.getByLabelText('To')).toHaveClass('compose-field', 'focus-visible:ring-0')
		expect(screen.getByLabelText('To')).not.toHaveClass('focus-visible:ring-[3px]')

		for (const name of ['Minimize composer', 'Close']) {
			const control = screen.getByRole('button', { name })
			expect(control).toHaveAttribute('data-slot', 'button')
			expect(control).toHaveClass('size-9', 'max-md:size-11', '[@media(any-pointer:coarse)]:size-11')
		}
		// Send names its shortcut for assistive technology and shows it to keyboard users.
		expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute(
			'aria-keyshortcuts',
			'Meta+Enter Control+Enter',
		)
		expect(screen.getByText('⌘↵')).toHaveClass('shortcut-hint')
		for (const name of ['Send', 'Save draft', 'Attach file', 'Discard draft']) {
			const control = screen.getByRole('button', { name })
			expect(control).toHaveAttribute('data-slot', 'button')
			expect(control.className).toMatch(/max-md:(?:min-h-11|size-11)/)
		}
	})

	it('exposes accurate controls while minimizing and restoring the composer body', () => {
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Original', body: 'Original body' }) })
		fireEvent.change(screen.getByLabelText('To'), { target: { value: 'edited@example.com' } })
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited subject' } })
		fireEvent.change(bodyField(), { target: { value: 'Edited body' } })
		const minimize = screen.getByRole('button', { name: 'Minimize composer' })
		expect(minimize).toHaveAttribute('aria-expanded', 'true')
		expect(minimize.querySelector('svg')).toHaveClass('lucide-minus')
		fireEvent.click(minimize)
		expect(screen.queryByLabelText('To')).not.toBeInTheDocument()
		expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument()
		expect(screen.queryByPlaceholderText('Write your message...')).not.toBeInTheDocument()
		const restore = screen.getByRole('button', { name: 'Restore composer' })
		expect(restore).toHaveAttribute('aria-expanded', 'false')
		expect(restore).toHaveClass('flex')
		expect(restore).not.toHaveClass('hidden')
		expect(restore.querySelector('svg')).toHaveClass('lucide-maximize-2')
		fireEvent.click(restore)
		// Minimizing only hides the body: the message being written is all still there.
		expect(screen.getByLabelText('To')).toHaveValue('edited@example.com')
		expect(screen.getByLabelText('Subject')).toHaveValue('Edited subject')
		expect(bodyField()).toHaveValue('Edited body')
		expect(screen.getByRole('button', { name: 'Minimize composer' })).toHaveAttribute('aria-expanded', 'true')
	})
})

describe('ComposeWindow close', () => {
	it('closes an empty composer at once, without creating an empty draft', async () => {
		const { onClosed } = renderWindow()
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
		expect(saveDraft).not.toHaveBeenCalled()
	})

	it('flushes the latest draft before closing, so closing never loses what was written', async () => {
		const save = deferred<{ draftId: string }>()
		saveDraft.mockReturnValueOnce(save.promise)
		const { onClosed } = renderWindow()
		fireEvent.change(bodyField(), { target: { value: 'Latest draft text' } })

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: '', subject: '', body: markdownToDraftBody('Latest draft text') },
			}),
		)
		expect(onClosed).not.toHaveBeenCalled()
		save.resolve({ draftId: 'flushed-draft' })
		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
	})

	it('prevents edits while close persistence is in flight', async () => {
		const save = deferred<{ draftId: string }>()
		saveDraft.mockReturnValueOnce(save.promise)
		const { onClosed } = renderWindow()
		const recipient = screen.getByLabelText('To')
		const subject = screen.getByLabelText('Subject')
		const body = bodyField()
		fireEvent.change(recipient, { target: { value: 'before@example.com' } })
		fireEvent.change(subject, { target: { value: 'Before close' } })
		fireEvent.change(body, { target: { value: 'Before close body' } })

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		await waitFor(() => expect(screen.getByText('Saving…')).toBeInTheDocument())
		expect(recipient).toBeDisabled()
		expect(subject).toBeDisabled()
		expect(body).toHaveAttribute('readonly')
		fireEvent.change(recipient, { target: { value: 'lost@example.com' } })
		fireEvent.change(subject, { target: { value: 'Lost subject' } })
		fireEvent.change(body, { target: { value: 'Lost body' } })

		expect(saveDraft).toHaveBeenCalledWith({
			data: {
				to: 'before@example.com',
				subject: 'Before close',
				body: markdownToDraftBody('Before close body'),
			},
		})
		save.resolve({ draftId: 'locked-draft' })
		await waitFor(() => expect(onClosed).toHaveBeenCalled())
	})

	it('stays open with its draft and an error when the closing save fails', async () => {
		// The app relies on this: opening another composer must not throw away one whose
		// draft could not be saved.
		saveDraft.mockRejectedValueOnce(new Error('offline'))
		const { onClosed } = renderWindow({ seed: fieldsSeed({ subject: 'Keep me' }) })

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save the draft. Your changes are still here; check your connection and try again.',
		)
		expect(onClosed).not.toHaveBeenCalled()
		expect(screen.getByLabelText('Subject')).toHaveValue('Keep me')
		expect(screen.getByLabelText('Subject')).toBeEnabled()
	})

	it('lets the app close it through its handle, saving the draft first', async () => {
		const { onClosed, handle } = renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi' }) })

		await act(async () => {
			await handle.current?.close()
		})

		expect(saveDraft).toHaveBeenCalledWith({ data: { to: 'a@b.com', subject: 'Hi', body: '' } })
		expect(onClosed).toHaveBeenCalledTimes(1)
	})

	it('saves once and closes once when asked to close again while already closing', async () => {
		const save = deferred<{ draftId: string }>()
		saveDraft.mockReturnValueOnce(save.promise)
		const { onClosed, handle } = renderWindow({ seed: fieldsSeed({ subject: 'Hi' }) })

		let first: Promise<void> | undefined
		let second: Promise<void> | undefined
		act(() => {
			first = handle.current?.close()
			second = handle.current?.close()
		})
		await act(async () => {
			save.resolve({ draftId: 'd1' })
			await Promise.all([first, second])
		})

		expect(saveDraft).toHaveBeenCalledTimes(1)
		expect(onClosed).toHaveBeenCalledTimes(1)
	})

	it('ignores a close while the message is sending, so the send is never abandoned', async () => {
		// The app closes the open composer before opening another; mid-send that must not
		// tear the window down or save over the draft being sent.
		const send = deferred<unknown>()
		sendDraft.mockReturnValueOnce(send.promise)
		const { onClosed, onSent, handle } = renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Send' }))
		await waitFor(() => expect(sendDraft).toHaveBeenCalled())

		await act(async () => {
			await handle.current?.close()
		})
		expect(onClosed).not.toHaveBeenCalled()
		expect(saveDraft).toHaveBeenCalledTimes(1)

		await act(async () => {
			send.resolve({ removedDraftId: 'new-draft' })
		})
		expect(onSent).toHaveBeenCalledTimes(1)
		expect(onClosed).not.toHaveBeenCalled()
	})

	it('ignores a close while the draft is being discarded, so a discarded draft is not saved again', async () => {
		const removal = deferred<unknown>()
		deleteDraft.mockReturnValueOnce(removal.promise)
		const { onClosed, handle } = renderWindow({ seed: draftSeed({ id: 'd0', subject: 'Bin me' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		await waitFor(() => expect(deleteDraft).toHaveBeenCalled())

		await act(async () => {
			await handle.current?.close()
		})
		expect(saveDraft).not.toHaveBeenCalled()
		expect(onClosed).not.toHaveBeenCalled()

		await act(async () => {
			removal.resolve({ removedDraftId: 'd0' })
		})
		expect(onClosed).toHaveBeenCalledTimes(1)
		expect(saveDraft).not.toHaveBeenCalled()
	})

	it('waits for an attachment still being read and saves it with the draft on close', async () => {
		const read = deferred<ArrayBuffer>()
		const pending = new File([new Uint8Array([1, 2, 3])], 'pending.txt')
		Object.defineProperty(pending, 'arrayBuffer', { value: () => read.promise, configurable: true })
		const { container, onClosed } = renderWindow()
		fireEvent.change(fileInput(container), { target: { files: [pending] } })
		await screen.findByRole('button', { name: 'Attaching...' })

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(saveDraft).not.toHaveBeenCalled()
		read.resolve(new Uint8Array([1, 2, 3]).buffer)

		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
		expect(saveDraft.mock.calls[0][0].data.attachments).toHaveLength(1)
	})

	it('stays open when an attachment being read on close fails', async () => {
		const read = deferred<ArrayBuffer>()
		const pending = new File([new Uint8Array([1, 2, 3])], 'pending.txt')
		Object.defineProperty(pending, 'arrayBuffer', { value: () => read.promise, configurable: true })
		const { container, onClosed } = renderWindow()
		fireEvent.change(fileInput(container), { target: { files: [pending] } })
		await screen.findByRole('button', { name: 'Attaching...' })

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		read.reject(new Error('read failed'))

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not attach the file. Check the file and try again.',
		)
		expect(onClosed).not.toHaveBeenCalled()
		expect(saveDraft).not.toHaveBeenCalled()
	})
})

describe('ComposeWindow keyboard', () => {
	it('closes on Escape from the window itself', async () => {
		const { onClosed } = renderWindow({ seed: fieldsSeed({ subject: 'Hi' }) })
		fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Escape' })
		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
		// Escape is the same close: the draft is kept.
		expect(saveDraft).toHaveBeenCalledWith({ data: { to: '', subject: 'Hi', body: '' } })
	})

	it('ignores Escape while typing, with modifiers held, or from outside the window', async () => {
		const { onClosed } = renderWindow({ seed: fieldsSeed({ subject: 'Hi' }) })
		// Typing in a field must not close the composer.
		fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'Escape' })
		fireEvent.keyDown(bodyField(), { key: 'Escape' })
		const panel = screen.getByRole('dialog', { name: 'Compose message' })
		const editable = document.createElement('div')
		Object.defineProperty(editable, 'isContentEditable', { value: true })
		panel.appendChild(editable)
		fireEvent.keyDown(editable, { key: 'Escape' })
		for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
			fireEvent.keyDown(panel, { key: 'Escape', ...modifier })
		}
		// Escape elsewhere on the page belongs to that page, not to the composer.
		fireEvent.keyDown(document.body, { key: 'Escape' })
		editable.remove()

		await act(async () => {})
		expect(onClosed).not.toHaveBeenCalled()
	})

	it('saves the draft with the Control+S / Command+S shortcut', async () => {
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'draft body' }) })
		fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 's', ctrlKey: true })
		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: 'a@b.com', subject: 'Hi', body: markdownToDraftBody('draft body') },
			}),
		)
		expect(sendDraft).not.toHaveBeenCalled()
	})
})

describe('ComposeWindow editing', () => {
	it('updates subject and body as the user types', () => {
		renderWindow()
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'My subject' } })
		fireEvent.change(bodyField(), { target: { value: 'My body' } })
		expect(screen.getByLabelText('Subject')).toHaveValue('My subject')
		expect(bodyField()).toHaveValue('My body')
		// The window title follows the subject, so a minimized window is still recognizable.
		expect(screen.getByText('My subject')).toBeInTheDocument()
	})

	it('updates the recipient field through the To input', () => {
		renderWindow()
		fireEvent.change(screen.getByLabelText('To'), { target: { value: 'new@x.com' } })
		expect(screen.getByLabelText('To')).toHaveValue('new@x.com')
	})
})

describe('ComposeWindow attachments', () => {
	it('ignores a change event that carries no files', () => {
		const { container } = renderWindow()
		fireEvent.change(fileInput(container), { target: { files: [] } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('attaches files, sanitizing unsafe and empty filenames, then removes one', async () => {
		const { container } = renderWindow()
		const input = fileInput(container)
		const click = vi.spyOn(input, 'click')
		// The paperclip button proxies clicks to the hidden file input.
		fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
		expect(click).toHaveBeenCalled()
		// 1, 2 and 3 bytes encode to base64 ending "==", "=" and neither, so each size is
		// read back exactly in the chip.
		const files = [
			new File([new Uint8Array(1)], 'ok.txt', { type: 'text/plain' }),
			new File([new Uint8Array(2)], 'bad/name\t.txt'),
			new File([new Uint8Array(3)], '   '),
			new File([new Uint8Array(2000)], 'big.txt'),
		]
		fireEvent.change(input, { target: { files } })

		expect(await screen.findByText('ok.txt')).toBeInTheDocument()
		expect(screen.getByText('bad_name_.txt')).toBeInTheDocument()
		expect(screen.getByText('attachment')).toBeInTheDocument()
		expect(screen.getByText('big.txt')).toBeInTheDocument()

		// Attachment pills are shared chips with no vertical padding of their own, 12px from the
		// lines around the row, and the footer below uses the same 12px with its safe-area sum.
		const remove = screen.getByRole('button', { name: 'Remove ok.txt' })
		const chip = remove.closest('[data-slot="chip"]')
		expect(chip).toHaveTextContent('ok.txt')
		expect(chip?.className).not.toMatch(/\bp[ytb]-/)
		expect(remove).toHaveClass('size-9', 'max-md:size-11')
		expect(chip?.parentElement).toHaveClass('gap-cluster', 'border-t', 'py-3')
		expect(screen.getByRole('button', { name: /Send/ }).parentElement).toHaveClass(
			'pt-3',
			'pb-[calc(0.75rem+var(--safe-area-bottom))]',
			'md:pb-3',
		)
		fireEvent.click(remove)
		await waitFor(() => expect(screen.queryByText('ok.txt')).not.toBeInTheDocument())
	})

	it('rejects attaching more than the allowed number of files', async () => {
		const { container } = renderWindow()
		const files = Array.from({ length: 11 }, (_, index) => new File(['x'], `f${index}.txt`))
		fireEvent.change(fileInput(container), { target: { files } })
		expect(await screen.findByRole('alert')).toHaveTextContent('Attach up to 10 files.')
	})

	it('rejects attachments whose combined size exceeds the 2 MB budget', async () => {
		const { container } = renderWindow()
		const big = new File(['x'], 'big.bin')
		Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
		fireEvent.change(fileInput(container), { target: { files: [big] } })
		expect(await screen.findByRole('alert')).toHaveTextContent('Attachments must be under 2 MB total.')
	})

	it('counts files already attached against the 2 MB budget', async () => {
		const { container } = renderWindow()
		fireEvent.change(fileInput(container), {
			target: { files: [new File([new Uint8Array(1536 * 1024)], 'first.bin')] },
		})
		expect(await screen.findByText('first.bin')).toBeInTheDocument()

		// Alone this file fits; with the first one the message would be over the limit.
		const second = new File(['x'], 'second.bin')
		Object.defineProperty(second, 'size', { value: 1024 * 1024 })
		fireEvent.change(fileInput(container), { target: { files: [second] } })

		expect(await screen.findByRole('alert')).toHaveTextContent('Attachments must be under 2 MB total.')
		expect(screen.queryByText('second.bin')).not.toBeInTheDocument()
	})

	it('shows a generic message when reading a file fails', async () => {
		const { container } = renderWindow()
		const broken = new File([new Uint8Array(4)], 'broken.txt')
		Object.defineProperty(broken, 'arrayBuffer', {
			value: () => Promise.reject(new Error('read failed')),
			configurable: true,
		})
		fireEvent.change(fileInput(container), { target: { files: [broken] } })
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not attach the file. Check the file and try again.',
		)
	})

	it('shows a generic message when a non-Error is thrown while reading a file', async () => {
		const { container } = renderWindow()
		const broken = new File([new Uint8Array(4)], 'broken.txt')
		Object.defineProperty(broken, 'arrayBuffer', {
			value: () => Promise.reject('nope'),
			configurable: true,
		})
		fireEvent.change(fileInput(container), { target: { files: [broken] } })
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not attach the file. Check the file and try again.',
		)
	})

	it('generates a client id without crypto.randomUUID when it is unavailable', async () => {
		const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
		Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
		try {
			const { container } = renderWindow()
			fireEvent.change(fileInput(container), {
				target: { files: [new File([new Uint8Array(5)], 'fallback.txt')] },
			})
			expect(await screen.findByText('fallback.txt')).toBeInTheDocument()
		} finally {
			if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original)
		}
	})

	it('ignores a second selection while the first is still being read', async () => {
		const read = deferred<ArrayBuffer>()
		const pending = new File([new Uint8Array([1, 2, 3])], 'first.txt')
		Object.defineProperty(pending, 'arrayBuffer', { value: () => read.promise, configurable: true })
		const { container } = renderWindow()
		fireEvent.change(fileInput(container), { target: { files: [pending] } })
		await screen.findByRole('button', { name: 'Attaching...' })
		expect(screen.getByText('Attaching…')).toBeInTheDocument()

		fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'second.txt')] } })
		read.resolve(new Uint8Array([1, 2, 3]).buffer)

		expect(await screen.findByText('first.txt')).toBeInTheDocument()
		expect(screen.queryByText('second.txt')).not.toBeInTheDocument()
	})

	it('blocks sending until the selected attachment finishes processing', async () => {
		const read = deferred<ArrayBuffer>()
		const pending = new File([new Uint8Array([1, 2, 3])], 'pending.txt')
		Object.defineProperty(pending, 'arrayBuffer', { value: () => read.promise, configurable: true })
		const { container, onSent } = renderWindow({
			seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'body' }),
		})

		fireEvent.change(fileInput(container), { target: { files: [pending] } })

		const attaching = await screen.findByRole('button', { name: 'Attaching...' })
		expect(attaching).toBeDisabled()
		fireEvent.click(attaching)
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()

		read.resolve(new Uint8Array([1, 2, 3]).buffer)
		expect(await screen.findByText('pending.txt')).toBeInTheDocument()
		const send = screen.getByRole('button', { name: 'Send' })
		expect(send).not.toBeDisabled()
		fireEvent.click(send)

		await waitFor(() => expect(onSent).toHaveBeenCalled())
		expect(saveDraft.mock.calls[0][0].data.attachments).toHaveLength(1)
	})
})

describe('ComposeWindow send', () => {
	it('blocks a recipient-less send with focused, accessible guidance before persistence', async () => {
		const { onSent } = renderWindow({ seed: fieldsSeed({ subject: 'Hi', body: 'body' }) })

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		const guidance = await screen.findByRole('alert')
		expect(guidance).toHaveTextContent('Add at least one recipient before sending.')
		const to = screen.getByLabelText('To')
		expect(to).toHaveFocus()
		expect(to).toHaveAttribute('aria-invalid', 'true')
		expect(to).toHaveAttribute('aria-describedby', 'compose-recipient-error')
		expect(guidance).toHaveAttribute('id', 'compose-recipient-error')
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()
		expect(onSent).not.toHaveBeenCalled()
		expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
	})

	it('identifies malformed recipients without reflecting them and clears guidance after correction', async () => {
		const { onSent } = renderWindow({
			seed: fieldsSeed({ to: 'valid@example.com, not-an-email', subject: 'Hi', body: 'body' }),
		})

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		const guidance = await screen.findByRole('alert')
		expect(guidance).toHaveTextContent('Enter a valid email address for each recipient before sending.')
		expect(guidance).not.toHaveTextContent('not-an-email')
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()

		const to = screen.getByLabelText('To')
		fireEvent.change(to, { target: { value: 'valid@example.com' } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		expect(to).not.toHaveAttribute('aria-invalid')
		expect(to).not.toHaveAttribute('aria-describedby')

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))
		await waitFor(() => expect(onSent).toHaveBeenCalled())
	})

	it('rejects an overlong recipient with static guidance and no mutation', async () => {
		const overlong = `${'a'.repeat(316)}@x.co`
		renderWindow({ seed: fieldsSeed({ to: overlong, subject: 'Hi', body: 'body' }) })

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		const guidance = await screen.findByRole('alert')
		expect(guidance).toHaveTextContent('Enter a valid email address for each recipient before sending.')
		expect(guidance).not.toHaveTextContent(overlong)
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()
	})

	it('applies recipient validation to the keyboard send shortcut', async () => {
		renderWindow({ seed: fieldsSeed({ subject: 'Hi', body: 'body' }) })
		const to = screen.getByLabelText('To')
		to.focus()

		fireEvent.keyDown(to, { key: 'Enter', ctrlKey: true })

		expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one recipient before sending.')
		expect(to).toHaveFocus()
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()
	})

	it('sends the visible uncommitted recipient through the imperative input seam', async () => {
		recipientInputMock.keepDraftLocal = true
		renderWindow({ seed: fieldsSeed({ subject: 'Hi', body: 'body' }) })
		fireEvent.change(screen.getByLabelText('To'), { target: { value: 'visible@example.com' } })

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		await waitFor(() => expect(sendDraft).toHaveBeenCalledTimes(1))
		expect(saveDraft).toHaveBeenCalledWith({
			data: { to: 'visible@example.com', subject: 'Hi', body: markdownToDraftBody('body') },
		})
		expect(sendDraft.mock.calls[0][0].data.to).toBe('visible@example.com')
	})

	it.each([
		['Control', { ctrlKey: true }],
		['Command', { metaKey: true }],
	])('sends an uncommitted recipient once with the %s+Enter shortcut', async (_name, modifier) => {
		recipientInputMock.keepDraftLocal = true
		const { onSent } = renderWindow({ seed: fieldsSeed({ subject: 'Hi', body: 'body' }) })
		const to = screen.getByLabelText('To')
		fireEvent.change(to, { target: { value: 'shortcut@example.com' } })
		to.focus()

		fireEvent.keyDown(to, { key: 'Enter', ...modifier })

		await waitFor(() => expect(sendDraft).toHaveBeenCalledTimes(1))
		expect(saveDraft).toHaveBeenCalledTimes(1)
		expect(saveDraft.mock.calls[0][0].data.to).toBe('shortcut@example.com')
		expect(sendDraft.mock.calls[0][0].data.to).toBe('shortcut@example.com')
		await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
	})

	it('sends from a minimized window with the recipients it already has', async () => {
		// Minimized, the To field is not mounted, so the shortcut falls back to the
		// recipients held in the composer.
		const { onSent } = renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'body' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Minimize composer' }))
		const restore = screen.getByRole('button', { name: 'Restore composer' })
		restore.focus()

		fireEvent.keyDown(restore, { key: 'Enter', metaKey: true })

		await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
		expect(sendDraft.mock.calls[0][0].data.to).toBe('a@b.com')
	})

	it('blocks a malformed uncommitted recipient from the keyboard path', async () => {
		recipientInputMock.keepDraftLocal = true
		renderWindow({ seed: fieldsSeed({ subject: 'Hi', body: 'body' }) })
		const to = screen.getByLabelText('To')
		fireEvent.change(to, { target: { value: 'private-invalid-value' } })
		to.focus()

		fireEvent.keyDown(to, { key: 'Enter', ctrlKey: true })

		const guidance = await screen.findByRole('alert')
		expect(guidance).toHaveTextContent('Enter a valid email address for each recipient before sending.')
		expect(guidance).not.toHaveTextContent('private-invalid-value')
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()
	})

	it('saves then sends the same provider draft as email-ready HTML, then reports it sent', async () => {
		// The composer state holds markdown source; the backing draft is updated
		// to inline-styled HTML before the provider sends that exact draft.
		saveDraft.mockResolvedValue({ draftId: 'draft-1' })
		const { onSent, onClosed } = renderWindow({
			seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'line **one**' }),
		})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		expect(await screen.findByRole('button', { name: /Sending/ })).toBeDisabled()
		expect(screen.getByText('Sending…')).toBeInTheDocument()

		await waitFor(() =>
			expect(sendDraft).toHaveBeenCalledWith({
				data: {
					draftId: 'draft-1',
					to: 'a@b.com',
					subject: 'Hi',
					body: markdownToEmailHtml('line **one**'),
				},
			}),
		)
		expect(sendDraft.mock.calls[0][0].data.body).toContain('<strong>one</strong>')
		expect(saveDraft).toHaveBeenCalledWith({
			data: { to: 'a@b.com', subject: 'Hi', body: markdownToDraftBody('line **one**') },
		})
		// The window does not navigate anywhere after sending (it used to jump to Sent): it
		// hands back to the app, which closes it over whatever the reader was looking at.
		await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
		expect(onClosed).not.toHaveBeenCalled()
		await waitFor(() => expect(saveComposeRecipients).toHaveBeenCalledWith({ data: { emails: ['a@b.com'] } }))
	})

	it('adds newly saved recipients to the contacts cache, and never fails a sent message over it', async () => {
		saveComposeRecipients.mockResolvedValueOnce({
			contacts: [{ id: 'c1', emails: [{ email: 'a@b.com' }] }],
		})
		const { onSent } = renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'x' }) })
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() => expect(saveComposeRecipients).toHaveBeenCalled())
		expect(onSent).toHaveBeenCalledTimes(1)

		saveComposeRecipients.mockRejectedValueOnce(new Error('contacts offline'))
		cleanup()
		const second = renderWindow({ seed: fieldsSeed({ to: 'b@b.com', subject: 'Hi', body: 'x' }) })
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() => expect(saveComposeRecipients).toHaveBeenCalledTimes(2))
		expect(second.onSent).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('includes attachments and the reply-to id in a reply send', async () => {
		const { container } = renderWindow({
			seed: fieldsSeed({ to: 'a@b.com', subject: 'Re: Hi', body: 'body', replyToMessageId: 'm9' }),
		})
		fireEvent.change(fileInput(container), {
			target: { files: [new File([new Uint8Array(3)], 'note.txt')] },
		})
		await screen.findByText('note.txt')

		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() => expect(sendDraft).toHaveBeenCalled())
		const payload = sendDraft.mock.calls[0][0].data
		expect(payload.replyToMessageId).toBe('m9')
		// Send uses the draft just saved above, so the server restores its
		// attachments instead of appending the same file a second time.
		expect(payload).not.toHaveProperty('attachments')
		expect(saveDraft.mock.calls[0][0].data.attachments).toHaveLength(1)
	})

	it('updates and sends the existing draft instead of creating a second message', async () => {
		saveDraft.mockResolvedValue({ draftId: 'd0' })
		renderWindow({
			seed: draftSeed({ id: 'd0', to: [{ email: 'a@b.com' }], subject: 'Draft', body: 'body' }),
		})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))

		await waitFor(() =>
			expect(sendDraft).toHaveBeenCalledWith({
				data: { draftId: 'd0', to: 'a@b.com', subject: 'Draft', body: markdownToEmailHtml('body') },
			}),
		)
		expect(saveDraft.mock.calls[0][0].data.draftId).toBe('d0')
	})

	it('keeps the reply reference when an autosaved reply is reopened from Drafts and sent', async () => {
		saveDraft.mockResolvedValue({ draftId: 'd0' })
		renderWindow({
			seed: draftSeed({
				id: 'd0',
				to: [{ email: 'a@b.com' }],
				subject: 'Re: Hi',
				body: 'body',
				reply_to_message_id: 'm9',
			}),
		})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() =>
			expect(sendDraft).toHaveBeenCalledWith({
				data: {
					draftId: 'd0',
					to: 'a@b.com',
					subject: 'Re: Hi',
					body: markdownToEmailHtml('body'),
					replyToMessageId: 'm9',
				},
			}),
		)
	})

	it('shows a generic error and re-enables sending when the send fails', async () => {
		sendDraft.mockRejectedValue(new Error('SMTP down'))
		const { onSent, onClosed } = renderWindow({
			seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'x' }),
		})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not send your message. Check your connection, then try again.',
		)
		expect(screen.queryByText(/SMTP down/)).toBeNull()
		expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
		expect(onSent).not.toHaveBeenCalled()
		expect(onClosed).not.toHaveBeenCalled()
		expect(saveComposeRecipients).not.toHaveBeenCalled()
	})

	it('shows a generic error when the send rejects with a non-Error', async () => {
		sendDraft.mockRejectedValue('boom')
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'x' }) })
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not send your message. Check your connection, then try again.',
		)
	})

	it('does not save recipients when contact autosave is disabled in preferences', async () => {
		window.localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({
				displayName: '',
				autoSaveContacts: false,
				primaryTimezone: 'UTC',
				secondaryTimezone: '',
			}),
		)
		const { onSent } = renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'x' }) })
		await act(async () => {})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() => expect(onSent).toHaveBeenCalled())
		expect(saveComposeRecipients).not.toHaveBeenCalled()
	})
})

describe('ComposeWindow save draft', () => {
	it('continues to save drafts without recipients', async () => {
		renderWindow({ seed: fieldsSeed({ subject: 'Hi', body: 'draft body' }) })

		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: '', subject: 'Hi', body: markdownToDraftBody('draft body') },
			}),
		)
		expect(sendDraft).not.toHaveBeenCalled()
	})

	it('saves immediately when Save draft is clicked', async () => {
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'draft body' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: 'a@b.com', subject: 'Hi', body: markdownToDraftBody('draft body') },
			}),
		)
		expect(await screen.findByText('Saved')).toBeInTheDocument()
	})

	it('updates the draft it already saved rather than creating another on the next save', async () => {
		saveDraft.mockResolvedValue({ draftId: 'saved-once' })
		renderWindow({ seed: fieldsSeed({ subject: 'Hi' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		await screen.findByText('Saved')

		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hi again' } })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

		await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2))
		expect(saveDraft.mock.calls[1][0].data).toMatchObject({ draftId: 'saved-once', subject: 'Hi again' })
	})

	it('shows a generic save error returned by the server', async () => {
		saveDraft.mockRejectedValue(new Error('Mailbox unavailable'))
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'draft body' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save the draft. Your changes are still here; check your connection and try again.',
		)
		expect(screen.queryByText(/Mailbox unavailable/)).toBeNull()
	})

	it('shows a generic error when manual saving rejects with a non-Error', async () => {
		saveDraft.mockRejectedValue('offline')
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'draft body' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save the draft. Your changes are still here; check your connection and try again.',
		)
	})

	it('shows a generic error when saving rejects with an object whose message is not text', async () => {
		saveDraft.mockRejectedValue({ message: 42 })
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save the draft. Your changes are still here; check your connection and try again.',
		)
	})

	it('explains when a draft recipient needs correction', async () => {
		saveDraft.mockRejectedValue(new Error('Invalid recipient: not-an-email'))
		renderWindow({ seed: fieldsSeed({ to: 'not-an-email', subject: 'Hi', body: 'draft body' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Enter a valid email address for each recipient before saving.')
		expect(alert).not.toHaveTextContent('not-an-email')
	})
})

describe('ComposeWindow discard', () => {
	it('deletes the backing draft then closes', async () => {
		const { onClosed } = renderWindow({ seed: draftSeed({ id: 'd0' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith({ data: { draftId: 'd0' } }))
		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
		// Discarding is not a save: the draft is gone, not written once more on the way out.
		expect(saveDraft).not.toHaveBeenCalled()
	})

	it('closes without a delete call when there is no saved draft', async () => {
		const { onClosed } = renderWindow()
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1))
		expect(deleteDraft).not.toHaveBeenCalled()
	})

	it('shows a generic error and stays open when deleting the draft fails', async () => {
		deleteDraft.mockRejectedValue(new Error('delete failed'))
		const { onClosed } = renderWindow({ seed: draftSeed({ id: 'd0' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not discard the draft. Check your connection, then try again.',
		)
		expect(onClosed).not.toHaveBeenCalled()
		expect(screen.getByRole('button', { name: 'Discard draft' })).toBeEnabled()
	})

	it('shows a generic error when discarding rejects with a non-Error', async () => {
		deleteDraft.mockRejectedValue('kaboom')
		renderWindow({ seed: draftSeed({ id: 'd0' }) })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not discard the draft. Check your connection, then try again.',
		)
	})
})

describe('ComposeWindow autosave', () => {
	it('does nothing when the composer is empty', async () => {
		vi.useFakeTimers()
		renderWindow()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		expect(saveDraft).not.toHaveBeenCalled()
	})

	it('autosaves content after the idle delay and briefly shows "Saved"', async () => {
		vi.useFakeTimers()
		saveDraft.mockResolvedValue({ draftId: 'saved-1' })
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'draft body' }) })

		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		// The body is stored in the markdown envelope so reloading the draft never
		// mistakes markdown containing literal tags for a legacy HTML draft.
		expect(saveDraft).toHaveBeenCalledWith({
			data: { to: 'a@b.com', subject: 'Hi', body: markdownToDraftBody('draft body') },
		})
		expect(screen.getByText('Saved')).toBeInTheDocument()

		// The "Saved" hint clears itself after a short delay.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2500)
		})
		expect(screen.queryByText('Saved')).not.toBeInTheDocument()
	})

	it('keeps the reply reference when autosaving a reply', async () => {
		vi.useFakeTimers()
		saveDraft.mockResolvedValue({ draftId: 'saved-1' })
		renderWindow({
			seed: fieldsSeed({ to: 'a@b.com', subject: 'Re: Hi', body: 'draft body', replyToMessageId: 'm9' }),
		})

		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})

		expect(saveDraft).toHaveBeenCalledWith({
			data: {
				to: 'a@b.com',
				subject: 'Re: Hi',
				body: markdownToDraftBody('draft body'),
				replyToMessageId: 'm9',
			},
		})
	})

	it('autosaves an existing draft with its id and any attachments', async () => {
		vi.useFakeTimers()
		saveDraft.mockResolvedValue({ draftId: 'd0' })
		const { container } = renderWindow({ seed: draftSeed({ id: 'd0' }) })

		fireEvent.change(fileInput(container), {
			target: { files: [new File([new Uint8Array(3)], 'a.txt')] },
		})
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0)
		})
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})

		const payload = saveDraft.mock.calls[0][0].data
		expect(payload.draftId).toBe('d0')
		expect(payload.attachments).toHaveLength(1)
	})

	it('swallows autosave failures so a transient error never interrupts editing', async () => {
		vi.useFakeTimers()
		saveDraft.mockRejectedValue(new Error('offline'))
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'body' }) })
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		expect(saveDraft).toHaveBeenCalled()
		expect(screen.queryByText('Saved')).not.toBeInTheDocument()
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('queues a send behind an in-flight autosave so both update one draft, not two', async () => {
		vi.useFakeTimers()
		const autosave = deferred<{ draftId: string }>()
		saveDraft.mockReturnValueOnce(autosave.promise).mockResolvedValue({ draftId: 'auto-1' })
		const { onSent } = renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'body' }) })

		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		expect(saveDraft).toHaveBeenCalledTimes(1)
		expect(screen.getByText('Saving…')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0)
		})
		// The send's save waits for the autosave rather than racing it with a second create.
		expect(saveDraft).toHaveBeenCalledTimes(1)

		await act(async () => {
			autosave.resolve({ draftId: 'auto-1' })
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(saveDraft).toHaveBeenCalledTimes(2)
		expect(saveDraft.mock.calls[1][0].data.draftId).toBe('auto-1')
		expect(sendDraft.mock.calls[0][0].data.draftId).toBe('auto-1')
		expect(onSent).toHaveBeenCalledTimes(1)
	})

	it('keeps saying "Saving…" while a later save is queued behind one that failed', async () => {
		// The status must reflect the last queued save, not the first to settle.
		vi.useFakeTimers()
		const manual = deferred<{ draftId: string }>()
		const autosave = deferred<{ draftId: string }>()
		saveDraft.mockReturnValueOnce(manual.promise).mockReturnValueOnce(autosave.promise)
		renderWindow({ seed: fieldsSeed({ to: 'a@b.com', subject: 'Hi', body: 'body' }) })

		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		await act(async () => {
			manual.reject(new Error('offline'))
			await vi.advanceTimersByTimeAsync(0)
		})

		expect(screen.getByRole('alert')).toHaveTextContent('Could not save the draft.')
		expect(saveDraft).toHaveBeenCalledTimes(2)
		expect(screen.getByRole('dialog', { name: 'Compose message' })).toHaveAttribute('aria-busy', 'true')
		expect(screen.getByText('Saving…')).toBeInTheDocument()

		await act(async () => {
			autosave.resolve({ draftId: 'auto-1' })
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
		expect(screen.getByText('Saved')).toBeInTheDocument()
	})
})
