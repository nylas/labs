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

vi.mock('@tanstack/react-router', async (importOriginal) => ({
	Await: (await importOriginal<any>()).Await,
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
// Each render of a row's date is counted, so tests can assert how many rows re-render.
const listDateRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('#shared/components/ClientTime', () => ({
	ClientListDate: ({ epochSeconds, className }: { epochSeconds?: number; className?: string }) => {
		listDateRenders.count += 1
		return (
			<time data-epoch={epochSeconds ?? ''} className={className}>
				{epochSeconds ? 'date' : ''}
			</time>
		)
	},
}))

// jsdom doesn't implement scrollIntoView; the keyboard cursor calls it to keep
// the highlighted row visible, so stub it to a no-op spy for these tests.
Element.prototype.scrollIntoView = vi.fn()

import { MailFolderRouteScreen } from './-mail-folder-screen.js'
import { loadMailFolderData, Route } from './mail.f.$folderId.js'

// Compose is app state: assert what the composer is asked to open, not a route.
const composeApi = vi.hoisted(() => ({
	openCompose: vi.fn(async () => {}),
	composing: null as { kind: string; threadId?: string } | null,
	registerInlineSlot: vi.fn(),
}))
vi.mock('#features/mail/components/ComposeProvider', () => ({ useCompose: () => composeApi }))

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
	composeApi.composing = null
	window.localStorage.clear()
	routerState = { location: { pathname: '/mail/f/inbox' }, matches: [] }
})

describe('loadMailFolderData', () => {
	it('reveals the retained list as soon as history returns to its folder, before old matches settle', () => {
		const committed = { routeId: '/mail/f/$folderId/t/$threadId' }
		routerState = { location: { pathname: '/mail/f/inbox/t/t1' }, matches: [committed] }
		const props = {
			threads: [thread({ id: 't1', subject: 'Retained' })],
			drafts: [],
			folders: [],
			folderId: 'inbox',
			nextCursor: undefined,
		}
		const view = render(<MailFolderRouteScreen {...props} />)
		const list = screen.getByText('Retained').closest('[data-mail-list]')
		expect(list).toHaveClass('hidden')
		routerState = { location: { pathname: '/mail/f/inbox' }, matches: [committed], isLoading: true }
		view.rerender(<MailFolderRouteScreen {...props} />)
		expect(screen.getByText('Retained').closest('[data-mail-list]')).toBe(list)
		expect(list).not.toHaveClass('hidden')
		expect(screen.queryByTestId('thread-outlet')).toBeNull()
		fireEvent.click(screen.getByRole('link', { name: /Open Retained/ }))
		// Other folder identities must not reveal this folder while their loader waits.
		routerState = { location: { pathname: '/mail/f/sent' }, matches: [committed], isLoading: true }
		view.rerender(<MailFolderRouteScreen {...props} />)
		expect(list).toHaveClass('hidden')
	})

	it('streams a folder placeholder while concurrent folder and thread requests resolve', async () => {
		let resolveFolders!: (value: any[]) => void
		let resolveThreads!: (value: any) => void
		getFolders.mockReturnValue(
			new Promise((done) => {
				resolveFolders = done
			}),
		)
		getThreads.mockReturnValue(
			new Promise((done) => {
				resolveThreads = done
			}),
		)
		const queryClient = loaderQueryClient()
		vi.stubGlobal('window', undefined)
		let data: any
		try {
			data = await Route.options.loader({ context: { queryClient }, params: { folderId: 'inbox' } })
		} finally {
			vi.unstubAllGlobals()
		}
		expect(data.deferred).toBeInstanceOf(Promise)
		expect(getFolders).toHaveBeenCalled()
		expect(getThreads).toHaveBeenCalled()
		Route.useLoaderData = () => data
		Route.useParams = () => ({ folderId: 'inbox' })
		Route.useSearch = () => ({})
		const Component = Route.options.component
		await act(async () => {
			render(
				<QueryClientProvider client={queryClient}>
					<Component />
				</QueryClientProvider>,
			)
		})
		expect(screen.queryByText('All caught up')).not.toBeInTheDocument()
		await act(async () => {
			resolveFolders([])
			resolveThreads({ threads: [] })
			await data.deferred
		})
		expect(await screen.findByText('All caught up')).toBeInTheDocument()
	})

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

	it('keeps the empty reader quiet while the composer is open over it', () => {
		// The "press C to compose" prompt would only sit under the window it describes.
		composeApi.composing = { kind: 'new' }
		const { container } = render(
			<MailFolderRouteScreen threads={[]} drafts={[]} folders={[]} folderId="inbox" nextCursor={undefined} />,
		)
		expect(screen.queryByText('Select a conversation')).toBeNull()
		expect(container.querySelector('section div.hidden.xl\\:flex.bg-background')).toBeEmptyDOMElement()
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
		const row = screen.getByRole('button', { name: /Plan/ })
		expect(row).toHaveClass('thread-row')
		expect(row).toHaveAttribute('data-nav-row')
		// Same cells as a conversation row: leading glyph, then subject and snippet in one summary.
		expect(row.firstElementChild).toHaveClass('thread-row-lead')
		const summary = container.querySelector('.thread-row-summary') as HTMLElement
		expect(Array.from(summary.children).map((cell) => cell.textContent)).toEqual(['Plan', 'Notes'])
		// Drafts have no star action, only the static glyph.
		expect(screen.queryByRole('button', { name: 'Star' })).toBeNull()
	})

	it('reopens a draft in the composer over the list instead of leaving the folder', () => {
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
		// Compose is a window over the page, not a route: the drafts list stays behind it.
		fireEvent.click(screen.getByRole('button', { name: /a@b.com.*Hi/ }))
		expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd1' })
		expect(navigate).not.toHaveBeenCalled()
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

	it('marks the selected row active and current, on the shared list toolbar edge', () => {
		const props = {
			threads: [thread({ id: 't1' })],
			drafts: [],
			folders: [],
			folderId: 'inbox',
			nextCursor: undefined,
			activeThreadId: 't1',
		}
		render(<MailFolderRouteScreen {...props} />)
		const threadLink = screen.getByRole('link', { name: /Open Subject/ })
		expect(threadLink).toHaveAttribute('data-active', 'true')
		// Selection is a fill, so the open row must also be announced as current.
		expect(threadLink).toHaveAttribute('aria-current', 'true')
		// The list title and the row text share one 16px left edge, under the one toolbar height.
		const listToolbar = screen.getByRole('heading', { level: 1 }).closest('[data-slot="toolbar"]')
		const row = threadLink.closest('[data-nav-row]')
		expect(listToolbar).toHaveClass('h-(--toolbar-height)', 'px-4')
		// The toolbar is bar glass pinned over the pane, and the list scrolls beneath it and the tab bar:
		// its padding keeps the first and last rows where a flat toolbar would put them.
		expect(listToolbar).toHaveClass('glass-bar', 'absolute', 'top-0')
		expect(listToolbar?.parentElement).toHaveClass('relative')
		const listViewport = row?.closest('[data-slot="scroll-area-viewport"]')
		expect(listViewport).toHaveClass('under-pinned-bar', 'under-mobile-bar')
		expect(listViewport).not.toContainElement(listToolbar as HTMLElement)
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

	// With no dot, unread must still read at a glance: the time takes the accent and
	// the sender's weight steps up, so it never rests on one cue.
	it('marks unread rows with an accent semibold time and a semibold sender', () => {
		render(
			<MailFolderRouteScreen
				threads={[
					thread({ id: 'new', subject: 'Fresh', unread: true, latest_message_received_date: 200 }),
					thread({ id: 'old', subject: 'Seen', unread: false, latest_message_received_date: 100 }),
				]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		const [fresh, seen] = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row]'))
		expect(fresh?.querySelector('.thread-row-when time')).toHaveClass('text-cta-icon', 'font-semibold')
		expect(fresh?.querySelector('.thread-row-sender')).toHaveClass('font-semibold')
		expect(seen?.querySelector('.thread-row-when time')).not.toHaveClass('text-cta-icon')
		expect(seen?.querySelector('.thread-row-sender')).toHaveClass('font-normal')
	})

	it('keeps one row structure for every density: a leading star, then subject and snippet together', () => {
		const { container } = render(screenFor())
		const row = container.querySelector('[data-nav-row]') as HTMLElement
		// Density is pure CSS on these cells, so the markup must not vary by mode.
		expect(Array.from(row.children).map((cell) => cell.className.split(' ')[0])).toEqual([
			'thread-row-link',
			'thread-row-lead',
			'thread-row-sender',
			'thread-row-when',
			'thread-row-text',
		])
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

	/** j/k open the conversation after the next paint; wait for that frame and task. */
	const afterPaint = () =>
		act(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))

	// j/k must answer within 100 ms on a long inbox. Re-rendering every row per
	// key press is what broke that budget, so a cursor move may only re-render
	// the row it leaves and the row it lands on.
	it('re-renders only the two rows whose cursor state changes when j moves the cursor', () => {
		const manyThreads = Array.from({ length: 40 }, (_, index) =>
			thread({ id: `many-${index}`, subject: `Thread ${index}`, latest_message_received_date: 1000 - index }),
		)
		renderInbox({ threads: manyThreads })
		fireEvent.keyDown(window, { key: 'j' })
		const before = listDateRenders.count
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()).toHaveTextContent('Thread 1')
		expect(listDateRenders.count - before).toBe(2)
	})

	it("starts the keyboard cursor fresh in another folder instead of carrying the last folder's position", () => {
		const view = renderInbox()
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()).toHaveTextContent('Second')
		view.rerender(
			<MailFolderRouteScreen
				threads={threads}
				drafts={[]}
				folders={[]}
				folderId="work"
				nextCursor={undefined}
			/>,
		)
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()).toHaveTextContent('First')
	})

	it('moves straight to the adjacent conversation with j/k while one is open', async () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t2' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't2' } }],
		} as RouterState
		renderInbox({ baseFolderId: 'work' })

		fireEvent.keyDown(window, { key: 'j' })
		await afterPaint()
		expect(navigate).toHaveBeenLastCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't3' },
			search: { baseFolderId: 'work' },
		})
		fireEvent.keyDown(window, { key: 'k' })
		await afterPaint()
		expect(navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ params: { folderId: 'inbox', threadId: 't1' } }),
		)
		// Arrow keys keep scrolling/cursor semantics rather than switching conversations.
		navigate.mockClear()
		fireEvent.keyDown(window, { key: 'ArrowDown' })
		expect(navigate).not.toHaveBeenCalled()
	})

	it('keeps advancing on repeated j/k while the previous conversation is still loading', async () => {
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
		const press = async (key: string) => {
			fireEvent.keyDown(window, { key })
			await afterPaint()
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
			await press('j')
			await press('j')
			await press('k')
			expect(navigate.mock.calls.map(([options]) => options.params.threadId)).toEqual(['t2', 't3', 't2'])
		} finally {
			navigate.mockReset()
		}
	})

	it('continues from a clicked or history destination that is still loading', async () => {
		// Committed on t3, but the user clicked t1 (or went back) and it is loading.
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t1' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't3' } }],
			isLoading: true,
		} as RouterState
		renderInbox()
		fireEvent.keyDown(window, { key: 'j' })
		await afterPaint()
		expect(navigate).toHaveBeenLastCalledWith(
			expect.objectContaining({ params: { folderId: 'inbox', threadId: 't2' } }),
		)
	})

	it('falls back to the committed conversation when the loading location is not a thread', async () => {
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
			await afterPaint()
			expect(navigate).toHaveBeenLastCalledWith(
				expect.objectContaining({ params: { folderId: 'inbox', threadId: 't2' } }),
			)
		}
	})

	// A key must answer within 100 ms however heavy the next conversation is: the
	// cursor moves in the key's own frame, and the conversation opens after that
	// paint. Presses that arrive first replace the pending open, so skimming with
	// j renders only the conversation it stops on.
	it('moves the cursor at once and opens only the last of several quick j/k presses', async () => {
		routerState = {
			location: { pathname: '/mail/f/inbox/t/t1' },
			matches: [{ routeId: '/mail/f/$folderId/t/$threadId', params: { folderId: 'inbox', threadId: 't1' } }],
		} as RouterState
		const view = renderInbox()
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()?.textContent).toContain('Second')
		expect(navigate).not.toHaveBeenCalled()
		fireEvent.keyDown(window, { key: 'j' })
		expect(cursored()?.textContent).toContain('Third')
		await afterPaint()
		expect(navigate.mock.calls.map(([options]) => options.params.threadId)).toEqual(['t3'])
		// An open still pending when the list goes away never fires.
		navigate.mockClear()
		fireEvent.keyDown(window, { key: 'k' })
		view.unmount()
		await afterPaint()
		expect(navigate).not.toHaveBeenCalled()
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
		const firstDraft = screen.getByRole('button', { name: /a@b.com.*One/ })
		firstDraft.focus()
		fireEvent.keyDown(firstDraft, { key: 'ArrowDown' })
		expect(document.activeElement).toHaveTextContent('Two')
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
		// Enter reopens the cursored draft over the list, as a click would.
		expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd2' })
		// The list owns Enter on a focused draft button: no second open from its native click.
		expect(composeApi.openCompose).toHaveBeenCalledTimes(1)
		expect(navigate).not.toHaveBeenCalled()
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

	it('does not navigate when a highlighted row that is not the routed reader is archived', async () => {
		const onUpdateThread = vi.fn().mockResolvedValue(undefined)
		// Highlighted (activeThreadId) but not open in the reader: there is no reader to close.
		renderInbox({ activeThreadId: 't1', onUpdateThread })

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

	it('opens the conversation in the reader from the row menu', async () => {
		renderInbox({ baseFolderId: 'work' })
		const menu = await openMenu('Third')
		expect(within(menu).getByText('Enter')).toHaveClass('kbd')
		choose('Open')
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't3' },
			search: { baseFolderId: 'work' },
		})
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

		// The reply opens in the composer over the list, answering the thread's last message.
		await waitFor(() =>
			expect(composeApi.openCompose).toHaveBeenCalledWith({
				kind: 'reply',
				threadId: 't1',
				to: 'ada@example.com',
				subject: 'Re: First',
				replyToMessageId: 'm2',
			}),
		)
		expect(navigate).not.toHaveBeenCalled()
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
		function deferred<T>() {
			let resolve!: (value: T) => void
			let reject!: (reason?: unknown) => void
			const promise = new Promise<T>((res, rej) => {
				resolve = res
				reject = rej
			})
			return { promise, resolve, reject }
		}

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

			fireEvent.contextMenu(screen.getByRole('button', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu', { name: 'Actions for draft One' })
			choose('Open draft')
			// "Open draft" reopens it over the list, the same as clicking the row.
			expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd1' })
			await menuClosed()

			// A failed discard is rolled back by the mutation; the menu stays usable.
			for (const attempt of [1, 2]) {
				fireEvent.contextMenu(screen.getByRole('button', { name: /c@d.com/ }))
				await screen.findByRole('menu', { name: 'Actions for draft (no subject)' })
				expect(screen.getByRole('menuitem', { name: 'Discard draft' })).toHaveAttribute(
					'data-variant',
					'destructive',
				)
				choose('Discard draft')
				await menuClosed()
				fireEvent.click(screen.getByRole('button', { name: 'Discard permanently' }))
				if (attempt === 1) {
					await screen.findByRole('alert')
					fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }))
				} else await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
			}
			expect(onDiscardDraft).toHaveBeenCalledTimes(2)
			expect(onDiscardDraft).toHaveBeenLastCalledWith('d2')
			// The second attempt succeeded, so the first one's message is gone.
			expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		})

		it('names the draft and safely cancels with the button or Escape while restoring row focus', async () => {
			const onDiscardDraft = vi.fn()
			renderDrafts({ onDiscardDraft })
			const row = screen.getByRole('button', { name: /a@b.com.*One/ })
			for (const useEscape of [false, true]) {
				row.focus()
				fireEvent.contextMenu(row)
				await screen.findByRole('menu')
				choose('Discard draft')
				const dialog = await screen.findByRole('dialog', { name: 'Discard this draft?' })
				expect(dialog).toHaveAccessibleDescription(
					'“One” and its attachments will be deleted. This cannot be undone.',
				)
				const cancel = screen.getByRole('button', { name: 'Keep draft' })
				await waitFor(() => expect(cancel).toHaveFocus())
				if (useEscape) fireEvent.keyDown(cancel, { key: 'Escape' })
				else fireEvent.click(cancel)
				await waitFor(() => expect(row).toHaveFocus())
				expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
			}
			expect(onDiscardDraft).not.toHaveBeenCalled()
		})

		it('prevents duplicate discard and cancellation while deletion is pending', async () => {
			const pending = deferred<void>()
			const onDiscardDraft = vi.fn(() => pending.promise)
			renderDrafts({ onDiscardDraft })
			fireEvent.contextMenu(screen.getByRole('button', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu')
			choose('Discard draft')
			const confirm = screen.getByRole('button', { name: 'Discard permanently' })
			act(() => {
				fireEvent.click(confirm)
				fireEvent.click(confirm)
			})
			expect(onDiscardDraft).toHaveBeenCalledTimes(1)
			expect(screen.getByRole('button', { name: 'Keep draft' })).toBeDisabled()
			expect(screen.getByRole('button', { name: 'Discarding…' })).toBeDisabled()
			fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
			expect(screen.getByRole('dialog')).toBeInTheDocument()
			await act(async () => {
				pending.resolve()
			})
			await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
		})

		it('retains the failure and safe cancellation after an optimistic row removal and rollback', async () => {
			const pending = deferred<void>()
			const onDiscardDraft = vi.fn(() => pending.promise)
			const view = renderDrafts({ onDiscardDraft })
			fireEvent.contextMenu(screen.getByRole('button', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu')
			choose('Discard draft')
			fireEvent.click(screen.getByRole('button', { name: 'Discard permanently' }))
			view.rerender(
				<MailFolderRouteScreen
					threads={[]}
					drafts={[drafts[1]]}
					folders={[]}
					folderId="drafts"
					nextCursor={undefined}
					onDiscardDraft={onDiscardDraft}
				/>,
			)
			expect(screen.getByRole('dialog', { name: 'Discard this draft?' })).toBeInTheDocument()
			await act(async () => {
				pending.reject(new Error('private details'))
			})
			view.rerender(
				<MailFolderRouteScreen
					threads={[]}
					drafts={drafts}
					folders={[]}
					folderId="drafts"
					nextCursor={undefined}
					onDiscardDraft={onDiscardDraft}
				/>,
			)
			expect(screen.getByRole('alert')).toHaveTextContent('Could not discard the draft.')
			expect(screen.getByRole('alert')).not.toHaveTextContent('private details')
			fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }))
			await waitFor(() => expect(screen.getByRole('button', { name: /a@b.com.*One/ })).toHaveFocus())
		})

		it('can leave the draft screen while a discard confirmation is open without deleting anything', async () => {
			const onDiscardDraft = vi.fn()
			const view = renderDrafts({ onDiscardDraft })
			fireEvent.contextMenu(screen.getByRole('button', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu')
			choose('Discard draft')
			await screen.findByRole('dialog', { name: 'Discard this draft?' })
			view.unmount()
			await waitFor(() => expect(document.body).toHaveFocus())
			expect(onDiscardDraft).not.toHaveBeenCalled()
		})

		it('puts focus on the cursored draft for the ContextMenu key', () => {
			renderDrafts()
			fireEvent.keyDown(window, { key: 'j' })
			fireEvent.keyDown(window, { key: 'ContextMenu' })
			// A draft row is its own button.
			expect(screen.getByRole('button', { name: /a@b.com.*One/ })).toHaveFocus()
		})

		it('keeps a generic failure in the confirmation so the user can retry or keep the draft', async () => {
			renderDrafts({ onDiscardDraft: vi.fn().mockRejectedValue(new Error('provider detail')) })
			const draft = screen.getByRole('button', { name: /c@d.com/ })
			fireEvent.contextMenu(draft)
			await screen.findByRole('menu')
			choose('Discard draft')
			fireEvent.click(screen.getByRole('button', { name: 'Discard permanently' }))
			const alert = await screen.findByRole('alert')
			expect(alert).toHaveTextContent('Could not discard the draft. Check your connection, then try again.')
			expect(screen.getByRole('dialog', { name: 'Discard this draft?' })).toContainElement(alert)
			expect(alert).not.toHaveTextContent('provider detail')
			fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }))
			await waitFor(() => expect(draft).toHaveFocus())
		})

		it('shows Discard as unavailable where the list cannot delete drafts', async () => {
			renderDrafts()
			fireEvent.contextMenu(screen.getByRole('button', { name: /a@b.com.*One/ }))
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
			fireEvent.contextMenu(screen.getByRole('button', { name: /a@b.com.*One/ }))
			await screen.findByRole('menu')
			choose('Discard draft')
			expect(deleteDraft).not.toHaveBeenCalled()
			fireEvent.click(screen.getByRole('button', { name: 'Discard permanently' }))
			await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith({ data: { draftId: 'd1' } }))
		})
	})
})

describe('MailFolderRouteScreen bulk triage', () => {
	const rows = [
		{ id: 'bulk-one', subject: 'Bulk one', unread: true, folders: ['inbox'] },
		{ id: 'bulk-two', subject: 'Bulk two', unread: true, folders: ['inbox'] },
	] as unknown as Thread[]
	function bulkScreen(onUpdateThread = vi.fn().mockResolvedValue(undefined), folderId = 'inbox') {
		return (
			<MailFolderRouteScreen
				threads={rows}
				drafts={[]}
				folders={[]}
				folderId={folderId}
				nextCursor="unseen-page"
				onUpdateThread={onUpdateThread}
			/>
		)
	}
	it('selects rows without navigation and acts on all loaded messages, not unseen pages', async () => {
		const update = vi.fn().mockResolvedValue(undefined)
		render(bulkScreen(update))
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		const first = screen.getByRole('checkbox', { name: 'Select Bulk one' })
		first.focus()
		await userEvent.keyboard(' ')
		expect(first).toBeChecked()
		fireEvent.click(screen.getByRole('button', { name: 'Toggle selection for Bulk two' }))
		expect(screen.getByRole('checkbox', { name: 'Select Bulk two' })).toBeChecked()
		expect(navigate).not.toHaveBeenCalled()
		expect(screen.getByRole('checkbox', { name: 'Select all loaded conversations' })).toBeChecked()
		fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
		await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
		expect(update.mock.calls).toEqual([
			[{ threadId: 'bulk-one', folder: 'archive' }],
			[{ threadId: 'bulk-two', folder: 'archive' }],
		])
		expect(getThreads).not.toHaveBeenCalled()
		await waitFor(() =>
			expect(screen.getByRole('checkbox', { name: 'Select all loaded conversations' })).toHaveFocus(),
		)
	})
	it('resets selection when changing folders and supports the isolated mutation fallback', async () => {
		const view = render(
			<MailFolderRouteScreen
				threads={rows}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bulk one' }))
		fireEvent.click(screen.getByRole('button', { name: 'Mark selected as unread' }))
		await waitFor(() =>
			expect(updateThreadState).toHaveBeenCalledWith({ data: { threadId: 'bulk-one', unread: true } }),
		)
		view.rerender(bulkScreen(undefined, 'archive'))
		expect(screen.getByRole('button', { name: 'Select messages' })).toBeInTheDocument()
		expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
	})
})

describe('mail selection keyboard semantics', () => {
	it('uses named checkboxes and native row buttons for an untitled conversation', async () => {
		render(
			<MailFolderRouteScreen
				threads={[{ id: 'untitled', folders: ['inbox'] }] as Thread[]}
				drafts={[]}
				folders={[]}
				folderId="inbox"
				nextCursor={undefined}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		const checkbox = screen.getByRole('checkbox', { name: 'Select (no subject)' })
		fireEvent.click(checkbox.closest('label') as HTMLLabelElement)
		expect(checkbox).toBeChecked()
		const row = screen.getByRole('button', { name: 'Toggle selection for (no subject)' })
		row.focus()
		await userEvent.keyboard('{Enter}')
		expect(checkbox).not.toBeChecked()
		await userEvent.keyboard(' ')
		expect(checkbox).toBeChecked()
		fireEvent.keyDown(window, { key: 'j' })
		fireEvent.keyDown(window, { key: 'o' })
		fireEvent.keyDown(window, { key: 'Enter' })
		expect(navigate).not.toHaveBeenCalled()
	})
})
