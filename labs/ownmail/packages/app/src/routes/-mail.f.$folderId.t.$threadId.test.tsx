// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
// The Conversation view looks up bulk-mail headers on demand; the route tests never need a real lookup.
vi.mock('#features/mail/server/mail-functions', () => ({
	getThreadListUnsubscribe: () => Promise.resolve({ messageIds: [] }),
}))
vi.mock('#server/fns', () => ({
	getMailboxInfo: async () => ({ email: 'ada@ownmail.com', appName: 'OwnMail' }),
	getThreads: (input: any) => getThreads(input),
	getThreadMessages: (input: any) => getThreadMessages(input),
	markThreadRead: (input: any) => markThreadRead(input),
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
	markThreadRead.mockImplementation(async ({ data }: any) => ({
		thread: { id: data.threadId, unread: false, folders: ['inbox'] },
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

	it('keeps sender and attachment surfaces distinct from the conversation ground', () => {
		renderThread()
		const avatars = document.querySelectorAll('[data-slot="sender-avatar"]')
		const attachmentLinks = document.querySelectorAll('[data-slot="thread-attachment"]')

		expect(avatars).toHaveLength(richMessages().length)
		for (const avatar of avatars) {
			expect(avatar).toHaveClass('bg-muted')
			expect(avatar).not.toHaveClass('bg-background')
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
		// The subject is in the scroll flow; the toolbar is the only pinned row.
		const header = heading.closest('header') as HTMLElement
		expect(header).toHaveClass('bg-background')
		expect(header.className).not.toMatch(/sticky|top-0/)
		const viewport = screen.getByRole('region', { name: 'Thread conversation' })
		expect(viewport).toContainElement(header)
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		expect(toolbar).toHaveAttribute('data-slot', 'toolbar')
		expect(toolbar).toHaveClass('h-14', 'md:h-11', 'shrink-0')
		expect(viewport).not.toContainElement(toolbar)
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
		// The download sits behind the message's one overflow button.
		expect(screen.queryByRole('menuitem', { name: 'Download raw email' })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Actions for message from Alice' }))
		const link = screen.getByRole('menuitem', { name: 'Download raw email' })

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
		const states = () =>
			Array.from(document.querySelectorAll('[data-slot="thread-message"]'), (message) =>
				message.getAttribute('data-state'),
			)

		expect(states()).toEqual(['collapsed', 'collapsed', 'open'])
		await user.click(screen.getByRole('button', { name: 'Expand all 3 messages' }))
		expect(states()).toEqual(['open', 'open', 'open'])
		expect(screen.getByRole('button', { name: 'Expand all 3 messages' })).toBeDisabled()

		await user.click(screen.getByRole('button', { name: 'Collapse all 3 messages' }))
		expect(states()).toEqual(['collapsed', 'collapsed', 'collapsed'])
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
		fireEvent.focus(screen.getByRole('button', { name: 'Actions for message from Alice' }))
		expect(trigger).toHaveAttribute('aria-expanded', 'false')

		await user.click(trigger)
		const reopenedPanel = screen.getByRole('heading', { name: 'Message details' }).closest('section')
		fireEvent.pointerDown(reopenedPanel as HTMLElement)
		act(() => {
			document.dispatchEvent(new Event('pointerup', { bubbles: true }))
			document.dispatchEvent(new Event('pointercancel', { bubbles: true }))
		})
		fireEvent.focus(screen.getByRole('button', { name: 'Actions for message from Alice' }))
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
		fireEvent.focus(screen.getByRole('button', { name: 'Actions for message from Alice' }))
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

		expect(content).toHaveClass('w-full', 'min-w-0')
		expect(content).not.toHaveClass('pl-12')
		// The body starts directly under the 40px header row, with no extra gap above it.
		expect(content?.className).not.toMatch(/\bmt-/)
	})

	it('toggles a collapsed message open and back, rendering its (empty) body and no attachments', async () => {
		const user = userEvent.setup()
		renderThread()
		const article = screen.getByRole('article', { name: '(unknown sender)' })
		expect(article).toHaveAttribute('data-state', 'collapsed')
		await user.click(screen.getByRole('button', { name: 'Expand message from (unknown sender)' }))
		expect(article).toHaveAttribute('data-state', 'open')
		// recipient line for the opened message uses its email-only recipient
		expect(screen.getByText('to noname@x.com')).toBeInTheDocument()
		// Collapsing goes through the message's overflow menu.
		await user.click(screen.getByRole('button', { name: 'Actions for message from (unknown sender)' }))
		await user.click(screen.getByRole('menuitem', { name: 'Collapse message' }))
		expect(article).toHaveAttribute('data-state', 'collapsed')
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
		// A draft has no raw email, so its overflow menu offers only collapse.
		fireEvent.click(screen.getByRole('button', { name: 'Actions for message from me@x.com' }))
		expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Collapse message'])
	})
})

// --- toolbar actions ----------------------------------------------------

describe('toolbar actions', () => {
	it('keeps mobile and tablet toolbar actions touch-friendly', () => {
		renderThread()

		expect(screen.getByRole('button', { name: 'Back to list' })).toHaveClass('xl:hidden')
		// One recipe for the whole row: the route's own actions, the reply group and
		// the thread display actions are all the shared icon button, 36px with a fine
		// pointer and 44px on narrow and touch screens, so no size is mixed in the row.
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		const buttons = [...toolbar.querySelectorAll('button')]
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
			'Back to list',
			'Archive',
			'Delete',
			'Star',
			'Mark unread',
			'Messages view',
			'Conversation view',
			'Thread display',
			'Expand all 3 messages',
			'Collapse all 3 messages',
			'Reply',
			'Reply all',
			'Forward',
		])
		for (const button of buttons) {
			expect(button).toHaveClass('size-9', 'max-md:size-11', '[@media(any-pointer:coarse)]:size-11')
			expect(button.className).not.toMatch(/\b(?:xl:)?[hw]-(?:9|11)\b/)
		}
	})

	it('hosts the thread display actions in the toolbar, ahead of the reply group', async () => {
		const user = userEvent.setup()
		renderThread()
		const toolbar = screen.getByTestId('thread-reader').firstElementChild as HTMLElement
		const expandAll = screen.getByRole('button', { name: 'Expand all 3 messages' })

		// The subject row no longer carries these, so it needs no 44px control.
		expect(toolbar).toContainElement(expandAll)
		expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		expect(
			screen.getByRole('heading', { name: 'Hello' }).closest('header')?.querySelector('button'),
		).toBeNull()
		const reply = screen.getByRole('button', { name: 'Reply' })
		expect(expandAll.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

		await user.click(expandAll)
		expect(document.querySelectorAll('[data-slot="thread-message"][data-state="open"]')).toHaveLength(3)
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

	it('opens a reply from the inline "Write a reply" field after the last message', async () => {
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

	it('replies from the Conversation view through the same compose flow, to everyone by default', async () => {
		const user = userEvent.setup()
		renderThread(composeData())
		await user.click(screen.getByRole('button', { name: 'Conversation view' }))
		// The pinned input takes the place of the inline field; it never sends itself.
		expect(screen.queryByRole('button', { name: /Write a reply/ })).not.toBeInTheDocument()

		await user.click(await screen.findByRole('button', { name: /^Reply to all…/ }))

		// Everyone on the last message except the signed-in address.
		expect(navigate).toHaveBeenLastCalledWith({
			to: '/mail/compose',
			search: {
				folderId: 'inbox',
				threadId: 't1',
				to: 'reply@x.com, sender@x.com, other@x.com, cc@x.com',
				subject: 'Re: ',
				replyToMessageId: 'mL',
			},
		})
	})

	it('offers complete mobile response actions with the same compose payloads', async () => {
		const user = userEvent.setup()
		render(
			<div
				id={MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID}
				role="toolbar"
				aria-label="Thread actions"
				className="mobile-thread-tabs"
			/>,
		)
		renderThread(composeData())
		const toolbar = screen.getByRole('toolbar', { name: 'Thread actions' })
		const reply = screen.getByRole('button', { name: 'Reply to thread' })
		const replyAll = screen.getByRole('button', { name: 'Reply all to thread' })
		const forward = screen.getByRole('button', { name: 'Forward thread' })

		expect(toolbar).toHaveClass('mobile-thread-tabs')
		for (const action of [reply, replyAll, forward]) expect(action).toHaveClass('min-h-11')
		for (const action of [reply, replyAll, forward]) expect(action).toHaveTextContent('')
		const desktopReply = screen.getByRole('button', { name: /Write a reply/ })
		// Desktop only: mobile keeps the bottom bar as its single reply surface.
		expect(desktopReply).toHaveClass('hidden', 'md:flex')
		// The field is not pinned: it scrolls with the conversation, after the last
		// message, on the same column (and so the same gutters) as the messages.
		const viewport = screen.getByRole('region', { name: 'Thread conversation' })
		expect(viewport).toContainElement(desktopReply)
		const lastMessage = [...document.querySelectorAll('[data-slot="thread-message"]')].at(-1) as Element
		expect(lastMessage.compareDocumentPosition(desktopReply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(desktopReply.closest('[data-slot="thread-column"]')).not.toBeNull()
		expect(desktopReply.className).not.toMatch(/\bmx-/)
		const reader = screen.getByTestId('thread-reader')
		expect(reader.firstElementChild).toHaveClass('h-14', 'md:h-11')
		// Nothing but the toolbar and the scrolling conversation remains in the pane.
		expect([...reader.children].map((child) => child.getAttribute('data-slot'))).toEqual([
			'toolbar',
			'scroll-area',
		])

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

	it('moves focus to the inline reply field on "r", which then opens the reply', async () => {
		const user = userEvent.setup()
		renderThread()
		const field = screen.getByRole('button', { name: /Write a reply/ })
		await act(async () => {
			fireEvent.keyDown(document.body, { key: 'r' })
		})
		// Reading is not interrupted: the shortcut reaches the field, it does not navigate.
		expect(field).toHaveFocus()
		expect(navigate).not.toHaveBeenCalled()

		await user.keyboard('{Enter}')
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({ folderId: 'inbox', threadId: 't1', replyToMessageId: 'm2' }),
			}),
		)
	})

	it('opens a reply to the latest message on "r" where the inline field is not displayed', async () => {
		renderThread()
		// On mobile the field is `display: none` and cannot take focus; jsdom applies
		// no stylesheet, so stand in for that by making focus a no-op.
		vi.spyOn(screen.getByRole('button', { name: /Write a reply/ }), 'focus').mockImplementation(() => {})
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
		expect(screen.getByRole('button', { name: /Write a reply/ })).toHaveFocus()
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
		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
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

			await userEvent.click(screen.getByRole('button', { name: 'Archive' }))

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
		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ params: { folderId: 'starred', threadId: 't2' } }),
			),
		)
	})

	it('returns to the list on phones, when nothing is cached, and after "Mark unread"', async () => {
		splitView(false)
		const first = renderThread(loaderData(), {}, undefined, inboxWith([opened, older]))
		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/f/$folderId' })),
		)
		first.unmount()

		splitView(true)
		navigate.mockClear()
		const second = renderThread(loaderData())
		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
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

		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))

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

		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
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
		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
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
		await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
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
