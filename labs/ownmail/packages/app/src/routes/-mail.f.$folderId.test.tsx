// @vitest-environment jsdom
import type { Draft, Thread } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The route hooks and Link/Outlet are stubbed so we can exercise the loader and the
// screen component in isolation without a live router.
type RouterState = {
	location: { pathname: string; maskedLocation?: { pathname: string } }
	matches: Array<{ routeId: string }>
	isLoading?: boolean
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
const deleteDraft = vi.fn()
const getThreadMessages = vi.fn()
vi.mock('#server/fns', () => ({
	getThreadMessages: (input: any) => getThreadMessages(input),
	deleteDraft: (input: any) => deleteDraft(input),
	getMailboxInfo: async () => ({ email: 'ada@ownmail.com', appName: 'OwnMail' }),
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
	window.localStorage.clear()
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
	it.each([
		['inbox', getThreads],
		['drafts', listDrafts],
	] as const)('connects %s refresh interactions to its live query', async (folderId, queryFn) => {
		Route.useLoaderData = vi.fn(() => ({ threads: [], drafts: [], folders: [], nextCursor: undefined }))
		Route.useParams = vi.fn(() => ({ folderId }))
		Route.useSearch = vi.fn(() => ({}))
		getThreads.mockResolvedValue({ threads: [], nextCursor: undefined })
		listDrafts.mockResolvedValue([])
		getFolders.mockResolvedValue([])
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
				<Component />
			</QueryClientProvider>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Refresh mail' }))
		await waitFor(() => expect(queryFn).toHaveBeenCalled())
		await waitFor(() => expect(getFolders).toHaveBeenCalled())
	})

	it('refreshes the folder unread count with the active thread list', async () => {
		Route.useLoaderData = vi.fn(() => ({
			threads: [],
			drafts: [],
			folders: [{ id: 'inbox', unread_count: 1 }],
			nextCursor: undefined,
		}))
		Route.useParams = vi.fn(() => ({ folderId: 'inbox' }))
		Route.useSearch = vi.fn(() => ({}))
		getThreads.mockResolvedValue({ threads: [], nextCursor: undefined })
		getFolders.mockResolvedValue([{ id: 'inbox', unread_count: 3 }])
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
				<Component />
			</QueryClientProvider>,
		)
		expect(screen.getByText('1')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Refresh mail' }))
		expect(await screen.findByText('3')).toBeInTheDocument()
	})

	it('announces a generic failure when the live mail refresh rejects', async () => {
		Route.useLoaderData = vi.fn(() => ({ threads: [], drafts: [], folders: [], nextCursor: undefined }))
		Route.useParams = vi.fn(() => ({ folderId: 'inbox' }))
		Route.useSearch = vi.fn(() => ({}))
		getThreads.mockRejectedValue(new Error('provider-secret-detail'))
		getFolders.mockResolvedValue([])
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<Component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Refresh mail' }))
		expect(await screen.findByRole('status', { name: 'Refresh mail status' })).toHaveTextContent(
			'Could not refresh. Check your connection, then try again.',
		)
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
	})

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
	it('offers an explicit mail refresh action alongside pull-to-refresh', () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined)
		render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
				onRefresh={onRefresh}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Refresh mail' }))
		expect(onRefresh).toHaveBeenCalledOnce()
		expect(screen.getByText('Pull to refresh')).toBeInTheDocument()
	})

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
		const star = screen.getByRole('button', { name: 'Star' })
		expect(star).toHaveClass('h-11', 'w-11', 'touch-target-square')
		expect(star.closest('a')).toBeNull()
		fireEvent.click(star)
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

	it('gives draft rows the shared thread row so they follow the list density', () => {
		const { container } = render(
			<MailFolderRouteScreen
				threads={[]}
				drafts={
					[{ id: 'd1', to: [{ name: 'Grace' }], subject: 'Plan', snippet: 'Notes' }] as unknown as Draft[]
				}
				folders={[]}
				folderId="drafts"
				nextCursor={undefined}
			/>,
		)
		const row = screen.getByRole('link')
		expect(row).toHaveClass('thread-row')
		expect(row).toHaveAttribute('data-nav-row')
		// Same cells as a conversation row: leading dot, then subject and snippet in one summary.
		expect(row.firstElementChild).toHaveClass('thread-row-dot')
		const summary = container.querySelector('.thread-row-summary') as HTMLElement
		expect(Array.from(summary.children).map((cell) => cell.textContent)).toEqual(['Plan', 'Notes'])
		// Drafts have no star action, only the static glyph.
		expect(screen.queryByRole('button', { name: 'Star' })).toBeNull()
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

	it('marks the selected row active in both reader and compose list modes', () => {
		const props = {
			threads: [thread({ id: 't1' })],
			drafts: [],
			folders: [],
			folderId: 'inbox',
			nextCursor: undefined,
			activeThreadId: 't1',
		}
		const { unmount } = render(<MailFolderRouteScreen {...props} />)
		expect(screen.getByRole('link', { name: /Open Subject/ })).toHaveAttribute('data-active', 'true')
		// Selection is a fill, so the open row must also be announced as current.
		expect(screen.getByRole('link', { name: /Open Subject/ })).toHaveAttribute('aria-current', 'true')
		unmount()
		render(<MailFolderRouteScreen {...props} composeThreadSearch={(threadId) => ({ to: [threadId] })} />)
		const threadLink = screen.getByRole('link', { name: /Open Subject/ })
		expect(threadLink).toHaveAttribute('data-active', 'true')
		expect(threadLink).toHaveAttribute('aria-current', 'true')
		// The list title and the row text share one 16px left edge, under the one toolbar height.
		const listToolbar = screen.getByRole('heading', { level: 1 }).closest('[data-slot="toolbar"]')
		const row = threadLink.closest('[data-nav-row]')
		expect(listToolbar).toHaveClass('h-14', 'md:h-11', 'px-4')
		expect(row).toHaveClass('px-4')
		expect(row?.className).not.toMatch(/\bpl-/)
		fireEvent.keyDown(window, { key: 'j' })
		expect(threadLink.closest('[data-nav-row]')).toHaveAttribute('data-nav-cursor', 'true')
	})
})

describe('MailFolderRouteScreen — reading pane', () => {
	const threads = [
		thread({ id: 't1', subject: 'First', latest_message_received_date: 300 }),
		thread({ id: 't2', subject: 'Second', latest_message_received_date: 200 }),
	]
	const openOn = (threadId: string) =>
		({
			location: { pathname: `/mail/f/inbox/t/${threadId}` },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId } }],
		}) as RouterState
	const screenFor = () => (
		<MailFolderRouteScreen
			threads={threads}
			drafts={[]}
			folders={[]}
			folderId="inbox"
			nextCursor={undefined}
		/>
	)
	const listSection = () => screen.getByRole('heading', { name: 'Inbox' }).closest('section') as HTMLElement

	it('switches the open conversation to replace the list, and remembers the choice', async () => {
		routerState = openOn('t1')
		render(screenFor())
		// Default vertical split keeps the list beside the reader on wide screens.
		expect(listSection()).toHaveClass('xl:flex')

		await userEvent.click(screen.getByRole('button', { name: 'Reading pane: Vertical split' }))
		await userEvent.click(screen.getByRole('menuitemradio', { name: 'No split' }))

		await waitFor(() => expect(listSection()).not.toHaveClass('xl:flex'))
		expect(listSection()).toHaveClass('hidden')
		expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').readingPane).toBe(
			'none',
		)
	})

	it('applies the chosen list density to the list and remembers it', async () => {
		try {
			render(screenFor())
			expect(listSection()).toHaveAttribute('data-density', 'default')
			expect(listSection()).toHaveClass('xl:w-[22rem]')

			await userEvent.click(screen.getByRole('button', { name: 'List density: Default' }))
			await userEvent.click(screen.getByRole('menuitemradio', { name: 'Condensed' }))

			await waitFor(() => expect(listSection()).toHaveAttribute('data-density', 'condensed'))
			// The choice only changes the attribute: the wider Condensed list is CSS keyed on it
			// (fine pointers only), so touch layouts keep the 22rem list.
			expect(listSection()).toHaveClass('mail-list-vertical', 'xl:w-[22rem]')
			expect(listSection().className).not.toContain('26rem')
			expect(JSON.parse(window.localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').listDensity).toBe(
				'condensed',
			)
		} finally {
			window.localStorage.clear()
		}
	})

	it('keeps one row structure for every density: a leading unread dot, then subject and snippet together', () => {
		const { container } = render(screenFor())
		const row = container.querySelector('[data-nav-row]') as HTMLElement
		// Density is pure CSS on these cells, so the markup must not vary by mode.
		expect(Array.from(row.children).map((cell) => cell.className.split(' ')[0])).toEqual([
			'thread-row-link',
			'thread-row-dot',
			'thread-row-lead',
			'thread-row-sender',
			'thread-row-when',
			'thread-row-text',
		])
		expect(row.querySelector('.thread-row-dot')).toHaveAttribute('aria-hidden', 'true')
		expect(row.querySelector('.thread-row-summary .thread-row-subject')).not.toBeNull()
		expect(row.querySelector('.thread-row-summary .thread-row-snippet')).not.toBeNull()
		expect(screen.getAllByRole('button', { name: /^(Star|Unstar)$/ })[0]).toHaveClass('thread-row-star')
	})

	it('stacks the list above the reader for a horizontal split', async () => {
		window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ readingPane: 'horizontal' }))
		routerState = openOn('t1')
		render(screenFor())
		await waitFor(() => expect(listSection().parentElement).toHaveClass('xl:flex-col'))
		expect(listSection()).toHaveClass('xl:h-[40%]')
	})

	it('returns the cursor and focus to the conversation that was just closed', async () => {
		routerState = openOn('t2')
		const view = render(screenFor())

		routerState = { location: { pathname: '/mail/f/inbox' }, matches: [] }
		view.rerender(screenFor())

		const row = screen.getByRole('link', { name: /Open Second/ })
		await waitFor(() => expect(row).toHaveFocus())
		expect(row.closest('[data-nav-row]')).toHaveAttribute('data-nav-cursor', 'true')
	})

	it('leaves focus alone when the closed conversation left the list (archived)', async () => {
		routerState = openOn('gone')
		const view = render(screenFor())
		routerState = { location: { pathname: '/mail/f/inbox' }, matches: [] }
		view.rerender(screenFor())
		await new Promise((resolve) => requestAnimationFrame(resolve))
		expect(document.querySelector('[data-nav-cursor="true"]')).toBeNull()
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

	it('moves straight to the adjacent conversation with j/k while one is open', () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t2' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't2' } }],
		} as RouterState
		renderInbox({ baseFolderId: 'work' })

		fireEvent.keyDown(window, { key: 'j' })
		expect(navigate).toHaveBeenLastCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't3' },
			search: { baseFolderId: 'work' },
		})
		fireEvent.keyDown(window, { key: 'k' })
		expect(navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ params: { folderId: 'inbox', threadId: 't1' } }),
		)
		// Arrow keys keep scrolling/cursor semantics rather than switching conversations.
		navigate.mockClear()
		fireEvent.keyDown(window, { key: 'ArrowDown' })
		expect(navigate).not.toHaveBeenCalled()
	})

	it('keeps advancing on repeated j/k while the previous conversation is still loading', () => {
		const committed = {
			routeId: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't1' },
		}
		routerState = { location: { pathname: '/mail/f/inbox/t/t1' }, matches: [committed] } as RouterState
		// Like the router, a navigation moves the location at once while the
		// committed match stays on t1 until the destination finishes loading.
		navigate.mockImplementation(({ params }: any) => {
			routerState = {
				location: { pathname: `/mail/f/inbox/t/${params.threadId}` },
				matches: [committed],
				isLoading: true,
			} as RouterState
		})
		const view = renderInbox()
		const press = (key: string) => {
			fireEvent.keyDown(window, { key })
			view.rerender(
				<MailFolderRouteScreen
					threads={threads}
					drafts={[]}
					folders={[]}
					folderId="inbox"
					nextCursor={undefined}
				/>,
			)
		}

		try {
			press('j')
			press('j')
			press('k')
			expect(navigate.mock.calls.map(([options]) => options.params.threadId)).toEqual(['t2', 't3', 't2'])
		} finally {
			navigate.mockReset()
		}
	})

	it('continues from a clicked or history destination that is still loading', () => {
		// Committed on t3, but the user clicked t1 (or went back) and it is loading.
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t1' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't3' } }],
			isLoading: true,
		} as RouterState
		renderInbox()
		fireEvent.keyDown(window, { key: 'j' })
		expect(navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ params: { folderId: 'inbox', threadId: 't2' } }),
		)
	})

	it('falls back to the committed conversation when the loading location is not a thread', () => {
		for (const pathname of ['/mail/f/inbox', '/mail/f/inbox/t/%E0%A4%A']) {
			cleanup()
			navigate.mockClear()
			routerState = {
				location: { pathname },
				matches: [
					{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't1' } },
				],
				isLoading: true,
			} as RouterState
			renderInbox()
			fireEvent.keyDown(window, { key: 'j' })
			expect(navigate).toHaveBeenLastCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't2' } }),
			)
		}
	})

	it('stays on the edge conversation instead of wrapping', () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t3' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't3' } }],
		} as RouterState
		renderInbox()
		fireEvent.keyDown(window, { key: 'j' })
		expect(navigate).not.toHaveBeenCalled()
		expect(cursored()?.textContent).toContain('Third')
	})

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

describe('MailFolderRouteScreen — context menus', () => {
	const threads = [
		thread({ id: 't1', subject: 'First', latest_message_received_date: 300, unread: true }),
		thread({ id: 't2', subject: 'Second', latest_message_received_date: 200, starred: true }),
		thread({ id: 't3', subject: 'Third', latest_message_received_date: 100 }),
	]
	const openT2 = () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t2' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't2' } }],
		} as RouterState
	}

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

	const row = (subject: string) =>
		screen.getByRole('link', { name: new RegExp(`Open ${subject}`) }).closest('[data-nav-row]') as HTMLElement

	async function openMenu(subject: string) {
		fireEvent.contextMenu(row(subject), { clientX: 10, clientY: 10 })
		return screen.findByRole('menu', { name: `Actions for ${subject}` })
	}

	const choose = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }))
	const menuClosed = () => waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

	it('acts on the row it was opened on and leaves the open conversation alone', async () => {
		openT2()
		updateThreadState.mockResolvedValue({ ok: true })
		renderInbox()

		await openMenu('First')
		choose('Archive')

		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 't1', folder: 'archive' } }),
		)
		await menuClosed()
		// The reader still shows t2: nothing navigated.
		expect(navigate).not.toHaveBeenCalled()
	})

	it('closes the reader when the open conversation itself is moved or marked unread', async () => {
		openT2()
		const onUpdateThread = vi.fn().mockResolvedValue(undefined)
		renderInbox({ baseFolderId: 'work', onUpdateThread })

		await openMenu('Second')
		choose('Delete')
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/f/$folderId',
				params: { folderId: 'inbox' },
				search: { baseFolderId: 'work' },
			}),
		)
		expect(onUpdateThread).toHaveBeenCalledWith({ threadId: 't2', folder: 'trash' })

		navigate.mockClear()
		await menuClosed()
		await openMenu('Second')
		choose('Mark as unread')
		await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
		expect(onUpdateThread).toHaveBeenLastCalledWith({ threadId: 't2', unread: true })
	})

	it('does not pull the user out of the composer when the highlighted row behind it is archived', async () => {
		const onUpdateThread = vi.fn().mockResolvedValue(undefined)
		renderInbox({ activeThreadId: 't1', composeThreadSearch: (threadId) => ({ threadId }), onUpdateThread })

		await openMenu('First')
		choose('Archive')

		await waitFor(() => expect(onUpdateThread).toHaveBeenCalledWith({ threadId: 't1', folder: 'archive' }))
		await menuClosed()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('mirrors the read state, star and archive state of its own row', async () => {
		openT2()
		const onUpdateThread = vi.fn().mockResolvedValue(undefined)
		renderInbox({ onUpdateThread })

		await openMenu('First')
		expect(screen.getByRole('menuitem', { name: 'Star' })).toBeInTheDocument()
		choose('Mark as read')
		await waitFor(() => expect(onUpdateThread).toHaveBeenLastCalledWith({ threadId: 't1', unread: false }))
		await menuClosed()

		await openMenu('Second')
		choose('Unstar')
		await waitFor(() => expect(onUpdateThread).toHaveBeenLastCalledWith({ threadId: 't2', starred: false }))
		// Starring or marking read never closes the open conversation.
		expect(navigate).not.toHaveBeenCalled()

		cleanup()
		renderInbox({ folderId: 'archive', onUpdateThread })
		await openMenu('Third')
		choose('Return to inbox')
		await waitFor(() => expect(onUpdateThread).toHaveBeenLastCalledWith({ threadId: 't3', folder: 'inbox' }))
	})

	it('marks Delete as destructive with an icon, not colour alone', async () => {
		renderInbox()
		await openMenu('First')
		const item = screen.getByRole('menuitem', { name: 'Delete' })
		expect(item).toHaveAttribute('data-variant', 'destructive')
		expect(item.querySelector('svg')).not.toBeNull()
	})

	it('opens the conversation, or the composer behind which the list sits', async () => {
		renderInbox({ baseFolderId: 'work' })
		const menu = await openMenu('Third')
		expect(within(menu).getByText('Enter')).toHaveClass('kbd')
		choose('Open')
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't3' },
			search: { baseFolderId: 'work' },
		})

		cleanup()
		renderInbox({ composeThreadSearch: (threadId) => ({ threadId }) })
		await openMenu('First')
		choose('Open')
		expect(navigate).toHaveBeenLastCalledWith({ to: '/mail/compose', search: { threadId: 't1' } })
	})

	it('disables the row actions while one is in flight and recovers after a failure', async () => {
		let fail!: (error: Error) => void
		const onUpdateThread = vi.fn(() => new Promise<void>((_resolve, reject) => (fail = reject)))
		renderInbox({ onUpdateThread })

		await openMenu('First')
		choose('Archive')
		await menuClosed()
		await openMenu('First')
		// Unavailable, not hidden.
		expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute('aria-disabled', 'true')
		expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true')
		expect(screen.getByRole('menuitem', { name: 'Open' })).not.toHaveAttribute('aria-disabled')

		await act(async () => fail(new Error('provider detail')))
		await waitFor(() =>
			expect(screen.getByRole('menuitem', { name: 'Archive' })).not.toHaveAttribute('aria-disabled'),
		)
		expect(screen.queryByText(/provider detail/)).not.toBeInTheDocument()
	})

	it('reports a failed action on the row it belongs to, and clears it on the next attempt', async () => {
		const onUpdateThread = vi
			.fn()
			.mockRejectedValueOnce(new Error('provider detail'))
			.mockResolvedValue(undefined)
		renderInbox({ onUpdateThread })

		await openMenu('Second')
		choose('Archive')
		const alert = await screen.findByRole('alert')
		// The reader toolbar's own wording, inside the row that failed and nowhere else.
		expect(alert).toHaveTextContent('Action failed')
		expect(alert).not.toHaveTextContent('provider detail')
		expect(row('Second')).toContainElement(alert)
		expect(row('First')).not.toContainElement(alert)
		expect(screen.getAllByRole('alert')).toHaveLength(1)

		await openMenu('Second')
		choose('Archive')
		await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
	})

	it('reports a failed star on its row too, from the menu or the star button', async () => {
		const onUpdateThread = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
		renderInbox({ onUpdateThread })

		await openMenu('First')
		choose('Star')
		const alert = await screen.findByRole('alert')
		expect(row('First')).toContainElement(alert)

		fireEvent.click(within(row('First')).getByRole('button', { name: 'Star' }))
		await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
	})

	it('starts a reply, reply all or forward for the row through the route, and reports a failure on the row', async () => {
		openT2()
		const onRespondToThread = vi.fn().mockResolvedValue(undefined)
		renderInbox({ onRespondToThread })

		for (const [name, kind] of [
			['Reply', 'reply'],
			['Reply all', 'reply-all'],
			['Forward', 'forward'],
		] as const) {
			await openMenu('First')
			choose(name)
			await waitFor(() => expect(onRespondToThread).toHaveBeenLastCalledWith({ threadId: 't1', kind }))
			await menuClosed()
		}

		onRespondToThread.mockRejectedValue(new Error('no message'))
		await openMenu('Third')
		choose('Reply')
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Action failed')
		expect(row('Third')).toContainElement(alert)
	})

	it('shows the reply items as unavailable where the list cannot start one', async () => {
		renderInbox()
		await openMenu('First')
		for (const name of ['Reply', 'Reply all', 'Forward']) {
			expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
		}
	})

	it('shows the reader shortcuts only on the row of the open conversation, where they act', async () => {
		openT2()
		renderInbox({ onRespondToThread: vi.fn() })

		const open = await openMenu('Second')
		const shortcuts = (menu: HTMLElement) =>
			[...menu.querySelectorAll('[role="menuitem"]')].map((element) => [
				[...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)?.textContent,
				element.getAttribute('aria-keyshortcuts'),
			])
		expect(shortcuts(open)).toEqual([
			['Open', 'Enter'],
			['Reply', 'R'],
			['Reply all', null],
			['Forward', null],
			['Mark as unread', 'U'],
			['Unstar', 'S'],
			['Archive', 'E'],
			['Delete', '#'],
		])
		fireEvent.keyDown(open, { key: 'Escape' })
		await menuClosed()

		// On another row those keys would act on the open conversation, so they are not shown.
		const other = await openMenu('First')
		expect(shortcuts(other).map(([, key]) => key)).toEqual([
			'Enter',
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		])
	})

	it('loads the thread and opens the composer on its last message in the live route', async () => {
		Route.useLoaderData = vi.fn(() => ({
			threads: [thread({ id: 't1', subject: 'First' })],
			drafts: [],
			folders: [],
			nextCursor: undefined,
		}))
		Route.useParams = vi.fn(() => ({ folderId: 'inbox' }))
		Route.useSearch = vi.fn(() => ({}))
		getThreads.mockResolvedValue({ threads: [thread({ id: 't1', subject: 'First' })], nextCursor: undefined })
		getFolders.mockResolvedValue([])
		getThreadMessages.mockResolvedValue({
			thread: thread({ id: 't1', subject: 'First' }),
			messages: [
				{ id: 'm1', subject: 'First', from: [{ email: 'old@example.com' }] },
				{ id: 'm2', subject: 'First', from: [{ email: 'ada@example.com' }] },
			],
			mailboxEmail: 'me@ownmail.com',
		})
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
				<Component />
			</QueryClientProvider>,
		)

		await openMenu('First')
		choose('Reply')

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/compose',
				search: {
					folderId: 'inbox',
					threadId: 't1',
					to: 'ada@example.com',
					subject: 'Re: First',
					replyToMessageId: 'm2',
				},
			}),
		)
		expect(getThreadMessages).toHaveBeenCalledWith({ data: { threadId: 't1' } })
	})

	it('keeps list shortcuts out of an open menu', async () => {
		renderInbox()
		await openMenu('First')
		const item = screen.getByRole('menuitem', { name: 'Archive' })
		fireEvent.keyDown(item, { key: 'j' })
		fireEvent.keyDown(item, { key: 'o' })
		// The same holds for any other menu on the page.
		const otherMenu = document.body.appendChild(document.createElement('div'))
		otherMenu.setAttribute('role', 'menu')
		fireEvent.keyDown(otherMenu, { key: 'j' })
		fireEvent.keyDown(otherMenu, { key: 'o' })
		otherMenu.remove()
		expect(document.querySelector('[data-nav-cursor="true"]')).toBeNull()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('puts focus on the cursored row for the ContextMenu key and Shift+F10', () => {
		renderInbox()
		// No cursor yet: there is no row to focus, and nothing breaks.
		fireEvent.keyDown(window, { key: 'ContextMenu' })
		expect(document.body).toHaveFocus()
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'ContextMenu' })
		expect(screen.getByRole('link', { name: /Open Second/ })).toHaveFocus()

		// A row that already has focus keeps it: the browser opens its menu there.
		const third = screen.getByRole('link', { name: /Open Third/ })
		third.focus()
		fireEvent.keyDown(third, { key: 'F10', shiftKey: true })
		expect(third).toHaveFocus()
		// Plain F10 is not a context-menu key.
		fireEvent.keyDown(window, { key: 'F10' })
		expect(third).toHaveFocus()
	})

	describe('drafts', () => {
		const drafts = [
			{ id: 'd1', to: [{ email: 'a@b.com' }], subject: 'One', snippet: 'x' },
			{ id: 'd2', to: [{ email: 'c@d.com' }], subject: '', snippet: 'y' },
		] as unknown as Draft[]

		function renderDrafts(props: Partial<Parameters<typeof MailFolderRouteScreen>[0]> = {}) {
			return render(
				<MailFolderRouteScreen
					threads={[]}
					drafts={drafts}
					folders={[]}
					folderId="drafts"
					nextCursor={undefined}
					{...props}
				/>,
			)
		}

		it('opens and discards the draft the menu was opened on', async () => {
			const onDiscardDraft = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
			renderDrafts({ onDiscardDraft })

			fireEvent.contextMenu(screen.getByRole('link', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu', { name: 'Actions for draft One' })
			choose('Open draft')
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/compose',
				search: { draft: 'd1', folderId: 'drafts' },
			})
			await menuClosed()

			// A failed discard is rolled back by the mutation; the menu stays usable.
			for (const _attempt of [1, 2]) {
				fireEvent.contextMenu(screen.getByRole('link', { name: /c@d.com/ }))
				await screen.findByRole('menu', { name: 'Actions for draft (no subject)' })
				expect(screen.getByRole('menuitem', { name: 'Discard draft' })).toHaveAttribute(
					'data-variant',
					'destructive',
				)
				choose('Discard draft')
				await menuClosed()
			}
			expect(onDiscardDraft).toHaveBeenCalledTimes(2)
			expect(onDiscardDraft).toHaveBeenLastCalledWith('d2')
			// The second attempt succeeded, so the first one's message is gone.
			expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		})

		it('puts focus on the cursored draft for the ContextMenu key', () => {
			renderDrafts()
			fireEvent.keyDown(window, { key: 'j' })
			fireEvent.keyDown(window, { key: 'ContextMenu' })
			// A draft row is its own link.
			expect(screen.getByRole('link', { name: /a@b.com.*One/ })).toHaveFocus()
		})

		it('says on the draft row, in the composer wording, when it could not be discarded', async () => {
			renderDrafts({ onDiscardDraft: vi.fn().mockRejectedValue(new Error('provider detail')) })
			const draft = screen.getByRole('link', { name: /c@d.com/ })
			fireEvent.contextMenu(draft)
			await screen.findByRole('menu')
			choose('Discard draft')
			const alert = await screen.findByRole('alert')
			expect(alert).toHaveTextContent('Could not discard the draft. Check your connection, then try again.')
			expect(draft).toContainElement(alert)
			expect(screen.getByRole('link', { name: /a@b.com.*One/ })).not.toContainElement(alert)
		})

		it('shows Discard as unavailable where the list cannot delete drafts', async () => {
			renderDrafts()
			fireEvent.contextMenu(screen.getByRole('link', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu')
			expect(screen.getByRole('menuitem', { name: 'Discard draft' })).toHaveAttribute('aria-disabled', 'true')
		})

		it('discards through the optimistic draft mutation in the live route', async () => {
			Route.useLoaderData = vi.fn(() => ({ threads: [], drafts, folders: [], nextCursor: undefined }))
			Route.useParams = vi.fn(() => ({ folderId: 'drafts' }))
			Route.useSearch = vi.fn(() => ({}))
			listDrafts.mockResolvedValue(drafts)
			getFolders.mockResolvedValue([])
			deleteDraft.mockResolvedValue({})
			const Component = Route.options.component
			render(
				<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })}>
					<Component />
				</QueryClientProvider>,
			)
			fireEvent.contextMenu(screen.getByRole('link', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu')
			choose('Discard draft')
			await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith({ data: { draftId: 'd1' } }))
		})
	})
})
