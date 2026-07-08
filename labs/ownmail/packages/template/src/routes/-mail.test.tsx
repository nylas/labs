// @vitest-environment jsdom
import type { Folder } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
vi.mock('../server/fns.js', () => ({
	getFolders: () => getFolders(),
	getMailboxInfo: () => getMailboxInfo(),
}))

// Child chrome is exercised by its own suites; stub each to a minimal, inspectable shell.
vi.mock('../components/AppRail.js', () => ({
	AppRailLogo: ({ appName }: { appName: string }) => <div data-testid="logo">{appName}</div>,
	AppRailNav: (props: any) => (
		<div data-testid="railnav" data-email={props.email}>
			<button type="button" onClick={props.onOpenCommandPalette}>
				rail-open-palette
			</button>
		</div>
	),
}))

const paletteShortcut = vi.fn()
vi.mock('../components/CommandPalette.js', () => ({
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

vi.mock('../components/MailSidebar.js', () => ({
	MailSidebar: (props: any) => (
		<div data-testid="sidebar" data-folder={props.currentFolderId ?? ''} data-base={props.baseFolderId ?? ''}>
			<button type="button" onClick={props.onNavigate}>
				sidebar-nav
			</button>
		</div>
	),
}))

vi.mock('../components/Sheet.js', () => ({
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

// Real ui-model helpers, except liveSearchTarget is spy-wrapped so the (otherwise
// unreachable) thread navigation branch can be driven explicitly.
vi.mock('../components/ui-model.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../components/ui-model.js')>()
	return { ...actual, liveSearchTarget: vi.fn((...args: any[]) => (actual.liveSearchTarget as any)(...args)) }
})

import { liveSearchTarget } from '../components/ui-model.js'
import { MailRouteScreen, Route } from './mail.js'

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

		const data = await Route.options.loader()

		expect(data.info).toEqual(info)
		expect(data.folders).toEqual([{ id: 'inbox' }])
	})

	it('renders the shell from loader data (logo, rail, sidebar)', () => {
		Route.useLoaderData = vi.fn(() => ({ info, folders: [] as Folder[] }))
		const Component = Route.options.component
		render(<Component />)
		expect(screen.getByTestId('logo')).toHaveTextContent('OwnMail')
		expect(screen.getByTestId('railnav')).toHaveAttribute('data-email', 'ada@example.com')
	})
})

describe('MailRouteScreen — layout wiring', () => {
	it('derives the current folder from the path and shows the outlet by default', () => {
		renderScreen()
		expect(screen.getAllByTestId('sidebar')[0]).toHaveAttribute('data-folder', 'inbox')
		expect(screen.getByTestId('outlet')).toBeInTheDocument()
		// No query -> the "/" shortcut hint is visible, no clear button.
		expect(screen.getByText('/')).toBeInTheDocument()
		expect(screen.queryByLabelText('Clear search')).toBeNull()
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

	it('opens the folder sheet from the menu button and closes it via sidebar navigation', () => {
		renderScreen()
		expect(screen.queryByTestId('sheet')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Open folders' }))
		expect(screen.getByTestId('sheet')).toBeInTheDocument()
		// Navigating within the sheet's sidebar closes the sheet.
		fireEvent.click(screen.getAllByText('sidebar-nav')[1])
		expect(screen.queryByTestId('sheet')).toBeNull()
	})

	it('closes the sheet via its own close control', () => {
		renderScreen()
		fireEvent.click(screen.getByRole('button', { name: 'Open folders' }))
		fireEvent.click(screen.getByText('close-sheet'))
		expect(screen.queryByTestId('sheet')).toBeNull()
	})
})

describe('MailRouteScreen — masks', () => {
	it('masks the compose FAB link to "/" when the public location is the root', () => {
		renderScreen(
			{},
			{ location: { pathname: '/mail/f/inbox', search: {}, maskedLocation: { pathname: '/' } } },
		)
		const fab = screen.getByRole('link', { name: 'Compose message' })
		expect(fab).toHaveAttribute('data-mask', 'yes')
	})

	it('leaves the compose FAB link unmasked on a normal location', () => {
		renderScreen()
		expect(screen.getByRole('link', { name: 'Compose message' })).toHaveAttribute('data-mask', 'no')
	})
})

describe('MailRouteScreen — search navigation', () => {
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

	it('searches without a folder scope and carries the mask when on the masked root', () => {
		renderScreen(
			{},
			{ location: { pathname: '/mail/search', search: {}, maskedLocation: { pathname: '/' } } },
		)
		fireEvent.change(searchInput(), { target: { value: 'x' } })
		submitSearch()
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/search',
			search: { q: 'x' },
			replace: true,
			mask: { to: '/' },
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

	it('returns to the folder list with a mask when clearing search on the masked root', () => {
		routerState = {
			location: {
				pathname: '/mail/search',
				search: { folderId: 'inbox' },
				maskedLocation: { pathname: '/' },
			},
			matches: [{ routeId: '/mail/search' }],
		}
		render(<MailRouteScreen info={info} folders={[]} />)
		submitSearch()
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/f/$folderId',
			params: { folderId: 'inbox' },
			replace: true,
			mask: { to: '/' },
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

	it('carries a mask when navigating to a thread from the masked root', () => {
		vi.mocked(liveSearchTarget).mockReturnValueOnce({ kind: 'thread', folderId: 'inbox', threadId: 't9' })
		renderScreen(
			{},
			{ location: { pathname: '/mail/f/inbox', search: {}, maskedLocation: { pathname: '/' } } },
		)
		fireEvent.change(searchInput(), { target: { value: 'ada' } })
		submitSearch()
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/mail/f/$folderId/t/$threadId', mask: { to: '/' } }),
		)
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

	it('debounces typing before navigating, replacing an in-flight timer', () => {
		vi.useFakeTimers()
		try {
			render(<MailRouteScreen info={info} folders={[]} />)
			fireEvent.change(searchInput(), { target: { value: 'a' } })
			fireEvent.change(searchInput(), { target: { value: 'ab' } })
			expect(navigate).not.toHaveBeenCalled()
			vi.advanceTimersByTime(280)
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ to: '/mail/search', search: { q: 'ab', folderId: 'inbox' } }),
			)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('MailRouteScreen — keyboard shortcuts', () => {
	it('focuses search on "/" and composes on "c"', () => {
		renderScreen()
		fireEvent.keyDown(window, { key: '/' })
		expect(document.activeElement).toBe(searchInput())

		fireEvent.keyDown(window, { key: 'c' })
		expect(navigate).toHaveBeenCalledWith({ to: '/mail/compose', search: { folderId: 'inbox' } })
	})

	it('carries a selected search thread id into the compose target', () => {
		renderScreen({}, { location: { pathname: '/mail/f/inbox', search: { threadId: 't5' } } })
		fireEvent.keyDown(window, { key: 'c' })
		expect(navigate).toHaveBeenCalledWith({
			to: '/mail/compose',
			search: { folderId: 'inbox', threadId: 't5' },
		})
	})

	it('masks the compose shortcut when on the masked root', () => {
		renderScreen(
			{},
			{ location: { pathname: '/mail/f/inbox', search: {}, maskedLocation: { pathname: '/' } } },
		)
		fireEvent.keyDown(window, { key: 'c' })
		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/mail/compose', mask: { to: '/' } }))
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

describe('useVersionPolling', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('polls /api/version while visible and invalidates only when the version changes', async () => {
		vi.useFakeTimers()
		const fetchMock = vi.fn()
		globalThis.fetch = fetchMock as unknown as typeof fetch
		const visibility = vi.spyOn(document, 'visibilityState', 'get')
		try {
			render(<MailRouteScreen info={info} folders={[]} />)

			// Hidden tab: no polling at all.
			visibility.mockReturnValue('hidden')
			await vi.advanceTimersByTimeAsync(10_000)
			expect(fetchMock).not.toHaveBeenCalled()

			visibility.mockReturnValue('visible')
			// A non-OK response is ignored.
			fetchMock.mockResolvedValueOnce({ ok: false })
			await vi.advanceTimersByTimeAsync(10_000)
			expect(invalidate).not.toHaveBeenCalled()

			// First OK response only records the baseline version.
			fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 1 }) })
			await vi.advanceTimersByTimeAsync(10_000)
			expect(invalidate).not.toHaveBeenCalled()

			// A changed version triggers a router invalidation.
			fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 2 }) })
			await vi.advanceTimersByTimeAsync(10_000)
			expect(invalidate).toHaveBeenCalledTimes(1)

			// Same version again: no further invalidation.
			fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 2 }) })
			await vi.advanceTimersByTimeAsync(10_000)
			expect(invalidate).toHaveBeenCalledTimes(1)

			// Transient network error is swallowed.
			fetchMock.mockRejectedValueOnce(new Error('offline'))
			await vi.advanceTimersByTimeAsync(10_000)
			expect(invalidate).toHaveBeenCalledTimes(1)
		} finally {
			visibility.mockRestore()
			vi.useRealTimers()
		}
	})
})
