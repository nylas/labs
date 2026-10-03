// @vitest-environment jsdom
import type { Folder } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A single mutable router state drives every useRouterState selector so tests can
// pose the shell in any location (folder, search route, masked "/" home, …).
type RouterState = {
	location: { pathname: string; search: Record<string, unknown>; maskedLocation?: { pathname: string } }
	matches: Array<{ routeId: string }>
}

let routerState: RouterState = { location: { pathname: '/mail/f/inbox', search: {} }, matches: [] }
const navigate = vi.fn()
const invalidate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate }),
	useRouterState: (opts: any) => opts.select(routerState),
	Outlet: () => <div data-testid="outlet" />,
	Link: ({ children, to, mask, search, ...rest }: any) => (
		<a href={typeof to === 'string' ? to : '#'} data-to={to} data-mask={mask ? 'yes' : 'no'} {...rest}>
			{children}
		</a>
	),
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({ handler: (fn: any) => fn, validator: () => ({ handler: (fn: any) => fn }) }),
}))

vi.mock('@tanstack/react-start/server', () => ({
	getRequest: vi.fn(() => new Request('http://ownmail.local/mail')),
}))

const getFolders = vi.fn()
const getMailboxInfo = vi.fn()
const listDrafts = vi.fn()
vi.mock('#server/fns', () => ({
	getFolders: () => getFolders(),
	getMailboxInfo: () => getMailboxInfo(),
	listDrafts: () => listDrafts(),
}))

// Child chrome is exercised by its own suites; stub each to a minimal, inspectable shell.
vi.mock('#app/components/AppRail', () => ({
	AppRailLogo: ({ appName }: { appName: string }) => <div data-testid="logo">{appName}</div>,
	AppRailNav: (props: any) => (
		<div data-testid="railnav" data-email={props.email} data-display-name={props.displayName}>
			<button type="button" aria-label="Open command palette" onClick={props.onOpenCommandPalette}>
				rail-open-palette
			</button>
		</div>
	),
	AppRailMobileNav: (props: any) => (
		<div data-testid="mobile-railnav">
			<button type="button" onClick={props.onNavigate}>
				mobile-nav-close
			</button>
		</div>
	),
}))

// Counts renders of the shell's chrome, so tests can assert what a keystroke re-renders.
const chromeRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('#app/components/MobileTabBar', () => ({
	MobileTabBar: ({ active, context }: { active: string; context?: string }) => {
		chromeRenders.count += 1
		return <nav data-testid="mobile-tabs" data-active={active} data-context={context ?? 'primary'} />
	},
}))

const paletteShortcut = vi.fn()
vi.mock('#app/components/CommandPalette', () => ({
	useCommandPaletteShortcut: (open: () => void) => paletteShortcut(open),
	CommandPalette: ({ open, onClose, onFocusSearch }: any) =>
		open ? (
			<div data-testid="palette">
				<button type="button" onClick={onClose}>
					close-palette
				</button>
				<button type="button" onClick={onFocusSearch}>
					focus-search
				</button>
			</div>
		) : null,
}))

vi.mock('#features/mail/components/MailSidebar', () => ({
	MailSidebar: (props: any) => (
		<div
			data-testid="sidebar"
			data-folder={props.currentFolderId ?? ''}
			data-base={props.baseFolderId ?? ''}
			data-mobile={props.mobile ? 'yes' : 'no'}
			data-latest-draft={props.latestDraft?.subject ?? ''}
		>
			<button type="button" onClick={props.onNavigate}>
				sidebar-nav
			</button>
			<button type="button" onClick={() => props.onFolderDeleted('work')}>
				delete-work-folder
			</button>
		</div>
	),
}))

vi.mock('#shared/components/Sheet', () => ({
	Sheet: ({ open, onClose, children }: any) =>
		open ? (
			<div data-testid="sheet">
				<button type="button" onClick={onClose}>
					close-sheet
				</button>
				{children}
			</div>
		) : null,
}))

// Real mail model helpers, except liveSearchTarget is spy-wrapped so the (otherwise
// unreachable) thread navigation branch can be driven explicitly.
vi.mock('#features/mail/lib/mail-ui-model', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#features/mail/lib/mail-ui-model')>()
	return { ...actual, liveSearchTarget: vi.fn((...args: any[]) => (actual.liveSearchTarget as any)(...args)) }
})

import { liveSearchTarget } from '#features/mail/lib/mail-ui-model'
import { MailRouteScreen } from './-mail-screen.js'
import { Route } from './mail.js'

// Compose is app state: assert what the composer is asked to open, not a route.
const composeApi = vi.hoisted(() => ({
	openCompose: vi.fn(async () => {}),
	composing: null as { kind: string; threadId?: string } | null,
	registerInlineSlot: vi.fn(),
}))
vi.mock('#features/mail/components/ComposeProvider', () => ({ useCompose: () => composeApi }))

const info = { email: 'ada@example.com', displayName: 'Ada', appName: 'OwnMail' }

function renderScreen(
	props: Partial<Parameters<typeof MailRouteScreen>[0]> = {},
	state?: Partial<RouterState>,
) {
	if (state) routerState = { location: { pathname: '/mail/f/inbox', search: {} }, matches: [], ...state }
	return render(<MailRouteScreen info={info} folders={[]} {...props} />)
}

function searchInput() {
	return screen.getByLabelText('Search mail') as HTMLInputElement
}

function submitSearch() {
	const form = searchInput().closest('form')
	if (!form) throw new Error('expected search form')
	fireEvent.submit(form)
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	routerState = { location: { pathname: '/mail/f/inbox', search: {} }, matches: [] }
})

describe('/mail loader + layout', () => {
	it('loads mailbox info and folders together for the shell', async () => {
		getMailboxInfo.mockResolvedValue(info)
		getFolders.mockResolvedValue([{ id: 'inbox' }] as Folder[])

		const queryClient = new QueryClient()
		const data = await Route.options.loader({ context: { queryClient } })

		expect(data.info).toEqual(info)
		expect(data.folders).toEqual([{ id: 'inbox' }])

		vi.clearAllMocks()
		await Route.options.loader({ context: { queryClient } })
		expect(getMailboxInfo).not.toHaveBeenCalled()
		expect(getFolders).not.toHaveBeenCalled()
	})

	it('renders the shell from loader data (logo, rail, sidebar)', () => {
		Route.useLoaderData = vi.fn(() => ({ info, folders: [] as Folder[] }))
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Component />
			</QueryClientProvider>,
		)
		expect(screen.getByTestId('logo')).toHaveTextContent('OwnMail')
		expect(screen.getByTestId('railnav')).toHaveAttribute('data-email', 'ada@example.com')
		expect(screen.getByTestId('mobile-tabs')).toHaveAttribute('data-active', 'mail')
	})

	it('offers the latest draft to resume, and only asks for drafts when the Drafts folder has some', async () => {
		listDrafts.mockResolvedValue([
			{ id: 'd1', subject: 'Old', date: 1 },
			{ id: 'd2', subject: 'Re: Q3 roadmap', date: 2 },
		])
		Route.useLoaderData = vi.fn(() => ({
			info,
			folders: [{ id: 'drafts', total_count: 2 }] as unknown as Folder[],
		}))
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Component />
			</QueryClientProvider>,
		)
		await waitFor(() =>
			expect(screen.getAllByTestId('sidebar')[0]).toHaveAttribute('data-latest-draft', 'Re: Q3 roadmap'),
		)
		expect(listDrafts).toHaveBeenCalledTimes(1)
	})

	it('does not fetch drafts for an empty Drafts folder', () => {
		Route.useLoaderData = vi.fn(() => ({ info, folders: [] as Folder[] }))
		const Component = Route.options.component
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Component />
			</QueryClientProvider>,
		)
		expect(listDrafts).not.toHaveBeenCalled()
		expect(screen.getAllByTestId('sidebar')[0]).toHaveAttribute('data-latest-draft', '')
	})

	it('renders current observed mailbox info instead of stale infinite-route loader data', () => {
		Route.useLoaderData = vi.fn(() => ({ info, folders: [] as Folder[] }))
		const queryClient = new QueryClient()
		queryClient.setQueryData(['account', 'mailbox-info'], {
			...info,
			displayName: 'Ada Lovelace',
		})
		const Component = Route.options.component

		render(
			<QueryClientProvider client={queryClient}>
				<Component />
			</QueryClientProvider>,
		)

		expect(screen.getByTestId('railnav')).toHaveAttribute('data-display-name', 'Ada Lovelace')
	})
})

describe('MailRouteScreen — layout wiring', () => {
	it('switches the one mobile bottom surface to thread actions for direct and search readers', () => {
		const direct = renderScreen(
			{},
			{
				location: { pathname: '/mail/f/inbox/t/t1', search: {} },
				matches: [{ routeId: '/mail/f/$folderId/t/$threadId' }],
			},
		)
		expect(screen.getByTestId('mobile-tabs')).toHaveAttribute('data-context', 'thread')
		expect(screen.queryByRole('button', { name: 'Compose message' })).toBeNull()

		direct.unmount()
		renderScreen(
			{},
			{
				location: { pathname: '/mail/search', search: { q: 'roadmap', threadId: 't2' } },
				matches: [{ routeId: '/mail/search' }],
			},
		)
		expect(screen.getByTestId('mobile-tabs')).toHaveAttribute('data-context', 'thread')
		expect(screen.queryByRole('link', { name: 'Compose message' })).toBeNull()
	})

	it('keeps primary mobile destinations and compose on list surfaces', () => {
		renderScreen(
			{},
			{
				location: { pathname: '/mail/search', search: { q: 'roadmap' } },
				matches: [{ routeId: '/mail/search' }],
			},
		)
		expect(screen.getByTestId('mobile-tabs')).toHaveAttribute('data-context', 'primary')
		expect(screen.getByRole('button', { name: 'Compose message' })).toBeInTheDocument()
	})

	it('recovers to Inbox only when the deleted folder is active', () => {
		renderScreen({}, { location: { pathname: '/mail/f/work', search: {} } })
		fireEvent.click(screen.getAllByRole('button', { name: 'delete-work-folder' })[0] as HTMLElement)
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
		})
		cleanup()
		navigate.mockClear()

		renderScreen({}, { location: { pathname: '/mail/f/inbox', search: {} } })
		fireEvent.click(screen.getAllByRole('button', { name: 'delete-work-folder' })[0] as HTMLElement)
		expect(navigate).not.toHaveBeenCalled()
	})

	it('derives the current folder from the path and shows the outlet by default', () => {
		renderScreen()
		expect(screen.getAllByTestId('sidebar')[0]).toHaveAttribute('data-folder', 'inbox')
		expect(screen.getByTestId('outlet')).toBeInTheDocument()
		// The custom clear button is the only clear affordance; a native search
		// input would render an additional browser-provided cancel button.
		expect(screen.getByLabelText('Search mail')).toHaveAttribute('type', 'text')
		// No query -> the "/" shortcut hint is visible, no clear button.
		expect(screen.getByText('/')).toBeInTheDocument()
		expect(screen.queryByLabelText('Clear search')).toBeNull()
	})

	it('uses one overlay divider across the complete mail header', () => {
		renderScreen()
		const header = screen.getByRole('banner')
		expect(header).toHaveClass('mail-header', 'relative')
		expect(header).not.toHaveClass('border-b', 'border-border')
	})

	it('falls back to defaultFolderId when the path has no folder, and renders children over the outlet', () => {
		renderScreen(
			{ defaultFolderId: 'starred', children: <div data-testid="child" /> },
			{ location: { pathname: '/mail/compose', search: {} } },
		)
		expect(screen.getAllByTestId('sidebar')[0]).toHaveAttribute('data-folder', 'starred')
		expect(screen.getByTestId('child')).toBeInTheDocument()
		expect(screen.queryByTestId('outlet')).toBeNull()
	})

	it('passes the label base folder from search params down to the sidebar', () => {
		renderScreen({}, { location: { pathname: '/mail/f/work', search: { baseFolderId: 'inbox' } } })
		expect(screen.getAllByTestId('sidebar')[0]).toHaveAttribute('data-base', 'inbox')
	})

	it('opens and closes the command palette', () => {
		renderScreen()
		expect(screen.queryByText('Commands')).toBeNull()
		expect(screen.getAllByRole('button', { name: 'Open command palette' })).toHaveLength(1)
		expect(screen.queryByTestId('palette')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
		expect(screen.getByTestId('palette')).toBeInTheDocument()
		fireEvent.click(screen.getByText('close-palette'))
		expect(screen.queryByTestId('palette')).toBeNull()
		// The palette shortcut hook is wired with the open handler.
		expect(paletteShortcut).toHaveBeenCalled()
	})

	it('focuses the search field when the palette delegates focus, and closes the palette', () => {
		renderScreen()
		fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
		fireEvent.click(screen.getByText('focus-search'))
		expect(screen.queryByTestId('palette')).toBeNull()
		expect(document.activeElement).toBe(searchInput())
	})

	it('opens the navigation sheet from the menu button and closes it via mobile navigation', () => {
		renderScreen()
		expect(screen.queryByTestId('sheet')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		expect(screen.getByTestId('sheet')).toBeInTheDocument()
		expect(screen.getByTestId('mobile-railnav')).toBeInTheDocument()
		expect(screen.getAllByTestId('sidebar')[1]).toHaveAttribute('data-mobile', 'yes')
		fireEvent.click(screen.getByText('mobile-nav-close'))
		expect(screen.queryByTestId('sheet')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getAllByText('sidebar-nav')[1])
		expect(screen.queryByTestId('sheet')).toBeNull()
	})

	it('closes the sheet via its own close control', () => {
		renderScreen()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getByText('close-sheet'))
		expect(screen.queryByTestId('sheet')).toBeNull()
	})
})

describe('MailRouteScreen — compose button', () => {
	it('opens a new message over the list from the mobile compose button, without leaving the page', () => {
		renderScreen()
		fireEvent.click(screen.getByRole('button', { name: 'Compose message' }))
		expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'new' })
		expect(navigate).not.toHaveBeenCalled()
	})
})

describe('MailRouteScreen — search navigation', () => {
	// Typing must answer within 100 ms. The search text used to live in the
	// shell, so every keystroke re-rendered the rail, both sidebars and the
	// command palette; now only the search box re-renders.
	it('re-renders only the search box, not the shell around it, on each keystroke', () => {
		renderScreen()
		const before = chromeRenders.count
		fireEvent.change(searchInput(), { target: { value: 'h' } })
		fireEvent.change(searchInput(), { target: { value: 'he' } })
		expect(searchInput().value).toBe('he')
		expect(chromeRenders.count).toBe(before)
	})

	it('navigates to search results scoped to the current folder on submit', () => {
		renderScreen()
		fireEvent.change(searchInput(), { target: { value: 'hello' } })
		submitSearch()
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/search',
			search: { q: 'hello', folderId: 'inbox' },
			replace: true,
		})
	})

	it('searches without a folder scope when the current route has none', () => {
		renderScreen({}, { location: { pathname: '/mail/search', search: {} } })
		fireEvent.change(searchInput(), { target: { value: 'x' } })
		submitSearch()
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/search',
			search: { q: 'x' },
			replace: true,
		})
	})

	it('clearing the query on the search route returns to the scoped folder list', () => {
		routerState = {
			location: { pathname: '/mail/search', search: { folderId: 'inbox' } },
			matches: [{ routeId: '/mail/search' }],
		}
		render(<MailRouteScreen info={info} folders={[]} />)
		submitSearch()
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
			replace: true,
		})
	})

	it('navigates straight to a thread when the live target resolves to one', () => {
		vi.mocked(liveSearchTarget).mockReturnValueOnce({ kind: 'thread', folderId: 'inbox', threadId: 't9' })
		renderScreen()
		fireEvent.change(searchInput(), { target: { value: 'ada' } })
		submitSearch()
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId/t/$threadId',
			params: { folderId: 'inbox', threadId: 't9' },
			replace: true,
		})
	})

	it('does nothing on an empty submit outside the search route', () => {
		renderScreen()
		submitSearch()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('shows the search query from the route and clears it via the clear button', () => {
		routerState = {
			location: { pathname: '/mail/search', search: { q: 'invoices' } },
			matches: [{ routeId: '/mail/search' }],
		}
		render(<MailRouteScreen info={info} folders={[]} />)
		expect(searchInput().value).toBe('invoices')
		fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
		expect(searchInput().value).toBe('')
		// Cleared query brings back the "/" hint.
		expect(screen.getByText('/')).toBeInTheDocument()
	})

	it('never navigates from typing alone', () => {
		render(<MailRouteScreen info={info} folders={[]} />)
		fireEvent.change(searchInput(), { target: { value: 'a' } })
		fireEvent.change(searchInput(), { target: { value: 'ab' } })
		expect(navigate).not.toHaveBeenCalled()
	})
})

describe('MailRouteScreen — keyboard shortcuts', () => {
	it('focuses search on "/" and composes on "c"', () => {
		renderScreen()
		fireEvent.keyDown(window, { key: '/' })
		expect(document.activeElement).toBe(searchInput())

		// "c" opens a new message where you are: the list or the conversation stays on screen.
		fireEvent.keyDown(window, { key: 'c' })
		expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'new' })
		expect(navigate).not.toHaveBeenCalled()
	})

	it('ignores shortcuts while typing in a field or with a modifier or key repeat', () => {
		renderScreen()
		const field = document.createElement('input')
		document.body.appendChild(field)
		fireEvent.keyDown(field, { key: 'c' })
		fireEvent.keyDown(window, { key: 'c', metaKey: true })
		fireEvent.keyDown(window, { key: 'c', repeat: true })
		expect(navigate).not.toHaveBeenCalled()
		field.remove()
	})
})
