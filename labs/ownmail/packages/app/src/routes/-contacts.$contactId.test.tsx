// @vitest-environment jsdom
import type { Contact } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, render as testingRender, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	navigate: vi.fn(),
	invalidate: vi.fn(),
	deleteContact: vi.fn(),
	getContact: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useNavigate: () => h.navigate,
	useRouter: () => ({ invalidate: h.invalidate }),
}))

vi.mock('#server/fns', () => ({
	deleteContact: (args: any) => h.deleteContact(args),
	getContact: (args: any) => h.getContact(args),
}))

vi.mock('./contacts.js', () => ({
	ContactAvatar: (props: any) => <span data-testid="avatar">{props.name}</span>,
}))

vi.mock('#features/contacts/components/ContactModal', () => ({
	ContactModal: (props: any) => (
		<div data-testid="contact-modal">
			<button type="button" onClick={() => props.onClose(true)}>
				modal-saved
			</button>
			<button type="button" onClick={() => props.onClose(false)}>
				modal-cancelled
			</button>
		</div>
	),
}))

import { ContactDetailScreen, Route } from './contacts.$contactId.js'

// Compose is app state: assert what the composer is asked to open, not a route.
const composeApi = vi.hoisted(() => ({
	openCompose: vi.fn(async () => {}),
	composing: null as { kind: string; threadId?: string } | null,
	registerInlineSlot: vi.fn(),
}))
vi.mock('#features/mail/components/ComposeProvider', () => ({ useCompose: () => composeApi }))

function render(ui: ReactElement) {
	return testingRender(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			{ui}
		</QueryClientProvider>,
	)
}

const full: Contact = {
	id: 'contact-1',
	given_name: 'Ada',
	surname: 'Lovelace',
	company_name: 'Engines',
	job_title: 'Mathematician',
	emails: [{ email: 'ada@x.com', type: 'work' }],
	phone_numbers: [{ number: '555-0100', type: 'home' }],
	notes: 'multi\nline',
}

beforeEach(() => {
	h.navigate.mockReset()
	h.invalidate.mockReset()
	h.deleteContact.mockReset().mockResolvedValue({ ok: true })
	h.getContact.mockReset().mockResolvedValue(full)
})

afterEach(cleanup)

describe('ContactDetailScreen', () => {
	const handlers = {
		onBack: vi.fn(),
		onEdit: vi.fn(),
		onNewEmail: vi.fn(),
		onRequestDelete: vi.fn(),
		onCancelDelete: vi.fn(),
		onConfirmDelete: vi.fn(),
	}

	it('renders every populated section', () => {
		render(<ContactDetailScreen contact={full} confirmingDelete={false} deleteError={null} {...handlers} />)
		expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
		// The role line appears as the tagline under the name and again in the Work section.
		expect(screen.getAllByText('Mathematician · Engines')).toHaveLength(2)
		const emailLink = screen.getByRole('link', { name: 'ada@x.com' })
		expect(emailLink).toHaveAttribute('href', 'mailto:ada@x.com')
		expect(emailLink).toHaveClass('min-h-11')
		const phoneLink = screen.getByRole('link', { name: '555-0100' })
		expect(phoneLink).toHaveAttribute('href', 'tel:555-0100')
		expect(phoneLink).toHaveClass('min-h-11')
		expect(screen.getByText(/multi\s+line/)).toBeInTheDocument()
	})

	it('omits sections a bare contact does not have', () => {
		render(
			<ContactDetailScreen
				contact={{ id: 'c2', given_name: 'Bea' }}
				confirmingDelete={false}
				deleteError={null}
				{...handlers}
			/>,
		)
		expect(screen.queryByText('Email')).not.toBeInTheDocument()
		expect(screen.queryByText('Phone')).not.toBeInTheDocument()
		expect(screen.queryByText('Work')).not.toBeInTheDocument()
		expect(screen.queryByText('Notes')).not.toBeInTheDocument()
	})

	it('wires the back, edit, and delete-request controls', () => {
		render(<ContactDetailScreen contact={full} confirmingDelete={false} deleteError={null} {...handlers} />)
		// The actions divider is the shared Section: 24px on both sides of its line.
		expect(screen.getByRole('button', { name: 'Edit' }).parentElement).toHaveClass(
			'mt-section',
			'border-t',
			'pt-section',
		)
		fireEvent.click(screen.getByRole('button', { name: /All contacts/ }))
		fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		expect(handlers.onBack).toHaveBeenCalled()
		expect(handlers.onEdit).toHaveBeenCalled()
		expect(handlers.onRequestDelete).toHaveBeenCalled()
	})

	it('swaps to confirm/cancel controls while confirming, and shows a delete error', () => {
		render(
			<ContactDetailScreen
				contact={full}
				confirmingDelete={true}
				deleteError="Could not delete"
				{...handlers}
			/>,
		)
		expect(screen.getByRole('alert')).toHaveTextContent('Could not delete')
		for (const name of ['Edit', 'Confirm delete', 'Cancel']) {
			expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'whitespace-nowrap')
		}
		expect(screen.getByRole('button', { name: 'Edit' }).parentElement).toHaveClass(
			'flex-col',
			'min-[400px]:flex-row',
			'min-[400px]:flex-wrap',
		)
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(handlers.onConfirmDelete).toHaveBeenCalled()
		expect(handlers.onCancelDelete).toHaveBeenCalled()
	})
})

describe('ContactDetailRoute wrapper', () => {
	function renderRoute(search: { q?: string; edit?: true; delete?: true } = {}) {
		Route.useLoaderData = vi.fn(() => full)
		Route.useSearch = vi.fn(() => search)
		const Page = Route.options.component
		return render(<Page />)
	}

	it('loads the contact by id', async () => {
		await Route.options.loader({ params: { contactId: 'contact-1' } })
		expect(h.getContact).toHaveBeenCalledWith({ data: { contactId: 'contact-1' } })
	})

	it('validates the q and edit search params', () => {
		expect(Route.options.validateSearch({ q: 'ada', edit: true })).toEqual({ q: 'ada', edit: true })
		expect(Route.options.validateSearch({ q: '', edit: false })).toEqual({})
		expect(Route.options.validateSearch({ q: 5 })).toEqual({})
		expect(Route.options.validateSearch({ delete: 'yes' })).toEqual({ delete: true })
	})

	it('opens on the delete confirmation when the list asked for it, and deletes only once confirmed', async () => {
		renderRoute({ q: 'ada', delete: true })
		expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
		expect(h.deleteContact).not.toHaveBeenCalled()

		// Cancelling clears the request from the URL as well.
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/contacts/$contactId',
			params: { contactId: 'contact-1' },
			search: { q: 'ada' },
		})
		expect(h.deleteContact).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		await waitFor(() => expect(h.deleteContact).toHaveBeenCalledWith({ data: { contactId: 'contact-1' } }))
	})

	describe('header context menu', () => {
		const writeText = vi.fn()
		beforeEach(() => {
			writeText.mockReset().mockResolvedValue(undefined)
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
		})
		afterEach(() => {
			Reflect.deleteProperty(navigator, 'clipboard')
		})

		async function openMenu() {
			const header = screen.getByRole('heading', { level: 1 }).closest('[data-slot="context-menu-trigger"]')
			fireEvent.contextMenu(header as HTMLElement, { clientX: 10, clientY: 10 })
			return screen.findByRole('menu', { name: 'Actions for Ada Lovelace' })
		}
		const choose = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }))
		const menuClosed = () => waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

		it('holds the actions of the page buttons, and no Open for the contact already open', async () => {
			renderRoute({ q: 'ada' })
			await openMenu()
			expect(screen.getAllByRole('menuitem').map((element) => element.textContent)).toEqual([
				'Edit',
				'New email',
				'Copy email address',
				'Delete…',
			])
			choose('Edit')
			expect(h.navigate).toHaveBeenCalledWith({
				to: '/contacts/$contactId',
				params: { contactId: 'contact-1' },
				search: { q: 'ada', edit: true },
			})
			await menuClosed()

			await openMenu()
			choose('New email')
			expect(composeApi.openCompose).toHaveBeenLastCalledWith({ kind: 'new', to: 'ada@x.com' })
		})

		it('asks for confirmation before deleting, exactly like the Delete button', async () => {
			renderRoute()
			await openMenu()
			const remove = screen.getByRole('menuitem', { name: 'Delete…' })
			expect(remove).toHaveAttribute('data-variant', 'destructive')
			expect(remove.querySelector('svg')).not.toBeNull()
			fireEvent.click(remove)
			expect(await screen.findByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
			expect(h.deleteContact).not.toHaveBeenCalled()
			// A confirmation opened here is not in the URL, so cancelling does not navigate.
			fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
			expect(h.navigate).not.toHaveBeenCalled()
		})

		it('copies the address, and stays quiet when the browser refuses or has no clipboard', async () => {
			renderRoute()
			await openMenu()
			choose('Copy email address')
			expect(writeText).toHaveBeenCalledWith('ada@x.com')
			await menuClosed()

			writeText.mockRejectedValue(new Error('denied'))
			await openMenu()
			choose('Copy email address')
			expect(writeText).toHaveBeenCalledTimes(2)
			await menuClosed()

			Reflect.deleteProperty(navigator, 'clipboard')
			await openMenu()
			choose('Copy email address')
			await menuClosed()
			expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		})

		it('shows the email actions as unavailable for a contact without an address', async () => {
			h.getContact.mockResolvedValue({ id: 'contact-1', given_name: 'Ada', surname: 'Lovelace' })
			Route.useLoaderData = vi.fn(() => ({ id: 'contact-1', given_name: 'Ada', surname: 'Lovelace' }))
			Route.useSearch = vi.fn(() => ({}))
			const Page = Route.options.component
			render(<Page />)
			await openMenu()
			expect(screen.getByRole('menuitem', { name: 'New email' })).toHaveAttribute('aria-disabled', 'true')
			expect(screen.getByRole('menuitem', { name: 'Copy email address' })).toHaveAttribute(
				'aria-disabled',
				'true',
			)
		})

		it('keeps the browser menu on the contact details, where the links and text are', () => {
			renderRoute()
			expect(fireEvent.contextMenu(screen.getByRole('link', { name: 'ada@x.com' }))).toBe(true)
			expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		})
	})

	it('navigates back to the list, preserving the active search', () => {
		renderRoute({ q: 'ada' })
		fireEvent.click(screen.getByRole('button', { name: /All contacts/ }))
		expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: { q: 'ada' } })
	})

	it('opens the edit modal via the URL edit flag', () => {
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/contacts/$contactId',
			params: { contactId: 'contact-1' },
			search: { edit: true },
		})
	})

	it('renders the edit modal when the edit flag is set and closes it on save', () => {
		renderRoute({ edit: true })
		expect(screen.getByTestId('contact-modal')).toBeInTheDocument()
		fireEvent.click(screen.getByText('modal-saved'))
		expect(h.invalidate).not.toHaveBeenCalled()
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/contacts/$contactId',
			params: { contactId: 'contact-1' },
			search: {},
		})
	})

	it('closes the edit modal without refreshing when nothing changed', () => {
		renderRoute({ edit: true })
		fireEvent.click(screen.getByText('modal-cancelled'))
		expect(h.invalidate).not.toHaveBeenCalled()
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/contacts/$contactId',
			params: { contactId: 'contact-1' },
			search: {},
		})
	})

	it('deletes the contact through the shared cache mutation and returns to the list', async () => {
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		// invalidate + navigate run only after deleteContact resolves — wait for the
		// final navigate, which implies the whole chain completed.
		await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: {} }))
		expect(h.deleteContact).toHaveBeenCalledWith({ data: { contactId: 'contact-1' } })
		expect(h.invalidate).not.toHaveBeenCalled()
	})

	it('backs out of a delete confirmation', () => {
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
	})

	it('shows a generic delete failure without navigating away', async () => {
		h.deleteContact.mockRejectedValue(new Error('server said no'))
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		expect(await screen.findByText('Failed to delete contact')).toBeInTheDocument()
		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('shows a generic message when the delete failure is not an Error', async () => {
		h.deleteContact.mockRejectedValue('boom')
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		expect(await screen.findByText('Failed to delete contact')).toBeInTheDocument()
	})
})
