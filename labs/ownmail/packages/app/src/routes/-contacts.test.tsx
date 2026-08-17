// @vitest-environment jsdom
import type { Contact } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, render as testingRender, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contactsStateTestApi } from '#features/contacts/state/contacts-state'

const h = vi.hoisted(() => ({
	navigate: vi.fn(),
	pathname: '/contacts',
	getContacts: vi.fn(),
	getMailboxInfo: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useNavigate: () => h.navigate,
	useRouterState: (opts: any) => opts.select({ location: { pathname: h.pathname } }),
	Link: ({ children, to, params, search, ...rest }: any) => (
		<a
			href={typeof to === 'string' ? to : '#'}
			data-to={to}
			data-params={JSON.stringify(params)}
			data-search={JSON.stringify(search)}
			{...rest}
		>
			{children}
		</a>
	),
	Outlet: () => <div data-testid="outlet" />,
}))

vi.mock('#app/components/AppRail', () => ({
	AppRailLogo: (props: any) => <div data-testid="logo">{props.appName}</div>,
	AppRailNav: (props: any) => (
		<div data-testid="nav" data-active={props.active}>
			<button type="button" onClick={props.onOpenCommandPalette}>
				open-palette
			</button>
		</div>
	),
	AppRailMobileNav: (props: any) => (
		<div data-testid="mobile-nav">
			<button type="button" onClick={props.onNavigate}>
				close-mobile-navigation
			</button>
		</div>
	),
}))

vi.mock('#app/components/MobileTabBar', () => ({
	MobileTabBar: ({ active }: { active: string }) => <nav data-testid="mobile-tabs" data-active={active} />,
}))

vi.mock('#shared/components/Sheet', () => ({
	Sheet: (props: any) =>
		props.open ? (
			<div data-testid="sheet">
				<button type="button" onClick={props.onClose}>
					close-sheet
				</button>
				{props.children}
			</div>
		) : null,
}))

vi.mock('#app/components/CommandPalette', () => ({
	CommandPalette: (props: any) =>
		props.open ? (
			<div data-testid="palette">
				<button type="button" onClick={props.onClose}>
					close-palette
				</button>
			</div>
		) : null,
	useCommandPaletteShortcut: () => {},
}))

vi.mock('#server/fns', () => ({
	getContacts: (args: any) => h.getContacts(args),
	getMailboxInfo: () => h.getMailboxInfo(),
}))

import { ContactsShell, Route } from './contacts.js'

function render(ui: ReactElement) {
	return testingRender(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })}
		>
			{ui}
		</QueryClientProvider>,
	)
}

const info = { email: 'ada@ownmail.com', appName: 'ownmail' }
const contacts: Contact[] = [
	{ id: 'c-ada', given_name: 'Ada', surname: 'Lovelace', emails: [{ email: 'ada@x.com' }] },
	{ id: 'c-bea', given_name: 'Bea', company_name: 'Skyworks' },
]

beforeEach(() => {
	h.navigate.mockReset()
	h.pathname = '/contacts'
	h.getContacts.mockReset()
})

afterEach(cleanup)

function shell(overrides: Partial<Parameters<typeof ContactsShell>[0]> = {}) {
	return render(
		<ContactsShell info={info} contacts={contacts} query="" onQueryChange={() => {}} {...overrides} />,
	)
}

describe('ContactsShell', () => {
	it('lists sorted contacts as links that carry the active search', () => {
		shell({ query: 'a', selectedId: 'c-ada' })
		const links = screen
			.getAllByRole('link')
			.filter((el) => el.getAttribute('data-to') === '/contacts/$contactId')
		expect(links).toHaveLength(2)
		expect(links[0]).toHaveAttribute('data-params', JSON.stringify({ contactId: 'c-ada' }))
		expect(links[0]).toHaveAttribute('data-search', JSON.stringify({ q: 'a' }))
		expect(links[0]).toHaveAttribute('aria-current', 'true')
		// Bea has a company subtitle but no email; Ada shows her name.
		expect(screen.getByText('Skyworks')).toBeInTheDocument()
	})

	it('shows the empty state, distinguishing no-contacts from no-matches', () => {
		shell({ contacts: [] })
		expect(screen.getByText('No contacts yet.')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Load more contacts/ })).toBeNull()
		cleanup()
		shell({ query: 'zzz' })
		expect(screen.getByText('No contacts match your search.')).toBeInTheDocument()
	})

	it('keeps pagination discoverable inside empty and filtered-empty states', () => {
		shell({ contacts: [], nextCursor: 'cursor-2' })
		const emptyState = screen.getByText('More contacts may be available').closest('div')
		expect(emptyState).toContainElement(screen.getByRole('button', { name: 'Load more contacts' }))
		expect(screen.getByText('Load the next page to keep looking.')).toBeInTheDocument()

		cleanup()
		shell({ query: 'zzz', nextCursor: 'cursor-2' })
		const filteredEmptyState = screen.getByText('No contacts match your search.').closest('div')
		expect(filteredEmptyState).toContainElement(screen.getByRole('button', { name: 'Load more contacts' }))
	})

	it('reports search input changes to the parent', () => {
		const onQueryChange = vi.fn()
		shell({ onQueryChange })
		fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'ada' } })
		expect(onQueryChange).toHaveBeenCalledWith('ada')
	})

	it('offers an explicit refresh action alongside pull-to-refresh', () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined)
		shell({ onRefresh })
		fireEvent.click(screen.getByRole('button', { name: 'Refresh contacts' }))
		expect(onRefresh).toHaveBeenCalledOnce()
		expect(screen.getByText('Pull to refresh')).toBeInTheDocument()
	})

	it('links "New contact" to the create route with the active search', () => {
		shell({ query: 'ada' })
		const newLink = screen.getAllByRole('link').find((el) => el.getAttribute('data-to') === '/contacts/new')
		expect(newLink).toHaveAttribute('data-search', JSON.stringify({ q: 'ada' }))
	})

	it('pages in more contacts and drops the button when the cursor is exhausted', async () => {
		h.getContacts.mockResolvedValue({ contacts: [{ id: 'c-cy', given_name: 'Cy' }] })
		shell({ nextCursor: 'cursor-2' })
		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		await waitFor(() => expect(screen.getByText('Cy')).toBeInTheDocument())
		expect(h.getContacts).toHaveBeenCalledWith({ data: { pageToken: 'cursor-2' } })
		expect(screen.queryByRole('button', { name: 'Load more contacts' })).not.toBeInTheDocument()
	})

	it('deduplicates a contact returned on a later page', async () => {
		h.getContacts.mockResolvedValue({
			contacts: [
				{ id: 'c-ada', given_name: 'Updated Ada' },
				{ id: 'c-cy', given_name: 'Cy' },
			],
		})
		shell({ nextCursor: 'cursor-2' })
		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))

		expect(await screen.findByText('Updated Ada')).toBeInTheDocument()
		expect(screen.getAllByText(/Ada/)).toHaveLength(1)
		expect(screen.getByText('Cy')).toBeInTheDocument()
	})

	it('delegates managed pagination to the query-backed route wrapper', async () => {
		const onLoadMore = vi.fn().mockResolvedValue(undefined)
		shell({ nextCursor: 'cursor-2', onLoadMore })
		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
		expect(h.getContacts).not.toHaveBeenCalled()
	})

	it('makes pagination synchronously single-flight while preserving focus', async () => {
		let resolve: (value: { contacts: Contact[]; nextCursor?: string }) => void = () => {}
		h.getContacts.mockReturnValue(
			new Promise((r) => {
				resolve = r
			}),
		)
		shell({ nextCursor: 'cursor-2' })
		const button = screen.getByRole('button', { name: 'Load more contacts' })
		button.focus()
		act(() => {
			button.click()
			button.click()
		})

		const pending = await screen.findByRole('button', { name: 'Loading more contacts…' })
		expect(h.getContacts).toHaveBeenCalledTimes(1)
		expect(pending).toBeEnabled()
		expect(pending).toHaveAttribute('aria-disabled', 'true')
		expect(pending).toHaveAttribute('aria-busy', 'true')
		expect(pending).toHaveFocus()
		fireEvent.click(pending)
		expect(h.getContacts).toHaveBeenCalledTimes(1)
		resolve({ contacts: [], nextCursor: 'cursor-3' })
		await waitFor(() => expect(screen.getByRole('button', { name: 'Load more contacts' })).toBeEnabled())
	})

	it('shows generic retry guidance, preserves focus and rows, then clears it after success', async () => {
		h.getContacts.mockRejectedValueOnce(new Error('provider-secret-detail')).mockResolvedValueOnce({
			contacts: [{ id: 'c-cy', given_name: 'Cy' }],
		})
		shell({ nextCursor: 'cursor-2' })
		const button = screen.getByRole('button', { name: 'Load more contacts' })
		button.focus()
		fireEvent.click(button)

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not load more contacts. Check your connection, then try again.',
		)
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
		expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
		const retry = screen.getByRole('button', { name: 'Try loading more contacts' })
		expect(retry).toHaveFocus()
		expect(retry).toHaveAttribute('aria-describedby', 'contacts-pagination-error')

		fireEvent.click(retry)
		expect(await screen.findByRole('button', { name: 'Loading more contacts…' })).toHaveAttribute(
			'aria-disabled',
			'true',
		)
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
		expect(await screen.findByText('Cy')).toBeInTheDocument()
	})

	it('renders managed pagination failures as static retry guidance', () => {
		shell({
			nextCursor: 'cursor-2',
			loadMoreError: true,
			onLoadMore: vi.fn().mockResolvedValue(undefined),
		})

		expect(screen.getByRole('alert')).toHaveTextContent('Could not load more contacts.')
		expect(screen.getByRole('button', { name: 'Try loading more contacts' })).toBeEnabled()
	})

	it('ignores a stale local success after a contacts-to-replacement-to-contacts transition', async () => {
		let resolvePage: (value: { contacts: Contact[]; nextCursor?: string }) => void = () => {}
		let settled = false
		h.getContacts.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve
			}).finally(() => {
				settled = true
			}),
		)
		const firstContacts = [{ id: 'a', given_name: 'First list' }] as Contact[]
		const replacementContacts = [{ id: 'b', given_name: 'Replacement list' }] as Contact[]
		const returnedContacts = [{ id: 'a2', given_name: 'Returned list' }] as Contact[]
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const props = { info, query: '', onQueryChange: () => {}, nextCursor: 'shared-cursor' }
		const view = testingRender(
			<QueryClientProvider client={client}>
				<ContactsShell {...props} contacts={firstContacts} />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		view.rerender(
			<QueryClientProvider client={client}>
				<ContactsShell {...props} contacts={replacementContacts} />
			</QueryClientProvider>,
		)
		view.rerender(
			<QueryClientProvider client={client}>
				<ContactsShell {...props} contacts={returnedContacts} />
			</QueryClientProvider>,
		)
		resolvePage({ contacts: [{ id: 'stale', given_name: 'Stale contact' }] as Contact[] })

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.getByText('Returned list')).toBeInTheDocument()
		expect(screen.queryByText('Stale contact')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('ignores a stale local failure after a contacts-to-replacement-to-contacts transition', async () => {
		let rejectPage: (reason?: unknown) => void = () => {}
		let settled = false
		h.getContacts.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectPage = reject
			}).finally(() => {
				settled = true
			}),
		)
		const firstContacts = [{ id: 'a', given_name: 'First list' }] as Contact[]
		const replacementContacts = [{ id: 'b', given_name: 'Replacement list' }] as Contact[]
		const returnedContacts = [{ id: 'a2', given_name: 'Returned list' }] as Contact[]
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const props = { info, query: '', onQueryChange: () => {}, nextCursor: 'shared-cursor' }
		const view = testingRender(
			<QueryClientProvider client={client}>
				<ContactsShell {...props} contacts={firstContacts} />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		view.rerender(
			<QueryClientProvider client={client}>
				<ContactsShell {...props} contacts={replacementContacts} />
			</QueryClientProvider>,
		)
		view.rerender(
			<QueryClientProvider client={client}>
				<ContactsShell {...props} contacts={returnedContacts} />
			</QueryClientProvider>,
		)
		rejectPage(new Error('provider-secret-detail'))

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.getByText('Returned list')).toBeInTheDocument()
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
	})

	it('opens and closes the command palette', () => {
		shell()
		fireEvent.click(screen.getByRole('button', { name: 'open-palette' }))
		expect(screen.getByTestId('palette')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'close-palette' }))
		expect(screen.queryByTestId('palette')).not.toBeInTheDocument()
	})

	it('opens the app navigation as a temporary sheet', () => {
		shell()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		expect(screen.getByTestId('sheet')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'close-mobile-navigation' }))
		expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getByRole('button', { name: 'close-sheet' }))
		expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
	})

	it('gives the mobile create action a name and preserves the search focus ring', () => {
		shell()
		expect(screen.getByRole('link', { name: 'New contact' })).toBeInTheDocument()
		expect(screen.getByRole('searchbox', { name: 'Search contacts' })).not.toHaveClass('outline-none')
	})
})

describe('ContactsLayout wrapper', () => {
	function renderLayout(loaderData: any, search: { q?: string }) {
		Route.useLoaderData = vi.fn(() => loaderData)
		Route.useSearch = vi.fn(() => search)
		const Page = Route.options.component
		return render(<Page />)
	}

	it('feeds loader data and the path-derived selection into the shell', () => {
		h.pathname = '/contacts/c-ada'
		renderLayout({ info, contacts, nextCursor: undefined }, { q: 'ad' })
		const links = screen
			.getAllByRole('link')
			.filter((el) => el.getAttribute('data-to') === '/contacts/$contactId')
		expect(links[0]).toHaveAttribute('aria-current', 'true')
		expect(screen.getByTestId('mobile-tabs')).toHaveAttribute('data-active', 'contacts')
		expect(screen.getByTestId('outlet')).toBeInTheDocument()
	})

	it('connects refresh interactions to the live contacts query', async () => {
		h.getContacts.mockResolvedValue({ contacts })
		renderLayout({ info, contacts }, {})
		fireEvent.click(screen.getByRole('button', { name: 'Refresh contacts' }))
		await waitFor(() => expect(h.getContacts).toHaveBeenCalledWith({ data: {} }))
	})

	it('announces a generic failure when the live contacts refresh rejects', async () => {
		h.getContacts.mockRejectedValue(new Error('provider-secret-detail'))
		renderLayout({ info, contacts }, {})

		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
		expect(await screen.findByRole('status')).toHaveTextContent(
			'Could not refresh. Check your connection, then try again.',
		)
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
	})

	it('pushes a typed query into the URL', () => {
		renderLayout({ info, contacts }, {})
		fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'ada' } })
		expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: { q: 'ada' }, replace: true })
	})

	it('clears the query from the URL when the field is emptied', () => {
		// The input is URL-controlled; start from an active query so emptying it fires a change.
		renderLayout({ info, contacts }, { q: 'ada' })
		fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: '' } })
		expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: {}, replace: true })
	})

	it('validates the q search param', () => {
		expect(Route.options.validateSearch({ q: 'ada' })).toEqual({ q: 'ada' })
		expect(Route.options.validateSearch({ q: '' })).toEqual({})
		expect(Route.options.validateSearch({ q: 5 })).toEqual({})
	})

	it('loads mailbox info and the first page of contacts, surfacing the cursor', async () => {
		h.getMailboxInfo.mockResolvedValue(info)
		h.getContacts.mockResolvedValue({ contacts, nextCursor: 'cursor-2' })
		expect(await Route.options.loader()).toEqual({ info, contacts, nextCursor: 'cursor-2' })

		h.getContacts.mockResolvedValue({ contacts })
		expect(await Route.options.loader()).toEqual({ info, contacts })
	})

	it('owns route pagination in the shared query cache', async () => {
		Route.useLoaderData = vi.fn(() => ({ info, contacts, nextCursor: 'cursor-2' }))
		Route.useSearch = vi.fn(() => ({}))
		h.getContacts.mockResolvedValue({ contacts: [{ id: 'c-cy', given_name: 'Cy' }] })
		const Component = Route.options.component
		render(<Component />)

		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		expect(await screen.findByText('Cy')).toBeInTheDocument()
		expect(h.getContacts).toHaveBeenCalledWith({ data: { pageToken: 'cursor-2' } })
	})

	it('preserves a confirmed contact update when a new loader page replaces the list cache', async () => {
		let loaderContacts = [{ id: 'c-ada', given_name: 'Stale provider name' }] as Contact[]
		Route.useLoaderData = vi.fn(() => ({ info, contacts: loaderContacts }))
		Route.useSearch = vi.fn(() => ({}))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		contactsStateTestApi.rememberConfirmedContactEffect(client, {
			type: 'updated',
			contact: { id: 'c-ada', given_name: 'Confirmed name' } as Contact,
		})
		const Component = Route.options.component
		const view = testingRender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		expect(screen.getByText('Confirmed name')).toBeInTheDocument()

		loaderContacts = [{ id: 'c-ada', given_name: 'Another stale provider name' }] as Contact[]
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)

		expect(await screen.findByText('Confirmed name')).toBeInTheDocument()
		expect(screen.queryByText('Another stale provider name')).toBeNull()
	})

	it('cancels a query-backed stale success across a loader A-to-B-to-A transition', async () => {
		let loaderContacts = [{ id: 'a', given_name: 'First list' }] as Contact[]
		let resolvePage: (value: { contacts: Contact[]; nextCursor?: string }) => void = () => {}
		let settled = false
		h.getContacts.mockReturnValue(
			new Promise((resolve) => {
				resolvePage = resolve
			}).finally(() => {
				settled = true
			}),
		)
		Route.useLoaderData = vi.fn(() => ({ info, contacts: loaderContacts, nextCursor: 'shared-cursor' }))
		Route.useSearch = vi.fn(() => ({}))
		const Component = Route.options.component
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const view = testingRender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		await waitFor(() => expect(h.getContacts).toHaveBeenCalledWith({ data: { pageToken: 'shared-cursor' } }))
		loaderContacts = [{ id: 'b', given_name: 'Replacement list' }] as Contact[]
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		expect(await screen.findByText('Replacement list')).toBeInTheDocument()
		loaderContacts = [{ id: 'a2', given_name: 'Returned list' }] as Contact[]
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		expect(await screen.findByText('Returned list')).toBeInTheDocument()
		resolvePage({ contacts: [{ id: 'stale', given_name: 'Stale contact' }] as Contact[] })

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.queryByText('Stale contact')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('cancels a query-backed stale failure across a loader A-to-B-to-A transition', async () => {
		let loaderContacts = [{ id: 'a', given_name: 'First list' }] as Contact[]
		let rejectPage: (reason?: unknown) => void = () => {}
		let settled = false
		h.getContacts.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectPage = reject
			}).finally(() => {
				settled = true
			}),
		)
		Route.useLoaderData = vi.fn(() => ({ info, contacts: loaderContacts, nextCursor: 'shared-cursor' }))
		Route.useSearch = vi.fn(() => ({}))
		const Component = Route.options.component
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
		const view = testingRender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)

		fireEvent.click(screen.getByRole('button', { name: 'Load more contacts' }))
		await waitFor(() => expect(h.getContacts).toHaveBeenCalledTimes(1))
		loaderContacts = [{ id: 'b', given_name: 'Replacement list' }] as Contact[]
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		expect(await screen.findByText('Replacement list')).toBeInTheDocument()
		loaderContacts = [{ id: 'a2', given_name: 'Returned list' }] as Contact[]
		view.rerender(
			<QueryClientProvider client={client}>
				<Component />
			</QueryClientProvider>,
		)
		expect(await screen.findByText('Returned list')).toBeInTheDocument()
		rejectPage(new Error('provider-secret-detail'))

		await waitFor(() => expect(settled).toBe(true))
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
	})
})
