// @vitest-environment jsdom
import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The route hooks and Link/Outlet are stubbed so we can exercise the loader and the
// screen component in isolation without a live router.
type RouterState = {
	location: { pathname: string; maskedLocation?: { pathname: string } }
	matches: Array<{ routeId: string }>
}

let routerState: RouterState = { location: { pathname: '/mail/f/inbox' }, matches: [] }
const invalidate = vi.fn()
const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useRouter: () => ({ invalidate }),
	useNavigate: () => navigate,
	useRouterState: (opts: any) => opts.select(routerState),
	Outlet: () => <div data-testid="thread-outlet" />,
	Link: ({ children, to, params, search, mask, activeProps, ...rest }: any) => {
		const href =
			typeof to === 'string' && params?.folderId
				? to.replace('$folderId', params.folderId).replace('$threadId', params.threadId ?? '')
				: (to ?? '#')
		return (
			<a href={href} data-mask={mask ? 'yes' : 'no'} data-search={JSON.stringify(search ?? {})} {...rest}>
				{children}
			</a>
		)
	},
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({ handler: (fn: any) => fn, validator: () => ({ handler: (fn: any) => fn }) }),
}))

vi.mock('@tanstack/react-start/server', () => ({
	getRequest: vi.fn(() => new Request('http://ownmail.local/mail')),
}))

const getFolders = vi.fn()
const getThreads = vi.fn()
const listDrafts = vi.fn()
const updateThreadState = vi.fn()
vi.mock('#server/fns', () => ({
	getFolders: () => getFolders(),
	getThreads: (input: any) => getThreads(input),
	listDrafts: () => listDrafts(),
	updateThreadState: (input: any) => updateThreadState(input),
}))

// ClientListDate depends on a mount effect + locale formatting; stub it to a stable
// marker so list assertions stay deterministic.
vi.mock('#shared/components/ClientTime', () => ({
	ClientListDate: ({ epochSeconds }: { epochSeconds?: number }) => (
		<time data-epoch={epochSeconds ?? ''}>{epochSeconds ? 'date' : ''}</time>
	),
}))

// jsdom doesn't implement scrollIntoView; the keyboard cursor calls it to keep
// the highlighted row visible, so stub it to a no-op spy for these tests.
Element.prototype.scrollIntoView = vi.fn()

import { loadMailFolderData, MailFolderRouteScreen, Route } from './mail.f.$folderId.js'

const thread = (over: Partial<Thread> & { id: string }): Thread =>
	({
		grant_id: 'g',
		subject: 'Subject',
		snippet: 'snippet',
		participants: [{ name: 'Ada', email: 'ada@example.com' }],
		folders: ['inbox'],
		...over,
	}) as unknown as Thread

const loaderQueryClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	routerState = { location: { pathname: '/mail/f/inbox' }, matches: [] }
})

describe('loadMailFolderData', () => {
	it('reuses the cached folder list when returning from a thread without another network wait', async () => {
		getFolders.mockResolvedValue([{ id: 'inbox' }])
		getThreads.mockResolvedValue({ threads: [thread({ id: 't1' })], nextCursor: undefined })
		const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

		await loadMailFolderData('inbox', client)
		vi.clearAllMocks()
		const restored = await loadMailFolderData('inbox', client)

		expect(restored.threads.map((item) => item.id)).toEqual(['t1'])
		expect(getFolders).not.toHaveBeenCalled()
		expect(getThreads).not.toHaveBeenCalled()
	})

	it('returns saved drafts (and no threads) for the drafts folder without hitting the thread list', async () => {
		getFolders.mockResolvedValue([{ id: 'inbox' }])
		listDrafts.mockResolvedValue([{ id: 'd1' }])

		const data = await loadMailFolderData('drafts', loaderQueryClient())

		expect(data.drafts).toEqual([{ id: 'd1' }])
		expect(data.threads).toEqual([])
		expect(data.nextCursor).toBeUndefined()
		expect(getThreads).not.toHaveBeenCalled()
	})

	it('requests starred threads for the starred pseudo-folder', async () => {
		getFolders.mockResolvedValue([])
		getThreads.mockResolvedValue({ threads: [thread({ id: 't1' })], nextCursor: 'c' })

		const data = await loadMailFolderData('starred', loaderQueryClient())

		expect(getThreads).toHaveBeenCalledWith({ data: { starred: true } })
		expect(data.drafts).toEqual([])
		expect(data.nextCursor).toBe('c')
	})

	it('requests threads scoped to a concrete folder id', async () => {
		getFolders.mockResolvedValue([])
		getThreads.mockResolvedValue({ threads: [], nextCursor: undefined })

		await loadMailFolderData('work', loaderQueryClient())

		expect(getThreads).toHaveBeenCalledWith({ data: { folderId: 'work' } })
	})

	it('is driven by the route loader using the folderId route param', async () => {
		getFolders.mockResolvedValue([])
		getThreads.mockResolvedValue({ threads: [], nextCursor: undefined })

		await Route.options.loader({
			context: { queryClient: loaderQueryClient() },
			params: { folderId: 'sent' },
		})

		expect(getThreads).toHaveBeenCalledWith({ data: { folderId: 'sent' } })
	})
})

describe('validateSearch', () => {
	it('keeps a string baseFolderId and drops anything else so the label context stays trustworthy', () => {
		expect(Route.options.validateSearch({ baseFolderId: 'inbox' })).toEqual({ baseFolderId: 'inbox' })
		expect(Route.options.validateSearch({ baseFolderId: 123 })).toEqual({})
		expect(Route.options.validateSearch({})).toEqual({})
	})
})

describe('FolderView (route component)', () => {
	it('wires loader data, folder param, and baseFolderId search into the screen', () => {
		Route.useLoaderData = vi.fn(() => ({ threads: [], drafts: [], folders: [], nextCursor: undefined }))
		Route.useParams = vi.fn(() => ({ folderId: 'inbox' }))
		Route.useSearch = vi.fn(() => ({ baseFolderId: 'archive' }))

		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
				<Component />
			</QueryClientProvider>,
		)

		expect(Route.useParams).toHaveBeenCalled()
		expect(Route.useSearch).toHaveBeenCalled()
		// Empty inbox renders the "all caught up" empty state.
		expect(screen.getByText('All caught up')).toBeInTheDocument()
	})

	it('wires starred pagination and row mutations through the centralized query gateway', async () => {
		Route.useLoaderData = vi.fn(() => ({
			threads: [thread({ id: 't1', starred: false, folders: ['inbox'] })],
			drafts: [],
			folders: [],
			nextCursor: 'cursor-2',
		}))
		Route.useParams = vi.fn(() => ({ folderId: 'starred' }))
		Route.useSearch = vi.fn(() => ({}))
		getThreads.mockResolvedValue({ threads: [], nextCursor: undefined })
		updateThreadState.mockResolvedValue({
			thread: thread({ id: 't1', starred: true, folders: ['inbox'] }),
		})
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
				<Component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: /Load more/ }))
		await waitFor(() =>
			expect(getThreads).toHaveBeenCalledWith({ data: { starred: true, pageToken: 'cursor-2' } }),
		)
		fireEvent.click(screen.getByRole('button', { name: 'Star' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: true } }),
		)
	})

	it('cancels a query-backed pagination success across an inbox-to-work-to-inbox transition', async () => {
		let folderId = 'inbox'
		let settled = false
		let resolvePage: (value: { threads: Thread[]; nextCursor?: string }) => void = () => {}
		getThreads.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve
			}).finally(() => {
				settled = true
			}),
		)
		Route.useLoaderData = vi.fn(() => ({
			threads: [thread({ id: `${folderId}-row`, subject: `${folderId} message` })],
			drafts: [],
			folders: [],
			nextCursor: 'shared-cursor',
		}))
		Route.useParams = vi.fn(() => ({ folderId }))
		Route.useSearch = vi.fn(() => ({}))
		const Component = Route.options.component
		const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
		const view = render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }))
		await waitFor(() =>
			expect(getThreads).toHaveBeenCalledWith({ data: { folderId: 'inbox', pageToken: 'shared-cursor' } }),
		)
		folderId = 'work'
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		folderId = 'inbox'
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		resolvePage({
			threads: [thread({ id: 'stale-row', subject: 'Stale inbox message' })],
			nextCursor: undefined,
		})

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.queryByText('Stale inbox message')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('cancels a query-backed pagination failure across an inbox-to-work-to-inbox transition', async () => {
		let folderId = 'inbox'
		let settled = false
		let rejectPage: (reason?: unknown) => void = () => {}
		getThreads.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectPage = reject
			}).finally(() => {
				settled = true
			}),
		)
		Route.useLoaderData = vi.fn(() => ({
			threads: [thread({ id: `${folderId}-row`, subject: `${folderId} message` })],
			drafts: [],
			folders: [],
			nextCursor: 'shared-cursor',
		}))
		Route.useParams = vi.fn(() => ({ folderId }))
		Route.useSearch = vi.fn(() => ({}))
		const Component = Route.options.component
		const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
		const view = render(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }))
		await waitFor(() => expect(getThreads).toHaveBeenCalledTimes(1))
		folderId = 'work'
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		folderId = 'inbox'
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		rejectPage(new Error('provider-secret-detail'))

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
	})
})

describe('MailFolderRouteScreen — thread list', () => {
	it('gives an open message the full tablet reader width and restores the list on wide screens', () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t1' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId' }],
		}
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't1' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)

		const listPane = screen.getByRole('heading', { name: 'Inbox' }).closest('section')
		expect(listPane).toHaveClass('hidden', 'xl:flex')
		expect(listPane).not.toHaveClass('md:flex')
		expect(screen.getByTestId('thread-outlet')).toBeInTheDocument()
	})

	it('shows the empty state when a real folder has no threads', () => {
		render(
			<MailFolderRouteScreen threads={[]} drafts={[]} folders={[]} folderId="inbox" nextCursor={undefined} />,
		)
		const listPane = screen.getByRole('heading', { name: 'Inbox' }).closest('section')
		expect(listPane).toHaveClass('flex', 'xl:w-[22rem]', 'xl:flex-none')
		expect(listPane).not.toHaveClass('md:w-[22rem]', 'md:flex-none')
		expect(screen.getByLabelText('Inbox thread list')).toHaveAttribute('data-slot', 'scroll-area-viewport')
		expect(screen.getByText('All caught up')).toBeInTheDocument()
		expect(screen.getByText('Select a conversation')).toBeInTheDocument()
		expect(screen.getByText('Select a conversation').closest('div.hidden')).toHaveClass('xl:flex')
	})

	it('sorts threads newest-first and surfaces the authoritative folder unread count badge', () => {
		const { container } = render(
			<MailFolderRouteScreen
				threads={[
					thread({ id: 'older', subject: 'Older', latest_message_received_date: 100 }),
					thread({ id: 'newer', subject: 'Newer', latest_message_received_date: 200, unread: true }),
				]}
				drafts={[]}
				folders={[{ id: 'inbox', unread_count: 1 }] as any}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		const rows = container.querySelectorAll('[data-nav-row]')
		// Newest thread renders before the older one.
		expect(rows[0]).toHaveTextContent('Newer')
		expect(rows[1]).toHaveTextContent('Older')
		// The folder's authoritative unread count drives the badge.
		expect(screen.getByText('1')).toBeInTheDocument()
	})

	it('uses the server folder count when the loaded page is incomplete', () => {
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't1', unread: true })]}
				drafts={[]}
				folders={[{ id: 'inbox', unread_count: 31 }] as any}
				folderId="inbox"
				nextCursor="next-page"
			/>,
		)
		expect(screen.getByText('31')).toBeInTheDocument()
	})

	it('renders attachment, multi-message, label, and unknown-sender affordances', () => {
		render(
			<MailFolderRouteScreen
				threads={[
					thread({
						id: 't1',
						subject: '',
						participants: [],
						has_attachments: true,
						message_ids: ['m1', 'm2', 'm3'],
						folders: ['inbox', 'work'],
					}),
				]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		expect(screen.getByText('(no subject)')).toBeInTheDocument()
		expect(screen.getByText('(unknown sender)')).toBeInTheDocument()
		// message_ids length > 1 shows the count.
		expect(screen.getByText('(3)')).toBeInTheDocument()
		// Thread carries the "work" label from LABELS.
		expect(screen.getByText('Work')).toBeInTheDocument()
	})

	it('toggles a thread star without requiring a broad route refresh', async () => {
		updateThreadState.mockResolvedValue({ ok: true })
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't1', starred: false })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Star' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', starred: true } }),
		)
		expect(invalidate).not.toHaveBeenCalled()
		// A starred thread advertises the un-star action.
		cleanup()
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't2', starred: true })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		expect(screen.getByRole('button', { name: 'Unstar' })).toBeInTheDocument()
	})

	it('keeps the stretched thread link separate from the mobile-sized star action', () => {
		const { container } = render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't1', subject: 'Quarterly plan' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		const row = container.querySelector<HTMLElement>('[data-nav-row]')
		const link = screen.getByRole('link', { name: 'Open Quarterly plan from Ada' })
		const star = screen.getByRole('button', { name: 'Star' })

		expect(row).toHaveAttribute('tabindex', '-1')
		expect(link).toHaveClass('absolute', 'inset-0')
		expect(link).not.toContainElement(star)
		expect(row).toContainElement(link)
		expect(row).toContainElement(star)
		expect(star).toHaveClass('h-11', 'w-11', 'lg:h-8', 'lg:w-8')
	})
})

describe('MailFolderRouteScreen — drafts', () => {
	it('shows the empty state when there are no drafts', () => {
		render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={[]}
				folders={[]}
				folderId="drafts"
				nextCursor="ignored-draft-cursor"
			/>,
		)
		expect(screen.getByText('All caught up')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
	})

	it('renders draft rows with recipient, subject fallback, and only a date when present', () => {
		const drafts = [
			{
				id: 'd1',
				to: [{ name: 'Grace', email: 'grace@example.com' }],
				subject: '',
				snippet: 'hi',
				date: 123,
			},
			{ id: 'd2', to: [], subject: 'Planning', snippet: 'x' },
		] as unknown as Draft[]
		render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={drafts}
				folders={[]}
				folderId="drafts"
				nextCursor={undefined}
			/>,
		)
		expect(screen.getByText('Grace')).toBeInTheDocument()
		expect(screen.getByText('(no subject)')).toBeInTheDocument()
		expect(screen.getByText('(no recipient)')).toBeInTheDocument()
		// Only the dated draft renders a <time> marker.
		expect(screen.getAllByText('date')).toHaveLength(1)
	})

	it('renders draft snippets as readable text rather than stored HTML envelopes', () => {
		render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={
					[
						{
							id: 'd-markdown',
							to: [{ email: 'grace@example.com' }],
							subject: 'Draft',
							snippet: '<pre data-ownmail-markdown="1">This is a test</pre>',
						},
					] as unknown as Draft[]
				}
				folders={[]}
				folderId="drafts"
				nextCursor={undefined}
			/>,
		)
		expect(screen.getByText('This is a test')).toBeInTheDocument()
		expect(screen.queryByText(/data-ownmail-markdown/)).toBeNull()
	})

	it('links drafts to the composer with the draft id', () => {
		routerState = { location: { pathname: '/mail/f/drafts' }, matches: [] }
		render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={[{ id: 'd1', to: [{ email: 'a@b.com' }], subject: 'Hi', snippet: 'x' }] as unknown as Draft[]}
				folders={[]}
				folderId="drafts"
				nextCursor={undefined}
			/>,
		)
		const link = screen.getByRole('link')
		expect(link).toHaveAttribute('data-mask', 'no')
		expect(link).toHaveAttribute('href', '/mail/compose')
		expect(link).toHaveAttribute('data-search', JSON.stringify({ draft: 'd1', folderId: 'drafts' }))
	})
})

describe('MailFolderRouteScreen — pagination', () => {
	it('keeps pagination discoverable when an empty folder page has a continuation cursor', async () => {
		getThreads.mockResolvedValue({
			threads: [thread({ id: 'older', subject: 'Older message' })],
			nextCursor: undefined,
		})
		render(
			<MailFolderRouteScreen threads={[]} drafts={[]} folders={[]} folderId="inbox" nextCursor="cursor-1" />,
		)

		const emptyState = screen.getByText('More messages may be available').closest('div')
		expect(emptyState).toContainElement(screen.getByRole('button', { name: 'Load more messages' }))
		expect(screen.queryByText('All caught up')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }))

		await waitFor(() =>
			expect(getThreads).toHaveBeenCalledWith({ data: { folderId: 'inbox', pageToken: 'cursor-1' } }),
		)
		expect(await screen.findByText('Older message')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull()
	})

	it('continues through an empty page when another cursor remains', async () => {
		getThreads.mockResolvedValueOnce({ threads: [], nextCursor: 'cursor-2' }).mockResolvedValueOnce({
			threads: [thread({ id: 'older', subject: 'Found on the next page' })],
			nextCursor: undefined,
		})
		render(
			<MailFolderRouteScreen threads={[]} drafts={[]} folders={[]} folderId="work" nextCursor="cursor-1" />,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }))
		await waitFor(() => expect(getThreads).toHaveBeenCalledTimes(1))
		expect(screen.getByText('More messages may be available')).toBeInTheDocument()
		fireEvent.click(await screen.findByRole('button', { name: 'Load more messages' }))

		await waitFor(() =>
			expect(getThreads).toHaveBeenNthCalledWith(2, {
				data: { folderId: 'work', pageToken: 'cursor-2' },
			}),
		)
		expect(await screen.findByText('Found on the next page')).toBeInTheDocument()
	})

	it('makes the first pagination activation synchronously single-flight with clear pending state', async () => {
		let resolvePage: (value: { threads: Thread[]; nextCursor?: string }) => void = () => {}
		getThreads.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve
			}),
		)
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'page1' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="cursor-1"
			/>,
		)

		const button = screen.getByRole('button', { name: 'Load more messages' })
		button.focus()
		act(() => {
			button.click()
			button.click()
		})

		const pending = await screen.findByRole('button', { name: 'Loading more messages…' })
		expect(getThreads).toHaveBeenCalledTimes(1)
		expect(pending).toBeEnabled()
		expect(pending).toHaveAttribute('aria-disabled', 'true')
		expect(pending).toHaveAttribute('aria-busy', 'true')
		expect(pending).toHaveFocus()
		expect(pending.querySelector('.animate-spin')).not.toBeNull()
		fireEvent.click(pending)
		expect(getThreads).toHaveBeenCalledTimes(1)
		resolvePage({ threads: [], nextCursor: 'cursor-2' })
		await waitFor(() => expect(screen.getByRole('button', { name: 'Load more messages' })).toBeEnabled())
	})

	it('shows generic retry guidance, preserves focus and rows, and clears feedback after success', async () => {
		getThreads.mockRejectedValueOnce(new Error('provider-secret-detail')).mockResolvedValueOnce({
			threads: [thread({ id: 'page2', subject: 'Recovered message' })],
			nextCursor: undefined,
		})
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'page1', subject: 'Existing message' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="cursor-1"
			/>,
		)

		const button = screen.getByRole('button', { name: 'Load more messages' })
		button.focus()
		fireEvent.click(button)

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not load more messages. Check your connection, then try again.',
		)
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByText('Existing message')).toBeInTheDocument()
		const retry = screen.getByRole('button', { name: 'Try loading more messages' })
		expect(retry).toHaveFocus()
		expect(retry).toHaveAttribute('aria-describedby', 'folder-pagination-error')

		fireEvent.click(retry)
		expect(await screen.findByRole('button', { name: 'Loading more messages…' })).toHaveAttribute(
			'aria-disabled',
			'true',
		)
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
		expect(await screen.findByText('Recovered message')).toBeInTheDocument()
		expect(screen.getByText('Existing message')).toBeInTheDocument()
	})

	it('renders managed pagination failures as static retry guidance', () => {
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'page1' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="cursor-1"
				loadMoreError
				onLoadMore={vi.fn().mockResolvedValue(undefined)}
			/>,
		)

		expect(screen.getByRole('alert')).toHaveTextContent('Could not load more messages.')
		expect(screen.getByRole('button', { name: 'Try loading more messages' })).toBeEnabled()
	})

	it('ignores a stale pagination success after an inbox-to-work-to-inbox transition', async () => {
		let resolvePage: (value: { threads: Thread[]; nextCursor?: string }) => void = () => {}
		let settled = false
		getThreads.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve
			}).finally(() => {
				settled = true
			}),
		)
		const view = render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'inbox-row', subject: 'Inbox message' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="shared-cursor"
			/>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }))
		expect(await screen.findByRole('button', { name: 'Loading more messages…' })).toHaveAttribute(
			'aria-disabled',
			'true',
		)
		view.rerender(
			<MailFolderRouteScreen
				threads={[thread({ id: 'work-row', subject: 'Work message' })]}
				drafts={[]}
				folders={[]}
				folderId="work"
				nextCursor="shared-cursor"
			/>,
		)
		view.rerender(
			<MailFolderRouteScreen
				threads={[thread({ id: 'replacement-inbox-row', subject: 'Replacement inbox message' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="shared-cursor"
			/>,
		)
		resolvePage({
			threads: [thread({ id: 'stale-row', subject: 'Stale inbox message' })],
			nextCursor: undefined,
		})

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.getByText('Replacement inbox message')).toBeInTheDocument()
		expect(screen.queryByText('Stale inbox message')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('ignores a stale pagination failure after an inbox-to-work-to-inbox transition', async () => {
		let rejectPage: (reason?: unknown) => void = () => {}
		let settled = false
		getThreads.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectPage = reject
			}).finally(() => {
				settled = true
			}),
		)
		const view = render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'inbox-row' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="shared-cursor"
			/>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more messages' }))
		view.rerender(
			<MailFolderRouteScreen
				threads={[thread({ id: 'work-row', subject: 'Work message' })]}
				drafts={[]}
				folders={[]}
				folderId="work"
				nextCursor="shared-cursor"
			/>,
		)
		view.rerender(
			<MailFolderRouteScreen
				threads={[thread({ id: 'replacement-inbox-row', subject: 'Replacement inbox message' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="shared-cursor"
			/>,
		)
		rejectPage(new Error('provider-secret-detail'))

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByText('Replacement inbox message')).toBeInTheDocument()
	})

	it('delegates managed pagination to the query-backed route wrapper', async () => {
		const onLoadMore = vi.fn().mockResolvedValue(undefined)
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'page1' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor="cursor-1"
				onLoadMore={onLoadMore}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: /Load more/ }))
		await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
		expect(getThreads).not.toHaveBeenCalled()
	})

	it('loads the next page of a starred folder and appends the results', async () => {
		getThreads.mockResolvedValue({
			threads: [thread({ id: 'page2', subject: 'Appended thread' })],
			nextCursor: undefined,
		})
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'page1' })]}
				drafts={[]}
				folders={[]}
				folderId="starred"
				nextCursor="cursor-1"
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: /Load more/ }))
		await waitFor(() =>
			expect(getThreads).toHaveBeenCalledWith({ data: { starred: true, pageToken: 'cursor-1' } }),
		)
		// Appended thread appears once the fetch resolves; the Load more button then
		// disappears because the cursor is exhausted. Await the render rather than
		// asserting synchronously right after the getThreads call.
		expect(await screen.findByText('Appended thread')).toBeInTheDocument()
		await waitFor(() => expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull())
	})

	it('paginates a concrete folder by folderId rather than the starred flag', async () => {
		getThreads.mockResolvedValue({ threads: [], nextCursor: 'cursor-2' })
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 'page1' })]}
				drafts={[]}
				folders={[]}
				folderId="work"
				nextCursor="cursor-1"
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: /Load more/ }))
		await waitFor(() =>
			expect(getThreads).toHaveBeenCalledWith({ data: { folderId: 'work', pageToken: 'cursor-1' } }),
		)
	})
})

describe('MailFolderRouteScreen — thread pane + realtime', () => {
	it('renders the thread outlet and hides the empty placeholder when a thread is open', () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t1' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId' }],
		}
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't1' })]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		expect(screen.getByTestId('thread-outlet')).toBeInTheDocument()
		expect(screen.queryByText('Select a conversation')).toBeNull()
	})

	it('links threads to their real URL and carries the baseFolderId search (no mask)', () => {
		routerState = { location: { pathname: '/mail/f/work' }, matches: [] }
		render(
			<MailFolderRouteScreen
				threads={[thread({ id: 't1' })]}
				drafts={[]}
				folders={[]}
				folderId="work"
				baseFolderId="inbox"
				nextCursor={undefined}
			/>,
		)
		// Thread links use real URLs; the baseFolderId is preserved as a search param.
		const link = screen.getAllByRole('link')[0]
		expect(link).toHaveAttribute('data-mask', 'no')
		expect(link).toHaveAttribute('data-search', JSON.stringify({ baseFolderId: 'inbox' }))
	})
})

describe('MailFolderRouteScreen — keyboard navigation', () => {
	const threads = [
		thread({ id: 't1', subject: 'First', latest_message_received_date: 300 }),
		thread({ id: 't2', subject: 'Second', latest_message_received_date: 200 }),
		thread({ id: 't3', subject: 'Third', latest_message_received_date: 100 }),
	]

	function renderInbox(props: Partial<Parameters<typeof MailFolderRouteScreen>[0]> = {}) {
		return render(
			<MailFolderRouteScreen
				threads={threads}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
				{...props}
			/>,
		)
	}

	const cursored = () =>
		document.querySelector<HTMLElement>('[data-nav-row][data-nav-cursor="true"]') ?? undefined

	it('moves a visible cursor down with j / ArrowDown and up with k / ArrowUp, clamping at the top', () => {
		renderInbox()
		// No cursor until the first key press.
		expect(cursored()).toBeUndefined()
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()).toHaveTextContent('First')
		fireEvent.keyDown(window, { key: 'ArrowDown' })
		expect(cursored()).toHaveTextContent('Second')
		fireEvent.keyDown(window, { key: 'k' })
		expect(cursored()).toHaveTextContent('First')
		fireEvent.keyDown(window, { key: 'ArrowUp' })
		expect(cursored()).toHaveTextContent('First')
		// The cursor keeps its row on screen.
		expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
	})

	it('moves directly to the first and last row with Home and End', () => {
		renderInbox()
		fireEvent.keyDown(window, { key: 'End' })
		expect(cursored()).toHaveTextContent('Third')
		fireEvent.keyDown(window, { key: 'Home' })
		expect(cursored()).toHaveTextContent('First')
	})

	it('opens the cursored thread on Enter, carrying the baseFolderId search', () => {
		renderInbox({ baseFolderId: 'archive' })
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'Enter' })
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't2' },
			search: { baseFolderId: 'archive' },
		})
	})

	it('opens on the "o" key as well', () => {
		renderInbox()
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'o' })
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ params: { folderId: 'inbox', threadId: 't1' } }),
		)
	})

	it('continues navigation from a focused thread row', () => {
		renderInbox()
		const firstRow = screen.getByRole('link', { name: /First/ })
		firstRow.focus()
		fireEvent.keyDown(firstRow, { key: 'ArrowDown' })
		expect(cursored()).toHaveTextContent('Second')
		expect(document.activeElement).toHaveClass('thread-row-link')
		expect(document.activeElement).toHaveAttribute('aria-label', expect.stringMatching(/Open Second/))
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
		expect(cursored()).toHaveTextContent('Third')
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ params: { folderId: 'inbox', threadId: 't3' } }),
		)
	})

	it('does nothing when Enter is pressed with no row cursored', () => {
		renderInbox()
		fireEvent.keyDown(window, { key: 'Enter' })
		expect(navigate).not.toHaveBeenCalled()
	})

	it('ignores navigation while typing, with a modifier, or on unrelated keys', () => {
		renderInbox()
		const field = document.createElement('input')
		document.body.appendChild(field)
		fireEvent.keyDown(field, { key: 'j' })
		fireEvent.keyDown(window, { key: 'j', metaKey: true })
		fireEvent.keyDown(window, { key: 'x' })
		expect(cursored()).toBeUndefined()
		field.remove()
	})

	it('does not hijack keys aimed at a focused nested control', () => {
		renderInbox()
		// Enter/j while a real control is focused must reach the control, not the list.
		const button = document.createElement('button')
		document.body.appendChild(button)
		fireEvent.keyDown(button, { key: 'Enter' })
		fireEvent.keyDown(button, { key: 'j' })
		expect(navigate).not.toHaveBeenCalled()
		expect(cursored()).toBeUndefined()
		button.remove()
	})

	it('suspends navigation while a dialog (palette, compose, event) is open', () => {
		renderInbox()
		const dialog = document.createElement('div')
		dialog.setAttribute('role', 'dialog')
		document.body.appendChild(dialog)
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()).toBeUndefined()
		dialog.remove()
	})

	it('navigates and opens drafts by keyboard in the drafts folder', () => {
		const drafts = [
			{ id: 'd1', to: [{ email: 'a@b.com' }], subject: 'One', snippet: 'x' },
			{ id: 'd2', to: [{ email: 'c@d.com' }], subject: 'Two', snippet: 'y' },
		] as unknown as Draft[]
		render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={drafts}
				folders={[]}
				folderId="drafts"
				nextCursor={undefined}
			/>,
		)
		const firstDraft = screen.getByRole('link', { name: /a@b.com.*One/ })
		firstDraft.focus()
		fireEvent.keyDown(firstDraft, { key: 'ArrowDown' })
		expect(document.activeElement).toHaveTextContent('Two')
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/compose',
			search: { draft: 'd2', folderId: 'drafts' },
		})
	})
})
