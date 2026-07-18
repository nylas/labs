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
vi.mock('../server/fns.js', () => ({
	getThreadMessages: (input: any) => getThreadMessages(input),
	updateThreadState: (input: any) => updateThreadState(input),
}))

import { markdownToDraftBody } from '../components/html-to-markdown.js'
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

function renderThread(data: any = loaderData(), search: any = {}) {
	Route.useLoaderData = vi.fn(() => data)
	Route.useParams = vi.fn(() => ({ folderId: 'inbox', threadId: 't1' }))
	Route.useSearch = vi.fn(() => search)
	const Component = Route.options.component
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })}
		>
			<Component />
		</QueryClientProvider>,
	)
}

// --- loader & validateSearch --------------------------------------------

describe('thread route loader', () => {
	it('loads the thread using the threadId param so the view opens the right conversation', async () => {
		getThreadMessages.mockResolvedValue({ thread: { id: 't1' }, messages: [] })

		const data = await Route.options.loader({ params: { folderId: 'inbox', threadId: 't9' } })

		expect(getThreadMessages).toHaveBeenCalledWith({ data: { threadId: 't9' } })
		expect(data).toEqual({ thread: { id: 't1' }, messages: [] })
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
		expect(attachmentLinks).toHaveLength(7)
		for (const link of attachmentLinks) {
			expect(link).toHaveClass('bg-card', 'hover:bg-accent', 'dark:bg-muted/40', 'dark:hover:bg-muted')
			expect(link).not.toHaveClass('bg-muted/40', 'hover:bg-muted')
		}
	})

	it('renders the subject and its thread labels', () => {
		renderThread()
		expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
		expect(screen.getByText('Work')).toBeInTheDocument()
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
		// header attachment strip: one per non-inline attachment (a1, a2, a3, a5).
		// a1 lives on the collapsed m1 so it is unique to the header; a2/a3/a5 also
		// appear inside the expanded m2 block, hence getAllByText for those.
		expect(screen.getByText('doc.pdf')).toBeInTheDocument()
		expect(screen.getAllByText('big.zip').length).toBeGreaterThan(0)
		expect(screen.getAllByText('nosize.dat').length).toBeGreaterThan(0)
		// inline attachment is excluded
		expect(screen.queryByText('sig.png')).not.toBeInTheDocument()
		// size formatting: B / KB / MB
		expect(screen.getByText('· 500 B')).toBeInTheDocument()
		expect(screen.getAllByText('· 2 KB').length).toBeGreaterThan(0)
		expect(screen.getAllByText('· 3.0 MB').length).toBeGreaterThan(0)
		// attachment link points at the parent message
		const link = screen.getByText('doc.pdf').closest('a') as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe('/attachments/a1?message_id=m1')
	})
})

// --- message list -------------------------------------------------------

describe('message list', () => {
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
		expect(screen.getByText('carol@x.com')).toBeInTheDocument()
		expect(screen.getByText('(unknown sender)')).toBeInTheDocument()
		// last message expanded → recipient line and HTML body iframe present
		expect(screen.getByText('to me')).toBeInTheDocument()
		expect(screen.getByTitle('Email content m2')).toBeInTheDocument()
		// collapsed earlier message shows its preview
		expect(screen.getByText('first body line')).toBeInTheDocument()
	})

	it('toggles a collapsed message open and back, rendering its (empty) body and no attachments', async () => {
		const user = userEvent.setup()
		renderThread()
		const toggle = screen.getByText('(unknown sender)').closest('button') as HTMLButtonElement
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
	})
})

// --- toolbar actions ----------------------------------------------------

describe('toolbar actions', () => {
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

	it('hides the reply affordances entirely when the thread has no messages', () => {
		renderThread(
			loaderData({
				thread: { id: 't1', subject: 'Empty', starred: false, folders: [] },
				messages: [],
			}),
		)
		expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Write a reply/ })).not.toBeInTheDocument()
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
