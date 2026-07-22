// @vitest-environment jsdom
import type { Contact } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, render as testingRender, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactModal } from './ContactModal.js'

const { createContact, updateContact } = vi.hoisted(() => ({
	createContact: vi.fn(),
	updateContact: vi.fn(),
}))

vi.mock('../../../server/fns.js', () => ({ createContact, updateContact }))

function render(ui: ReactElement) {
	return testingRender(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			{ui}
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	createContact.mockReset().mockResolvedValue({ contactId: 'contact-new' })
	updateContact.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

const existing: Contact = {
	id: 'contact-1',
	given_name: 'Ada',
	surname: 'Lovelace',
	company_name: 'Engines',
	job_title: 'Mathematician',
	emails: [{ email: 'ada@x.com', type: 'work' }],
	phone_numbers: [{ number: '555-0100' }],
	notes: 'note',
}

describe('ContactModal — create', () => {
	it('creates a contact from the entered fields and reports the new id', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)

		expect(screen.getByText('New contact')).toBeInTheDocument()
		const setField = (label: string, value: string) =>
			fireEvent.change(screen.getByLabelText(label as string, { selector: 'input' }), {
				target: { value },
			})
		setField('First name', 'Grace')
		setField('Last name', 'Hopper')
		setField('Company', 'US Navy')
		setField('Job title', 'Admiral')
		fireEvent.change(screen.getByLabelText('Notes', { selector: 'textarea' }), {
			target: { value: 'Coined "debugging"' },
		})
		fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'grace@x.com' } })
		fireEvent.change(screen.getByLabelText('Email 1 type'), { target: { value: 'home' } })
		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

		// onClose fires only after createContact resolves; wait for it, which implies
		// the create call already happened.
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true, 'contact-new'))
		expect(createContact.mock.calls[0][0].data).toMatchObject({
			givenName: 'Grace',
			surname: 'Hopper',
			companyName: 'US Navy',
			jobTitle: 'Admiral',
			notes: 'Coined "debugging"',
			emails: [{ email: 'grace@x.com', type: 'home' }],
		})
	})

	it('lets you add and remove email and phone rows', () => {
		render(<ContactModal contact={null} onClose={vi.fn()} />)

		fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
		expect(screen.getByLabelText('Email 2')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Remove email 2' }))
		expect(screen.queryByLabelText('Email 2')).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Add phone' }))
		const phone = screen.getByLabelText('Phone 1')
		fireEvent.change(phone, { target: { value: '555-9000' } })
		expect((phone as HTMLInputElement).value).toBe('555-9000')
		const phoneType = screen.getByLabelText('Phone 1 type')
		fireEvent.change(phoneType, { target: { value: 'work' } })
		expect((phoneType as HTMLSelectElement).value).toBe('work')
		fireEvent.click(screen.getByRole('button', { name: 'Remove phone 1' }))
		expect(screen.queryByLabelText('Phone 1')).not.toBeInTheDocument()
	})

	it('surfaces a save error and keeps the dialog open', async () => {
		createContact.mockRejectedValue(new Error('QUOTA: too many contacts'))
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)

		fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'grace@x.com' } })
		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

		expect(
			await screen.findByText('Could not save contact. Check your connection, then try again.'),
		).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()
	})

	it('shows a generic message when the failure is not an Error', async () => {
		createContact.mockRejectedValue('boom')
		render(<ContactModal contact={null} onClose={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'grace@x.com' } })
		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
		expect(
			await screen.findByText('Could not save contact. Check your connection, then try again.'),
		).toBeInTheDocument()
	})

	it('shows a busy label while the save is in flight', async () => {
		let resolve: (value: { contactId: string }) => void = () => {}
		createContact.mockReturnValue(
			new Promise<{ contactId: string }>((r) => {
				resolve = r
			}),
		)
		render(<ContactModal contact={null} onClose={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'grace@x.com' } })
		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
		expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
		resolve({ contactId: 'contact-new' })
	})
})

describe('ContactModal — edit', () => {
	it('prefills the form and sends the full field set on save', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={existing} onClose={onClose} />)

		expect(screen.getByText('Edit contact')).toBeInTheDocument()
		expect(
			(screen.getByLabelText('First name' as string, { selector: 'input' }) as HTMLInputElement).value,
		).toBe('Ada')
		expect((screen.getByLabelText('Email 1') as HTMLInputElement).value).toBe('ada@x.com')

		fireEvent.change(screen.getByLabelText('First name' as string, { selector: 'input' }), {
			target: { value: 'Ada B.' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

		// onClose fires only after updateContact resolves; wait for it, which implies
		// the update call already happened.
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true, 'contact-1'))
		expect(updateContact.mock.calls[0][0].data).toMatchObject({
			contactId: 'contact-1',
			givenName: 'Ada B.',
			emails: [{ email: 'ada@x.com', type: 'work' }],
		})
	})
})

describe('ContactModal — dismissal', () => {
	it('closes without changes from the close button', () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it('closes without changes from the cancel button', () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it('closes without changes when the dialog requests to close (Escape/backdrop)', () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledWith(false)
	})
})
