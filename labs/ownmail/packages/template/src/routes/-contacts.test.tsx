// @vitest-environment jsdom
import type { Contact } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../components/AppRail.js', () => ({
	AppRailLogo: (props: any) => <div data-testid="logo">{props.appName}</div>,
	AppRailNav: (props: any) => (
		<div data-testid="nav" data-active={props.active}>
			<button type="button" onClick={props.onOpenCommandPalette}>
				open-palette
			</button>
		</div>
	),
}))

vi.mock('../components/CommandPalette.js', () => ({
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

vi.mock('../server/fns.js', () => ({
	getContacts: (args: any) => h.getContacts(args),
	getMailboxInfo: () => h.getMailboxInfo(),
}))

import { ContactsShell, Route } from './contacts.js'

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
		cleanup()
		shell({ query: 'zzz' })
		expect(screen.getByText('No contacts match your search.')).toBeInTheDocument()
	})

	it('reports search input changes to the parent', () => {
		const onQueryChange = vi.fn()
		shell({ onQueryChange })
		fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'ada' } })
		expect(onQueryChange).toHaveBeenCalledWith('ada')
	})

	it('links "New contact" to the create route with the active search', () => {
		shell({ query: 'ada' })
		const newLink = screen.getAllByRole('link').find((el) => el.getAttribute('data-to') === '/contacts/new')
		expect(newLink).toHaveAttribute('data-search', JSON.stringify({ q: 'ada' }))
	})

	it('pages in more contacts and drops the button when the cursor is exhausted', async () => {
		h.getContacts.mockResolvedValue({ contacts: [{ id: 'c-cy', given_name: 'Cy' }] })
		shell({ nextCursor: 'cursor-2' })
		fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
		await waitFor(() => expect(screen.getByText('Cy')).toBeInTheDocument())
		expect(h.getContacts).toHaveBeenCalledWith({ data: { pageToken: 'cursor-2' } })
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
	})

	it('shows a loading label while a page is in flight', async () => {
		let resolve: (value: { contacts: Contact[]; nextCursor?: string }) => void = () => {}
		h.getContacts.mockReturnValue(
			new Promise((r) => {
				resolve = r
			}),
		)
		shell({ nextCursor: 'cursor-2' })
		fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
		expect(await screen.findByRole('button', { name: 'Loading…' })).toBeDisabled()
		resolve({ contacts: [] })
	})

	it('keeps the paged button after a failed load for a retry', async () => {
		h.getContacts.mockRejectedValue(new Error('down'))
		shell({ nextCursor: 'cursor-2' })
		fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled())
	})

	it('opens and closes the command palette', () => {
		shell()
		fireEvent.click(screen.getByRole('button', { name: 'open-palette' }))
		expect(screen.getByTestId('palette')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'close-palette' }))
		expect(screen.queryByTestId('palette')).not.toBeInTheDocument()
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
		expect(screen.getByTestId('outlet')).toBeInTheDocument()
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
})
