// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailKeys } from '#features/mail/state/mail-queries'
import { ToastProvider } from '#shared/components/Toaster'

const getDraft = vi.fn()
const saveDraft = vi.fn()
const sendDraft = vi.fn()
const saveComposeRecipients = vi.fn()
vi.mock('#server/fns', () => ({
	getDraft: (a: any) => getDraft(a),
	saveDraft: (a: any) => saveDraft(a),
	sendDraft: (a: any) => sendDraft(a),
	saveComposeRecipients: (a: any) => saveComposeRecipients(a),
	deleteDraft: vi.fn(),
	markThreadRead: vi.fn(),
	updateThreadState: vi.fn(),
}))

// The composer's own fields are covered in ComposeWindow.test.tsx; here the "To"
// autocomplete and the markdown editor are plain inputs so the provider's job —
// which composer is open, where, and what happens around it — is what is asserted.
vi.mock('#shared/components/RecipientInput', async () => {
	const React = await vi.importActual<typeof import('react')>('react')
	return {
		RecipientInput: React.forwardRef(function MockRecipientInput(
			{ id, value, onChange, disabled }: any,
			ref,
		) {
			React.useImperativeHandle(ref, () => ({ getCurrentValue: () => value }), [value])
			return (
				<input
					id={id}
					aria-label="To"
					value={value}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
				/>
			)
		}),
	}
})
vi.mock('./MarkdownEditor.js', () => ({
	MarkdownEditor: ({ id, value, onChange, readOnly }: any) => (
		<textarea
			id={id}
			placeholder="Write your message..."
			value={value}
			readOnly={readOnly}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}))

import { ComposeProvider, type ComposeRequest, loadComposeWindow, useCompose } from './ComposeProvider.js'

// The app warms the composer code while idle, so these tests start from that
// state; opening before it has loaded is covered in ComposeProvider.lazy.test.tsx.
beforeAll(async () => {
	await loadComposeWindow()
})
afterEach(() => {
	cleanup()
})
beforeEach(() => {
	vi.clearAllMocks()
	getDraft.mockResolvedValue({ id: 'd1', subject: 'Saved subject', body: 'Saved body' })
	saveDraft.mockResolvedValue({ draftId: 'saved-draft' })
	sendDraft.mockResolvedValue({ removedDraftId: 'saved-draft' })
	saveComposeRecipients.mockResolvedValue({ contacts: [] })
})

let compose: ReturnType<typeof useCompose>

/** Captures the context, shows what is being composed, and offers an opener button. */
function Harness({ request = { kind: 'new' } as ComposeRequest }: { request?: ComposeRequest }) {
	compose = useCompose()
	return (
		<>
			<button type="button" onClick={() => void compose.openCompose(request)}>
				Open composer
			</button>
			<span data-testid="composing">{JSON.stringify(compose.composing)}</span>
		</>
	)
}

/** A thread on screen offering the place under its last message for its reply. */
function ThreadSlot({ threadId }: { threadId: string }) {
	const { registerInlineSlot } = useCompose()
	return <div data-testid={`slot-${threadId}`} ref={(element) => registerInlineSlot(threadId, element)} />
}

function renderProvider({
	request,
	slots = [],
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: {
	request?: ComposeRequest
	slots?: string[]
	queryClient?: QueryClient
} = {}) {
	const tree = (slotIds: string[]) => (
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<ComposeProvider>
					<Harness request={request} />
					{slotIds.map((threadId) => (
						<ThreadSlot key={threadId} threadId={threadId} />
					))}
				</ComposeProvider>
			</ToastProvider>
		</QueryClientProvider>
	)
	const view = render(tree(slots))
	return { ...view, setSlots: (slotIds: string[]) => view.rerender(tree(slotIds)) }
}

async function open(request: ComposeRequest) {
	await act(async () => {
		await compose.openCompose(request)
	})
}

function composing() {
	return JSON.parse(screen.getByTestId('composing').textContent ?? 'null')
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {}
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

describe('ComposeProvider opening', () => {
	it('opens a new message as a floating window over whatever is on screen', async () => {
		renderProvider()
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

		await open({ kind: 'new', to: 'a@b.com', subject: 'Hello' })

		const dialog = screen.getByRole('dialog', { name: 'Compose message' })
		expect(dialog).toHaveAttribute('data-presentation', 'floating')
		expect(screen.getByLabelText('To')).toHaveValue('a@b.com')
		expect(screen.getByLabelText('Subject')).toHaveValue('Hello')
	})

	it('saves the open composer before replacing it, so opening another never drops a draft', async () => {
		const save = deferred<{ draftId: string }>()
		saveDraft.mockReturnValueOnce(save.promise)
		renderProvider()
		await open({ kind: 'new' })
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'First message' } })

		let second: Promise<void> = Promise.resolve()
		act(() => {
			second = compose.openCompose({ kind: 'new', subject: 'Second message' })
		})
		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({ data: { to: '', subject: 'First message', body: '' } }),
		)
		// Until that save lands, the first composer is still the one on screen.
		expect(screen.getByLabelText('Subject')).toHaveValue('First message')

		await act(async () => {
			save.resolve({ draftId: 'first-draft' })
			await second
		})
		expect(screen.getAllByRole('dialog')).toHaveLength(1)
		expect(screen.getByLabelText('Subject')).toHaveValue('Second message')
	})

	it('starts each draft fresh: fields edited in one draft never carry into the next', async () => {
		// Keyed by id: saving a draft refetches cached drafts, so call order is not stable.
		const drafts: Record<string, object> = {
			'draft-one': { id: 'draft-one', to: [{ email: 'first@example.com' }], subject: 'First subject' },
			'draft-two': { id: 'draft-two', to: [{ email: 'second@example.com' }], subject: 'Second subject' },
		}
		getDraft.mockImplementation(async ({ data }: any) => drafts[data.draftId])
		saveDraft.mockResolvedValueOnce({ draftId: 'draft-one' })
		renderProvider()
		await open({ kind: 'draft', draftId: 'draft-one' })
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited first subject' } })

		await open({ kind: 'draft', draftId: 'draft-two' })

		expect(saveDraft.mock.calls[0][0].data).toMatchObject({
			draftId: 'draft-one',
			subject: 'Edited first subject',
		})
		expect(screen.getByLabelText('To')).toHaveValue('second@example.com')
		expect(screen.getByLabelText('Subject')).toHaveValue('Second subject')
	})

	it('keeps the open composer, and its error, when its draft cannot be saved', async () => {
		saveDraft.mockRejectedValueOnce(new Error('offline'))
		renderProvider()
		await open({ kind: 'new' })
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Unsaved work' } })

		await open({ kind: 'new', subject: 'Replacement' })

		expect(screen.getByLabelText('Subject')).toHaveValue('Unsaved work')
		expect(screen.getByRole('alert')).toHaveTextContent('Could not save the draft.')
		expect(composing()).toEqual({ kind: 'new' })
	})

	it('loads a draft before opening it, so the window starts with the saved fields', async () => {
		renderProvider()
		await open({ kind: 'draft', draftId: 'd1' })

		expect(getDraft).toHaveBeenCalledWith({ data: { draftId: 'd1' } })
		expect(screen.getByLabelText('Subject')).toHaveValue('Saved subject')
		expect(screen.getByPlaceholderText('Write your message...')).toHaveValue('Saved body')
	})

	it('refetches an invalidated cached draft rather than reopening stale fields', async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		queryClient.setQueryData(mailKeys.draft('d1'), { id: 'd1', subject: 'Obsolete cached subject' })
		await queryClient.invalidateQueries({ queryKey: mailKeys.draft('d1'), refetchType: 'none' })
		getDraft.mockResolvedValue({ id: 'd1', subject: 'Current server subject' })
		renderProvider({ queryClient })

		await open({ kind: 'draft', draftId: 'd1' })

		expect(getDraft).toHaveBeenCalledWith({ data: { draftId: 'd1' } })
		expect(screen.getByLabelText('Subject')).toHaveValue('Current server subject')
	})

	it('says so, and opens nothing, when a draft cannot be loaded', async () => {
		getDraft.mockRejectedValue(new Error('provider-secret-detail'))
		renderProvider()

		await open({ kind: 'draft', draftId: 'd1' })

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(screen.getByRole('status')).toHaveTextContent('Could not open the draft. Try again from Drafts.')
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(composing()).toBeNull()
	})
})

describe('ComposeProvider inline replies', () => {
	it('writes a reply in its thread when that thread is on screen', async () => {
		renderProvider({ slots: ['t1'] })
		await open({ kind: 'reply', threadId: 't1', replyToMessageId: 'm1', subject: 'Re: Hi' })

		const reply = screen.getByRole('region', { name: 'Reply' })
		expect(screen.getByTestId('slot-t1')).toContainElement(reply)
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	})

	it('floats the reply, keeping what was written, once its thread leaves the screen', async () => {
		const { setSlots } = renderProvider({ slots: ['t1'] })
		await open({ kind: 'reply', threadId: 't1', replyToMessageId: 'm1' })
		fireEvent.change(screen.getByPlaceholderText('Write your message...'), {
			target: { value: 'Half a reply' },
		})

		setSlots([])

		expect(screen.getByRole('dialog', { name: 'Compose message' })).toBeInTheDocument()
		expect(screen.getByPlaceholderText('Write your message...')).toHaveValue('Half a reply')
	})

	it('floats a reply whose thread is not on screen, or that names no thread', async () => {
		renderProvider({ slots: ['other-thread'] })
		await open({ kind: 'reply', threadId: 't1', replyToMessageId: 'm1' })
		expect(screen.getByRole('dialog', { name: 'Compose message' })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		await open({ kind: 'reply', replyToMessageId: 'm1' })
		expect(screen.getByRole('dialog', { name: 'Compose message' })).toBeInTheDocument()
	})

	it('floats a forward even when its thread is on screen, because it goes to someone new', async () => {
		renderProvider({ slots: ['t1'] })
		await open({ kind: 'forward', threadId: 't1', subject: 'Fwd: Hi' })

		expect(screen.getByRole('dialog', { name: 'Compose message' })).toBeInTheDocument()
		expect(screen.getByTestId('slot-t1')).toBeEmptyDOMElement()
	})

	it('ignores repeated or unknown slot registrations', async () => {
		renderProvider({ slots: ['t1'] })
		const slot = screen.getByTestId('slot-t1')
		act(() => {
			compose.registerInlineSlot('t1', slot)
			compose.registerInlineSlot('never-registered', null)
		})
		await open({ kind: 'reply', threadId: 't1', replyToMessageId: 'm1' })
		expect(slot).toContainElement(screen.getByRole('region', { name: 'Reply' }))
	})
})

describe('ComposeProvider composing state', () => {
	it('tells the page what is being composed, and for which thread', async () => {
		renderProvider()
		expect(composing()).toBeNull()

		await open({ kind: 'reply', threadId: 't1', replyToMessageId: 'm1' })
		expect(composing()).toEqual({ kind: 'reply', threadId: 't1' })

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		await waitFor(() => expect(composing()).toBeNull())

		await open({ kind: 'draft', draftId: 'd1' })
		expect(composing()).toEqual({ kind: 'draft' })
	})
})

describe('ComposeProvider closing', () => {
	it('returns focus to whatever opened the composer', async () => {
		renderProvider()
		const opener = screen.getByRole('button', { name: 'Open composer' })
		opener.focus()
		await act(async () => {
			fireEvent.click(opener)
		})
		await waitFor(() => expect(screen.getByLabelText('To')).toHaveFocus())

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(opener).toHaveFocus()
	})

	it('leaves focus alone when the opener is no longer on screen', async () => {
		renderProvider()
		const opener = document.createElement('button')
		document.body.appendChild(opener)
		opener.focus()
		await open({ kind: 'new' })
		opener.remove()

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(opener).not.toHaveFocus()
	})

	it('closes cleanly when nothing focusable opened it', async () => {
		renderProvider()
		// Shadows the prototype getter on this document only; deleting it restores the real one.
		Object.defineProperty(document, 'activeElement', { get: () => null, configurable: true })
		try {
			await open({ kind: 'new' })
		} finally {
			delete (document as { activeElement?: unknown }).activeElement
		}

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
	})

	it('confirms a sent message with a toast and puts focus back', async () => {
		renderProvider({ request: { kind: 'new', to: 'a@b.com', subject: 'Hi' } })
		const opener = screen.getByRole('button', { name: 'Open composer' })
		opener.focus()
		await act(async () => {
			fireEvent.click(opener)
		})
		await waitFor(() => expect(screen.getByPlaceholderText('Write your message...')).toHaveFocus())

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(sendDraft).toHaveBeenCalled()
		expect(screen.getByRole('status')).toHaveTextContent('Sent')
		expect(opener).toHaveFocus()
	})

	it('does not toast when the composer is merely closed', async () => {
		renderProvider()
		await open({ kind: 'new' })
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		expect(screen.getByRole('status')).toBeEmptyDOMElement()
	})
})

describe('useCompose outside a provider', () => {
	it('is a harmless no-op, so a page rendered on its own (in tests, or before sign-in) does not crash', async () => {
		const { result } = renderHook(() => useCompose())
		expect(result.current.composing).toBeNull()
		await expect(result.current.openCompose({ kind: 'new' })).resolves.toBeUndefined()
		expect(() => result.current.registerInlineSlot('t1', null)).not.toThrow()
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
	})
})
