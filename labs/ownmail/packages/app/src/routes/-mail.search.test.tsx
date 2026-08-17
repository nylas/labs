// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mailKeys } from '#features/mail/state/mail-queries'

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
			href={typeof to === 'string' ? to : undefined}
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
vi.mock('#server/fns', () => fns)

import { Route } from './mail.search.js'

function renderRoute(
	client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }),
) {
	const Comp = Route.options.component as () => JSX.Element
	return render(
		<QueryClientProvider client={client}>
			<Comp />
		</QueryClientProvider>,
	)
}

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
	h.location = { pathname: '/mail/search' }
	h.navigate.mockResolvedValue(undefined)
	h.invalidate.mockResolvedValue(undefined)
	fns.updateThreadState.mockImplementation(async ({ data }: any) => ({
		thread: {
			id: data.threadId,
			starred: data.starred ?? false,
			unread: data.unread ?? false,
			folders: [data.folder ?? 'inbox'],
		},
	}))
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

	it('does not turn a blank query into an unfiltered mailbox request', async () => {
		fns.getFolders.mockResolvedValue([])
		fns.getThreads.mockResolvedValue({ threads: [{ id: 'existing-mailbox-thread' }] })

		const result = await Route.options.loader({
			deps: { q: '   ', folderId: undefined, threadId: 'existing-mailbox-thread' },
		})

		expect(fns.getThreads).not.toHaveBeenCalled()
		expect(fns.getThreadMessages).not.toHaveBeenCalled()
		expect(result).toMatchObject({ threads: [], selected: null })
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
		// Unread badge shows the count only, matching the mail folder list.
		expect(screen.getByText('1')).toBeTruthy()
		expect(screen.getByText('Hello there')).toBeTruthy()
		// Empty subject falls back to a placeholder.
		expect(screen.getByText('(no subject)')).toBeTruthy()
		// Multi-message thread shows its count; single-message thread does not.
		expect(screen.getByText('(2)')).toBeTruthy()
		// The active thread and the unread thread are flagged for styling/state.
		expect(container.querySelector('[data-active="true"]')?.querySelector('a')).toHaveAttribute(
			'data-to',
			'/mail/search',
		)
		expect(container.querySelector('[data-unread="true"]')).toBeTruthy()
		// No conversation selected -> the reader shows the empty prompt.
		expect(screen.getByText('Select a conversation')).toBeTruthy()
		const listPane = screen.getByRole('heading', { level: 1 }).closest('section')
		expect(listPane).toHaveClass('flex', 'xl:w-[22rem]', 'xl:flex-none')
		expect(listPane).not.toHaveClass('md:w-[22rem]', 'md:flex-none')
		expect(screen.getByText('Select a conversation').closest('div.hidden')).toHaveClass('xl:flex')
	})

	it('uses the starred cache key for the starred pseudo-folder', () => {
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, folderId: 'starred' }))
		renderRoute()
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Starred')
	})

	it('labels unscoped results as search results instead of inbox', () => {
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, folderId: undefined }))

		renderRoute()

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Search results')
	})

	it('offers a full-width accessible control when the first page has a continuation cursor', () => {
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, nextCursor: 'cursor-2' }))

		renderRoute()

		expect(screen.getByText('Hello there')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Load more search results' })).toHaveClass('min-h-11', 'w-full')
	})

	it('can continue from an empty page that has a continuation cursor', async () => {
		const user = userEvent.setup()
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, threads: [], nextCursor: 'cursor-2' }))
		fns.getThreads.mockResolvedValue({
			threads: [{ ...initial.threads[0], id: 'page-2', subject: 'Found on the next page' }],
		})
		renderRoute()

		const status = screen.getByRole('status')
		expect(status).toHaveTextContent('More messages may be available')
		expect(status).toHaveTextContent('Load the next page to continue searching.')
		expect(status).toHaveClass('min-h-0', 'flex-1')
		expect(status).not.toHaveClass('h-full')
		expect(status.parentElement).toHaveClass('flex', 'flex-col')
		await user.click(screen.getByRole('button', { name: 'Load more search results' }))

		expect(await screen.findByText('Found on the next page')).toBeInTheDocument()
		expect(fns.getThreads).toHaveBeenCalledWith({
			data: { q: 'hello', folderId: 'work', pageToken: 'cursor-2' },
		})
	})

	it('loads a scoped next page, dedupes results, preserves date order, and opens an appended row by keyboard', async () => {
		const user = userEvent.setup()
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, nextCursor: 'cursor-2' }))
		fns.getThreads.mockResolvedValue({
			threads: [
				{
					...initial.threads[0],
					subject: 'Updated duplicate',
				},
				{
					...initial.threads[1],
					id: 'page-2',
					subject: 'Newest appended result',
					latest_message_sent_date: Math.floor(Date.now() / 1000) + 86_400,
				},
			],
		})

		const { container } = renderRoute()
		await user.click(screen.getByRole('button', { name: 'Load more search results' }))

		await waitFor(() =>
			expect(fns.getThreads).toHaveBeenCalledWith({
				data: { q: 'hello', folderId: 'work', pageToken: 'cursor-2' },
			}),
		)
		expect(await screen.findByText('Newest appended result')).toBeInTheDocument()
		expect(screen.getAllByText('Updated duplicate')).toHaveLength(1)
		expect(screen.queryByText('Hello there')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Load more search results' })).not.toBeInTheDocument()

		const rows = container.querySelectorAll('[data-nav-row]')
		expect(rows[0]).toHaveTextContent('Newest appended result')
		expect(rows[1]).toHaveTextContent('Updated duplicate')

		const lastRow = rows[rows.length - 1] as HTMLElement
		lastRow.querySelector<HTMLElement>('.thread-row-link')?.focus()
		await user.keyboard('{Home}')
		await waitFor(() =>
			expect(container.querySelector('[data-nav-cursor="true"]')).toHaveTextContent('Newest appended result'),
		)
		expect(document.activeElement).toHaveClass('thread-row-link')
		expect(document.activeElement).toHaveAttribute(
			'aria-label',
			expect.stringMatching(/Newest appended result/),
		)
		await user.keyboard('{Enter}')
		expect(h.navigate).toHaveBeenLastCalledWith({
			to: '/mail/search',
			search: { q: 'hello', folderId: 'work', threadId: 'page-2' },
		})
	})

	it('prevents duplicate next-page requests while loading', async () => {
		const user = userEvent.setup()
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, nextCursor: 'cursor-2' }))
		let resolvePage: ((value: { threads: never[] }) => void) | undefined
		fns.getThreads.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePage = resolve
				}),
		)
		renderRoute()

		const loadMore = screen.getByRole('button', { name: 'Load more search results' })
		await user.dblClick(loadMore)

		expect(fns.getThreads).toHaveBeenCalledTimes(1)
		expect(screen.getByRole('button', { name: 'Loading more search results…' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Loading more search results…' })).toHaveAttribute(
			'aria-busy',
			'true',
		)
		resolvePage?.({ threads: [] })
		await waitFor(() =>
			expect(screen.queryByRole('button', { name: 'Loading more search results…' })).not.toBeInTheDocument(),
		)
	})

	it('keeps current results and offers a generic retry after a next-page failure', async () => {
		const user = userEvent.setup()
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, nextCursor: 'cursor-2' }))
		fns.getThreads.mockRejectedValueOnce(new Error('provider secret: cursor-2')).mockResolvedValueOnce({
			threads: [{ ...initial.threads[1], id: 'recovered', subject: 'Recovered result' }],
		})
		renderRoute()

		await user.click(screen.getByRole('button', { name: 'Load more search results' }))

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not load more results. Check your connection, then try again.',
		)
		expect(screen.getByText('Older thread')).toBeInTheDocument()
		expect(screen.queryByText(/provider secret/i)).not.toBeInTheDocument()
		const retry = screen.getByRole('button', { name: 'Try loading more search results' })
		expect(retry).toBeEnabled()
		expect(retry).toHaveAttribute('aria-describedby', 'search-pagination-error')

		await user.click(retry)

		expect(await screen.findByText('Recovered result')).toBeInTheDocument()
		expect(fns.getThreads).toHaveBeenCalledTimes(2)
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('uses the starred filter when loading more starred search results', async () => {
		const user = userEvent.setup()
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, folderId: 'starred', nextCursor: 'cursor-2' }))
		fns.getThreads.mockResolvedValue({ threads: [] })
		renderRoute()

		await user.click(screen.getByRole('button', { name: 'Load more search results' }))

		await waitFor(() =>
			expect(fns.getThreads).toHaveBeenCalledWith({
				data: { q: 'hello', starred: true, pageToken: 'cursor-2' },
			}),
		)
	})

	it('keeps a late page from an old query identity out of the current search', async () => {
		const user = userEvent.setup()
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useLoaderData = vi.fn(() => ({ ...initial, nextCursor: 'cursor-2' }))
		let resolveOldPage: ((value: { threads: any[] }) => void) | undefined
		fns.getThreads.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveOldPage = resolve
				}),
		)
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const firstSearch = renderRoute(client)
		await user.click(screen.getByRole('button', { name: 'Load more search results' }))
		await waitFor(() => expect(fns.getThreads).toHaveBeenCalledTimes(1))

		firstSearch.unmount()
		Route.useSearch = vi.fn(() => ({ q: 'different', threadId: undefined }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: 'work',
			selected: null,
			threads: [{ ...initial.threads[1], id: 'current', subject: 'Current query result' }],
		}))
		renderRoute(client)
		resolveOldPage?.({
			threads: [{ ...initial.threads[1], id: 'late-old', subject: 'Late old result' }],
		})

		await waitFor(() => {
			const oldData = client.getQueryData(mailKeys.threadList({ q: 'hello', folderId: 'work' })) as {
				pages: unknown[]
			}
			expect(oldData.pages).toHaveLength(2)
		})
		expect(screen.getByText('Current query result')).toBeInTheDocument()
		expect(screen.queryByText('Late old result')).not.toBeInTheDocument()
	})

	it('toggling a row star persists the new state through the mutation gateway', async () => {
		const user = userEvent.setup()
		renderRoute()

		await user.click(screen.getByLabelText('Star'))

		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: true } }),
		)
		expect(h.invalidate).not.toHaveBeenCalled()
	})

	it('renders the result link and star as sibling actions with a mobile-sized star target', () => {
		const { container } = renderRoute()
		const row = container.querySelector<HTMLElement>('[data-nav-row]')
		const link = screen.getByRole('link', { name: 'Open Hello there from Zoe' })
		const star = screen.getByRole('button', { name: 'Star' })

		expect(row).toHaveAttribute('tabindex', '-1')
		expect(link).not.toContainElement(star)
		expect(row).toContainElement(link)
		expect(row).toContainElement(star)
		expect(star).toHaveClass('h-11', 'w-11', 'lg:h-8', 'lg:w-8')
	})
})

describe('/mail/search empty results', () => {
	it('shows search-specific recovery copy and no unread badge when a query has no matches', () => {
		Route.useSearch = vi.fn(() => ({ q: 'nomatch', threadId: undefined }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: undefined,
			selected: null,
			threads: [],
		}))

		renderRoute()

		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Search results')
		expect(screen.queryByText(/unread$/)).toBeNull()
		expect(screen.getByText('No messages found')).toBeInTheDocument()
		expect(screen.getByText('Try different keywords or clear the search.')).toBeInTheDocument()
		expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
		expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true')
		expect(screen.queryByText('Nothing here')).not.toBeInTheDocument()
		expect(screen.queryByText('This view is empty.')).not.toBeInTheDocument()
	})

	it('prompts for keywords when an empty-query deep link has no results', () => {
		Route.useSearch = vi.fn(() => ({ q: '   ', threadId: undefined }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: undefined,
			selected: null,
			threads: [],
		}))

		renderRoute()

		expect(screen.getByText('Search your mail')).toBeInTheDocument()
		expect(screen.getByText('Enter keywords above to find messages.')).toBeInTheDocument()
		expect(screen.queryByText('No messages found')).not.toBeInTheDocument()
		expect(screen.getByRole('status')).toBeInTheDocument()
		expect(fns.getThreads).not.toHaveBeenCalled()
	})

	it('ignores cached list and detail data when a blank query retains a thread id', () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		queryClient.setQueryData(mailKeys.threadList({ q: '   ' }), {
			pages: [{ threads: [{ id: 'cached-list', subject: 'Cached list result' }] }],
			pageParams: [undefined],
		})
		queryClient.setQueryData(mailKeys.threadDetail('cached-detail'), {
			thread: { id: 'cached-detail', subject: 'Cached conversation', folders: ['inbox'] },
			messages: [],
			mailboxEmail: 'me@example.com',
		})
		Route.useSearch = vi.fn(() => ({ q: '   ', threadId: 'cached-detail' }))
		Route.useLoaderData = vi.fn(() => ({
			folders: [],
			folderId: undefined,
			selected: null,
			threads: [],
		}))

		renderRoute(queryClient)

		expect(screen.getByRole('status')).toHaveTextContent('Search your mail')
		expect(screen.queryByText('Cached list result')).not.toBeInTheDocument()
		expect(screen.queryByText('Cached conversation')).not.toBeInTheDocument()
		expect(fns.getThreads).not.toHaveBeenCalled()
		expect(fns.getThreadMessages).not.toHaveBeenCalled()
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

	it('renders the shared reader and routes reply actions + toolbar to the composer/list', async () => {
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
		expect(screen.getByRole('link', { name: 'Back to list' })).toHaveClass('h-11', 'w-11', 'xl:hidden')

		// The shared reader (same component as the folder thread view) shows the subject,
		// label chip, and the last message's HTML body via the iframe renderer.
		expect(screen.getByText('Subject A')).toBeTruthy()
		expect(screen.getAllByText('Work').length).toBeGreaterThan(0)
		expect(screen.getByTitle('Email content m3')).toBeTruthy()

		// Reply / Reply all / Forward each route to the composer for the latest message.
		await user.click(screen.getByRole('button', { name: 'Reply' }))
		await user.click(screen.getByRole('button', { name: 'Reply all' }))
		await user.click(screen.getByRole('button', { name: 'Forward' }))
		// The mobile "Write a reply…" footer also routes to the composer.
		await user.click(screen.getByRole('button', { name: /Write a reply/ }))
		await waitFor(() =>
			expect(h.navigate).toHaveBeenCalledWith(
				expect.objectContaining({
					to: '/mail/compose',
					search: expect.objectContaining({ threadId: 'th1', replyToMessageId: 'm3' }),
				}),
			),
		)

		// Archive leaves the thread (state update + navigate back to the list, no mask).
		await user.click(screen.getByLabelText('Archive'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'th1', folder: 'archive' },
			}),
		)
		expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))
		expect(h.navigate).toHaveBeenCalledWith(expect.not.objectContaining({ mask: expect.anything() }))

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

	it('returns archived search results to the inbox instead of archiving them again', async () => {
		const user = userEvent.setup()
		seedDetail({
			thread: {
				id: 'th-archive',
				subject: 'Archived',
				starred: false,
				has_attachments: false,
				folders: ['archive'],
			},
			messages,
		})

		renderRoute()
		await user.click(screen.getByLabelText('Return to inbox'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'th-archive', folder: 'inbox' },
			}),
		)
	})

	it('keeps an unscoped selected conversation in the unscoped search identity', () => {
		seedDetail({
			thread: {
				id: 'th-unscoped',
				subject: 'Unscoped detail',
				starred: false,
				has_attachments: false,
				folders: ['inbox'],
			},
			messages,
		})
		const initial = (Route.useLoaderData as ReturnType<typeof vi.fn>)()
		Route.useSearch = vi.fn(() => ({ q: 'hello', threadId: 'th-unscoped' }))
		Route.useLoaderData = vi.fn(() => ({ ...initial, folderId: undefined }))

		renderRoute()

		expect(screen.getByText('Unscoped detail')).toBeInTheDocument()
		expect(screen.getByRole('heading', { level: 1, name: 'Search results' })).toBeInTheDocument()
	})

	it.each([
		{
			label: 'Archive',
			busyLabel: 'Archiving',
			pendingLabels: ['Archiving', 'Delete', 'Star'],
			folder: 'archive',
			threadFolders: ['inbox'],
		},
		{
			label: 'Return to inbox',
			busyLabel: 'Returning to inbox',
			pendingLabels: ['Returning to inbox', 'Delete', 'Star'],
			folder: 'inbox',
			threadFolders: ['archive'],
		},
		{
			label: 'Delete',
			busyLabel: 'Deleting',
			pendingLabels: ['Archive', 'Deleting', 'Star'],
			folder: 'trash',
			threadFolders: ['inbox'],
		},
	])('makes $label single-flight and navigates only after success', async (scenario) => {
		let resolveMutation: ((value: unknown) => void) | undefined
		fns.updateThreadState.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveMutation = resolve
				}),
		)
		seedDetail({
			thread: {
				id: 'th-pending',
				subject: 'Pending action',
				starred: false,
				has_attachments: false,
				folders: scenario.threadFolders,
			},
			messages,
		})
		renderRoute()

		fireEvent.click(screen.getByTitle(scenario.label))
		const pending = await screen.findByRole('button', { name: scenario.busyLabel })
		expect(pending).toBeEnabled()
		expect(pending).toHaveAttribute('aria-disabled', 'true')
		expect(pending).toHaveAttribute('aria-busy', 'true')
		expect(pending.querySelector('.animate-spin')).not.toBeNull()
		for (const label of scenario.pendingLabels) {
			const control = screen.getByTitle(label)
			if (label === scenario.busyLabel) expect(control).toBeEnabled()
			else expect(control).toBeDisabled()
		}
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))

		fireEvent.click(pending)
		expect(fns.updateThreadState).toHaveBeenCalledTimes(1)
		resolveMutation?.({
			thread: {
				id: 'th-pending',
				starred: false,
				unread: false,
				folders: [scenario.folder],
			},
		})
		await waitFor(() =>
			expect(h.navigate).toHaveBeenCalledWith({
				to: '/mail/search',
				search: { q: 'hello', folderId: 'work' },
			}),
		)
	})

	it('accepts only the first same-batch activation before the pending state renders', async () => {
		let resolveMutation: ((value: unknown) => void) | undefined
		fns.updateThreadState.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveMutation = resolve
				}),
		)
		seedDetail({
			thread: {
				id: 'th-same-batch',
				subject: 'Same batch action',
				starred: false,
				has_attachments: false,
				folders: ['inbox'],
			},
			messages,
		})
		renderRoute()

		const archive = screen.getByTitle('Archive')
		act(() => {
			archive.click()
			archive.click()
		})

		await waitFor(() => expect(fns.updateThreadState).toHaveBeenCalledTimes(1))
		const pending = await screen.findByRole('button', { name: 'Archiving' })
		expect(pending).toBeEnabled()
		expect(pending).toHaveAttribute('aria-disabled', 'true')
		resolveMutation?.({
			thread: { id: 'th-same-batch', starred: false, unread: false, folders: ['archive'] },
		})
		await waitFor(() =>
			expect(h.navigate).toHaveBeenCalledWith({
				to: '/mail/search',
				search: { q: 'hello', folderId: 'work' },
			}),
		)
	})

	it.each([
		{ label: 'Archive', restoredLabel: 'Archive', starred: false, folders: ['inbox'] },
		{ label: 'Return to inbox', restoredLabel: 'Return to inbox', starred: false, folders: ['archive'] },
		{ label: 'Delete', restoredLabel: 'Delete', starred: false, folders: ['inbox'] },
		{ label: 'Star', restoredLabel: 'Star', starred: false, folders: ['inbox'] },
		{ label: 'Unstar', restoredLabel: 'Unstar', starred: true, folders: ['inbox'] },
	])('recovers $label with a generic error and the prior state', async (scenario) => {
		const user = userEvent.setup()
		fns.updateThreadState.mockRejectedValueOnce(new Error('provider-secret-detail'))
		seedDetail({
			thread: {
				id: 'th-failure',
				subject: 'Failure recovery',
				starred: scenario.starred,
				has_attachments: false,
				folders: scenario.folders,
			},
			messages,
		})
		renderRoute()

		await user.click(screen.getByTitle(scenario.label))
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Action failed')
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByTitle(scenario.restoredLabel)).toBeEnabled()
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))
	})

	it.each([
		{ outcome: 'success', reject: false },
		{ outcome: 'failure', reject: true },
	])('keeps keyboard focus on Star after mutation $outcome', async ({ reject }) => {
		const user = userEvent.setup()
		if (reject) fns.updateThreadState.mockRejectedValueOnce(new Error('provider-secret-detail'))
		seedDetail({
			thread: {
				id: `th-focus-${reject ? 'failure' : 'success'}`,
				subject: 'Focus retention',
				starred: false,
				has_attachments: false,
				folders: ['inbox'],
			},
			messages,
		})
		renderRoute()

		const star = screen.getByTitle('Star')
		star.focus()
		expect(star).toHaveFocus()
		await user.keyboard('{Enter}')

		if (reject) {
			expect(await screen.findByRole('alert')).toHaveTextContent('Action failed')
			expect(screen.getByTitle('Star')).toHaveFocus()
		} else {
			expect(await screen.findByTitle('Unstar')).toHaveFocus()
		}
	})

	it('clears a prior failure and succeeds on retry', async () => {
		const user = userEvent.setup()
		fns.updateThreadState.mockRejectedValueOnce(new Error('first failure'))
		seedDetail({
			thread: {
				id: 'th-retry',
				subject: 'Retry action',
				starred: false,
				has_attachments: false,
				folders: ['inbox'],
			},
			messages,
		})
		renderRoute()

		await user.click(screen.getByTitle('Archive'))
		expect(await screen.findByRole('alert')).toHaveTextContent('Action failed')
		await user.click(screen.getByTitle('Archive'))

		await waitFor(() => expect(fns.updateThreadState).toHaveBeenCalledTimes(2))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/mail/search',
			search: { q: 'hello', folderId: 'work' },
		})
	})

	it('ignores a completed leave action after another search result replaces the reader', async () => {
		let resolveMutation: ((value: unknown) => void) | undefined
		let mutationSettled = false
		fns.updateThreadState.mockImplementationOnce(() =>
			new Promise((resolve) => {
				resolveMutation = resolve
			}).finally(() => {
				mutationSettled = true
			}),
		)
		let selectedId = 'th:old'
		let selectedQuery = 'hello'
		const routeData = () => ({
			folders: [],
			folderId: 'work',
			threads: [],
			selected: {
				thread: {
					id: selectedId,
					subject: selectedId === 'th:old' ? 'Old result' : 'New result',
					starred: selectedId === 'th',
					has_attachments: false,
					folders: ['inbox'],
				},
				messages: [],
				mailboxEmail: 'me@x.com',
			},
		})
		Route.useSearch = vi.fn(() => ({ q: selectedQuery, folderId: 'work', threadId: selectedId }))
		Route.useLoaderData = vi.fn(routeData)
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const Comp = Route.options.component as () => JSX.Element
		const view = render(
			<QueryClientProvider client={client}>
				<Comp />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByTitle('Archive'))
		const archiving = await screen.findByRole('button', { name: 'Archiving' })
		expect(archiving).toBeEnabled()
		expect(archiving).toHaveAttribute('aria-disabled', 'true')
		selectedId = 'th'
		selectedQuery = 'new search'
		view.rerender(
			<QueryClientProvider client={client}>
				<Comp />
			</QueryClientProvider>,
		)
		expect(await screen.findByText('New result')).toBeInTheDocument()
		expect(screen.getByTitle('Unstar')).toBeEnabled()

		resolveMutation?.({
			thread: { id: 'th:old', starred: false, unread: false, folders: ['archive'] },
		})
		await waitFor(() => expect(mutationSettled).toBe(true))
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.getByTitle('Unstar')).toBeEnabled()
	})

	it('ignores a failed action after another result replaces the reader', async () => {
		let rejectMutation: ((reason?: unknown) => void) | undefined
		let mutationSettled = false
		fns.updateThreadState.mockImplementationOnce(() =>
			new Promise((_resolve, reject) => {
				rejectMutation = reject
			}).finally(() => {
				mutationSettled = true
			}),
		)
		let selectedId = 'th-old-failure'
		const routeData = () => ({
			folders: [],
			folderId: 'work',
			threads: [],
			selected: {
				thread: {
					id: selectedId,
					subject: selectedId === 'th-old-failure' ? 'Old failed result' : 'New safe result',
					starred: selectedId === 'th-new-safe',
					has_attachments: false,
					folders: ['inbox'],
				},
				messages: [],
				mailboxEmail: 'me@x.com',
			},
		})
		Route.useSearch = vi.fn(() => ({ q: 'hello', folderId: 'work', threadId: selectedId }))
		Route.useLoaderData = vi.fn(routeData)
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const Comp = Route.options.component as () => JSX.Element
		const view = render(
			<QueryClientProvider client={client}>
				<Comp />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByTitle('Star'))
		const starring = await screen.findByRole('button', { name: 'Starring' })
		expect(starring).toBeEnabled()
		expect(starring).toHaveAttribute('aria-disabled', 'true')
		selectedId = 'th-new-safe'
		view.rerender(
			<QueryClientProvider client={client}>
				<Comp />
			</QueryClientProvider>,
		)
		expect(await screen.findByText('New safe result')).toBeInTheDocument()
		expect(screen.getByTitle('Unstar')).toBeEnabled()

		rejectMutation?.(new Error('provider-secret-detail'))
		await waitFor(() => expect(mutationSettled).toBe(true))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByTitle('Unstar')).toBeEnabled()
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))
	})

	it('offers complete mobile response actions with search-reader compose context', async () => {
		const user = userEvent.setup()
		seedDetail({
			thread: {
				id: 'th-mobile',
				subject: 'Mobile actions',
				starred: false,
				has_attachments: false,
				folders: ['inbox'],
			},
			messages: [
				{
					id: 'm-mobile',
					from: [{ email: 'sender@x.com' }],
					to: [{ email: 'me@x.com' }, { email: 'other@x.com' }],
					cc: [{ email: 'cc@x.com' }],
					body: 'Mobile body',
				},
			],
			mailboxEmail: 'me@x.com',
		})
		renderRoute()
		const group = screen.getByRole('group', { name: 'Thread response actions' })
		const reply = screen.getByRole('button', { name: 'Reply to thread' })
		const replyAll = screen.getByRole('button', { name: 'Reply all to thread' })
		const forward = screen.getByRole('button', { name: 'Forward thread' })

		expect(group).toHaveClass('grid-cols-3', 'pr-14', 'sm:hidden')
		for (const action of [reply, replyAll, forward]) expect(action).toHaveClass('min-h-11')
		expect(screen.getByRole('button', { name: /Write a reply/ })).toHaveClass('hidden', 'sm:flex')

		await user.click(reply)
		expect(h.navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({
					folderId: 'inbox',
					threadId: 'th-mobile',
					replyToMessageId: 'm-mobile',
				}),
			}),
		)

		await user.click(replyAll)
		const replyAllCall = h.navigate.mock.calls.at(-1)?.[0]
		expect(replyAllCall.search.to).toContain('sender@x.com')
		expect(replyAllCall.search.to).toContain('other@x.com')
		expect(replyAllCall.search.to).toContain('cc@x.com')
		expect(replyAllCall.search.to).not.toContain('me@x.com')

		await user.click(forward)
		expect(h.navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: '/mail/compose',
				search: expect.objectContaining({ folderId: 'inbox', threadId: 'th-mobile', to: '' }),
			}),
		)
		expect(h.navigate.mock.calls.at(-1)?.[0].search.body).toContain('Forwarded message')
	})

	it('hides all reply actions and refreshes on a marked-read thread with no messages', async () => {
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

		// markedRead is applied directly to every relevant cached view.
		expect(h.invalidate).not.toHaveBeenCalled()
		// With no message to act on, none of the reply actions render.
		expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Reply all' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Forward' })).toBeNull()
		expect(screen.queryByRole('group', { name: 'Thread response actions' })).toBeNull()

		// Unstar (thread already starred) updates state without leaving the view.
		await user.click(screen.getByLabelText('Unstar'))
		await waitFor(() =>
			expect(fns.updateThreadState).toHaveBeenCalledWith({
				data: { threadId: 'thB', starred: false },
			}),
		)
		expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/search' }))

		// Archiving navigates back with just the search scope.
		await user.click(screen.getByLabelText('Archive'))
		await waitFor(() =>
			expect(h.navigate).toHaveBeenCalledWith({
				to: '/mail/search',
				search: { q: 'hello', folderId: 'work' },
			}),
		)
	})

	it('renders the reader body for a thread that carries no attachments', () => {
		seedDetail({
			thread: { id: 'thC', subject: 'C', starred: false, has_attachments: false, folders: [] },
			messages: [{ id: 'mc', from: [{ name: 'Z' }], body: '<p>hi</p>' }],
		})

		renderRoute()

		expect(screen.getByText('C')).toBeTruthy()
		expect(screen.getByTitle('Email content mc')).toBeTruthy()
		// No non-inline attachments -> no attachment download links in the reader.
		expect(document.querySelector('[data-slot="thread-attachment"]')).toBeNull()
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
