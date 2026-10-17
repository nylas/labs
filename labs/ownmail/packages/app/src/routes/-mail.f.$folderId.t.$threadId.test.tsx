// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID } from '#app/components/MobileTabBar'
import { mailKeys } from '#features/mail/state/mail-queries'

// A single navigate/invalidate pair backs the mocked router hooks; `routerState`
// supplies the router state consumed via useRouter().
const navigate = vi.fn()
const invalidate = vi.fn()
let routerState: any

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useNavigate: () => navigate,
	useRouter: () => ({ state: routerState, invalidate }),
}))

const getThreadMessages = vi.fn()
const updateThreadState = vi.fn()
const markThreadRead = vi.fn()
const getThreads = vi.fn()
const sideThreadSearch = vi.fn(async (_input: unknown) => ({ threads: [] }))
const headerFacts = vi.fn()
const deleteDraft = vi.fn()
const sendScheduledNow = vi.fn()
const cancelScheduledSend = vi.fn()
// The Conversation view looks up bulk-mail headers on demand; the route tests never need a real lookup.
vi.mock('#features/mail/server/mail-functions', () => ({
	getThreadListUnsubscribe: () => Promise.resolve({ messageIds: [] }),
}))
vi.mock('#server/fns', () => ({
	getMailboxInfo: async () => ({ email: 'ada@ownmail.com', appName: 'OwnMail' }),
	// The reader's side-thread lookup searches by subject; the list's pages are what these tests drive.
	getThreads: (input: any) => (input?.data?.q !== undefined ? sideThreadSearch(input) : getThreads(input)),
	getThreadMessages: (input: any) => getThreadMessages(input),
	getThreadHeaderFacts: (input: any) => headerFacts(input),
	deleteDraft: (input: any) => deleteDraft(input),
	sendScheduledNow: (input: any) => sendScheduledNow(input),
	cancelScheduledSend: (input: any) => cancelScheduledSend(input),
	markThreadRead: (input: any) => markThreadRead(input),
	updateThreadState: (input: any) => updateThreadState(input),
}))

import { ErrorBanner } from '#features/mail/components/ErrorBanner'
import { markdownToDraftBody } from '#features/mail/lib/html-to-markdown'
import { ToastProvider } from '#shared/components/Toaster'
import { Route } from './mail.f.$folderId.t.$threadId.js'

// Compose is app state: assert what the composer is asked to open, not a route.
const composeApi = vi.hoisted(() => ({
	openCompose: vi.fn(async () => {}),
	composing: null as { kind: string; threadId?: string } | null,
	registerInlineSlot: vi.fn(),
}))
vi.mock('#features/mail/components/ComposeProvider', () => ({ useCompose: () => composeApi }))

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
	headerFacts.mockResolvedValue({ byMessage: {} })
	deleteDraft.mockResolvedValue({})
	updateThreadState.mockImplementation(async ({ data }: any) => ({
		thread: {
			id: data.threadId,
			starred: data.starred ?? false,
			unread: data.unread ?? false,
			folders: ['work'],
		},
	}))
	markThreadRead.mockImplementation(async ({ data }: any) => ({
		thread: { id: data.threadId, unread: false, folders: ['inbox'] },
	}))
	routerState = { location: { pathname: '/mail/f/inbox/t/t1' } }
})

// --- data builders -------------------------------------------------------

/** The desktop toolbar: the phone's top bar has its own Archive and Back, and jsdom shows both bars. */
const desktopBar = () => within(document.querySelector('.reader-toolbar') as HTMLElement)

/** A file chip as read aloud in order: its name, then its size and version line. */
const chipText = (chip: Element) =>
	[...chip.querySelectorAll('.flex-col > span')].map((part) => part.textContent).join(' · ')

function richMessages(): any[] {
	return [
		// unknown sender (empty from), recipient with only an email, no date, empty body
		{ id: 'm0', from: [], to: [{ email: 'noname@x.com' }], body: '', snippet: '' },
		// named sender, named recipient, dated, plaintext, non-inline + inline attachments
		{
			id: 'm1',
			from: [{ name: 'Alice', email: 'alice@x.com' }],
			to: [{ name: 'Bob', email: 'bob@x.com' }],
			date: 1_700_000_000,
			snippet: 'preview one',
			body: 'first body line',
			attachments: [
				{ id: 'a1', filename: 'doc.pdf', size: 500, is_inline: false },
				{ id: 'inline1', filename: 'sig.png', size: 10, is_inline: true },
			],
		},
		// email-only sender, no `to` (→ "me"), HTML body (→ iframe), varied attachments
		{
			id: 'm2',
			from: [{ email: 'carol@x.com' }],
			body: '<p>HTML body content</p>',
			attachments: [
				{ id: 'a2', size: 2048, is_inline: false }, // no filename, KB size
				{ id: 'a3', filename: 'big.zip', size: 3_145_728, is_inline: false }, // MB size
				{ id: 'a5', filename: 'nosize.dat', is_inline: false }, // no size
			],
		},
	]
}

function loaderData(overrides: any = {}): any {
	return {
		thread: { id: 't1', subject: 'Hello', starred: false, folders: ['work'] },
		messages: richMessages(),
		mailboxEmail: 'me@x.com',
		...overrides,
	}
}

function renderThread(
	data: any = loaderData(),
	search: any = {},
	params = { folderId: 'inbox', threadId: 't1' },
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }),
) {
	Route.useLoaderData = vi.fn(() => data)
	Route.useParams = vi.fn(() => params)
	Route.useSearch = vi.fn(() => search)
	const Component = Route.options.component
	const screen = () => (
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<Component />
			</ToastProvider>
		</QueryClientProvider>
	)
	const rendered = render(screen())
	return { ...rendered, rerenderThread: () => rendered.rerender(screen()) }
}

// --- loader & validateSearch --------------------------------------------

describe('thread route loader', () => {
	it('loads the thread using the threadId param so the view opens the right conversation', async () => {
		getThreadMessages.mockResolvedValue({ thread: { id: 't1' }, messages: [] })

		const data = await Route.options.loader({
			context: { queryClient: new QueryClient() },
			params: { folderId: 'inbox', threadId: 't9' },
		})

		expect(getThreadMessages).toHaveBeenCalledWith({ data: { threadId: 't9' } })
		expect(data).toEqual({ thread: { id: 't1' }, messages: [] })
	})

	it('reuses a cached thread detail across history navigation', async () => {
		getThreadMessages.mockResolvedValue({
			thread: { id: 't9', subject: 'Cached' },
			messages: [],
			mailboxEmail: 'me@example.com',
		})
		const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
		const args = {
			context: { queryClient },
			params: { folderId: 'inbox', threadId: 't9' },
		}

		await Route.options.loader(args)
		getThreadMessages.mockClear()
		const restored = await Route.options.loader(args)

		expect(restored.thread.id).toBe('t9')
		expect(getThreadMessages).not.toHaveBeenCalled()
	})
})

describe('thread route validateSearch', () => {
	it('keeps a string baseFolderId so the reading pane can return to the originating folder', () => {
		expect(Route.options.validateSearch({ baseFolderId: 'starred' })).toEqual({
			baseFolderId: 'starred',
		})
	})

	it('drops a non-string baseFolderId to avoid trusting malformed navigation state', () => {
		expect(Route.options.validateSearch({ baseFolderId: 123 })).toEqual({})
		expect(Route.options.validateSearch({})).toEqual({})
	})
})

// --- header, subject, labels, attachments -------------------------------

describe('thread header', () => {
	it('reads the conversation on the app ground so sender canvases can extend across it', () => {
		renderThread()
		const conversation = document.querySelector('[data-slot="thread-conversation"]')
		const overflowSlots = document.querySelectorAll('[data-slot^="scroll-area-overflow-"]')

		expect(conversation).toHaveClass('min-h-full', 'bg-background')
		expect(conversation).not.toHaveClass('bg-muted', 'bg-card')
		expect(overflowSlots).toHaveLength(2)
		for (const slot of overflowSlots) {
			expect(slot).toHaveClass('from-background/80')
			expect(slot).not.toHaveClass('from-muted/80')
		}
	})

	it('mounts the shared avatar on every row and a chip for every file of the open message', () => {
		renderThread()
		// Two read messages are one-line rows, each led by a 28px avatar.
		const rows = document.querySelectorAll('[data-slot="message-expand"]')
		expect(rows).toHaveLength(2)
		for (const row of rows) expect(row.querySelector('[data-slot="avatar"]')).toHaveClass('size-7')
		// Only the open message owns its file chips; the header counts files without linking them.
		const chips = [...document.querySelectorAll('[data-slot="attachment-chip"]')].map(chipText)
		expect(chips).toEqual(['attachment · 2 KB', 'big.zip · 3.0 MB', 'nosize.dat'])
	})

	it('renders the subject and its thread labels', () => {
		renderThread()
		const heading = screen.getByRole('heading', { name: 'Hello' })
		expect(heading).toBeInTheDocument()
		expect(screen.getByText('Work')).toBeInTheDocument()
		// The subject is in the scroll flow; the toolbar is the only pinned row.
		const header = heading.closest('header') as HTMLElement
		expect(header.closest('[data-slot="thread-conversation"]')).toHaveClass('bg-background')
		expect(header.className).not.toMatch(/sticky|top-0/)
		const viewport = screen.getByRole('region', { name: 'Thread conversation' })
		expect(viewport).toContainElement(header)
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		expect(toolbar).toHaveAttribute('data-slot', 'toolbar')
		expect(toolbar).toHaveClass('h-(--toolbar-height)', 'shrink-0')
		expect(viewport).not.toContainElement(toolbar)
		const motionContent = heading.closest('[data-navigation-content]')
		expect(motionContent).toContainElement(heading)
		expect(motionContent).not.toContainElement(toolbar)
		// The toolbar is bar glass over the reader, and the conversation scrolls beneath it.
		expect(toolbar).toHaveClass('glass-bar', 'absolute', 'top-0')
		expect(screen.getByTestId('thread-reader')).toHaveClass('relative')
		expect(viewport).toHaveClass('under-pinned-bar', 'under-mobile-bar')
	})

	it('says "No subject" and shows no labels for an empty thread', () => {
		renderThread(
			loaderData({
				thread: { id: 't1', subject: '', starred: false, folders: [] },
				messages: [],
			}),
		)
		// "(no subject)" tells nobody anything; with no first line to stand in, it says so plainly.
		expect(screen.getByRole('heading', { level: 1, name: 'No subject' })).toBeInTheDocument()
		expect(screen.queryByText('Work')).not.toBeInTheDocument()
	})

	it('counts the files across the thread and shows each with its message, with human-readable sizes', () => {
		renderThread()
		// Inline images are not files; the others count once each.
		expect(screen.getByRole('button', { name: '4 files' })).toHaveAttribute('aria-expanded', 'false')
		// a1 lives on a read message and is shown once that message opens.
		expect(screen.queryByText(/doc\.pdf/)).toBeNull()
		expect([...document.querySelectorAll('[data-slot="attachment-chip"]')].map(chipText)).toContain(
			'big.zip · 3.0 MB',
		)
		expect(screen.queryByText(/sig\.png/)).not.toBeInTheDocument()

		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		fireEvent.click(within(stream).getByRole('button', { name: /Alice/ }))
		expect([...document.querySelectorAll('[data-slot="attachment-chip"]')].map(chipText)).toContain(
			'doc.pdf · 500 B',
		)
		expect(screen.getByRole('region', { name: 'Attachments from Alice' })).toBeInTheDocument()
	})
})

// --- message list -------------------------------------------------------

describe('message list', () => {
	it('resets the conversation scroll position before painting a newly selected thread', () => {
		const params = { folderId: 'inbox', threadId: 't1' }
		const { rerenderThread } = renderThread(loaderData(), {}, params)
		const viewport = screen.getByRole('region', { name: 'Thread conversation' })
		viewport.scrollTop = 480

		params.threadId = 't2'
		rerenderThread()

		const nextViewport = screen.getByRole('region', { name: 'Thread conversation' })
		expect(nextViewport).not.toBe(viewport)
		expect(nextViewport.scrollTop).toBe(0)
	})

	it('offers the raw email of the latest message, its id escaped', async () => {
		renderThread(
			loaderData({
				messages: [
					{
						id: 'msg/#1',
						from: [{ name: 'Alice', email: 'alice@x.com' }],
						body: 'Raw message',
					},
				],
			}),
		)
		// Each message's own download sits in its header's right-click menu (the
		// header's); the More menu downloads the latest one, its id escaped.
		expect(screen.queryByRole('menuitem', { name: 'Download raw email' })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'More' }))
		const link = await screen.findByRole('menuitem', { name: 'Download raw email' })

		expect(link).toHaveAttribute('href', '/messages/msg%2F%231/download')
		expect(link).toHaveAttribute('download')
		expect(link.closest('button')).toBeNull()
	})

	it('opens the last message and keeps earlier ones on one line, with previews and senders', () => {
		renderThread()
		// senders resolved from name, email, and the unknown fallback
		expect(screen.getByText('Alice')).toBeInTheDocument()
		expect(screen.getByText('Unknown sender')).toBeInTheDocument()
		// last message open → its header (here a stand-in) and HTML body are present
		expect(screen.getByRole('heading', { level: 2, name: 'carol@x.com' })).toBeInTheDocument()
		expect(screen.getByTitle('Email content m2')).toBeInTheDocument()
		// the read message above shows its preview
		expect(screen.getByText('first body line')).toBeInTheDocument()
	})

	it('expands and collapses every message from the More menu', async () => {
		const user = userEvent.setup()
		renderThread()
		const states = () =>
			Array.from(document.querySelectorAll('[data-slot="thread-message"]'), (message) =>
				message.getAttribute('aria-label'),
			)

		expect(states()).toEqual(['Message from carol@x.com'])
		await user.click(screen.getByRole('button', { name: 'More' }))
		await user.click(screen.getByRole('menuitem', { name: 'Expand all 3 messages' }))
		expect(states()).toHaveLength(3)

		await user.click(screen.getByRole('button', { name: 'More' }))
		expect(screen.getByRole('menuitem', { name: 'Expand all 3 messages' })).toBeDisabled()
		await user.click(screen.getByRole('menuitem', { name: 'Collapse all 3 messages' }))
		expect(states()).toEqual([])
	})

	it('looks up the header facts once and hands each message header its own', async () => {
		const facts = {
			byMessage: { 'm-details': { verified: true, authFailed: false, listUnsubscribe: false } },
		}
		headerFacts.mockResolvedValue(facts)
		renderThread(
			loaderData({
				messages: [
					{
						id: 'm-details',
						from: [{ name: 'Alice', email: 'alice@x.com' }],
						to: [{ name: 'Bob', email: 'bob@x.com' }],
						date: 1_700_000_000,
						body: 'Detailed message',
					},
				],
			}),
		)
		// The header's details say the sender was verified, from that message's own facts.
		await waitFor(() => expect(headerFacts).toHaveBeenCalled())
		fireEvent.click(document.querySelector('[data-slot="recipient-summary"]') as HTMLElement)
		expect(await screen.findByText('Verified sender')).toBeInTheDocument()
		expect(headerFacts).toHaveBeenCalledExactlyOnceWith({ data: { threadId: 't1' } })
	})

	it('reads the thread without header facts when the lookup fails', async () => {
		headerFacts.mockRejectedValue(new Error('provider down'))
		renderThread(
			loaderData({
				messages: [
					{
						id: 'm-undated',
						from: [{ name: 'Alice', email: 'alice@x.com' }],
						to: [{ name: 'Bob', email: 'bob@x.com' }],
						body: 'Undated message',
					},
				],
			}),
		)
		await waitFor(() => expect(headerFacts).toHaveBeenCalled())
		expect(screen.getByText('Undated message')).toBeInTheDocument()
		expect(document.querySelector('[data-slot="message-header"]')).not.toHaveAttribute('data-verified')
	})

	it('omits the details disclosure when a provider message has no metadata', () => {
		renderThread(
			loaderData({
				messages: [{ id: 'm-no-details', body: 'Body without addressing metadata' }],
			}),
		)

		expect(screen.queryByText('Message details')).not.toBeInTheDocument()
		expect(screen.getByText('Body without addressing metadata')).toBeInTheDocument()
	})

	it("starts an open message's prose under the sender's name, 12px beneath its header", () => {
		renderThread()
		const content = document.querySelector('[data-slot="expanded-message-content"]')

		expect(content).toHaveClass('reader-message-content')
		// The prose column is inset past the 32px avatar; the header row above is not.
		expect(content?.querySelector('[data-inset="true"]')).not.toBeNull()
		expect(document.querySelector('[data-slot="message-header"]')?.closest('[data-inset]')).toBeNull()
	})

	it('toggles a read message open and back, rendering its (empty) body and no attachments', async () => {
		const user = userEvent.setup()
		renderThread()
		expect(screen.queryByRole('article', { name: 'Message from Unknown sender' })).toBeNull()
		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		await user.click(within(stream).getByRole('button', { name: /Unknown sender/ }))
		const article = screen.getByRole('article', { name: 'Message from Unknown sender' })
		// The header names the opened message's email-only recipient.
		expect(within(article).getByText('to noname')).toBeInTheDocument()
		expect(within(article).queryByRole('region', { name: /^Attachments/ })).toBeNull()
		// Collapsing goes through the message's header.
		await user.click(within(article).getByRole('button', { name: 'Collapse message' }))
		expect(screen.queryByRole('article', { name: 'Message from Unknown sender' })).toBeNull()
	})

	it('renders attachments inside an opened message, including missing filename and size', () => {
		renderThread()
		// m2 is open by default; its attachments render inside the message block too
		const files = screen.getByRole('region', { name: 'Attachments from carol@x.com' })
		const chips = [...files.querySelectorAll('[data-slot="attachment-chip"]')].map(chipText)
		expect(chips).toContain('attachment · 2 KB') // a2 has no filename
		expect(chips).toContain('nosize.dat') // and a5 no size
	})

	it('shows a saved OwnMail draft in its thread as a draft to resume or discard', async () => {
		const user = userEvent.setup()
		renderThread(
			loaderData({
				thread: { id: 'd1', subject: 'Draft', starred: false, folders: ['custom'] },
				messages: [
					{
						id: 'm1',
						from: [{ name: 'Alice', email: 'alice@x.com' }],
						to: [{ email: 'me@x.com' }],
						body: 'Hi',
					},
					{
						id: 'd1',
						folders: ['custom'],
						from: [{ email: 'me@x.com' }],
						to: [{ name: 'Alice', email: 'alice@x.com' }],
						body: markdownToDraftBody('# Heading\n\n**ready** to send'),
					},
				],
				ownmailDraftMessageIds: ['d1'],
			}),
		)
		// The draft is not a message anyone has read: it sits under the message it answers.
		expect(screen.queryByTitle('Email content d1')).toBeNull()
		const draft = screen.getByRole('region', { name: 'Your draft reply to Alice' })
		expect(draft.closest('[data-draft-id="d1"]')).not.toBeNull()
		// The preview is the words of the draft, not its Markdown.
		expect(draft).toHaveTextContent('Heading')
		await user.click(screen.getByRole('button', { name: 'Resume' }))
		expect(composeApi.openCompose).toHaveBeenLastCalledWith({ kind: 'draft', draftId: 'd1' })
		// Replies answer Alice's message, never the unsent draft.
		await user.click(screen.getByRole('button', { name: 'Reply' }))
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ replyToMessageId: 'm1' }),
		)
		await user.click(screen.getByRole('button', { name: 'Discard' }))
		await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith({ data: { draftId: 'd1' } }))
	})
})

// --- toolbar actions ----------------------------------------------------

describe('toolbar actions', () => {
	it('keeps mobile and tablet toolbar actions touch-friendly', () => {
		renderThread()

		expect(desktopBar().getByRole('button', { name: 'Back to list' })).toHaveClass('xl:hidden')
		// One height for the whole row: 32px with a fine pointer and 44px on narrow and
		// touch screens. Every control is an icon button except Reply all, the one
		// labelled action in the respond group (design.md "Reading").
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		const buttons = [...toolbar.querySelectorAll('button')]
		expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
			'Back to list',
			'Archive',
			'Delete',
			'Star',
			'Mark unread',
			'Messages view',
			'Conversation view',
			'Thread display',
			'Previous message (k)',
			'Next message (j)',
			'Reply all',
			'Reply',
			'Forward',
			'More',
		])
		const replyAll = screen.getByRole('button', { name: 'Reply all' })
		expect(replyAll).toHaveTextContent('Reply all')
		expect(replyAll).toHaveClass(
			'h-8',
			'reader-reply-all',
			'max-md:min-h-11',
			'[@media(any-pointer:coarse)]:min-h-11',
		)
		for (const button of buttons.filter((button) => button !== replyAll)) {
			expect(button).toHaveClass('max-md:size-11', '[@media(any-pointer:coarse)]:size-11')
		}
		for (const name of ['Archive', 'Reply', 'Forward', 'More', 'Previous message (k)']) {
			expect(desktopBar().getByRole('button', { name })).toHaveClass('size-8')
		}
		// Triage, view and position are divided from each other.
		for (const separator of within(toolbar).getAllByRole('separator')) {
			expect(separator).toHaveAttribute('aria-orientation', 'vertical')
		}
		expect(within(toolbar).getAllByRole('separator')).toHaveLength(2)
		expect(within(toolbar).getByText('3 of 3')).toHaveClass('reader-stepper-count', 'font-data')
	})

	it('hosts the thread display actions in the toolbar, ahead of the reply group, and More at its end', async () => {
		const user = userEvent.setup()
		renderThread()
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		const display = screen.getByRole('button', { name: 'Thread display' })
		const more = screen.getByRole('button', { name: 'More' })

		// The subject row no longer carries these, so it needs no 44px control.
		expect(toolbar).toContainElement(display)
		expect(toolbar).toContainElement(more)
		expect(
			screen
				.getByRole('heading', { name: 'Hello' })
				.closest('header')
				?.querySelector(
					'[data-slot="thread-actions"], [data-slot="reader-more"], [data-slot="thread-stepper"]',
				),
		).toBeNull()
		const replyAll = screen.getByRole('button', { name: 'Reply all' })
		expect(display.compareDocumentPosition(replyAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(replyAll.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

		await user.click(more)
		await user.click(screen.getByRole('menuitem', { name: 'Expand all 3 messages' }))
		expect(document.querySelectorAll('[data-slot="thread-message"][data-state="open"]')).toHaveLength(3)
	})

	it('archives the thread and returns to the folder list', async () => {
		const user = userEvent.setup()
		renderThread()
		await user.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 't1', folder: 'archive' },
			}),
		)
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/mail/f/$folderId', params: { folderId: 'inbox' }, search: {} }),
		)
		expect(invalidate).not.toHaveBeenCalled()
	})

	describe('confirming a move', () => {
		it('confirms an archive with an Undo that puts the conversation back where it was', async () => {
			const user = userEvent.setup()
			renderThread(loaderData({ thread: { id: 't1', subject: 'Hello', folders: ['inbox', 'work'] } }))
			await user.click(desktopBar().getByRole('button', { name: 'Archive' }))
			expect(await screen.findByText('Archived')).toBeInTheDocument()
			await user.click(screen.getByRole('button', { name: 'Undo' }))
			await waitFor(() =>
				expect(updateThreadState).toHaveBeenLastCalledWith({ data: { threadId: 't1', folder: 'inbox' } }),
			)
		})

		it('says when an undo fails rather than leaving the reader guessing', async () => {
			const user = userEvent.setup()
			renderThread(loaderData({ thread: { id: 't1', subject: 'Hello', folders: ['inbox'] } }))
			await user.click(screen.getByRole('button', { name: 'Delete' }))
			expect(await screen.findByText('Moved to Trash')).toBeInTheDocument()
			updateThreadState.mockRejectedValueOnce(new Error('offline'))
			await user.click(screen.getByRole('button', { name: 'Undo' }))
			expect(await screen.findByText('Could not undo. Try again from the folder.')).toBeInTheDocument()
		})

		it('names a return to the inbox and offers to send it back to the archive', async () => {
			const user = userEvent.setup()
			renderThread(
				loaderData({ thread: { id: 't1', subject: 'Hello', folders: ['archive'] } }),
				{},
				{ folderId: 'archive', threadId: 't1' },
			)
			await user.click(desktopBar().getByRole('button', { name: 'Return to inbox' }))
			expect(await screen.findByText('Moved to Inbox')).toBeInTheDocument()
			await user.click(screen.getByRole('button', { name: 'Undo' }))
			await waitFor(() =>
				expect(updateThreadState).toHaveBeenLastCalledWith({ data: { threadId: 't1', folder: 'archive' } }),
			)
		})

		it('confirms without Undo when it cannot know where the conversation came from', async () => {
			const user = userEvent.setup()
			renderThread()
			await user.click(desktopBar().getByRole('button', { name: 'Archive' }))
			expect(await screen.findByText('Archived')).toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
		})
	})

	it('returns archived threads to the inbox instead of archiving them again', async () => {
		const user = userEvent.setup()
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hello', starred: false, folders: ['archive'] } }))
		await user.click(desktopBar().getByRole('button', { name: 'Return to inbox' }))

		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'inbox' } }),
		)
	})

	it('deletes the thread by moving it to trash and leaving', async () => {
		const user = userEvent.setup()
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'trash' } }),
		)
	})

	it('marks the thread unread and leaves the reading pane', async () => {
		const user = userEvent.setup()
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Mark unread' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', unread: true } }),
		)
		expect(navigate).toHaveBeenCalled()
	})

	it('stars an unstarred thread in place without leaving', async () => {
		const user = userEvent.setup()
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Star' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: true } }),
		)
		expect(navigate).not.toHaveBeenCalled()
		expect(invalidate).not.toHaveBeenCalled()
	})

	it('shows pending state only on the star control while a star mutation is in flight', async () => {
		const user = userEvent.setup()
		let resolveMutation: ((value: unknown) => void) | undefined
		updateThreadState.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveMutation = resolve
				}),
		)
		renderThread()

		await user.click(screen.getByRole('button', { name: 'Star' }))

		const star = screen.getByRole('button', { name: 'Starring' })
		expect(star).toHaveAttribute('aria-busy', 'true')
		expect(star.querySelector('.animate-spin')).not.toBeNull()
		for (const label of ['Archive', 'Delete', 'Mark unread']) {
			const button = desktopBar().getByRole('button', { name: label })
			expect(button.querySelector('.animate-spin')).toBeNull()
		}

		fireEvent.click(star)
		expect(updateThreadState).toHaveBeenCalledTimes(1)

		resolveMutation?.({
			thread: { id: 't1', starred: true, unread: false, folders: ['work'] },
		})
		await waitFor(() => expect(screen.getByRole('button', { name: 'Unstar' })).toBeInTheDocument())
	})

	it('grows the star once when starring, so the change is confirmed where the eye already is', async () => {
		const user = userEvent.setup()
		updateThreadState.mockResolvedValueOnce({
			thread: { id: 't1', starred: true, unread: false, folders: ['work'] },
		})
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Star' }))
		const unstar = await screen.findByRole('button', { name: 'Unstar' })
		expect(unstar).toHaveClass('star-pop')
		// The pop runs once: when it ends the class goes, so a re-render never replays it.
		// jsdom has no AnimationEvent, so React listens for the prefixed event name.
		act(() => {
			unstar.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }))
			fireEvent.animationEnd(unstar)
		})
		expect(unstar).not.toHaveClass('star-pop')
	})

	it('never animates unstarring: removing a mark is not a confirmation', async () => {
		const user = userEvent.setup()
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hi', starred: true, folders: [] } }))
		await user.click(screen.getByRole('button', { name: 'Unstar' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: false } }),
		)
		expect(document.querySelector('.star-pop')).toBeNull()
	})

	it('unstars a starred thread and labels the control accordingly', async () => {
		const user = userEvent.setup()
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hi', starred: true, folders: [] } }))
		const unstar = screen.getByRole('button', { name: 'Unstar' })
		await user.click(unstar)
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: false } }),
		)
	})

	it('navigates back to the list from the mobile back button', async () => {
		const user = userEvent.setup()
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Back to list' }))
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } }),
		)
		expect(updateThreadState).not.toHaveBeenCalled()
	})

	it('carries the baseFolderId through leave navigation as a real URL', async () => {
		const user = userEvent.setup()
		renderThread(loaderData(), { baseFolderId: 'starred' })
		await user.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() => expect(navigate).toHaveBeenCalled())
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/mail/f/$folderId',
				params: { folderId: 'inbox' },
				search: { baseFolderId: 'starred' },
			}),
		)
		expect(navigate.mock.calls.every(([arg]) => !('mask' in arg))).toBe(true)
	})

	it('preserves baseFolderId when using the mobile back button (no mask)', async () => {
		const user = userEvent.setup()
		renderThread(loaderData(), { baseFolderId: 'starred' })
		await user.click(screen.getByRole('button', { name: 'Back to list' }))
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { baseFolderId: 'starred' } }))
		expect(navigate.mock.calls.every(([arg]) => !('mask' in arg))).toBe(true)
	})

	it('navigates back to the list after a deliberate rightward reader swipe', () => {
		renderThread(loaderData(), { baseFolderId: 'starred' })
		const reader = screen.getByTestId('thread-reader')
		fireEvent.touchStart(reader, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchMove(reader, { touches: [{ clientX: 90, clientY: 52 }] })
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 130, clientY: 55 }] })
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/mail/f/$folderId',
				params: { folderId: 'inbox' },
				search: { baseFolderId: 'starred' },
			}),
		)
	})

	it('keeps native vertical scrolling and pinch zoom enabled over the reader', () => {
		renderThread()
		expect(screen.getByTestId('thread-reader')).toHaveStyle({ touchAction: 'pan-y pinch-zoom' })
	})

	it('ignores short, vertical, and interactive-control reader swipes', () => {
		renderThread()
		const reader = screen.getByTestId('thread-reader')
		fireEvent.touchStart(reader, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 100, clientY: 52 }] })
		fireEvent.touchStart(reader, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 140, clientY: 180 }] })
		const back = screen.getByRole('button', { name: 'Back to list' })
		fireEvent.touchStart(back, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchEnd(back, { changedTouches: [{ clientX: 140, clientY: 52 }] })
		expect(navigate).not.toHaveBeenCalled()
	})

	it('cancels incomplete and multi-touch reader swipes', () => {
		renderThread()
		const reader = screen.getByTestId('thread-reader')
		fireEvent.touchStart(reader, {
			touches: [
				{ clientX: 50, clientY: 50 },
				{ clientX: 60, clientY: 50 },
			],
		})
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 140, clientY: 50 }] })
		fireEvent.touchStart(reader, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchCancel(reader)
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 140, clientY: 50 }] })
		fireEvent.touchStart(reader, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchMove(reader, {
			touches: [
				{ clientX: 50, clientY: 50 },
				{ clientX: 60, clientY: 50 },
			],
		})
		fireEvent.touchEnd(reader, {
			touches: [],
			changedTouches: [{ clientX: 140, clientY: 50 }],
		})
		fireEvent.touchStart(reader, { touches: [{ clientX: 50, clientY: 50 }] })
		fireEvent.touchEnd(reader, {
			touches: [{ clientX: 60, clientY: 50 }],
			changedTouches: [{ clientX: 140, clientY: 50 }],
		})
		expect(navigate).not.toHaveBeenCalled()
	})
})

// --- error handling -----------------------------------------------------

describe('action errors', () => {
	it('shows a generic message when an action fails', async () => {
		const user = userEvent.setup()
		updateThreadState.mockRejectedValueOnce(new Error('boom'))
		renderThread()
		await user.click(desktopBar().getByRole('button', { name: 'Archive' }))
		expect(await screen.findByText('Action failed')).toBeInTheDocument()
		// An error sits in the flow below the pinned bar, never hidden under it; the
		// conversation then starts beneath the error instead of beneath the bar.
		expect(screen.getByRole('alert').parentElement).toHaveClass('under-pinned-bar')
		expect(screen.getByRole('region', { name: 'Thread conversation' })).not.toHaveClass('under-pinned-bar')
		expect(navigate).not.toHaveBeenCalled()
	})

	it('falls back to a generic message when a non-Error is thrown', async () => {
		const user = userEvent.setup()
		updateThreadState.mockRejectedValueOnce('weird')
		renderThread()
		await user.click(desktopBar().getByRole('button', { name: 'Archive' }))
		expect(await screen.findByText('Action failed')).toBeInTheDocument()
		// An error sits in the flow below the pinned bar, never hidden under it; the
		// conversation then starts beneath the error instead of beneath the bar.
		expect(screen.getByRole('alert').parentElement).toHaveClass('under-pinned-bar')
		expect(screen.getByRole('region', { name: 'Thread conversation' })).not.toHaveClass('under-pinned-bar')
	})
})

describe('ErrorBanner', () => {
	it('strips the QUOTA: prefix so plan-limit copy reads naturally', () => {
		render(<ErrorBanner message="QUOTA:  You hit a limit" />)
		expect(screen.getByRole('alert')).toHaveTextContent('You hit a limit')
	})

	it('shows a non-quota message verbatim', () => {
		render(<ErrorBanner message="Plain error" />)
		expect(screen.getByRole('alert')).toHaveTextContent('Plain error')
	})
})

// --- compose navigation -------------------------------------------------

describe('compose navigation', () => {
	function composeData(): any {
		return loaderData({
			thread: { id: 't1', subject: 'Chat', starred: false, folders: [] },
			messages: [
				{
					id: 'mL',
					from: [{ email: 'sender@x.com' }],
					to: [{ email: 'me@x.com' }, { email: 'other@x.com' }],
					cc: [{ email: 'cc@x.com' }],
					reply_to: [{ email: 'reply@x.com' }],
					date: 1_700_000_000,
					body: 'Original body',
				},
			],
			mailboxEmail: 'me@x.com',
		})
	}

	it('replies to the sender via the toolbar Reply action', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Reply' }))
		expect(composeApi.openCompose).toHaveBeenCalledWith(
			expect.objectContaining({
				threadId: 't1',
				replyToMessageId: 'mL',
				to: 'reply@x.com',
			}),
		)
	})

	it('reply-all addresses every participant except the mailbox owner', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Reply all' }))
		const call = composeApi.openCompose.mock.calls.find((c) => c[0]?.replyToMessageId === 'mL')
		const recipients: string = call?.[0].to
		expect(recipients).not.toContain('me@x.com')
		expect(recipients).toContain('sender@x.com')
		expect(recipients).toContain('other@x.com')
		expect(recipients).toContain('cc@x.com')
	})

	it('forwards the message with a quoted forwarding header', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Forward' }))
		// A forward starts a new conversation, so it floats instead of sitting in this thread.
		const call = composeApi.openCompose.mock.calls.find((c) => c[0]?.kind === 'forward')
		expect(call?.[0].body).toContain('Forwarded message')
		expect(call?.[0].to).toBe('')
		expect(call?.[0].threadId).toBe('t1')
	})

	it('opens a reply to everyone from the reply card under the last message, or to the sender only', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		const card = screen.getByRole('region', { name: 'Reply' })
		expect(card.closest('[data-navigation-content]')).toBeNull()
		// Reply all reaches the Reply-To address, the other recipient and Cc, never the owner.
		expect(card).toHaveTextContent('Reply all to reply, other, cc')
		await user.click(within(card).getByRole('button', { name: /Write a reply/ }))
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({
				replyToMessageId: 'mL',
				to: 'reply@x.com, sender@x.com, other@x.com, cc@x.com',
			}),
		)
		await user.click(within(card).getByRole('button', { name: 'Send' }))
		expect(composeApi.openCompose).toHaveBeenCalledTimes(2)
		await user.click(within(card).getByRole('button', { name: 'Reply only to reply' }))
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ replyToMessageId: 'mL', to: 'reply@x.com' }),
		)
	})

	it('replies from the Conversation view through the same compose flow, to everyone by default', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Conversation view' }))
		// The pinned input takes the place of the inline field; it never sends itself.
		expect(screen.queryByRole('button', { name: /Write a reply/ })).not.toBeInTheDocument()

		const pinnedReply = await screen.findByRole('button', { name: /^Reply to all…/ })
		expect(pinnedReply.closest('[data-navigation-content]')).toBeNull()
		expect(document.querySelector('[data-slot="conversation-transcript"]')).toHaveAttribute(
			'data-navigation-content',
		)
		await user.click(pinnedReply)

		// Everyone on the last message except the signed-in address.
		expect(composeApi.openCompose).toHaveBeenLastCalledWith({
			kind: 'reply',
			threadId: 't1',
			to: 'reply@x.com, sender@x.com, other@x.com, cc@x.com',
			subject: 'Re: ',
			replyToMessageId: 'mL',
		})
	})

	it('offers complete mobile response actions with the same compose payloads', async () => {
		const user = userEvent.setup()
		// The phone's reply bar fills the thread slot of the mobile tab bar.
		const slot = document.createElement('div')
		slot.id = MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID
		document.body.append(slot)
		renderThread(composeData())
		const bar = within(slot)
		const reply = bar.getByRole('button', { name: 'Reply' })
		const replyAll = bar.getByRole('button', { name: 'Reply all' })
		const forward = bar.getByRole('button', { name: 'Forward' })
		// Reply all is the one labelled button (board 03).
		expect(replyAll).toHaveTextContent('Reply all')
		// The phone's reply bar and top bar replace the desktop toolbar and reply card below `md`.
		expect(screen.getByTestId('thread-reader').firstElementChild).toHaveClass('max-md:hidden')
		const card = document.querySelector('[data-slot="inline-reply-dock"]') as HTMLElement
		expect(card).toHaveClass('reader-reply-dock')
		// The card sits in the conversation, after the last message, on the same column.
		const viewport = screen.getByRole('region', { name: 'Thread conversation' })
		expect(viewport).toContainElement(card)
		const lastMessage = [...document.querySelectorAll('[data-slot="thread-message"]')].at(-1) as Element
		expect(lastMessage.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(card.querySelector('[data-slot="thread-column"]')).not.toBeNull()
		const topBar = document.querySelector('[data-slot="mobile-thread-top-bar"]') as HTMLElement
		expect(topBar).toHaveTextContent('Chat1 message · 2 people')

		await user.click(reply)
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ threadId: 't1', to: 'reply@x.com' }),
		)

		replyAll.focus()
		await user.keyboard('{Enter}')
		const replyAllCall = composeApi.openCompose.mock.calls.at(-1)?.[0]
		expect(replyAllCall).toEqual(
			expect.objectContaining({ kind: 'reply', threadId: 't1', replyToMessageId: 'mL' }),
		)
		expect(replyAllCall?.to).toContain('sender@x.com')
		expect(replyAllCall?.to).not.toContain('me@x.com')

		forward.focus()
		await user.keyboard(' ')
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ threadId: 't1', to: '' }),
		)
		expect(composeApi.openCompose.mock.calls.at(-1)?.[0].body).toContain('Forwarded message')

		// The phone top bar archives and goes back like the toolbar.
		await user.click(within(topBar).getByRole('button', { name: 'Back to Inbox' }))
		await user.click(within(topBar).getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'archive' } }),
		)
		slot.remove()
	})

	it('hides the reply affordances entirely when the thread has no messages', () => {
		renderThread(
			loaderData({
				thread: { id: 't1', subject: 'Empty', starred: false, folders: [] },
				messages: [],
			}),
		)
		expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Write a reply/ })).not.toBeInTheDocument()
		expect(screen.queryByRole('group', { name: 'Thread response actions' })).not.toBeInTheDocument()
	})
})

// --- keyboard shortcuts -------------------------------------------------

describe('replying in the thread', () => {
	afterEach(() => {
		composeApi.composing = null
	})

	it('makes room under the last message for its own reply, in place of the reply field', () => {
		composeApi.composing = { kind: 'reply', threadId: 't1' }
		renderThread()
		// The composer portals into this slot; the thread offers it under its own id.
		const slot = document.querySelector('[data-slot="inline-composer"]')
		expect(slot).not.toBeNull()
		expect(composeApi.registerInlineSlot).toHaveBeenCalledWith('t1', slot)
		expect(screen.queryByRole('button', { name: /Write a reply/ })).not.toBeInTheDocument()
	})

	it('keeps the reply field for a reply that belongs to another thread, or for a new message', () => {
		composeApi.composing = { kind: 'reply', threadId: 'other' }
		const view = renderThread()
		expect(document.querySelector('[data-slot="inline-composer"]')).toBeNull()
		expect(screen.getByRole('button', { name: /Write a reply/ })).toBeInTheDocument()
		view.unmount()
		composeApi.composing = { kind: 'new' }
		renderThread()
		expect(document.querySelector('[data-slot="inline-composer"]')).toBeNull()
	})

	it('leaves keys typed in the composer to the composer, so Escape there never closes the thread', () => {
		renderThread()
		const composer = document.createElement('div')
		composer.className = 'compose-panel'
		const send = document.createElement('button')
		composer.append(send)
		document.body.append(composer)
		fireEvent.keyDown(send, { key: 'Escape' })
		fireEvent.keyDown(send, { key: 'e' })
		expect(navigate).not.toHaveBeenCalled()
		expect(updateThreadState).not.toHaveBeenCalled()
		composer.remove()
	})
})

describe('keyboard shortcuts', () => {
	it('leaves keys pressed inside an open menu to that menu', async () => {
		renderThread()
		// Typeahead letters and Escape inside any menu must not archive, delete or close the reader.
		const menu = document.createElement('div')
		menu.setAttribute('role', 'menu')
		const item = menu.appendChild(document.createElement('div'))
		item.setAttribute('role', 'menuitem')
		document.body.appendChild(menu)
		await act(async () => {
			for (const key of ['e', '#', 's', 'u', 'r', 'Escape']) fireEvent.keyDown(item, { key })
		})
		menu.remove()
		expect(updateThreadState).not.toHaveBeenCalled()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('ignores keystrokes while typing, when repeating, or with a modifier held', async () => {
		renderThread()
		const input = document.createElement('input')
		document.body.appendChild(input)
		await act(async () => {
			fireEvent.keyDown(input, { key: 'e' }) // isTyping guard
			fireEvent.keyDown(document.body, { key: 'e', repeat: true })
			fireEvent.keyDown(document.body, { key: 'e', metaKey: true })
			fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true })
			fireEvent.keyDown(document.body, { key: 'e', altKey: true })
			fireEvent.keyDown(document.body, { key: 'z' }) // unmapped key
		})
		input.remove()
		expect(updateThreadState).not.toHaveBeenCalled()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('moves focus to the reply card\'s plain reply on "r", which then opens the reply', async () => {
		const user = userEvent.setup()
		renderThread()
		const replyOnly = screen.getByRole('button', { name: /^Reply only to/ })
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'r' })
		})
		// Reading is not interrupted: the shortcut reaches the card, it does not navigate.
		expect(replyOnly).toHaveFocus()
		expect(navigate).not.toHaveBeenCalled()

		// `r` means Reply, as on a phone: a reply to the sender only, not Reply all.
		await user.keyboard('{Enter}')
		expect(composeApi.openCompose).toHaveBeenCalledTimes(1)
		expect(composeApi.openCompose).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'reply', threadId: 't1', replyToMessageId: 'm2', to: 'carol@x.com' }),
		)
	})

	it('opens a reply to the latest message on "r" where the inline field is not displayed', async () => {
		renderThread()
		// On mobile the field is `display: none` and cannot take focus; jsdom applies
		// no stylesheet, so stand in for that by making focus a no-op.
		vi.spyOn(screen.getByRole('button', { name: /^Reply only to/ }), 'focus').mockImplementation(() => {})
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'r' })
		})
		expect(composeApi.openCompose).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'reply',
				threadId: 't1',
				replyToMessageId: 'm2',
				to: 'carol@x.com',
			}),
		)
	})

	it('replies to the first other person when your own message is the latest, and to no one when there is none', async () => {
		const own = (to: Array<{ name?: string; email: string }>) =>
			loaderData({
				messages: [
					{
						id: 'm1',
						from: [{ name: 'Carol', email: 'carol@x.com' }],
						to: [{ email: 'me@x.com' }],
						body: 'Hi',
					},
					{ id: 'm2', from: [{ name: 'Me', email: 'me@x.com' }], to, body: 'Thanks' },
				],
			})
		const { unmount } = renderThread(own([{ email: 'me@x.com' }, { name: 'Carol', email: 'carol@x.com' }]))
		expect(screen.getByRole('button', { name: 'Reply only to Carol' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'reply', replyToMessageId: 'm2', to: 'carol@x.com' }),
		)
		unmount()
		// A note to yourself has no one else to reply to: the composer opens unaddressed.
		renderThread(own([{ email: 'me@x.com' }]))
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'r' })
		})
		expect(composeApi.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'reply', replyToMessageId: 'm2', to: '' }),
		)
	})

	it('counts on the phone top bar what the stream shows, not messages in Trash', () => {
		renderThread(
			loaderData({
				messages: [
					{
						id: 'm1',
						from: [{ name: 'Carol', email: 'carol@x.com' }],
						to: [{ email: 'me@x.com' }],
						body: 'Hi',
					},
					{
						id: 'm2',
						from: [{ name: 'Dave', email: 'dave@x.com' }],
						to: [{ email: 'me@x.com' }],
						body: 'Binned',
						folders: ['trash'],
					},
					{
						id: 'm3',
						from: [{ name: 'Carol', email: 'carol@x.com' }],
						to: [{ email: 'me@x.com' }],
						body: 'Bye',
					},
				],
			}),
		)
		expect(document.querySelector('[data-slot="mobile-thread-top-bar"]')).toHaveTextContent(
			'Hello2 messages · 2 people',
		)
	})

	it('falls back to the event target when a reply event has no composed path', () => {
		renderThread()
		const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true })
		Object.defineProperty(event, 'composedPath', { value: () => [] })

		document.body.dispatchEvent(event)

		expect(event.defaultPrevented).toBe(true)
		expect(screen.getByRole('button', { name: /^Reply only to/ })).toHaveFocus()
	})

	it('does not open a reply from interactive controls, with modifiers, or while a dialog is open', async () => {
		renderThread()
		const input = document.createElement('input')
		const textarea = document.createElement('textarea')
		const select = document.createElement('select')
		const button = document.createElement('button')
		const anchor = document.createElement('a')
		const summary = document.createElement('summary')
		const editable = document.createElement('div')
		const dialog = document.createElement('div')
		Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true })
		anchor.href = '/safe-test-target'
		dialog.setAttribute('role', 'dialog')
		document.body.append(input, textarea, select, button, anchor, summary, editable)

		await act(async () => {
			for (const control of [input, textarea, select, button, anchor, summary, editable]) {
				fireEvent.keyDown(control, { key: 'r' })
			}
			fireEvent.keyDown(document.body, { key: 'r', repeat: true })
			fireEvent.keyDown(document.body, { key: 'r', metaKey: true })
			fireEvent.keyDown(document.body, { key: 'r', ctrlKey: true })
			fireEvent.keyDown(document.body, { key: 'r', altKey: true })
			fireEvent.keyDown(document.body, { key: 'R', shiftKey: true })
			document.body.appendChild(dialog)
			fireEvent.keyDown(document.body, { key: 'r' })
			fireEvent.keyDown(document.body, { key: 'e' })
		})

		for (const control of [input, textarea, select, button, anchor, summary, editable]) control.remove()
		dialog.remove()
		expect(navigate).not.toHaveBeenCalled()
		expect(updateThreadState).not.toHaveBeenCalled()
	})

	it('respects a previously prevented reply shortcut', () => {
		renderThread()
		const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true })
		event.preventDefault()

		document.body.dispatchEvent(event)

		expect(event.defaultPrevented).toBe(true)
		expect(navigate).not.toHaveBeenCalled()
	})

	it('ignores reply shortcuts retargeted from interactive HTML-email shadow content', () => {
		renderThread()
		const email = screen.getByTitle('Email content m2')
		const emailRoot = email.shadowRoot?.querySelector('.email-root')
		const anchor = document.createElement('a')
		anchor.href = 'https://example.com'
		emailRoot?.appendChild(anchor)
		let retargetedTarget: EventTarget | null = null
		window.addEventListener(
			'keydown',
			(event) => {
				retargetedTarget = event.target
			},
			{ once: true },
		)

		anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, composed: true }))

		expect(retargetedTarget).toBe(email)
		expect(navigate).not.toHaveBeenCalled()
	})

	it('does nothing on "r" when the thread has no message to reply to', async () => {
		renderThread(loaderData({ messages: [] }))
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'r' })
		})
		expect(navigate).not.toHaveBeenCalled()
	})

	it('archives on "e"', async () => {
		renderThread()
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'e' })
		})
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 't1', folder: 'archive' },
			}),
		)
	})

	it('returns an archived thread to the inbox on "e"', async () => {
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hi', starred: false, folders: ['archive'] } }))
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'e' })
		})
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'inbox' } }),
		)
	})

	it('trashes on "#"', async () => {
		renderThread()
		await act(async () => {
			fireEvent.keyDown(document.body, { key: '#' })
		})
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'trash' } }),
		)
	})

	it('toggles star on "s" using the current starred state', async () => {
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hi', starred: true, folders: [] } }))
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 's' })
		})
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: false } }),
		)
	})

	it('marks unread on "u"', async () => {
		renderThread()
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'u' })
		})
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', unread: true } }),
		)
	})

	it('closes the reading pane on Escape without mutating the thread', async () => {
		renderThread()
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'Escape' })
		})
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/mail/f/$folderId', params: { folderId: 'inbox' } }),
		)
		expect(updateThreadState).not.toHaveBeenCalled()
	})

	it('preserves baseFolderId when closing on Escape (no mask)', async () => {
		renderThread(loaderData(), { baseFolderId: 'starred' })
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'Escape' })
		})
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { baseFolderId: 'starred' } }))
		expect(navigate.mock.calls.every(([arg]) => !('mask' in arg))).toBe(true)
	})
})

// --- read state on open ------------------------------------------------

describe('read state on open', () => {
	function unreadInbox(queryClient: QueryClient) {
		queryClient.setQueryData(mailKeys.threadList({ folderId: 'inbox' }), {
			pages: [{ threads: [{ id: 't9', folders: ['inbox'], unread: true }] }],
			pageParams: [undefined],
		})
		queryClient.setQueryData(mailKeys.folders(), [{ id: 'inbox', unread_count: 1 }])
	}

	it('shows the opened row as read in the list before the conversation finishes loading', async () => {
		let deliver: (value: unknown) => void = () => {}
		getThreadMessages.mockReturnValue(new Promise((resolve) => (deliver = resolve)))
		const queryClient = new QueryClient()
		unreadInbox(queryClient)

		const loading = Route.options.loader({
			context: { queryClient },
			params: { folderId: 'inbox', threadId: 't9' },
			preload: false,
		})

		await waitFor(() =>
			expect(
				(queryClient.getQueryData(mailKeys.threadList({ folderId: 'inbox' })) as any).pages[0].threads[0]
					.unread,
			).toBe(false),
		)
		expect((queryClient.getQueryData(mailKeys.folders()) as any)[0].unread_count).toBe(0)
		deliver({ thread: { id: 't9', unread: true }, messages: [], mailboxEmail: 'me@x.com' })
		await expect(loading).resolves.toMatchObject({ thread: { id: 't9', unread: false } })
		expect(markThreadRead).toHaveBeenCalledTimes(1)
	})

	it('never marks mail read when a row is merely hovered (intent preload)', async () => {
		getThreadMessages.mockResolvedValue({
			thread: { id: 't9', unread: true },
			messages: [],
			mailboxEmail: 'me',
		})
		const queryClient = new QueryClient()
		unreadInbox(queryClient)

		await Route.options.loader({
			context: { queryClient },
			params: { folderId: 'inbox', threadId: 't9' },
			preload: true,
		})

		expect(markThreadRead).not.toHaveBeenCalled()
		expect(
			(queryClient.getQueryData(mailKeys.threadList({ folderId: 'inbox' })) as any).pages[0].threads[0]
				.unread,
		).toBe(true)
	})

	it('marks a server-rendered unread thread read once and keeps a later "Mark unread"', async () => {
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hello', unread: true, folders: ['work'] } }))
		await waitFor(() => expect(markThreadRead).toHaveBeenCalledWith({ data: { threadId: 't1' } }))

		await userEvent.click(screen.getByRole('button', { name: 'Mark unread' }))

		expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', unread: true } })
		expect(markThreadRead).toHaveBeenCalledTimes(1)
	})

	it('does not broadly invalidate the router when a thread opens', () => {
		renderThread(loaderData())
		expect(invalidate).not.toHaveBeenCalled()
		expect(markThreadRead).not.toHaveBeenCalled()
	})
})

// --- triage flow ---------------------------------------------------------

describe('triage flow', () => {
	function splitView(matches: boolean) {
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
		)
	}
	function inboxWith(threads: any[]) {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		queryClient.setQueryData(mailKeys.threadList({ folderId: 'inbox' }), {
			pages: [{ threads }],
			pageParams: [undefined],
		})
		return queryClient
	}
	const newest = { id: 't0', folders: ['inbox'], latest_message_received_date: 300 }
	const opened = { id: 't1', folders: ['inbox'], latest_message_received_date: 200 }
	const older = { id: 't2', folders: ['inbox'], latest_message_received_date: 100 }

	afterEach(() => vi.unstubAllGlobals())

	it('opens the next conversation after archiving in split view so triage keeps its place', async () => {
		splitView(true)
		renderThread(loaderData(), {}, undefined, inboxWith([newest, opened, older]))
		// Split layouts keep the back control for narrow screens only.
		expect(screen.getByRole('button', { name: 'Back to list' })).toHaveClass('xl:hidden')
		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: 'inbox', threadId: 't2' },
				search: {},
			}),
		)
	})

	it('falls back to the newer neighbour when deleting the last conversation', async () => {
		splitView(true)
		renderThread(loaderData(), { baseFolderId: 'work' }, undefined, inboxWith([newest, opened]))
		await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/f/$folderId/t/$threadId',
				params: { folderId: 'inbox', threadId: 't0' },
				search: { baseFolderId: 'work' },
			}),
		)
	})

	it('returns to the list instead of advancing when the reader replaces the list (no split)', async () => {
		splitView(true)
		window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ readingPane: 'none' }))
		try {
			renderThread(loaderData(), {}, undefined, inboxWith([newest, opened, older]))
			// Wide screens still need a way back when the list is hidden.
			await waitFor(() =>
				expect(screen.getByRole('button', { name: 'Back to list' })).not.toHaveClass('xl:hidden'),
			)

			await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))

			await waitFor(() =>
				expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/f/$folderId' })),
			)
			expect(navigate).not.toHaveBeenCalledWith(
				expect.objectContaining({ to: '/mail/f/$folderId/t/$threadId' }),
			)
		} finally {
			window.localStorage.clear()
		}
	})

	it('uses the starred list when triaging from Starred', async () => {
		splitView(true)
		const queryClient = new QueryClient()
		queryClient.setQueryData(mailKeys.threadList({ starred: true }), {
			pages: [{ threads: [opened, older] }],
			pageParams: [undefined],
		})
		renderThread(loaderData(), {}, { folderId: 'starred', threadId: 't1' }, queryClient)
		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'starred', threadId: 't2' } }),
			),
		)
	})

	it('returns to the list on phones, when nothing is cached, and after "Mark unread"', async () => {
		splitView(false)
		const first = renderThread(loaderData(), {}, undefined, inboxWith([opened, older]))
		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/f/$folderId' })),
		)
		first.unmount()

		splitView(true)
		navigate.mockClear()
		const second = renderThread(loaderData())
		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/f/$folderId' })),
		)
		second.unmount()

		navigate.mockClear()
		renderThread(loaderData(), {}, undefined, inboxWith([opened, older]))
		await userEvent.click(screen.getByRole('button', { name: 'Mark unread' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/f/$folderId' })),
		)
	})

	function pagedInbox(threads: any[], nextCursor = 'page-2') {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		queryClient.setQueryData(mailKeys.threadList({ folderId: 'inbox' }), {
			pages: [{ threads, nextCursor }],
			pageParams: [undefined],
		})
		return queryClient
	}
	const nextPageThread = { id: 't9', folders: ['inbox'], latest_message_received_date: 50 }

	it('loads the next page to keep triaging past the oldest loaded conversation', async () => {
		splitView(true)
		getThreads.mockResolvedValue({
			threads: [{ ...nextPageThread, grant_id: 'private' }],
			nextCursor: 'page-3',
		})
		const queryClient = pagedInbox([newest, opened])
		renderThread(loaderData(), {}, undefined, queryClient)

		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't9' } }),
			),
		)
		expect(getThreads).toHaveBeenCalledWith({ data: { folderId: 'inbox', pageToken: 'page-2' } })
		// The fetched page joins the list cache so the list shows the opened row.
		const list = queryClient.getQueryData<any>(mailKeys.threadList({ folderId: 'inbox' }))
		expect(list.pageParams).toEqual([undefined, 'page-2'])
		expect(list.pages[1]).toEqual({ threads: [nextPageThread], nextCursor: 'page-3' })
	})

	it('keeps a next page that arrives while the archive is still in flight', async () => {
		splitView(true)
		let confirmArchive: (value: unknown) => void = () => {}
		updateThreadState.mockReturnValueOnce(new Promise((resolve) => (confirmArchive = resolve)))
		let deliverPage: (value: unknown) => void = () => {}
		getThreads.mockReturnValueOnce(new Promise((resolve) => (deliverPage = resolve)))
		const queryClient = pagedInbox([newest, opened])
		const key = mailKeys.threadList({ folderId: 'inbox' })
		renderThread(loaderData(), {}, undefined, queryClient)

		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		// The request only starts after the journal captured its snapshot.
		await waitFor(() => expect(updateThreadState).toHaveBeenCalled())
		deliverPage({ threads: [nextPageThread] })
		await new Promise((resolve) => setTimeout(resolve, 0))
		// The archive commit then rebuilds from that earlier snapshot, which
		// must not discard the page that arrived in between.
		confirmArchive({ thread: { id: 't1', folders: ['archive'] } })

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't9' } }),
			),
		)
		const ids = queryClient
			.getQueryData<any>(key)
			.pages.flatMap((page: any) => page.threads.map((thread: any) => thread.id))
		expect(ids).toEqual(['t0', 't9'])
	})

	it('falls back to the newer neighbour when the next page cannot load or is empty', async () => {
		splitView(true)
		getThreads.mockRejectedValueOnce(new Error('offline'))
		const first = renderThread(loaderData(), {}, undefined, pagedInbox([newest, opened]))
		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't0' } }),
			),
		)
		first.unmount()

		navigate.mockClear()
		getThreads.mockResolvedValueOnce({ threads: [] })
		const queryClient = pagedInbox([newest, opened])
		renderThread(loaderData(), {}, undefined, queryClient)
		await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't0' } }),
			),
		)
		expect(queryClient.getQueryData<any>(mailKeys.threadList({ folderId: 'inbox' })).pages[1]).toEqual({
			threads: [],
		})
	})

	it('does not append a fetched page when the list changed while it loaded', async () => {
		splitView(true)
		const queryClient = pagedInbox([newest, opened])
		const key = mailKeys.threadList({ folderId: 'inbox' })
		const refreshed = { pages: [{ threads: [newest], nextCursor: 'fresh-cursor' }], pageParams: [undefined] }
		getThreads.mockImplementationOnce(async () => {
			queryClient.setQueryData(key, refreshed)
			return { threads: [nextPageThread] }
		})
		renderThread(loaderData(), {}, undefined, queryClient)
		await userEvent.click(desktopBar().getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't9' } }),
			),
		)
		expect(queryClient.getQueryData<any>(key).pages).toHaveLength(1)
	})

	it('shows the cached subject while a tapped conversation loads', () => {
		const Pending = Route.options.pendingComponent
		Route.useParams = vi.fn(() => ({ folderId: 'inbox', threadId: 't1' }))
		const queryClient = inboxWith([{ ...opened, subject: 'Quarterly plan' }])
		const view = render(
			<QueryClientProvider client={queryClient}>
				<Pending />
			</QueryClientProvider>,
		)
		expect(screen.getByRole('heading', { name: 'Quarterly plan' })).toBeTruthy()
		expect(screen.getByTestId('thread-reader-pending').getAttribute('aria-busy')).toBe('true')
		// The skeleton shares the loaded reader's toolbar and column gutters, so nothing shifts on load.
		const pending = screen.getByTestId('thread-reader-pending')
		expect(pending.firstElementChild).toHaveAttribute('data-slot', 'toolbar')
		const columns = pending.querySelectorAll('[data-slot="thread-column"]')
		expect(columns).toHaveLength(2)
		expect(columns[0]).toContainElement(screen.getByRole('heading', { name: 'Quarterly plan' }))
		for (const column of columns) expect(column.parentElement?.className).not.toMatch(/\bp[xlr]-/)
		view.unmount()

		Route.useParams = vi.fn(() => ({ folderId: 'inbox', threadId: 'uncached' }))
		render(
			<QueryClientProvider client={queryClient}>
				<Pending />
			</QueryClientProvider>,
		)
		expect(screen.getByRole('heading', { name: 'Loading conversation…' })).toBeTruthy()
	})
})

describe('thread detail cache entry without data', () => {
	it('keeps showing the loaded conversation when a seedless fetch replaces its cache entry', () => {
		// A hover preload or a background refetch can recreate the detail entry
		// while the reader is open. Such a fetch carries no loader seed, and React
		// Query only applies `initialData` to an existing entry in an effect, so
		// the next render sees no data. The reader must fall back to what the
		// loader gave it instead of crashing on `undefined`.
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const { rerenderThread } = renderThread(loaderData(), {}, undefined, queryClient)
		const queryKey = mailKeys.threadDetail('t1')
		queryClient.removeQueries({ queryKey, exact: true })
		void queryClient.fetchQuery({ queryKey, queryFn: () => new Promise(() => {}) })
		expect(queryClient.getQueryData(queryKey)).toBeUndefined()

		expect(() => rerenderThread()).not.toThrow()
		expect(screen.getByRole('heading', { name: 'Hello' })).toBeTruthy()
	})
})

describe('what the reader is given beyond the thread', () => {
	it('knows the named people of the conversations already listed, for the lookalike-sender check', () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		queryClient.setQueryData(mailKeys.threadList({ folderId: 'inbox' }), {
			pages: [
				{
					threads: [
						{
							id: 'bank',
							participants: [
								{ name: 'Meridian Bank', email: 'Statements@MeridianBank.com' },
								{ name: 'Me', email: 'me@x.com' },
								{ email: 'noname@x.com' },
							],
						},
						{ id: 'again', participants: [{ name: 'Meridian', email: 'statements@meridianbank.com' }] },
						{ id: 'none' },
					],
				},
			],
			pageParams: [undefined],
		})
		// A message from someone using that name on another domain is a lookalike: its links are inert.
		renderThread(
			loaderData({
				messages: [
					{
						id: 'm-bank',
						from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }],
						to: [{ email: 'me@x.com' }],
						body: '<p>Verify your <a href="https://meridian-secure.co/login">account</a>.</p>',
					},
				],
			}),
			{},
			undefined,
			queryClient,
		)
		expect(document.querySelector('[data-slot="expanded-message-content"]')).toHaveAttribute(
			'data-links-disabled',
			'true',
		)
		expect(screen.getByText(/usually writes from/)).toBeInTheDocument()
	})

	it('retries the messages that could not load, in place', async () => {
		getThreadMessages.mockResolvedValue({
			thread: { id: 't1', subject: 'Hello' },
			messages: [],
			mailboxEmail: 'me@x.com',
		})
		renderThread(loaderData({ failedMessageIds: ['lost'] }))
		const notice = screen.getByText('Couldn’t load 1 message. Showing 3 saved on this device.')
		fireEvent.click(
			within(notice.closest('[role="note"]') as HTMLElement).getByRole('button', { name: 'Try again' }),
		)
		await waitFor(() => expect(getThreadMessages).toHaveBeenCalledWith({ data: { threadId: 't1' } }))
	})

	it('says so on the reader when a draft cannot be discarded', async () => {
		deleteDraft.mockRejectedValue(new Error('nope'))
		renderThread(
			loaderData({
				messages: [
					...richMessages(),
					{ id: 'd1', from: [{ email: 'me@x.com' }], to: [{ email: 'alice@x.com' }], body: 'Draft' },
				],
				ownmailDraftMessageIds: ['d1'],
			}),
		)
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
		expect(await screen.findByText('Could not discard the draft')).toBeInTheDocument()
	})

	it('sends your scheduled message now or cancels it, and says so when it cannot', async () => {
		const later = Math.floor(Date.now() / 1000) + 86_400
		sendScheduledNow
			.mockResolvedValueOnce({ cancelledMessageId: 'm-out' })
			.mockRejectedValueOnce(new Error('x'))
		cancelScheduledSend
			.mockRejectedValueOnce(new Error('x'))
			.mockResolvedValueOnce({ cancelledMessageId: 'm-out' })
		const data = loaderData({
			messages: [
				...richMessages(),
				{
					id: 'm-out',
					from: [{ email: 'me@x.com' }],
					to: [{ name: 'Alice', email: 'alice@x.com' }],
					subject: 'Re: Hello',
					body: 'Later',
					date: 1_700_000_500,
					send_at: later,
					schedule_id: 'sched-1',
				},
			],
		})
		// Sending or cancelling reloads the thread; the provider still holds it in this test.
		getThreadMessages.mockResolvedValue(data)
		renderThread(data)
		// The actions sit on the message's own status line.
		const status = () => within(document.querySelector('[data-slot="outgoing-status"]') as HTMLElement)
		fireEvent.click(status().getByText('Send now'))
		await waitFor(() => expect(sendScheduledNow).toHaveBeenCalledWith({ data: { messageId: 'm-out' } }))
		fireEvent.click(status().getByText('Send now'))
		expect(await screen.findByText('Could not send it now')).toBeInTheDocument()
		fireEvent.click(status().getByText('Cancel'))
		expect(await screen.findByText('Could not cancel the scheduled send')).toBeInTheDocument()
		expect(composeApi.openCompose).not.toHaveBeenCalled()
		fireEvent.click(status().getByText('Cancel'))
		await waitFor(() =>
			expect(composeApi.openCompose).toHaveBeenCalledWith(
				expect.objectContaining({ kind: 'new', to: 'alice@x.com', body: 'Later' }),
			),
		)
	})

	it('names the folder the phone back button returns to, and gives the reply bar its room', () => {
		renderThread(loaderData(), {}, { folderId: 'sent', threadId: 't1' })
		const topBar = document.querySelector('[data-slot="mobile-thread-top-bar"]') as HTMLElement
		expect(within(topBar).getByRole('button', { name: 'Back to Sent' })).toBeInTheDocument()
		expect(screen.getByRole('region', { name: 'Thread conversation' })).toHaveClass('under-mobile-reply-bar')
		cleanup()
		renderThread(loaderData(), {}, { folderId: 'custom-label', threadId: 't1' })
		const custom = document.querySelector('[data-slot="mobile-thread-top-bar"]') as HTMLElement
		expect(within(custom).getByRole('button', { name: 'Back to list' })).toBeInTheDocument()
		cleanup()
		renderThread(loaderData({ messages: [] }))
		expect(screen.getByRole('region', { name: 'Thread conversation' })).not.toHaveClass(
			'under-mobile-reply-bar',
		)
	})

	it('keeps the toolbar and a way back when the conversation cannot load, and tries again in place', async () => {
		const user = userEvent.setup()
		Route.useParams = vi.fn(() => ({ folderId: 'inbox', threadId: 't1' }))
		Route.useSearch = vi.fn(() => ({ baseFolderId: 'starred' }))
		const reset = vi.fn()
		const ErrorView = Route.options.errorComponent
		render(<ErrorView error={new Error('down')} reset={reset} info={{ componentStack: '' }} />)
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		expect(toolbar).toHaveAttribute('data-slot', 'toolbar')
		await user.click(screen.getByRole('button', { name: 'Try again' }))
		expect(reset).toHaveBeenCalledTimes(1)
		await user.click(within(toolbar).getByRole('button', { name: 'Back to list' }))
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
			search: { baseFolderId: 'starred' },
		})
		Route.useSearch = vi.fn(() => ({}))
		cleanup()
		render(<ErrorView error={new Error('down')} reset={reset} info={{ componentStack: '' }} />)
		await user.click(screen.getByRole('button', { name: 'Back to list' }))
		expect(navigate).toHaveBeenLastCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
			search: {},
		})
	})
})
