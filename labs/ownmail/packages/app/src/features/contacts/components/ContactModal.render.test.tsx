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

vi.mock('#server/fns', () => ({ createContact, updateContact }))

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
	it('blocks a blank contact with focused, actionable identity guidance', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		const notes = screen.getByLabelText('Notes', { selector: 'textarea' })
		fireEvent.change(notes, { target: { value: 'Keep this draft value' } })

		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Add a name, company, or email.')
		const firstName = screen.getByLabelText('First name', { selector: 'input' })
		expect(firstName).toHaveFocus()
		expect(firstName).toHaveAttribute('aria-invalid', 'true')
		expect(firstName).toHaveAttribute('aria-describedby', 'contact-form-validation')
		expect(notes).toHaveValue('Keep this draft value')
		expect(createContact).not.toHaveBeenCalled()
		expect(onClose).not.toHaveBeenCalled()

		fireEvent.change(firstName, { target: { value: 'Grace' } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		expect(firstName).not.toHaveAttribute('aria-invalid')
	})

	it('blocks malformed email, clears stale guidance, and submits after correction', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		const email = screen.getByLabelText('Email 1')
		fireEvent.change(email, { target: { value: 'not-an-email' } })

		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

		expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.')
		expect(email).toHaveFocus()
		expect(email).toHaveAttribute('aria-invalid', 'true')
		expect(email).toHaveAttribute('aria-describedby', 'contact-form-validation')
		expect(createContact).not.toHaveBeenCalled()

		fireEvent.change(email, { target: { value: 'grace@x.com' } })
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		expect(email).not.toHaveAttribute('aria-invalid')
		fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true, 'contact-new'))
		expect(createContact).toHaveBeenCalledTimes(1)
	})

	it('creates a contact from the entered fields and reports the new id', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)

		expect(screen.getByRole('dialog', { name: 'New contact' })).toBeInTheDocument()
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

	it('provides touch-friendly, focus-visible contact controls', () => {
		render(<ContactModal contact={null} onClose={vi.fn()} />)
		const expectFocusFallback = (control: HTMLElement) =>
			expect(control).toHaveClass(
				'focus-visible:ring-[3px]',
				'focus-visible:ring-ring',
				'forced-colors:focus-visible:outline-2',
				'forced-colors:focus-visible:outline-offset-2',
				'forced-colors:focus-visible:outline-solid',
			)

		expect(screen.getByLabelText('First name', { selector: 'input' })).toHaveClass('h-11')
		expect(screen.getByLabelText('Email 1')).toHaveClass('h-11')
		const emailType = screen.getByLabelText('Email 1 type')
		expect(emailType).toHaveClass('h-11')
		expectFocusFallback(emailType)
		const close = screen.getByRole('button', { name: 'Close' })
		expect(close).toHaveClass('h-11', 'w-11')
		expectFocusFallback(close)
		const addEmail = screen.getByRole('button', { name: 'Add email' })
		expect(addEmail).toHaveClass('min-h-11')
		expectFocusFallback(addEmail)
		const removeEmail = screen.getByRole('button', { name: 'Remove email 1' })
		expect(removeEmail).toHaveClass('h-11', 'w-11')
		expectFocusFallback(removeEmail)
		const cancel = screen.getByRole('button', { name: 'Cancel' })
		expect(cancel).toHaveClass('min-h-11')
		expectFocusFallback(cancel)
		const addContact = screen.getByRole('button', { name: 'Add contact' })
		expect(addContact).toHaveClass('min-h-11')
		expectFocusFallback(addContact)
		fireEvent.click(screen.getByRole('button', { name: 'Add phone' }))
		expect(screen.getByLabelText('Phone 1')).toHaveClass('h-11')
		const phoneType = screen.getByLabelText('Phone 1 type')
		expect(phoneType).toHaveClass('h-11')
		expectFocusFallback(phoneType)
		const removePhone = screen.getByRole('button', { name: 'Remove phone 1' })
		expect(removePhone).toHaveClass('h-11', 'w-11')
		expectFocusFallback(removePhone)

		fireEvent.change(screen.getByLabelText('First name', { selector: 'input' }), {
			target: { value: 'Ada' },
		})
		fireEvent.click(cancel)
		const continueEditing = screen.getByRole('button', { name: 'Continue editing' })
		const discardChanges = screen.getByRole('button', { name: 'Discard changes' })
		for (const action of [continueEditing, discardChanges]) {
			expect(action).toHaveClass('min-h-11')
			expectFocusFallback(action)
		}
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
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'grace@x.com' } })
		const save = screen.getByRole('button', { name: 'Add contact' })
		fireEvent.click(save)
		fireEvent.click(save)
		expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled()
		expect(screen.getByLabelText('Email 1')).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Add phone' })).toBeDisabled()
		fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
		expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
		expect(createContact).toHaveBeenCalledTimes(1)
		expect(onClose).not.toHaveBeenCalled()
		resolve({ contactId: 'contact-new' })
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
	})
})

describe('ContactModal — edit', () => {
	it('blocks an invalid edited email without calling update', async () => {
		render(<ContactModal contact={existing} onClose={vi.fn()} />)
		const email = screen.getByLabelText('Email 1')
		fireEvent.change(email, { target: { value: 'ada-at-example' } })

		fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

		expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.')
		expect(email).toHaveFocus()
		expect(updateContact).not.toHaveBeenCalled()
	})

	it('prefills the form and sends the full field set on save', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={existing} onClose={onClose} />)

		expect(screen.getByRole('dialog', { name: 'Edit contact' })).toBeInTheDocument()
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

	it('asks before dirty Cancel, preserves values, and restores editor focus', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		const firstName = screen.getByLabelText('First name', { selector: 'input' })
		fireEvent.change(firstName, { target: { value: 'Grace' } })

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

		expect(onClose).not.toHaveBeenCalled()
		expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toHaveAccessibleDescription(
			'Your contact changes have not been saved. You can keep editing or discard them.',
		)
		expect(screen.getByRole('button', { name: 'Continue editing' })).toHaveFocus()
		fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }))
		expect(await screen.findByLabelText('First name', { selector: 'input' })).toHaveValue('Grace')
		await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
		expect(onClose).not.toHaveBeenCalled()
	})

	it('discards dirty create changes once without saving', () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.change(screen.getByLabelText('Notes', { selector: 'textarea' }), {
			target: { value: 'private draft note' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))

		const discard = screen.getByRole('button', { name: 'Discard changes' })
		fireEvent.click(discard)
		fireEvent.click(discard)

		expect(onClose).toHaveBeenCalledTimes(1)
		expect(onClose).toHaveBeenCalledWith(false)
		expect(createContact).not.toHaveBeenCalled()
	})

	it('restores focus to the close button that invoked confirmation', async () => {
		render(<ContactModal contact={null} onClose={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('First name', { selector: 'input' }), {
			target: { value: 'Grace' },
		})
		const close = screen.getByRole('button', { name: 'Close' })
		fireEvent.click(close)
		fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }))

		await waitFor(() => expect(close).toHaveFocus())
	})

	it('intercepts Escape for dirty edit forms and lets Escape cancel the confirmation', async () => {
		const onClose = vi.fn()
		render(<ContactModal contact={existing} onClose={onClose} />)
		fireEvent.change(screen.getByLabelText('First name', { selector: 'input' }), {
			target: { value: 'Ada B.' },
		})
		const firstName = screen.getByLabelText('First name', { selector: 'input' })
		firstName.focus()

		fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
		expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument()
		fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

		expect(await screen.findByLabelText('First name', { selector: 'input' })).toHaveValue('Ada B.')
		await waitFor(() => expect(firstName).toHaveFocus())
		expect(onClose).not.toHaveBeenCalled()
		expect(updateContact).not.toHaveBeenCalled()
	})

	it('intercepts backdrop dismissal for dirty forms', () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.change(screen.getByLabelText('First name', { selector: 'input' }), {
			target: { value: 'Grace' },
		})
		const firstName = screen.getByLabelText('First name', { selector: 'input' })
		firstName.focus()
		const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
		expect(overlay).not.toBeNull()

		fireEvent.click(overlay as HTMLElement)

		expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()

		const confirmationOverlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
		fireEvent.click(confirmationOverlay as HTMLElement)
		expect(screen.getByLabelText('First name', { selector: 'input' })).toHaveValue('Grace')
		expect(firstName).toHaveFocus()
		expect(onClose).not.toHaveBeenCalled()
	})

	it('gives repeatable-field controls 44px touch targets', () => {
		render(<ContactModal contact={null} onClose={vi.fn()} />)
		expect(screen.getByRole('button', { name: 'Add email' })).toHaveClass('min-h-11')
		expect(screen.getByLabelText('Email 1 type')).toHaveClass('h-11')
		expect(screen.getByRole('button', { name: 'Remove email 1' })).toHaveClass('h-11', 'w-11')
	})

	it('treats whitespace and transient blank rows as pristine', () => {
		const onClose = vi.fn()
		render(<ContactModal contact={null} onClose={onClose} />)
		fireEvent.change(screen.getByLabelText('First name', { selector: 'input' }), {
			target: { value: '   ' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Add phone' }))
		fireEvent.change(screen.getByLabelText('Phone 1 type'), { target: { value: 'work' } })
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

		expect(onClose).toHaveBeenCalledWith(false)
		expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
	})
})
