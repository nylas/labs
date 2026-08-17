// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('#server/fns', () => ({
	getThreadMessages: (input: any) => getThreadMessages(input),
	updateThreadState: (input: any) => updateThreadState(input),
}))

import { markdownToDraftBody } from '#features/mail/lib/html-to-markdown'
import { ErrorBanner, Route } from './mail.f.$folderId.t.$threadId.js'

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
	updateThreadState.mockImplementation(async ({ data }: any) => ({
		thread: {
			id: data.threadId,
			starred: data.starred ?? false,
			unread: data.unread ?? false,
			folders: ['work'],
		},
	}))
	routerState = { location: { pathname: '/mail/f/inbox/t/t1' } }
})

// --- data builders -------------------------------------------------------

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
		markedRead: false,
		...overrides,
	}
}

function renderThread(
	data: any = loaderData(),
	search: any = {},
	params = { folderId: 'inbox', threadId: 't1' },
) {
	Route.useLoaderData = vi.fn(() => data)
	Route.useParams = vi.fn(() => params)
	Route.useSearch = vi.fn(() => search)
	const Component = Route.options.component
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
	const screen = () => (
		<QueryClientProvider client={queryClient}>
			<Component />
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
	it('uses a neutral light-mode conversation surface while preserving the dark-mode background', () => {
		renderThread()
		const conversation = document.querySelector('[data-slot="thread-conversation"]')
		const overflowSlots = document.querySelectorAll('[data-slot^="scroll-area-overflow-"]')

		expect(conversation).toHaveClass('min-h-full', 'bg-muted', 'dark:bg-background')
		expect(conversation).not.toHaveClass('bg-background', 'bg-card')
		expect(overflowSlots).toHaveLength(2)
		for (const slot of overflowSlots) {
			expect(slot).toHaveClass('from-muted/80', 'dark:from-background/80')
			expect(slot).not.toHaveClass('from-background/80')
		}
	})

	it('keeps nested sender and attachment surfaces distinct from the muted conversation', () => {
		renderThread()
		const avatars = document.querySelectorAll('[data-slot="sender-avatar"]')
		const attachmentLinks = document.querySelectorAll('[data-slot="thread-attachment"]')

		expect(avatars).toHaveLength(richMessages().length)
		for (const avatar of avatars) {
			expect(avatar).toHaveClass('bg-card', 'dark:bg-muted')
			expect(avatar).not.toHaveClass('bg-muted')
		}
		// Only the expanded message owns download links; the header is count-only,
		// so aggregate and per-message surfaces never duplicate a download.
		expect(attachmentLinks).toHaveLength(3)
		for (const link of attachmentLinks) {
			expect(link).toHaveClass('bg-card', 'hover:bg-accent', 'dark:bg-muted/40', 'dark:hover:bg-muted')
			expect(link).not.toHaveClass('bg-muted/40', 'hover:bg-muted')
		}
	})

	it('renders the subject and its thread labels', () => {
		renderThread()
		const heading = screen.getByRole('heading', { name: 'Hello' })
		expect(heading).toBeInTheDocument()
		expect(screen.getByText('Work')).toBeInTheDocument()
		expect(heading.closest('header')).toHaveClass('xl:sticky', 'xl:top-0', 'bg-muted', 'dark:bg-background')
	})

	it('falls back to "(no subject)" and shows no labels for an empty thread', () => {
		renderThread(
			loaderData({
				thread: { id: 't1', subject: '', starred: false, folders: [] },
				messages: [],
			}),
		)
		expect(screen.getByRole('heading', { name: '(no subject)' })).toBeInTheDocument()
		expect(screen.queryByText('Work')).not.toBeInTheDocument()
	})

	it('lists every non-inline attachment across the thread with human-readable sizes', () => {
		renderThread()
		// a1 lives on collapsed m1 and is intentionally absent until that message is
		// expanded. The count-only thread summary does not duplicate attachment links.
		expect(screen.queryByText('doc.pdf')).toBeNull()
		expect(screen.getByText('big.zip')).toBeInTheDocument()
		expect(screen.getByText('nosize.dat')).toBeInTheDocument()
		// inline attachment is excluded
		expect(screen.queryByText('sig.png')).not.toBeInTheDocument()
		// The expanded latest message covers KB / MB formatting without duplicates.
		expect(screen.getByText('· 2 KB')).toBeInTheDocument()
		expect(screen.getByText('· 3.0 MB')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Expand message from Alice' }))
		expect(screen.getByText('· 500 B')).toBeInTheDocument()
		// Once its message is expanded, the attachment link points at that parent message.
		const link = screen.getByText('doc.pdf').closest('a') as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe('/attachments/a1?message_id=m1')
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

	it('offers a separate raw email download for each individual message', () => {
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
		const link = screen.getByRole('link', { name: 'Download raw email from Alice' })

		expect(link).toHaveAttribute('href', '/messages/msg%2F%231/download')
		expect(link).toHaveAttribute('download')
		expect(link.closest('button')).toBeNull()
		expect(link.parentElement?.querySelector('button')).toHaveAttribute('aria-expanded', 'true')
	})

	it('opens the last message and collapses earlier ones, showing previews and senders', () => {
		renderThread()
		// senders resolved from name, email, and the unknown fallback
		expect(screen.getByText('Alice')).toBeInTheDocument()
		expect(screen.getAllByText('carol@x.com').length).toBeGreaterThan(0)
		expect(screen.getByText('(unknown sender)')).toBeInTheDocument()
		// last message expanded → recipient line and HTML body iframe present
		expect(screen.getByText('to me')).toBeInTheDocument()
		expect(screen.getByTitle('Email content m2')).toBeInTheDocument()
		// collapsed earlier message shows its preview
		expect(screen.getByText('first body line')).toBeInTheDocument()
	})

	it('expands and collapses every message from the thread overview controls', async () => {
		const user = userEvent.setup()
		renderThread()
		const toggles = () => Array.from(document.querySelectorAll('[data-slot="message-toggle"]'))

		expect(toggles().map((button) => button.getAttribute('aria-expanded'))).toEqual([
			'false',
			'false',
			'true',
		])
		await user.click(screen.getByRole('button', { name: 'Expand all 3 messages' }))
		expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true)
		expect(screen.getByRole('button', { name: 'Expand all 3 messages' })).toBeDisabled()

		await user.click(screen.getByRole('button', { name: 'Collapse all 3 messages' }))
		expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true)
		expect(screen.getByRole('button', { name: 'Collapse all 3 messages' })).toBeDisabled()
	})

	it('discloses complete available addressing and timestamp details', async () => {
		const user = userEvent.setup()
		renderThread(
			loaderData({
				messages: [
					{
						id: 'm-details',
						from: [{ name: 'Alice', email: 'alice@x.com' }],
						to: [{ name: 'Bob', email: 'bob@x.com' }],
						cc: [{ email: 'cc@x.com' }],
						bcc: [{ email: 'bcc@x.com' }],
						reply_to: [{ name: 'Replies', email: 'reply@x.com' }],
						date: 1_700_000_000,
						body: 'Detailed message',
					},
				],
			}),
		)
		const trigger = screen.getByRole('button', { name: /Show message details/ })
		expect(trigger).toHaveTextContent('to Bob')
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		expect(screen.queryByRole('heading', { name: 'Message details' })).not.toBeInTheDocument()

		await user.click(trigger)
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		const heading = screen.getByRole('heading', { name: 'Message details' })
		const panel = heading.closest('section')
		expect(panel).toHaveClass('sm:absolute', 'sm:top-full', 'bg-popover')
		expect(screen.getByText('Alice <alice@x.com>')).toBeInTheDocument()
		expect(screen.getByText('Bob <bob@x.com>')).toBeInTheDocument()
		expect(screen.getByText('cc@x.com')).toBeInTheDocument()
		expect(screen.getByText('bcc@x.com')).toBeInTheDocument()
		expect(screen.getByText('Replies <reply@x.com>')).toBeInTheDocument()
		expect(panel?.querySelector('time')).toHaveAttribute('datetime', '2023-11-14T22:13:20.000Z')

		await user.keyboard('x')
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		await user.click(screen.getByText('Alice <alice@x.com>'))
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		fireEvent.focusIn(panel as HTMLElement)
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		fireEvent.pointerDown(panel as HTMLElement)
		fireEvent.pointerUp(panel as HTMLElement)
		screen.getByLabelText('Thread conversation').focus()
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		await new Promise((resolve) => setTimeout(resolve, 0))
		fireEvent.focus(screen.getByRole('link', { name: 'Download raw email from Alice' }))
		expect(trigger).toHaveAttribute('aria-expanded', 'false')

		await user.click(trigger)
		const reopenedPanel = screen.getByRole('heading', { name: 'Message details' }).closest('section')
		fireEvent.pointerDown(reopenedPanel as HTMLElement)
		act(() => {
			document.dispatchEvent(new Event('pointerup', { bubbles: true }))
			document.dispatchEvent(new Event('pointercancel', { bubbles: true }))
		})
		fireEvent.focus(screen.getByRole('link', { name: 'Download raw email from Alice' }))
		expect(trigger).toHaveAttribute('aria-expanded', 'false')

		await user.click(trigger)
		await user.click(document.body)
		expect(trigger).toHaveAttribute('aria-expanded', 'false')

		await user.click(trigger)
		act(() => {
			document.dispatchEvent(new Event('pointerup', { bubbles: true }))
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
		})
		expect(trigger).toHaveFocus()
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		expect(screen.queryByRole('heading', { name: 'Message details' })).not.toBeInTheDocument()

		fireEvent.click(trigger)
		fireEvent.pointerDown(trigger)
		fireEvent.pointerUp(trigger)
		fireEvent.click(trigger)
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(trigger)
		fireEvent.focus(screen.getByRole('link', { name: 'Download raw email from Alice' }))
		expect(trigger).toHaveAttribute('aria-expanded', 'false')
		expect(navigate).not.toHaveBeenCalled()
	})

	it('shows addressing details without inventing a date when the provider omits it', async () => {
		const user = userEvent.setup()
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

		await user.click(screen.getByRole('button', { name: /Show message details/ }))
		const panel = screen.getByRole('heading', { name: 'Message details' }).closest('section')
		const labels = Array.from(panel?.querySelectorAll('dt') ?? [], (node) => node.textContent)
		expect(labels).toEqual(['From', 'To'])
		expect(panel?.querySelector('time')).toBeNull()
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

	it('lets expanded message content reclaim the avatar gutter', () => {
		renderThread()
		const content = document.querySelector('[data-slot="expanded-message-content"]')

		expect(content).toHaveClass('mt-5', 'w-full', 'min-w-0')
		expect(content).not.toHaveClass('pl-12')
	})

	it('toggles a collapsed message open and back, rendering its (empty) body and no attachments', async () => {
		const user = userEvent.setup()
		renderThread()
		const toggle = screen.getByRole('button', { name: 'Expand message from (unknown sender)' })
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		await user.click(toggle)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		// recipient line for the opened message uses its email-only recipient
		expect(screen.getByText('to noname@x.com')).toBeInTheDocument()
		await user.click(toggle)
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
	})

	it('renders attachments inside an opened message, including missing filename and size', () => {
		renderThread()
		// m2 is open by default; its attachments render inside the message block too
		expect(screen.getAllByText('attachment').length).toBeGreaterThan(0) // a2 has no filename
		expect(screen.getAllByText('big.zip').length).toBeGreaterThan(0)
	})

	it('renders a saved OwnMail draft as its final formatted HTML in the thread reader', () => {
		renderThread(
			loaderData({
				thread: { id: 'd1', subject: 'Draft', starred: false, folders: ['custom'] },
				messages: [
					{
						id: 'd1',
						folders: ['custom'],
						from: [{ email: 'me@x.com' }],
						body: markdownToDraftBody('# Heading\n\n**ready** to send'),
					},
				],
				ownmailDraftMessageIds: ['d1'],
			}),
		)
		const root = screen.getByTitle('Email content d1').shadowRoot?.querySelector('.email-root')

		expect(root?.querySelector('h1')?.textContent).toBe('Heading')
		expect(root?.querySelector('strong')?.textContent).toBe('ready')
		expect(root?.textContent).not.toContain('# Heading')
		expect(screen.queryByRole('link', { name: 'Download raw email from me@x.com' })).not.toBeInTheDocument()
	})
})

// --- toolbar actions ----------------------------------------------------

describe('toolbar actions', () => {
	it('keeps mobile and tablet toolbar actions touch-friendly', () => {
		renderThread()

		expect(screen.getByRole('button', { name: 'Back to list' })).toHaveClass(
			'h-11',
			'w-11',
			'shrink-0',
			'xl:hidden',
		)
		for (const label of ['Archive', 'Delete', 'Star', 'Mark unread']) {
			expect(screen.getByRole('button', { name: label })).toHaveClass(
				'h-11',
				'w-11',
				'shrink-0',
				'xl:h-9',
				'xl:w-9',
			)
		}
	})

	it('archives the thread and returns to the folder list', async () => {
		const user = userEvent.setup()
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Archive' }))
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

	it('returns archived threads to the inbox instead of archiving them again', async () => {
		const user = userEvent.setup()
		renderThread(loaderData({ thread: { id: 't1', subject: 'Hello', starred: false, folders: ['archive'] } }))
		await user.click(screen.getByRole('button', { name: 'Return to inbox' }))

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
			const button = screen.getByRole('button', { name: label })
			expect(button.querySelector('.animate-spin')).toBeNull()
		}

		fireEvent.click(star)
		expect(updateThreadState).toHaveBeenCalledTimes(1)

		resolveMutation?.({
			thread: { id: 't1', starred: true, unread: false, folders: ['work'] },
		})
		await waitFor(() => expect(screen.getByRole('button', { name: 'Unstar' })).toBeInTheDocument())
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
		await user.click(screen.getByRole('button', { name: 'Archive' }))
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
		fireEvent.touchStart(reader, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchMove(reader, { touches: [{ clientX: 50, clientY: 52 }] })
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 90, clientY: 55 }] })
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
		fireEvent.touchStart(reader, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 60, clientY: 52 }] })
		fireEvent.touchStart(reader, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 100, clientY: 180 }] })
		const back = screen.getByRole('button', { name: 'Back to list' })
		fireEvent.touchStart(back, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchEnd(back, { changedTouches: [{ clientX: 100, clientY: 52 }] })
		expect(navigate).not.toHaveBeenCalled()
	})

	it('cancels incomplete and multi-touch reader swipes', () => {
		renderThread()
		const reader = screen.getByTestId('thread-reader')
		fireEvent.touchStart(reader, {
			touches: [
				{ clientX: 10, clientY: 50 },
				{ clientX: 20, clientY: 50 },
			],
		})
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 100, clientY: 50 }] })
		fireEvent.touchStart(reader, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchCancel(reader)
		fireEvent.touchEnd(reader, { changedTouches: [{ clientX: 100, clientY: 50 }] })
		fireEvent.touchStart(reader, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchMove(reader, {
			touches: [
				{ clientX: 10, clientY: 50 },
				{ clientX: 20, clientY: 50 },
			],
		})
		fireEvent.touchEnd(reader, {
			touches: [],
			changedTouches: [{ clientX: 100, clientY: 50 }],
		})
		fireEvent.touchStart(reader, { touches: [{ clientX: 10, clientY: 50 }] })
		fireEvent.touchEnd(reader, {
			touches: [{ clientX: 20, clientY: 50 }],
			changedTouches: [{ clientX: 100, clientY: 50 }],
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
		await user.click(screen.getByRole('button', { name: 'Archive' }))
		expect(await screen.findByText('Action failed')).toBeInTheDocument()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('falls back to a generic message when a non-Error is thrown', async () => {
		const user = userEvent.setup()
		updateThreadState.mockRejectedValueOnce('weird')
		renderThread()
		await user.click(screen.getByRole('button', { name: 'Archive' }))
		expect(await screen.findByText('Action failed')).toBeInTheDocument()
	})
})

describe('ErrorBanner', () => {
	it('strips the QUOTA: prefix so plan-limit copy reads naturally', () => {
		render(<ErrorBanner message="QUOTA:  You hit a limit" />)
		expect(screen.getByText('You hit a limit')).toBeInTheDocument()
	})

	it('shows a non-quota message verbatim', () => {
		render(<ErrorBanner message="Plain error" />)
		expect(screen.getByText('Plain error')).toBeInTheDocument()
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
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({
					folderId: 'inbox',
					threadId: 't1',
					replyToMessageId: 'mL',
					to: 'reply@x.com',
				}),
			}),
		)
	})

	it('reply-all addresses every participant except the mailbox owner', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Reply all' }))
		const call = navigate.mock.calls.find((c) => c[0]?.search?.replyToMessageId === 'mL')
		const recipients: string = call?.[0].search.to
		expect(recipients).not.toContain('me@x.com')
		expect(recipients).toContain('sender@x.com')
		expect(recipients).toContain('other@x.com')
		expect(recipients).toContain('cc@x.com')
	})

	it('forwards the message with a quoted forwarding header', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Forward' }))
		const call = navigate.mock.calls.find((c) => c[0]?.to === '/mail/compose')
		expect(call?.[0].search.body).toContain('Forwarded message')
		expect(call?.[0].search.to).toBe('')
	})

	it('opens a reply from the bottom "Write a reply" composer', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: /Write a reply/ }))
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({ replyToMessageId: 'mL' }),
			}),
		)
	})

	it('offers complete mobile response actions with the same compose payloads', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		const group = screen.getByRole('group', { name: 'Thread response actions' })
		const reply = screen.getByRole('button', { name: 'Reply to thread' })
		const replyAll = screen.getByRole('button', { name: 'Reply all to thread' })
		const forward = screen.getByRole('button', { name: 'Forward thread' })

		expect(group).toHaveClass('grid-cols-3', 'pr-14', 'sm:hidden')
		for (const action of [reply, replyAll, forward]) expect(action).toHaveClass('min-h-11')
		expect(screen.getByRole('button', { name: /Write a reply/ })).toHaveClass('hidden', 'sm:flex')

		await user.click(reply)
		expect(navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({ folderId: 'inbox', threadId: 't1', to: 'reply@x.com' }),
			}),
		)

		replyAll.focus()
		await user.keyboard('{Enter}')
		const replyAllCall = navigate.mock.calls.at(-1)?.[0]
		expect(replyAllCall).toEqual(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({ folderId: 'inbox', threadId: 't1', replyToMessageId: 'mL' }),
			}),
		)
		expect(replyAllCall.search.to).toContain('sender@x.com')
		expect(replyAllCall.search.to).not.toContain('me@x.com')

		forward.focus()
		await user.keyboard(' ')
		expect(navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({ folderId: 'inbox', threadId: 't1', to: '' }),
			}),
		)
		expect(navigate.mock.calls.at(-1)?.[0].search.body).toContain('Forwarded message')
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

describe('keyboard shortcuts', () => {
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

	it('opens a reply to the latest message on "r"', async () => {
		renderThread()
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'r' })
		})
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({
					folderId: 'inbox',
					threadId: 't1',
					replyToMessageId: 'm2',
					to: 'carol@x.com',
				}),
			}),
		)
	})

	it('falls back to the event target when a reply event has no composed path', () => {
		renderThread()
		const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true })
		Object.defineProperty(event, 'composedPath', { value: () => [] })

		document.body.dispatchEvent(event)

		expect(event.defaultPrevented).toBe(true)
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))
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

// --- markedRead cache propagation --------------------------------------

describe('auto mark-read', () => {
	it('does not broadly invalidate the router when the loader reports the thread was marked read', () => {
		renderThread(loaderData({ markedRead: true }))
		expect(invalidate).not.toHaveBeenCalled()
	})

	it('does not invalidate when the thread was already read', () => {
		renderThread(loaderData({ markedRead: false }))
		expect(invalidate).not.toHaveBeenCalled()
	})
})
