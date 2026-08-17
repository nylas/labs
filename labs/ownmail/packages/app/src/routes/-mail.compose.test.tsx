// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownToDraftBody } from '#features/mail/lib/html-to-markdown'
import { markdownToEmailHtml } from '#features/mail/lib/markdown-model'
import { mailKeys } from '#features/mail/state/mail-queries'

// TanStack router/start are stubbed so the route module can be imported and its
// loader/component exercised directly without a live router. `navigate` and
// `invalidate` are captured so tests can assert navigation intent.
const navigate = vi.fn()
const invalidate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	Link: ({ children, to, search, ...rest }: any) => (
		<a data-to={to} data-search={JSON.stringify(search)} {...rest}>
			{children}
		</a>
	),
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate }),
	useRouterState: (opts: any) => opts.select({ location: { pathname: '/mail/compose' }, matches: [] }),
	Outlet: () => null,
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({ handler: (fn: any) => fn }),
}))

// All server calls are mocked so a render never touches the network; tests assert
// the right fn is called with the right payload.
const getDraft = vi.fn()
const getFolders = vi.fn()
const getThreads = vi.fn()
const getThreadMessages = vi.fn()
const listDrafts = vi.fn()
const saveDraft = vi.fn()
const saveComposeRecipients = vi.fn()
const sendDraft = vi.fn()
const sendMessage = vi.fn()
const updateThreadState = vi.fn()
const deleteDraft = vi.fn()
const recipientInputMock = vi.hoisted(() => ({ keepDraftLocal: false }))
vi.mock('#server/fns', () => ({
	getDraft: (a: any) => getDraft(a),
	getFolders: (a: any) => getFolders(a),
	getThreads: (a: any) => getThreads(a),
	getThreadMessages: (a: any) => getThreadMessages(a),
	listDrafts: () => listDrafts(),
	saveDraft: (a: any) => saveDraft(a),
	saveComposeRecipients: (a: any) => saveComposeRecipients(a),
	sendDraft: (a: any) => sendDraft(a),
	sendMessage: (a: any) => sendMessage(a),
	updateThreadState: (a: any) => updateThreadState(a),
	deleteDraft: (a: any) => deleteDraft(a),
}))

// Focus coverage on mail.compose.tsx: the "To" autocomplete and the error banner
// are their own units, so they are replaced with minimal stand-ins.
vi.mock('#shared/components/RecipientInput', async () => {
	const React = await vi.importActual<typeof import('react')>('react')
	return {
		RecipientInput: React.forwardRef(function MockRecipientInput(
			{ id, value, onChange, onEdit, placeholder, disabled, invalid, describedBy }: any,
			ref,
		) {
			const [localDraft, setLocalDraft] = React.useState<string | null>(null)
			const currentValue = React.useRef(value)
			currentValue.current = localDraft ?? value
			React.useImperativeHandle(ref, () => ({ getCurrentValue: () => currentValue.current }), [])
			return (
				<input
					id={id}
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
vi.mock('#features/mail/components/MarkdownEditor', () => ({
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
vi.mock('./mail.f.$folderId.t.$threadId.js', () => ({
	ErrorBanner: ({ message }: any) => <div role="alert">{message}</div>,
}))

import { Route } from './mail.compose.js'

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	window.history.replaceState(null, '')
})
beforeEach(() => {
	vi.clearAllMocks()
	recipientInputMock.keepDraftLocal = false
	window.localStorage.removeItem('ownmail:user-preferences:v1')
	getThreads.mockResolvedValue({ threads: [] })
	getFolders.mockResolvedValue([])
	getDraft.mockResolvedValue(null)
	getThreadMessages.mockResolvedValue(null)
	listDrafts.mockResolvedValue([])
	saveDraft.mockResolvedValue({ draftId: 'new-draft', created: true })
	saveComposeRecipients.mockResolvedValue({ contacts: [] })
	sendDraft.mockResolvedValue({ removedDraftId: 'new-draft' })
	sendMessage.mockResolvedValue(undefined)
	updateThreadState.mockImplementation(async ({ data }: any) => ({
		thread: { ...makeThread(), id: data.threadId, ...data },
	}))
	deleteDraft.mockImplementation(async ({ data }: any) => ({ removedDraftId: data.draftId }))
})

const NOW = 1_700_000_000

function makeThread(overrides: any = {}) {
	return {
		id: 't1',
		subject: 'Hello there',
		snippet: 'a snippet',
		unread: false,
		starred: false,
		has_attachments: false,
		message_ids: ['m1'],
		participants: [{ name: 'Alice', email: 'alice@example.com' }],
		folders: [],
		latest_message_received_date: NOW,
		...overrides,
	}
}

function makeMessage(overrides: any = {}) {
	return {
		id: 'm1',
		from: [{ name: 'Alice', email: 'alice@example.com' }],
		to: [{ name: 'Bob', email: 'bob@example.com' }],
		date: NOW,
		subject: 'Hello there',
		body: '<p>First line</p><p>Second line</p>',
		snippet: 'snippet',
		attachments: [],
		reply_to: [],
		cc: [],
		...overrides,
	}
}

function renderCompose({
	loader = {},
	search = {},
	staleTime = 30_000,
}: {
	loader?: any
	search?: any
	staleTime?: number
} = {}) {
	const data = {
		draft: null,
		folders: [],
		threads: [],
		selected: null,
		folderId: 'inbox',
		reply: null,
		...loader,
	}
	Route.useLoaderData = vi.fn(() => data)
	Route.useSearch = vi.fn(() => search)
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime } } })}
		>
			<Route.options.component />
		</QueryClientProvider>,
	)
}

function fileInput(container: HTMLElement) {
	return container.querySelector('input[type="file"]') as HTMLInputElement
}

function runComposeLoader(
	deps: Record<string, string | undefined>,
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
	return Route.options.loader({
		context: { queryClient },
		deps,
	})
}

describe('mail.compose validateSearch', () => {
	it('keeps only well-typed search params and drops oversized bodies to bound the URL', () => {
		const result = Route.options.validateSearch({
			draft: 'd1',
			folderId: 'inbox',
			threadId: 't1',
			to: 'a@b.com',
			subject: 'Hi',
			body: 'short body',
			replyToMessageId: 'm9',
		})
		expect(result).toEqual({
			draft: 'd1',
			folderId: 'inbox',
			threadId: 't1',
			to: 'a@b.com',
			subject: 'Hi',
			body: 'short body',
			replyToMessageId: 'm9',
		})
	})

	it('rejects non-string values and bodies over 4000 chars so bad input never reaches the loader', () => {
		const result = Route.options.validateSearch({
			draft: 123,
			folderId: null,
			threadId: undefined,
			to: {},
			subject: [],
			body: 'x'.repeat(4001),
			replyToMessageId: 7,
		})
		expect(result).toEqual({})
	})
})

describe('mail.compose loader', () => {
	it('exposes each search param as a loader dep so the loader re-runs when the URL changes', () => {
		const search = {
			draft: 'd1',
			folderId: 'inbox',
			threadId: 't1',
			to: 'a@b.com',
			subject: 'Hi',
			body: 'b',
			replyToMessageId: 'm9',
		}
		expect(Route.options.loaderDeps({ search })).toEqual(search)
	})

	it('opens a blank composer without blocking on mailbox network requests', async () => {
		getFolders.mockResolvedValue([{ id: 'inbox' }])
		getThreads.mockResolvedValue({ threads: [makeThread()] })

		const data = await runComposeLoader({})

		expect(getFolders).not.toHaveBeenCalled()
		expect(getThreads).not.toHaveBeenCalled()
		expect(getDraft).not.toHaveBeenCalled()
		expect(getThreadMessages).not.toHaveBeenCalled()
		expect(data.folderId).toBe('inbox')
		expect(data.draft).toBeNull()
		expect(data.reply).toBeNull()
	})

	it('does not block starred-folder compose on a thread-list request', async () => {
		const data = await runComposeLoader({ folderId: 'starred' })
		expect(data.folderId).toBe('starred')
		expect(getThreads).not.toHaveBeenCalled()
	})

	it('awaits an explicitly requested draft but leaves backdrop detail to the query cache', async () => {
		getDraft.mockResolvedValue({ id: 'd0' })
		getThreadMessages.mockResolvedValue({ thread: makeThread(), messages: [], mailboxEmail: 'me@x.com' })

		const data = await runComposeLoader({ draft: 'd0', threadId: 't1', folderId: 'archive' })

		expect(getDraft).toHaveBeenCalledWith({ data: { draftId: 'd0' } })
		expect(getThreadMessages).not.toHaveBeenCalled()
		expect(data.draft?.id).toBe('d0')
	})

	it('refetches an invalidated cached draft before initializing compose', async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
		})
		queryClient.setQueryData(mailKeys.draft('d0'), {
			id: 'd0',
			subject: 'Obsolete cached subject',
			body: 'Obsolete cached body',
		})
		await queryClient.invalidateQueries({ queryKey: mailKeys.draft('d0'), refetchType: 'none' })
		getDraft.mockResolvedValue({
			id: 'd0',
			subject: 'Current server subject',
			body: 'Current server body',
		})

		const data = await runComposeLoader({ draft: 'd0' }, queryClient)

		expect(getDraft).toHaveBeenCalledWith({ data: { draftId: 'd0' } })
		expect(data.draft).toMatchObject({
			id: 'd0',
			subject: 'Current server subject',
			body: 'Current server body',
		})
	})

	it('builds a reply payload that carries the reply-to message id when replying', async () => {
		const data = await runComposeLoader({
			replyToMessageId: 'm9',
			to: 'a@b.com',
			subject: 'Re: Hi',
			body: 'quoted',
		})
		expect(data.reply).toEqual({
			to: 'a@b.com',
			subject: 'Re: Hi',
			body: 'quoted',
			replyToMessageId: 'm9',
		})
	})

	it('builds a reply payload from a prefilled to/subject/body even without a reply-to id', async () => {
		const data = await runComposeLoader({ subject: 'Fwd: Hi', body: 'forwarded' })
		expect(data.reply).toEqual({ to: '', subject: 'Fwd: Hi', body: 'forwarded' })
	})

	it('defaults every reply field to empty when only a reply-to id survives validation', async () => {
		// A reply-to id with no accompanying to/subject/body must still yield a well-formed
		// payload rather than leaking undefined fields into the composer state.
		const data = await runComposeLoader({ replyToMessageId: 'm9' })
		expect(data.reply).toEqual({ to: '', subject: '', body: '', replyToMessageId: 'm9' })
	})

	it('builds a prefill payload from a lone recipient, defaulting the subject and body', async () => {
		const data = await runComposeLoader({ to: 'x@y.com' })
		expect(data.reply).toEqual({ to: 'x@y.com', subject: '', body: '' })
	})

	it('builds a prefill payload from a lone body, defaulting the recipient and subject', async () => {
		// Only body is present: the to/subject fall through the || chain and default to ''.
		const data = await runComposeLoader({ body: 'just a body' })
		expect(data.reply).toEqual({ to: '', subject: '', body: 'just a body' })
	})
})

describe('mail.compose composer prefill', () => {
	it('prefills recipients, subject and body from an existing draft so edits continue where left off', () => {
		renderCompose({
			loader: {
				draft: {
					id: 'd0',
					to: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
					subject: 'Draft subject',
					body: 'Draft body',
				},
			},
		})
		expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('a@x.com, b@x.com')
		expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Draft subject')
		expect((screen.getByPlaceholderText('Write your message...') as HTMLTextAreaElement).value).toBe(
			'Draft body',
		)
	})

	it('resets every draft-owned field when backdrop navigation selects another draft', async () => {
		let search = { draft: 'draft-one' }
		let loaderData = {
			draft: {
				id: 'draft-one',
				to: [{ email: 'first@example.com' }],
				subject: 'First subject',
				body: 'First body',
			},
			folders: [],
			threads: [],
			selected: null,
			folderId: 'drafts',
			reply: null,
		}
		Route.useLoaderData = vi.fn(() => loaderData)
		Route.useSearch = vi.fn(() => search)
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const view = render(
			<QueryClientProvider client={queryClient}>
				<Route.options.component />
			</QueryClientProvider>,
		)

		fireEvent.change(screen.getByLabelText('To'), { target: { value: 'edited-first@example.com' } })
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited first subject' } })
		fireEvent.change(screen.getByPlaceholderText('Write your message...'), {
			target: { value: 'Edited first body' },
		})

		search = { draft: 'draft-two' }
		loaderData = {
			...loaderData,
			draft: {
				id: 'draft-two',
				to: [{ email: 'second@example.com' }],
				subject: 'Second subject',
				body: 'Second body',
			},
		}
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<Route.options.component />
			</QueryClientProvider>,
		)

		await waitFor(() =>
			expect((screen.getByPlaceholderText('Write your message...') as HTMLTextAreaElement).value).toBe(
				'Second body',
			),
		)
		expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('second@example.com')
		expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Second subject')

		saveDraft.mockResolvedValue({ draftId: 'draft-two' })
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: {
					draftId: 'draft-two',
					to: 'second@example.com',
					subject: 'Second subject',
					body: markdownToDraftBody('Second body'),
				},
			}),
		)
	})

	it('converts an enveloped markdown draft back to its source before prefilling the editor', () => {
		renderCompose({
			loader: { draft: { id: 'd0', body: markdownToDraftBody('**Draft body**') } },
		})
		expect((screen.getByPlaceholderText('Write your message...') as HTMLTextAreaElement).value).toBe(
			'**Draft body**',
		)
	})

	it('does not decode a draft with browser DOM APIs while server-rendering', () => {
		Route.useLoaderData = vi.fn(() => ({
			draft: { id: 'd0', body: markdownToDraftBody('**Draft body**') },
			folders: [],
			threads: [],
			selected: null,
			folderId: 'drafts',
			reply: null,
		}))
		Route.useSearch = vi.fn(() => ({}))
		const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
		Object.defineProperty(globalThis, 'DOMParser', { value: undefined, configurable: true })
		try {
			expect(() =>
				renderToString(
					<QueryClientProvider client={new QueryClient()}>
						<Route.options.component />
					</QueryClientProvider>,
				),
			).not.toThrow()
		} finally {
			if (original) Object.defineProperty(globalThis, 'DOMParser', original)
		}
	})

	it('prefills from a reply payload and shows the reply subject in the window title', () => {
		renderCompose({
			loader: { reply: { to: 'a@b.com', subject: 'Re: Hi', body: 'quoted' } },
		})
		expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('a@b.com')
		expect(screen.getByText('Re: Hi')).toBeInTheDocument()
	})

	it('starts empty and titles the window "New message" for a blank compose', () => {
		renderCompose()
		expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('')
		expect(screen.getByText('New message')).toBeInTheDocument()
	})
})

describe('mail.compose initial focus', () => {
	it('focuses the recipient field for a brand-new message', async () => {
		renderCompose()

		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('To')))
	})

	it('focuses the body when replying, even when reply metadata is incomplete', async () => {
		renderCompose({
			loader: { reply: { to: '', subject: '', body: '', replyToMessageId: 'm9' } },
		})

		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByPlaceholderText('Write your message...')),
		)
	})

	it('focuses the subject when a new message already has recipients', async () => {
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: '', body: '' } } })

		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Subject')))
	})

	it('focuses the body when a non-reply message already has recipients and a subject', async () => {
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hello', body: '' } } })

		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByPlaceholderText('Write your message...')),
		)
	})

	it('focuses the first missing field when reopening a draft', async () => {
		renderCompose({ loader: { draft: { id: 'd0', to: [], subject: 'Saved subject', body: 'Saved body' } } })

		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('To')))
	})

	it('focuses the body when reopening a complete draft', async () => {
		renderCompose({
			loader: {
				draft: {
					id: 'd0',
					to: [{ email: 'a@b.com' }],
					subject: 'Saved subject',
					body: 'Saved body',
				},
			},
		})

		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByPlaceholderText('Write your message...')),
		)
	})
})

describe('mail.compose thread list', () => {
	it('keeps the composer and draft context open when a backdrop thread is selected', () => {
		const { container } = renderCompose({
			loader: {
				threads: [makeThread({ id: 't-backdrop', subject: 'Backdrop thread' })],
				reply: { to: 'ada@example.com', subject: 'Draft subject', body: 'Draft body' },
			},
			search: { to: 'ada@example.com', subject: 'Draft subject', body: 'Draft body' },
		})
		const row = container.querySelector('a[aria-label="Open Backdrop thread from Alice"]')

		expect(row).toHaveAttribute('data-to', '/mail/compose')
		expect(JSON.parse(row?.getAttribute('data-search') ?? '{}')).toEqual({
			folderId: 'inbox',
			threadId: 't-backdrop',
			to: 'ada@example.com',
			subject: 'Draft subject',
			body: 'Draft body',
		})
	})

	it('renders the canonical drafts list in the compose backdrop', async () => {
		listDrafts.mockResolvedValue([
			{ id: 'd-backdrop', to: [{ email: 'draft@example.com' }], subject: 'Saved draft' },
		])
		renderCompose({ loader: { folderId: 'drafts' } })

		expect(await screen.findByText('Saved draft')).toBeInTheDocument()
		expect(getThreads).not.toHaveBeenCalled()
	})

	it('loads another cached-list page without routing through an SSR loader', async () => {
		getThreads
			.mockResolvedValueOnce({ threads: [makeThread()], nextCursor: 'next-page' })
			.mockResolvedValueOnce({ threads: [], nextCursor: undefined })
		renderCompose()

		fireEvent.click(await screen.findByRole('button', { name: 'Load more messages' }))
		await waitFor(() =>
			expect(getThreads).toHaveBeenLastCalledWith({
				data: { folderId: 'inbox', pageToken: 'next-page' },
			}),
		)
	})

	it('uses the starred cache key for the starred pseudo-folder', () => {
		renderCompose({ loader: { folderId: 'starred' } })

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Starred')
	})

	it('renders unread, starred, multi-message and attachment cues for a rich thread row', () => {
		const unread = makeThread({
			id: 't1',
			unread: true,
			starred: true,
			has_attachments: true,
			message_ids: ['m1', 'm2'],
			subject: 'Rich thread',
			folders: ['work'],
		})
		renderCompose({ loader: { threads: [unread], folders: [{ id: 'inbox', unread_count: 1 }] } })

		expect(screen.getByText('Rich thread')).toBeInTheDocument()
		expect(screen.getByText('(2)')).toBeInTheDocument()
		expect(screen.getByText('Work')).toBeInTheDocument()
		// A starred thread offers an Unstar affordance.
		expect(screen.getByRole('button', { name: 'Unstar' })).toBeInTheDocument()
		// Unread threads bump the header badge (count only, matching the mail folder list).
		expect(screen.getByText('1')).toBeInTheDocument()
	})

	it('falls back to "(no subject)" and hides date/counts for a sparse read thread', () => {
		const sparse = makeThread({
			id: 't2',
			subject: '',
			unread: false,
			starred: false,
			has_attachments: false,
			message_ids: undefined,
			latest_message_received_date: undefined,
			latest_message_sent_date: undefined,
		})
		renderCompose({ loader: { threads: [sparse] } })

		expect(screen.getByText('(no subject)')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
		// A fully-read folder shows no unread-count badge in the header.
		expect(screen.queryByText('1')).not.toBeInTheDocument()
	})

	it('toggles a row star through the centralized mutation gateway', async () => {
		const thread = makeThread({ id: 't7', starred: false })
		renderCompose({ loader: { threads: [thread] } })

		fireEvent.click(screen.getByRole('button', { name: 'Star' }))

		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't7', starred: true } }),
		)
		expect(invalidate).not.toHaveBeenCalled()
	})

	it('sorts threads that carry no send or receive timestamp as epoch zero without crashing', () => {
		// Threads with neither a received nor a sent date must still order deterministically
		// (both fall back to 0) rather than producing NaN comparisons that drop rows.
		const a = makeThread({
			id: 'ta',
			subject: 'Undated A',
			latest_message_received_date: undefined,
			latest_message_sent_date: undefined,
		})
		const b = makeThread({
			id: 'tb',
			subject: 'Undated B',
			latest_message_received_date: undefined,
			latest_message_sent_date: undefined,
		})
		renderCompose({ loader: { threads: [a, b] } })

		expect(screen.getByText('Undated A')).toBeInTheDocument()
		expect(screen.getByText('Undated B')).toBeInTheDocument()
	})
})

describe('mail.compose empty backdrop', () => {
	it('prompts the reader to pick a conversation when none is selected', () => {
		renderCompose({ loader: { threads: [makeThread()] } })
		expect(screen.getByText('Select a conversation')).toBeInTheDocument()
	})

	it('shows loading feedback instead of a false empty folder while the backdrop query is pending', async () => {
		let resolveThreads: (value: { threads: any[] }) => void = () => {}
		getThreads.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveThreads = resolve
				}),
		)
		renderCompose({ loader: { threads: undefined } })

		expect(screen.getByRole('status')).toHaveTextContent('Loading messages…')
		expect(screen.queryByText('All caught up')).not.toBeInTheDocument()

		resolveThreads({ threads: [] })
		await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
		expect(await screen.findByText('All caught up')).toBeVisible()
	})
})

describe('mail.compose selected backdrop', () => {
	function selectedLoader(overrides: any = {}) {
		const thread = makeThread({ id: 't1', ...(overrides.thread ?? {}) })
		return {
			threads: [thread, makeThread({ id: 't2', subject: 'Other' })],
			selected: {
				thread,
				messages: overrides.messages ?? [makeMessage()],
				mailboxEmail: 'me@x.com',
			},
			...overrides.loader,
		}
	}

	it('marks the active row and renders the selected thread in the shared reader', () => {
		renderCompose({
			loader: selectedLoader({
				thread: { has_attachments: true, folders: ['finance'] },
				messages: [
					makeMessage({
						id: 'm1',
						attachments: [{ id: 'report', filename: 'report.pdf', size: 1_572_864, is_inline: false }],
					}),
				],
			}),
		})
		// The chosen thread's row is flagged active for styling.
		expect(document.querySelector('[data-active="true"]')).not.toBeNull()
		// The shared reader (same component as the folder thread view) renders the attachment
		// and the Finance label appears on both the list row and the reader header.
		expect(screen.getAllByText('report.pdf').length).toBeGreaterThan(0)
		expect(screen.getAllByText('Finance').length).toBeGreaterThan(1)
	})

	it('propagates a loader-side mark-read into cached mail views', () => {
		const loader = selectedLoader()
		loader.selected.markedRead = true
		renderCompose({
			loader,
			search: { threadId: 't1' },
		})
		expect(screen.getByRole('heading', { name: 'Hello there' })).toBeInTheDocument()
		expect(invalidate).not.toHaveBeenCalled()
	})

	it('refetches a selected compose backdrop through its canonical detail query', async () => {
		const loader = selectedLoader()
		getThreadMessages.mockResolvedValue(loader.selected)
		renderCompose({ loader, search: { threadId: 't1' }, staleTime: 0 })
		await waitFor(() => expect(getThreadMessages).toHaveBeenCalledWith({ data: { threadId: 't1' } }))
	})

	it('archives the selected thread and leaves the composer', async () => {
		renderCompose({
			loader: selectedLoader(),
			search: { replyToMessageId: 'm9', to: 'x@y.com', subject: 'Sub', body: 'Bod' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 't1', folder: 'archive' },
			}),
		)
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
		expect(invalidate).not.toHaveBeenCalled()
	})

	it('returns an archived selected thread to the inbox', async () => {
		renderCompose({ loader: selectedLoader({ thread: { folders: ['archive'] } }) })
		fireEvent.click(screen.getByRole('button', { name: 'Return to inbox' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'inbox' } }),
		)
	})

	it('deletes the selected thread by moving it to trash', async () => {
		renderCompose({ loader: selectedLoader() })
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'trash' } }),
		)
	})

	it('toggles the star on the selected thread without navigating away', async () => {
		renderCompose({ loader: selectedLoader({ thread: { starred: true } }) })
		// The backdrop toolbar star (the only one carrying a title) reflects the state.
		fireEvent.click(screen.getByTitle('Unstar'))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: false } }),
		)
		expect(navigate).not.toHaveBeenCalled()
	})

	it.each([
		{
			label: 'Archive',
			busyLabel: 'Archiving',
			otherLabels: ['Delete', 'Star'],
			folder: 'archive',
			threadFolders: [],
		},
		{
			label: 'Return to inbox',
			busyLabel: 'Returning to inbox',
			otherLabels: ['Delete', 'Star'],
			folder: 'inbox',
			threadFolders: ['archive'],
		},
		{
			label: 'Delete',
			busyLabel: 'Deleting',
			otherLabels: ['Archive', 'Star'],
			folder: 'trash',
			threadFolders: [],
		},
	])('makes backdrop $label single-flight and leaves only after success', async (scenario) => {
		let resolveMutation: ((value: unknown) => void) | undefined
		updateThreadState.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveMutation = resolve
				}),
		)
		renderCompose({
			loader: selectedLoader({
				thread: { folders: scenario.threadFolders },
				loader: { draft: { id: 'd1' } },
			}),
			search: { threadId: 't1', draft: 'd1', subject: 'Preserve me' },
		})

		fireEvent.click(screen.getByTitle(scenario.label))
		const pending = await screen.findByRole('button', { name: scenario.busyLabel })
		expect(pending).toBeEnabled()
		expect(pending).toHaveAttribute('aria-disabled', 'true')
		expect(pending).toHaveAttribute('aria-busy', 'true')
		expect(pending.querySelector('.animate-spin')).not.toBeNull()
		for (const label of scenario.otherLabels) expect(screen.getByTitle(label)).toBeDisabled()
		expect(navigate).not.toHaveBeenCalled()

		fireEvent.click(pending)
		expect(updateThreadState).toHaveBeenCalledTimes(1)
		resolveMutation?.({ thread: makeThread({ folders: [scenario.folder] }) })
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/compose',
				search: { draft: 'd1', folderId: 'inbox', subject: 'Preserve me' },
			}),
		)
	})

	it('accepts only the first same-batch backdrop activation', async () => {
		let resolveMutation: ((value: unknown) => void) | undefined
		updateThreadState.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveMutation = resolve
				}),
		)
		renderCompose({ loader: selectedLoader(), search: { threadId: 't1' } })

		const archive = screen.getByTitle('Archive')
		act(() => {
			archive.click()
			archive.click()
		})

		await waitFor(() => expect(updateThreadState).toHaveBeenCalledTimes(1))
		const pending = await screen.findByRole('button', { name: 'Archiving' })
		expect(pending).toBeEnabled()
		expect(pending).toHaveAttribute('aria-disabled', 'true')
		resolveMutation?.({ thread: makeThread({ folders: ['archive'] }) })
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' })),
		)
	})

	it.each([
		{ label: 'Archive', restoredLabel: 'Archive', starred: false, folders: [] },
		{ label: 'Return to inbox', restoredLabel: 'Return to inbox', starred: false, folders: ['archive'] },
		{ label: 'Delete', restoredLabel: 'Delete', starred: false, folders: [] },
		{ label: 'Star', restoredLabel: 'Star', starred: false, folders: [] },
		{ label: 'Unstar', restoredLabel: 'Unstar', starred: true, folders: [] },
	])('recovers backdrop $label with generic feedback and prior state', async (scenario) => {
		updateThreadState.mockRejectedValueOnce(new Error('provider-secret-detail'))
		renderCompose({
			loader: selectedLoader({ thread: { starred: scenario.starred, folders: scenario.folders } }),
			search: { threadId: 't1' },
		})

		fireEvent.click(screen.getByTitle(scenario.label))

		expect(await screen.findByRole('alert')).toHaveTextContent('Action failed')
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByTitle(scenario.restoredLabel)).toBeEnabled()
		expect(navigate).not.toHaveBeenCalled()
	})

	it.each([
		{ outcome: 'success', reject: false },
		{ outcome: 'failure', reject: true },
	])('keeps keyboard focus on the backdrop star after $outcome', async ({ reject }) => {
		if (reject) updateThreadState.mockRejectedValueOnce(new Error('provider-secret-detail'))
		renderCompose({ loader: selectedLoader(), search: { threadId: 't1' } })

		await waitFor(() => expect(screen.getByLabelText('To')).toHaveFocus())
		const star = screen.getByTitle('Star')
		star.focus()
		expect(star).toHaveFocus()
		fireEvent.click(star)

		if (reject) {
			expect(await screen.findByRole('alert')).toHaveTextContent('Action failed')
			expect(screen.getByTitle('Star')).toHaveFocus()
		} else {
			expect(await screen.findByTitle('Unstar')).toHaveFocus()
		}
	})

	it('clears a backdrop failure and leaves on retry', async () => {
		updateThreadState.mockRejectedValueOnce(new Error('first failure'))
		renderCompose({
			loader: selectedLoader({ loader: { draft: { id: 'd1' } } }),
			search: { threadId: 't1', draft: 'd1' },
		})

		fireEvent.click(screen.getByTitle('Archive'))
		expect(await screen.findByRole('alert')).toHaveTextContent('Action failed')
		fireEvent.click(screen.getByTitle('Archive'))

		await waitFor(() => expect(updateThreadState).toHaveBeenCalledTimes(2))
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/compose',
				search: { draft: 'd1', folderId: 'inbox' },
			}),
		)
	})

	it('ignores a stale backdrop success when delimiter values collide across reader identities', async () => {
		let resolveMutation: ((value: unknown) => void) | undefined
		let mutationSettled = false
		updateThreadState.mockImplementationOnce(() =>
			new Promise((resolve) => {
				resolveMutation = resolve
			}).finally(() => {
				mutationSettled = true
			}),
		)
		let selectedId = 'th:old'
		let folderId = 'work'
		const routeData = () => {
			const thread = makeThread({
				id: selectedId,
				subject: selectedId === 'th:old' ? 'Old backdrop' : 'New backdrop',
				starred: selectedId === 'th',
			})
			return {
				draft: null,
				folders: [],
				threads: [thread],
				selected: { thread, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
				folderId,
				reply: null,
			}
		}
		Route.useLoaderData = vi.fn(routeData)
		Route.useSearch = vi.fn(() => ({ threadId: selectedId, folderId }))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const view = render(
			<QueryClientProvider client={client}>
				<Route.options.component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByTitle('Archive'))
		expect(await screen.findByRole('button', { name: 'Archiving' })).toHaveAttribute('aria-disabled', 'true')
		selectedId = 'th'
		folderId = 'old:work'
		view.rerender(
			<QueryClientProvider client={client}>
				<Route.options.component />
			</QueryClientProvider>,
		)
		expect(await screen.findByRole('heading', { name: 'New backdrop' })).toBeInTheDocument()
		expect(screen.getByTitle('Unstar')).toBeEnabled()

		resolveMutation?.({ thread: makeThread({ id: 'th:old', folders: ['archive'] }) })
		await waitFor(() => expect(mutationSettled).toBe(true))
		expect(navigate).not.toHaveBeenCalled()
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.getByTitle('Unstar')).toBeEnabled()
	})

	it('ignores a pending backdrop completion after compose context changes on the same thread', async () => {
		let resolveMutation: ((value: unknown) => void) | undefined
		let mutationSettled = false
		updateThreadState.mockImplementationOnce(() =>
			new Promise((resolve) => {
				resolveMutation = resolve
			}).finally(() => {
				mutationSettled = true
			}),
		)
		let subject = 'Old compose context'
		const loader = selectedLoader()
		Route.useLoaderData = vi.fn(() => ({
			draft: null,
			folders: [],
			folderId: 'work',
			reply: null,
			...loader,
		}))
		Route.useSearch = vi.fn(() => ({ threadId: 't1', folderId: 'work', subject }))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const view = render(
			<QueryClientProvider client={client}>
				<Route.options.component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByTitle('Archive'))
		expect(await screen.findByRole('button', { name: 'Archiving' })).toHaveAttribute('aria-disabled', 'true')
		subject = 'New compose context'
		view.rerender(
			<QueryClientProvider client={client}>
				<Route.options.component />
			</QueryClientProvider>,
		)
		expect(screen.getByTitle('Return to inbox')).toBeEnabled()

		resolveMutation?.({ thread: makeThread({ id: 't1', folders: ['archive'] }) })
		await waitFor(() => expect(mutationSettled).toBe(true))
		expect(navigate).not.toHaveBeenCalled()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('ignores a stale backdrop failure after another thread replaces it', async () => {
		let rejectMutation: ((reason?: unknown) => void) | undefined
		let mutationSettled = false
		updateThreadState.mockImplementationOnce(() =>
			new Promise((_resolve, reject) => {
				rejectMutation = reject
			}).finally(() => {
				mutationSettled = true
			}),
		)
		let selectedId = 'th-old-failure'
		const routeData = () => {
			const thread = makeThread({
				id: selectedId,
				subject: selectedId === 'th-old-failure' ? 'Old failed backdrop' : 'New safe backdrop',
				starred: selectedId === 'th-new-safe',
			})
			return {
				draft: null,
				folders: [],
				threads: [thread],
				selected: { thread, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
				folderId: 'work',
				reply: null,
			}
		}
		Route.useLoaderData = vi.fn(routeData)
		Route.useSearch = vi.fn(() => ({ threadId: selectedId, folderId: 'work' }))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const view = render(
			<QueryClientProvider client={client}>
				<Route.options.component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByTitle('Star'))
		expect(await screen.findByRole('button', { name: 'Starring' })).toHaveAttribute('aria-disabled', 'true')
		selectedId = 'th-new-safe'
		view.rerender(
			<QueryClientProvider client={client}>
				<Route.options.component />
			</QueryClientProvider>,
		)
		expect(await screen.findByRole('heading', { name: 'New safe backdrop' })).toBeInTheDocument()
		expect(screen.getByTitle('Unstar')).toBeEnabled()

		rejectMutation?.(new Error('provider-secret-detail'))
		await waitFor(() => expect(mutationSettled).toBe(true))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByTitle('Unstar')).toBeEnabled()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('starts a reply seeded from the latest message', () => {
		renderCompose({ loader: selectedLoader() })
		fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
		expect(document.activeElement).toBe(screen.getByPlaceholderText('Write your message...'))
	})

	it('starts a reply-all seeded from the latest message and mailbox address', () => {
		renderCompose({ loader: selectedLoader() })
		fireEvent.click(screen.getByRole('button', { name: 'Reply all' }))
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
		expect(document.activeElement).toBe(screen.getByPlaceholderText('Write your message...'))
	})

	it('starts a forward seeded from the latest message', () => {
		renderCompose({ loader: selectedLoader() })
		fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
		expect(document.activeElement).toBe(screen.getByLabelText('To'))
	})

	it('badges unread count and toggles a row star while a conversation is open', async () => {
		const active = makeThread({ id: 't1', latest_message_received_date: NOW - 100 })
		const unread = makeThread({ id: 't-unread', unread: true, latest_message_received_date: NOW })
		renderCompose({
			loader: {
				threads: [active, unread],
				folders: [{ id: 'inbox', unread_count: 1 }],
				selected: { thread: active, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
			},
		})
		// The unread badge is shared with the selected-conversation layout (count only).
		expect(screen.getByText('1')).toBeInTheDocument()
		// The newest (unread) row sorts first; starring it hits the server.
		fireEvent.click(screen.getAllByRole('button', { name: 'Star' })[0])
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't-unread', starred: true } }),
		)
	})

	it('ignores reply/reply-all/forward when the thread has no messages', () => {
		renderCompose({ loader: selectedLoader({ messages: [] }) })
		fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
		fireEvent.click(screen.getByRole('button', { name: 'Reply all' }))
		fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
		expect(navigate).not.toHaveBeenCalled()
	})

	it('renders the reader safely when a message omits its attachments array entirely', () => {
		// A message with `attachments: undefined` (not just an empty array) must not throw;
		// the shared reader's `?? []` fallback keeps it rendering.
		renderCompose({
			loader: selectedLoader({
				thread: { has_attachments: true },
				messages: [makeMessage({ attachments: undefined })],
			}),
		})
		// The backdrop toolbar renders, proving the reader mounted without throwing.
		expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
	})

	it('addresses an open message by recipient email when the recipient has no name', () => {
		// name is missing, so `name || email` resolves to the email, and the non-empty join
		// keeps the `|| 'me'` fallback from firing.
		renderCompose({
			loader: selectedLoader({ messages: [makeMessage({ id: 'mC', to: [{ email: 'no-name@x.com' }] })] }),
		})
		expect(screen.getByText('to no-name@x.com')).toBeInTheDocument()
	})

	it('addresses an open message to "me" when the recipient list is empty', () => {
		// An empty (but defined) recipient array joins to '' and must fall back to 'me'.
		renderCompose({
			loader: selectedLoader({ messages: [makeMessage({ id: 'mC', to: [] })] }),
		})
		expect(screen.getByText('to me')).toBeInTheDocument()
	})

	it('defaults the reply recipient to empty when the latest message has no sender', () => {
		// No from and no reply_to means replyDraftSearch produces an empty recipient, which
		// composeBackdropReplySearch drops — the composer must open with an empty To field.
		renderCompose({
			loader: selectedLoader({ messages: [makeMessage({ id: 'mC', from: undefined, reply_to: undefined })] }),
		})
		fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
	})

	it('defaults reply-all recipients to empty when the latest message carries no addresses', () => {
		renderCompose({
			loader: selectedLoader({
				messages: [
					makeMessage({ id: 'mC', from: undefined, to: undefined, cc: undefined, reply_to: undefined }),
				],
			}),
		})
		fireEvent.click(screen.getByRole('button', { name: 'Reply all' }))
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
	})

	it('carries the saved draft id into the list search when archiving out of a conversation', async () => {
		// Leaving a conversation while a draft is loaded must preserve the draft id so the
		// composer can be reopened against it.
		const thread = makeThread({ id: 't1' })
		renderCompose({
			loader: {
				folderId: 'inbox',
				draft: { id: 'd0' },
				threads: [thread],
				selected: { thread, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
			},
		})
		fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'archive' } }),
		)
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/mail/compose', search: expect.objectContaining({ draft: 'd0' }) }),
		)
	})
})

describe('mail.compose keyboard escape', () => {
	function renderSelected(search: any = {}) {
		const thread = makeThread({ id: 't1' })
		return renderCompose({
			loader: {
				threads: [thread],
				selected: { thread, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
			},
			search,
		})
	}

	it('closes back to the list on Escape when a conversation is open', () => {
		renderSelected({ replyToMessageId: 'm9', to: 'x', subject: 's', body: 'b' })
		fireEvent.keyDown(document.body, { key: 'Escape' })
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
	})

	it('ignores Escape and modifier keys while typing or with modifiers held', () => {
		renderSelected()
		// Typing in a field must not close the composer.
		fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'Escape' })
		fireEvent.keyDown(screen.getByPlaceholderText('Write your message...'), { key: 'Escape' })
		fireEvent.keyDown(document.body, { key: 'Escape', repeat: true })
		fireEvent.keyDown(document.body, { key: 'Escape', metaKey: true })
		fireEvent.keyDown(document.body, { key: 'Escape', ctrlKey: true })
		fireEvent.keyDown(document.body, { key: 'Escape', altKey: true })
		// A non-Escape key is a no-op.
		fireEvent.keyDown(document.body, { key: 'a' })

		const editable = document.createElement('div')
		Object.defineProperty(editable, 'isContentEditable', { value: true })
		document.body.appendChild(editable)
		fireEvent.keyDown(editable, { key: 'Escape' })

		expect(navigate).not.toHaveBeenCalled()
		editable.remove()
	})

	it('does not bind the Escape handler when no conversation is open', () => {
		renderCompose({ loader: { threads: [makeThread()] } })
		fireEvent.keyDown(document.body, { key: 'Escape' })
		expect(navigate).not.toHaveBeenCalled()
	})
})

describe('mail.compose window controls', () => {
	it('uses a safe-area-aware full viewport on mobile and retains the floating desktop composer', () => {
		renderCompose()
		const panel = screen.getByRole('dialog', { name: 'Compose message' })
		expect(panel).toHaveClass('inset-x-0')
		expect(panel).toHaveClass('top-0')
		expect(panel).toHaveClass('h-dvh')
		expect(panel).toHaveClass('max-sm:pt-[env(safe-area-inset-top)]')
		expect(panel).toHaveClass('max-sm:pb-[env(safe-area-inset-bottom)]')
		expect(panel).toHaveClass('sm:inset-x-auto')
		expect(panel).toHaveClass('sm:w-[min(30rem,calc(100vw-2rem))]')
		expect(panel).toHaveClass('sm:h-[min(32rem,calc(100dvh-1rem))]')
	})

	it('uses shared buttons for 44px mobile header and footer controls', () => {
		renderCompose()

		for (const name of ['Minimize composer', 'Close']) {
			const control = screen.getByRole('button', { name })
			expect(control).toHaveAttribute('data-slot', 'button')
			expect(control).toHaveClass('max-md:size-11')
		}
		for (const name of ['Send', 'Save draft', 'Attach file', 'Discard draft']) {
			const control = screen.getByRole('button', { name })
			expect(control).toHaveAttribute('data-slot', 'button')
			expect(control.className).toMatch(/max-md:(?:min-h-11|size-11)/)
		}
	})

	it('exposes accurate controls while minimizing and restoring the composer body', () => {
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Original', body: 'Original body' } } })
		fireEvent.change(screen.getByLabelText('To'), { target: { value: 'edited@example.com' } })
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited subject' } })
		fireEvent.change(screen.getByPlaceholderText('Write your message...'), {
			target: { value: 'Edited body' },
		})
		const minimize = screen.getByRole('button', { name: 'Minimize composer' })
		expect(minimize).toHaveAttribute('aria-expanded', 'true')
		expect(minimize.querySelector('svg')).toHaveClass('lucide-minus')
		fireEvent.click(minimize)
		expect(screen.queryByLabelText('To')).not.toBeInTheDocument()
		expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument()
		expect(screen.queryByPlaceholderText('Write your message...')).not.toBeInTheDocument()
		const restore = screen.getByRole('button', { name: 'Restore composer' })
		expect(restore).toHaveAttribute('aria-expanded', 'false')
		expect(restore.querySelector('svg')).toHaveClass('lucide-maximize-2')
		fireEvent.click(restore)
		expect(screen.getByLabelText('To')).toHaveValue('edited@example.com')
		expect(screen.getByLabelText('Subject')).toHaveValue('Edited subject')
		expect(screen.getByPlaceholderText('Write your message...')).toHaveValue('Edited body')
		expect(screen.getByRole('button', { name: 'Minimize composer' })).toHaveAttribute('aria-expanded', 'true')
	})

	it('goes back in browser history when there is a prior compose entry', () => {
		window.history.pushState({ __TSR_index: 3 }, '')
		const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
		renderCompose()
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(back).toHaveBeenCalled()
		expect(navigate).not.toHaveBeenCalled()
		back.mockRestore()
	})

	it('closes to the selected thread view when a conversation is open', () => {
		const thread = makeThread({ id: 't1' })
		renderCompose({
			loader: {
				folderId: 'archive',
				threads: [thread],
				selected: { thread, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
			},
		})
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'archive', threadId: 't1' },
		})
	})

	it('closes to the folder list when no conversation is open', () => {
		renderCompose({ loader: { folderId: 'inbox' } })
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(navigate).toHaveBeenCalledWith({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } })
	})

	it('flushes the latest draft before closing', async () => {
		let resolveSave: (value: { draftId: string }) => void = () => {}
		saveDraft.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		renderCompose({ loader: { folderId: 'inbox' } })
		fireEvent.change(screen.getByPlaceholderText('Write your message...'), {
			target: { value: 'Latest draft text' },
		})

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: '', subject: '', body: markdownToDraftBody('Latest draft text') },
			}),
		)
		expect(navigate).not.toHaveBeenCalled()
		resolveSave({ draftId: 'flushed-draft' })
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/f/$folderId',
				params: { folderId: 'inbox' },
			}),
		)
	})

	it('prevents edits while close persistence is in flight', async () => {
		let resolveSave: (value: { draftId: string }) => void = () => {}
		saveDraft.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		renderCompose({ loader: { folderId: 'inbox' } })
		const recipient = screen.getByLabelText('To')
		const subject = screen.getByLabelText('Subject')
		const body = screen.getByPlaceholderText('Write your message...')
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
		resolveSave({ draftId: 'locked-draft' })
		await waitFor(() => expect(navigate).toHaveBeenCalled())
	})
})

describe('mail.compose editing', () => {
	it('updates subject and body as the user types', () => {
		renderCompose()
		fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'My subject' } })
		fireEvent.change(screen.getByPlaceholderText('Write your message...'), {
			target: { value: 'My body' },
		})
		expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('My subject')
		expect((screen.getByPlaceholderText('Write your message...') as HTMLTextAreaElement).value).toBe(
			'My body',
		)
	})

	it('updates the recipient field through the To input', () => {
		renderCompose()
		fireEvent.change(screen.getByLabelText('To'), { target: { value: 'new@x.com' } })
		expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('new@x.com')
	})
})

describe('mail.compose attachments', () => {
	it('ignores a change event that carries no files', () => {
		const { container } = renderCompose()
		fireEvent.change(fileInput(container), { target: { files: [] } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('attaches files, sanitizing unsafe and empty filenames, then removes one', async () => {
		const { container } = renderCompose()
		// The paperclip button proxies clicks to the hidden file input.
		fireEvent.click(screen.getByRole('button', { name: 'Attach file' }))
		const files = [
			new File([new Uint8Array(1)], 'ok.txt'),
			new File([new Uint8Array(2)], 'bad/name\t.txt'),
			new File([new Uint8Array(3)], '   '),
			new File([new Uint8Array(2000)], 'big.txt'),
		]
		fireEvent.change(fileInput(container), { target: { files } })

		expect(await screen.findByText('ok.txt')).toBeInTheDocument()
		expect(screen.getByText('bad_name_.txt')).toBeInTheDocument()
		expect(screen.getByText('attachment')).toBeInTheDocument()
		expect(screen.getByText('big.txt')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Remove ok.txt' }))
		await waitFor(() => expect(screen.queryByText('ok.txt')).not.toBeInTheDocument())
	})

	it('rejects attaching more than the allowed number of files', async () => {
		const { container } = renderCompose()
		const files = Array.from({ length: 11 }, (_, index) => new File(['x'], `f${index}.txt`))
		fireEvent.change(fileInput(container), { target: { files } })
		expect(await screen.findByRole('alert')).toHaveTextContent('Attach up to 10 files.')
	})

	it('rejects attachments whose combined size exceeds the 2 MB budget', async () => {
		const { container } = renderCompose()
		const big = new File(['x'], 'big.bin')
		Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
		fireEvent.change(fileInput(container), { target: { files: [big] } })
		expect(await screen.findByRole('alert')).toHaveTextContent('Attachments must be under 2 MB total.')
	})

	it('shows a generic message when reading a file fails', async () => {
		const { container } = renderCompose()
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
		const { container } = renderCompose()
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
			const { container } = renderCompose()
			fireEvent.change(fileInput(container), {
				target: { files: [new File([new Uint8Array(5)], 'fallback.txt')] },
			})
			expect(await screen.findByText('fallback.txt')).toBeInTheDocument()
		} finally {
			if (original) Object.defineProperty(globalThis.crypto, 'randomUUID', original)
		}
	})

	it('blocks sending until the selected attachment finishes processing', async () => {
		let resolveFile: (value: ArrayBuffer) => void = () => {}
		const pending = new File([new Uint8Array([1, 2, 3])], 'pending.txt')
		Object.defineProperty(pending, 'arrayBuffer', {
			value: () =>
				new Promise<ArrayBuffer>((resolve) => {
					resolveFile = resolve
				}),
			configurable: true,
		})
		const { container } = renderCompose({
			loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'body' } },
		})

		fireEvent.change(fileInput(container), { target: { files: [pending] } })

		const attaching = await screen.findByRole('button', { name: 'Attaching...' })
		expect(attaching).toBeDisabled()
		fireEvent.click(attaching)
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()

		resolveFile(new Uint8Array([1, 2, 3]).buffer)
		expect(await screen.findByText('pending.txt')).toBeInTheDocument()
		const send = screen.getByRole('button', { name: 'Send' })
		expect(send).not.toBeDisabled()
		fireEvent.click(send)

		await waitFor(() => expect(sendDraft).toHaveBeenCalled())
		expect(saveDraft.mock.calls[0][0].data.attachments).toHaveLength(1)
	})
})

describe('mail.compose send', () => {
	it('blocks a recipient-less send with focused, accessible guidance before persistence', async () => {
		renderCompose({ loader: { reply: { to: '', subject: 'Hi', body: 'body' } } })

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
		expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
	})

	it('identifies malformed recipients without reflecting them and clears guidance after correction', async () => {
		renderCompose({
			loader: { reply: { to: 'valid@example.com, not-an-email', subject: 'Hi', body: 'body' } },
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
		await waitFor(() => expect(sendDraft).toHaveBeenCalled())
	})

	it('rejects an overlong recipient with static guidance and no mutation', async () => {
		const overlong = `${'a'.repeat(316)}@x.co`
		renderCompose({ loader: { reply: { to: overlong, subject: 'Hi', body: 'body' } } })

		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		const guidance = await screen.findByRole('alert')
		expect(guidance).toHaveTextContent('Enter a valid email address for each recipient before sending.')
		expect(guidance).not.toHaveTextContent(overlong)
		expect(saveDraft).not.toHaveBeenCalled()
		expect(sendDraft).not.toHaveBeenCalled()
	})

	it('applies recipient validation to the keyboard send shortcut', async () => {
		renderCompose({ loader: { reply: { to: '', subject: 'Hi', body: 'body' } } })
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
		renderCompose({ loader: { reply: { to: '', subject: 'Hi', body: 'body' } } })
		const to = screen.getByLabelText('To')
		fireEvent.change(to, { target: { value: 'visible@example.com' } })

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
		renderCompose({ loader: { reply: { to: '', subject: 'Hi', body: 'body' } } })
		const to = screen.getByLabelText('To')
		fireEvent.change(to, { target: { value: 'shortcut@example.com' } })
		to.focus()

		fireEvent.keyDown(to, { key: 'Enter', ...modifier })

		await waitFor(() => expect(sendDraft).toHaveBeenCalledTimes(1))
		expect(saveDraft).toHaveBeenCalledTimes(1)
		expect(saveDraft.mock.calls[0][0].data.to).toBe('shortcut@example.com')
		expect(sendDraft.mock.calls[0][0].data.to).toBe('shortcut@example.com')
	})

	it('blocks a malformed uncommitted recipient from the keyboard path', async () => {
		recipientInputMock.keepDraftLocal = true
		renderCompose({ loader: { reply: { to: '', subject: 'Hi', body: 'body' } } })
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

	it('saves then sends the same provider draft as email-ready HTML', async () => {
		// The composer state holds markdown source; the backing draft is updated
		// to inline-styled HTML before the provider sends that exact draft.
		saveDraft.mockResolvedValue({ draftId: 'draft-1' })
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'line **one**' } } })
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))

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
		expect(saveComposeRecipients).toHaveBeenCalledWith({ data: { emails: ['a@b.com'] } })
		expect(navigate).toHaveBeenCalledWith({ to: '/mail/f/$folderId', params: { folderId: 'sent' } })
	})

	it('includes attachments and the reply-to id in a reply send', async () => {
		const { container } = renderCompose({
			loader: {
				reply: { to: 'a@b.com', subject: 'Re: Hi', body: 'body', replyToMessageId: 'm9' },
			},
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
		renderCompose({
			loader: { draft: { id: 'd0', to: [{ email: 'a@b.com' }], subject: 'Draft', body: 'body' } },
		})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))

		await waitFor(() =>
			expect(sendDraft).toHaveBeenCalledWith({
				data: { draftId: 'd0', to: 'a@b.com', subject: 'Draft', body: markdownToEmailHtml('body') },
			}),
		)
	})

	it('keeps the reply reference when an autosaved reply is sent as a draft', async () => {
		saveDraft.mockResolvedValue({ draftId: 'd0' })
		renderCompose({
			loader: {
				draft: { id: 'd0', to: [{ email: 'a@b.com' }], subject: 'Re: Hi', body: 'body' },
				reply: { to: 'a@b.com', subject: 'Re: Hi', body: 'body', replyToMessageId: 'm9' },
			},
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
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'x' } } })
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not send your message. Check your connection, then try again.',
		)
		expect(navigate).not.toHaveBeenCalled()
		expect(saveComposeRecipients).not.toHaveBeenCalled()
	})

	it('shows a generic error when the send rejects with a non-Error', async () => {
		sendDraft.mockRejectedValue('boom')
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'x' } } })
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
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'x' } } })
		await act(async () => {})
		fireEvent.click(screen.getByRole('button', { name: /Send/ }))
		await waitFor(() => expect(sendDraft).toHaveBeenCalled())
		expect(saveComposeRecipients).not.toHaveBeenCalled()
	})
})

describe('mail.compose save draft', () => {
	it('continues to save drafts without recipients', async () => {
		renderCompose({ loader: { reply: { to: '', subject: 'Hi', body: 'draft body' } } })

		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: '', subject: 'Hi', body: markdownToDraftBody('draft body') },
			}),
		)
		expect(sendDraft).not.toHaveBeenCalled()
	})

	it('saves immediately when Save draft is clicked', async () => {
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'draft body' } } })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

		await waitFor(() =>
			expect(saveDraft).toHaveBeenCalledWith({
				data: { to: 'a@b.com', subject: 'Hi', body: markdownToDraftBody('draft body') },
			}),
		)
		expect(screen.getByText('Saved')).toBeInTheDocument()
	})

	it('shows a generic save error returned by the server', async () => {
		saveDraft.mockRejectedValue(new Error('Mailbox unavailable'))
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'draft body' } } })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save the draft. Your changes are still here; check your connection and try again.',
		)
	})

	it('shows a generic error when manual saving rejects with a non-Error', async () => {
		saveDraft.mockRejectedValue('offline')
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'draft body' } } })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save the draft. Your changes are still here; check your connection and try again.',
		)
	})

	it('explains when a draft recipient needs correction', async () => {
		saveDraft.mockRejectedValue(new Error('Invalid recipient: not-an-email'))
		renderCompose({ loader: { reply: { to: 'not-an-email', subject: 'Hi', body: 'draft body' } } })
		fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Enter a valid email address for each recipient before saving.',
		)
	})
})

describe('mail.compose discard', () => {
	it('deletes the backing draft then closes to the open conversation', async () => {
		const thread = makeThread({ id: 't1' })
		renderCompose({
			loader: {
				folderId: 'inbox',
				draft: { id: 'd0' },
				threads: [thread],
				selected: { thread, messages: [makeMessage()], mailboxEmail: 'me@x.com' },
			},
		})
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith({ data: { draftId: 'd0' } }))
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't1' },
		})
	})

	it('closes without a delete call when there is no saved draft', async () => {
		renderCompose({ loader: { folderId: 'inbox' } })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } }),
		)
		expect(deleteDraft).not.toHaveBeenCalled()
	})

	it('shows a generic error and stays open when deleting the draft fails', async () => {
		deleteDraft.mockRejectedValue(new Error('delete failed'))
		renderCompose({ loader: { draft: { id: 'd0' } } })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not discard the draft. Check your connection, then try again.',
		)
		expect(navigate).not.toHaveBeenCalled()
	})

	it('shows a generic error when discarding rejects with a non-Error', async () => {
		deleteDraft.mockRejectedValue('kaboom')
		renderCompose({ loader: { draft: { id: 'd0' } } })
		fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not discard the draft. Check your connection, then try again.',
		)
	})
})

describe('mail.compose autosave', () => {
	it('does nothing when the composer is empty', async () => {
		vi.useFakeTimers()
		renderCompose()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		expect(saveDraft).not.toHaveBeenCalled()
	})

	it('autosaves content after the idle delay and briefly shows "Saved"', async () => {
		vi.useFakeTimers()
		saveDraft.mockResolvedValue({ draftId: 'saved-1' })
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'draft body' } } })

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
		renderCompose({
			loader: { reply: { to: 'a@b.com', subject: 'Re: Hi', body: 'draft body', replyToMessageId: 'm9' } },
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
		const { container } = renderCompose({ loader: { draft: { id: 'd0' } } })

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
		renderCompose({ loader: { reply: { to: 'a@b.com', subject: 'Hi', body: 'body' } } })
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000)
		})
		expect(saveDraft).toHaveBeenCalled()
		expect(screen.queryByText('Saved')).not.toBeInTheDocument()
	})
})
