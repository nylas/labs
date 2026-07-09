// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	navigate: vi.fn(),
	invalidate: vi.fn(),
	// Mutable router location, swapped per test to drive the mask branch.
	location: { pathname: '/mail/search' } as {
		pathname: string
		maskedLocation?: { pathname: string }
	},
}))

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useRouter: () => ({
		navigate: h.navigate,
		invalidate: h.invalidate,
		state: { location: h.location },
	}),
	// Render a real anchor so structure is inspectable; object props are stashed as JSON.
	Link: ({ to, search, mask, children, ...rest }: any) => (
		<a
			data-to={to}
			data-search={JSON.stringify(search)}
			data-mask={mask ? JSON.stringify(mask) : undefined}
			{...rest}
		>
			{children}
		</a>
	),
}))

const fns = vi.hoisted(() => ({
	getFolders: vi.fn(),
	getThreads: vi.fn(),
	getThreadMessages: vi.fn(),
	updateThreadState: vi.fn(),
}))
vi.mock('../server/fns.js', () => fns)

import { Route } from './mail.search.js'

function renderRoute() {
	const Comp = Route.options.component as () => JSX.Element
	return render(<Comp />)
}

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
	h.location = { pathname: '/mail/search' }
	h.navigate.mockResolvedValue(undefined)
	h.invalidate.mockResolvedValue(undefined)
	fns.updateThreadState.mockResolvedValue(undefined)
})

describe('/mail/search validateSearch', () => {
	it('keeps a query plus optional string folder/thread scope so deep links survive', () => {
		expect(Route.options.validateSearch({ q: 'hi', folderId: 'work', threadId: 't1' })).toEqual({
			q: 'hi',
			folderId: 'work',
			threadId: 't1',
		})
	})

	it('defaults a missing query to empty and omits absent scope keys', () => {
		expect(Route.options.validateSearch({})).toEqual({ q: '' })
	})

	it('coerces q to a string and drops non-string folder/thread values as untrusted input', () => {
		expect(Route.options.validateSearch({ q: 123, folderId: 5, threadId: {} })).toEqual({ q: '123' })
	})
})

describe('/mail/search loaderDeps', () => {
	it('exposes query and scope so the loader refetches when any of them change', () => {
		expect(Route.options.loaderDeps({ search: { q: 'hi', folderId: 'work', threadId: 't1' } })).toEqual({
			q: 'hi',
			folderId: 'work',
			threadId: 't1',
		})
	})
})

describe('/mail/search loader', () => {
	it('threads a starred filter and selected conversation through parallel fetches', async () => {
		fns.getFolders.mockResolvedValue([{ id: 'inbox' }])
		fns.getThreads.mockResolvedValue({ threads: [{ id: 't1' }] })
		fns.getThreadMessages.mockResolvedValue({ thread: { id: 't1' }, messages: [] })

		const result = await Route.options.loader({
			deps: { q: 'x', folderId: 'starred', threadId: 't1' },
		})

		expect(fns.getThreads).toHaveBeenCalledWith({ data: { q: 'x', starred: true } })
		expect(fns.getThreadMessages).toHaveBeenCalledWith({ data: { threadId: 't1' } })
		expect(result).toMatchObject({
			threads: [{ id: 't1' }],
			folders: [{ id: 'inbox' }],
			folderId: 'starred',
			selected: { thread: { id: 't1' } },
		})
	})

	it('scopes a non-starred folder query by folderId and skips message load without a thread', async () => {
		fns.getFolders.mockResolvedValue([])
		fns.getThreads.mockResolvedValue({ threads: [] })

		const result = await Route.options.loader({ deps: { q: 'y', folderId: 'work' } })

		expect(fns.getThreads).toHaveBeenCalledWith({ data: { q: 'y', folderId: 'work' } })
		expect(fns.getThreadMessages).not.toHaveBeenCalled()
		expect(result.selected).toBeNull()
	})

	it('searches all folders when no folder scope is supplied', async () => {
		fns.getFolders.mockResolvedValue([])
		fns.getThreads.mockResolvedValue({ threads: [] })

		const result = await Route.options.loader({ deps: { q: 'z' } })

		expect(fns.getThreads).toHaveBeenCalledWith({ data: { q: 'z' } })
		expect(result.folderId).toBeUndefined()
	})
})

describe('/mail/search results list', () => {
	beforeEach(() => {
		h.location = { pathname: '/x', maskedLocation: { pathname: '/' } }
		Route.useSearch = vi.fn(() => ({ q: 'hello', threadId: 't2' }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: 'work',
			selected: null,
			threads: [
				{
					id: 't1',
					unread: true,
					starred: false,
					has_attachments: true,
					folders: ['inbox', 'work'],
					participants: [{ name: 'Zoe' }],
					subject: 'Hello there',
					snippet: 'preview snippet',
					message_ids: ['a', 'b'],
					latest_message_received_date: Math.floor(Date.now() / 1000),
				},
				{
					id: 't0',
					unread: false,
					starred: true,
					has_attachments: false,
					folders: ['inbox'],
					participants: [{ name: 'Older' }],
					subject: 'Older thread',
					snippet: '',
					message_ids: ['x'],
					latest_message_sent_date: Math.floor(Date.now() / 1000) - 86_400,
				},
				{
					id: 't3',
					unread: false,
					starred: true,
					has_attachments: false,
					folders: ['inbox'],
					participants: [{ name: 'Undated two' }],
					subject: 'Undated two',
					snippet: '',
					message_ids: ['y'],
				},
				{
					id: 't2',
					unread: false,
					starred: true,
					has_attachments: false,
					folders: ['inbox'],
					participants: [{ email: 'p@x.com' }],
					subject: '',
					snippet: '',
				},
			],
		}))
	})

	it('renders scoped results with an unread badge and a placeholder detail pane', () => {
		const { container } = renderRoute()

		// Label-scoped title resolves via the labels table.
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Filtered')
		expect(screen.getByText('1 unread')).toBeTruthy()
		expect(screen.getByText('Hello there')).toBeTruthy()
		// Empty subject falls back to a placeholder.
		expect(screen.getByText('(no subject)')).toBeTruthy()
		// Multi-message thread shows its count; single-message thread does not.
		expect(screen.getByText('(2)')).toBeTruthy()
		// The active thread and the unread thread are flagged for styling/state.
		expect(container.querySelector('[data-active="true"]')?.getAttribute('data-to')).toBe('/mail/search')
		expect(container.querySelector('[data-unread="true"]')).toBeTruthy()
		// No conversation selected -> the reader shows the empty prompt.
		expect(screen.getByText('Select a conversation')).toBeTruthy()
	})

	it('toggling a row star persists the new state and refreshes the list', async () => {
		const user = userEvent.setup()
		renderRoute()

		await user.click(screen.getByLabelText('Star'))

		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: true } }),
		)
		expect(h.invalidate).toHaveBeenCalled()
	})
})

describe('/mail/search empty results', () => {
	it('shows the empty-state copy and no unread badge when nothing matches', () => {
		Route.useSearch = vi.fn(() => ({ q: 'nomatch', threadId: undefined }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: undefined,
			selected: null,
			threads: [],
		}))

		renderRoute()

		// Undefined folder scope defaults the title to the inbox.
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Inbox')
		expect(screen.queryByText(/unread$/)).toBeNull()
		expect(screen.getByText('Nothing here')).toBeTruthy()
	})

	it('omits the folder key from a result link when the search is unscoped', () => {
		Route.useSearch = vi.fn(() => ({ q: 'q', threadId: undefined }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: undefined,
			selected: null,
			threads: [
				{
					id: 'only',
					unread: false,
					starred: false,
					has_attachments: false,
					folders: ['inbox'],
					participants: [{ name: 'Y' }],
					subject: 'Unscoped',
					snippet: '',
					message_ids: ['1'],
				},
			],
		}))

		const { container } = renderRoute()

		const link = container.querySelector('a[data-to="/mail/search"]')
		expect(JSON.parse(link?.getAttribute('data-search') ?? '{}')).toEqual({ q: 'q', threadId: 'only' })
	})
})

describe('/mail/search thread detail', () => {
	const messages = [
		{
			id: 'm1',
			from: [{ name: 'Alice', email: 'alice@x.com' }],
			to: [{ name: 'Bob', email: 'bob@x.com' }, { email: 'nomail@x.com' }],
			date: 1_700_000_000,
			body: '<p>Hello world</p><p>Second para</p>',
			attachments: [
				{ id: 'att1', filename: 'file.pdf', size: 500, is_inline: false },
				{ id: 'att1b', filename: 'big.bin', size: 5000, is_inline: false },
				{ id: 'inl', filename: 'inline.png', size: 10, is_inline: true },
			],
		},
		{ id: 'm2', body: '', snippet: '', to: [], attachments: [] },
		{
			id: 'm3',
			from: [{ email: 'carol@x.com' }],
			body: '<div>Last body</div>',
			attachments: [
				{ id: 'att3', size: 2 * 1024 * 1024, is_inline: false },
				{ id: 'att3b', filename: 'nosize.txt', is_inline: false },
			],
		},
	]

	function seedDetail(overrides: {
		thread: any
		messages: any[]
		mailboxEmail?: string
		markedRead?: boolean
	}) {
		Route.useSearch = vi.fn(() => ({ q: 'hello', threadId: overrides.thread.id }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: 'work',
			// A single row keeps list markup rendering alongside the detail pane.
			threads: [
				{
					id: overrides.thread.id,
					unread: false,
					starred: false,
					has_attachments: false,
					folders: ['inbox'],
					participants: [{ name: 'X' }],
					subject: 'row',
					snippet: '',
					message_ids: ['1'],
				},
			],
			selected: {
				thread: overrides.thread,
				messages: overrides.messages,
				mailboxEmail: overrides.mailboxEmail ?? 'me@x.com',
				...(overrides.markedRead ? { markedRead: true } : {}),
			},
		}))
	}

	it('renders a rich conversation: banner, message blocks, sizes and reply actions', async () => {
		h.location = { pathname: '/x', maskedLocation: { pathname: '/' } }
		const user = userEvent.setup()
		seedDetail({
			thread: {
				id: 'th1',
				subject: 'Subject A',
				starred: false,
				has_attachments: true,
				folders: ['inbox', 'work'],
			},
			messages,
		})

		renderRoute()

		// Subject + label chip in the header.
		expect(screen.getByText('Subject A')).toBeTruthy()
		expect(screen.getAllByText('Work').length).toBeGreaterThan(0)
		// Attachment banner uses the first non-inline attachment (500 bytes -> "B").
		expect(screen.getAllByText('file.pdf').length).toBeGreaterThan(0)
		expect(screen.getByText(/500 B/)).toBeTruthy()
		// Last message opens by default: recipient line collapses to "me", body renders.
		expect(screen.getByText(/to me/)).toBeTruthy()
		expect(screen.getByText('Last body')).toBeTruthy()
		// Its attachments cover the MB size branch and the filename fallback.
		expect(screen.getByText(/2\.0 MB/)).toBeTruthy()
		expect(screen.getByText('nosize.txt')).toBeTruthy()
		expect(screen.getByText('attachment')).toBeTruthy()

		// Expand the first (collapsed) message: recipients + body + KB-sized attachment appear.
		await user.click(screen.getByRole('button', { name: /Alice/ }))
		expect(screen.getByText(/to Bob/)).toBeTruthy()
		expect(screen.getByText('Second para')).toBeTruthy()
		expect(screen.getByText(/5 KB/)).toBeTruthy()

		// Collapse the last message: it now shows a one-line preview instead of "to ...".
		await user.click(screen.getByRole('button', { name: /carol/ }))

		// Expand the empty (no-sender) message: its empty body and attachment lists collapse to nothing.
		await user.click(screen.getByRole('button', { name: /unknown sender/i }))
		expect(screen.getByText(/to me/)).toBeTruthy()

		// Reply / Reply all / Forward each route to the composer for the latest message.
		await user.click(screen.getByRole('button', { name: 'Reply' }))
		await user.click(screen.getByRole('button', { name: 'Reply all' }))
		await user.click(screen.getByRole('button', { name: 'Forward' }))
		await waitFor(() =>
			expect(h.navigate).toHaveBeenCalledWith(
				expect.objectContaining({
					to: '/mail/compose',
					search: expect.objectContaining({ threadId: 'th1', replyToMessageId: 'm3' }),
				}),
			),
		)

		// Archive leaves the thread (state update + navigate back to the list + invalidate).
		await user.click(screen.getByLabelText('Archive'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'th1', folder: 'archive' },
			}),
		)
		expect(h.navigate).toHaveBeenCalledWith(expect.not.objectContaining({ mask: expect.anything() }))
		expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))

		// Deleting also leaves the thread, moving it to trash.
		await user.click(screen.getByLabelText('Delete'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'th1', folder: 'trash' },
			}),
		)

		// Starring stays on the thread (no navigation from this action).
		// The toolbar button is disambiguated from the row star by its title attribute.
		await user.click(screen.getByTitle('Star'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'th1', starred: true },
			}),
		)

		// Escape returns to the list with a real URL (no mask).
		h.navigate.mockClear()
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))
		expect(h.navigate).toHaveBeenCalledWith(expect.not.objectContaining({ mask: expect.anything() }))
	})

	it('falls back to placeholder attachment metadata and disables reply when a thread has no messages', async () => {
		const user = userEvent.setup()
		seedDetail({
			thread: {
				id: 'thB',
				subject: '',
				starred: true,
				has_attachments: true,
				folders: ['finance'],
			},
			messages: [],
			markedRead: true,
		})

		renderRoute()

		// markedRead selection triggers a background refresh on mount.
		expect(h.invalidate).toHaveBeenCalled()
		// No messages -> banner shows placeholder filename and size.
		expect(screen.getByText('attachment.pdf')).toBeTruthy()
		expect(screen.getByText(/248 KB/)).toBeTruthy()
		// Reply is hidden with no message to reply to; Reply all/Forward are inert.
		expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
		await user.click(screen.getByRole('button', { name: 'Reply all' }))
		await user.click(screen.getByRole('button', { name: 'Forward' }))
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose' }))

		// Unstar (thread already starred) updates state without leaving the view.
		await user.click(screen.getByLabelText('Unstar'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'thB', starred: false },
			}),
		)
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))

		// Archiving without a mask navigates back with just the search scope.
		await user.click(screen.getByLabelText('Archive'))
		await waitFor(() =>
			expect(h.navigate).toHaveBeenCalledWith({
				to: '/mail/search',
				search: { q: 'hello', folderId: 'work' },
			}),
		)
	})

	it('renders no attachment banner when the thread carries no attachments', () => {
		seedDetail({
			thread: { id: 'thC', subject: 'C', starred: false, has_attachments: false, folders: [] },
			messages: [{ id: 'mc', from: [{ name: 'Z' }], body: '<p>hi</p>' }],
		})

		renderRoute()

		expect(screen.getByText('hi')).toBeTruthy()
		expect(screen.queryByText(/248 KB/)).toBeNull()
		expect(screen.queryByText('attachment.pdf')).toBeNull()
	})
})

describe('/mail/search keyboard shortcuts', () => {
	function seedKeyboardDetail() {
		h.location = { pathname: '/mail/search' }
		Route.useSearch = vi.fn(() => ({ q: 'kb', threadId: 'thK' }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: 'work',
			threads: [],
			selected: {
				thread: { id: 'thK', subject: 'K', starred: false, has_attachments: false, folders: [] },
				messages: [],
				mailboxEmail: 'me@x.com',
			},
		}))
	}

	it('Escape returns to the results list', () => {
		seedKeyboardDetail()
		renderRoute()

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

		expect(h.navigate).toHaveBeenCalledWith({ to: '/mail/search', search: { q: 'kb', folderId: 'work' } })
	})

	it('ignores Escape with a modifier so shortcuts do not fire mid-chord', () => {
		seedKeyboardDetail()
		renderRoute()

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', metaKey: true, bubbles: true }))

		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('ignores non-Escape keys', () => {
		seedKeyboardDetail()
		renderRoute()

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('ignores Escape while typing in a field so it does not steal focus events', () => {
		seedKeyboardDetail()
		renderRoute()

		const input = document.createElement('input')
		document.body.appendChild(input)
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		document.body.removeChild(input)

		expect(h.navigate).not.toHaveBeenCalled()
	})
})
