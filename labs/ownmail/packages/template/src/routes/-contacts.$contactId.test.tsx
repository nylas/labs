// @vitest-environment jsdom
import type { Contact } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

vi.mock('../server/fns.js', () => ({
	deleteContact: (args: any) => h.deleteContact(args),
	getContact: (args: any) => h.getContact(args),
}))

vi.mock('./contacts.js', () => ({
	ContactAvatar: (props: any) => <span data-testid="avatar">{props.name}</span>,
}))

vi.mock('../components/ContactModal.js', () => ({
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
		onRequestDelete: vi.fn(),
		onCancelDelete: vi.fn(),
		onConfirmDelete: vi.fn(),
	}

	it('renders every populated section', () => {
		render(<ContactDetailScreen contact={full} confirmingDelete={false} deleteError={null} {...handlers} />)
		expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
		// The role line appears as the tagline under the name and again in the Work section.
		expect(screen.getAllByText('Mathematician · Engines')).toHaveLength(2)
		expect(screen.getByRole('link', { name: 'ada@x.com' })).toHaveAttribute('href', 'mailto:ada@x.com')
		expect(screen.getByText('555-0100')).toBeInTheDocument()
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
		expect(screen.getByText('Could not delete')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(handlers.onConfirmDelete).toHaveBeenCalled()
		expect(handlers.onCancelDelete).toHaveBeenCalled()
	})
})

describe('ContactDetailRoute wrapper', () => {
	function renderRoute(search: { q?: string; edit?: true } = {}) {
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

	it('renders the edit modal when the edit flag is set and refreshes on save', () => {
		renderRoute({ edit: true })
		expect(screen.getByTestId('contact-modal')).toBeInTheDocument()
		fireEvent.click(screen.getByText('modal-saved'))
		expect(h.invalidate).toHaveBeenCalledTimes(1)
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

	it('deletes the contact then refreshes and returns to the list', async () => {
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		await waitFor(() => expect(h.deleteContact).toHaveBeenCalledWith({ data: { contactId: 'contact-1' } }))
		expect(h.invalidate).toHaveBeenCalled()
		expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: {} })
	})

	it('backs out of a delete confirmation', () => {
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
	})

	it('surfaces a delete failure without navigating away', async () => {
		h.deleteContact.mockRejectedValue(new Error('server said no'))
		renderRoute()
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
		fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
		expect(await screen.findByText('server said no')).toBeInTheDocument()
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
