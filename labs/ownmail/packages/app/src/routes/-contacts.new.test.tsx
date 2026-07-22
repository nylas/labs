// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ navigate: vi.fn(), invalidate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useNavigate: () => h.navigate,
	useRouter: () => ({ invalidate: h.invalidate }),
}))

vi.mock('#features/contacts/components/ContactModal', () => ({
	ContactModal: (props: any) => (
		<div data-testid="contact-modal" data-contact={String(props.contact)}>
			<button type="button" onClick={() => props.onClose(true, 'contact-new')}>
				saved
			</button>
			<button type="button" onClick={() => props.onClose(true)}>
				saved-no-id
			</button>
			<button type="button" onClick={() => props.onClose(false)}>
				cancelled
			</button>
		</div>
	),
}))

import { Route } from './contacts.new.js'

function renderRoute(search: { q?: string } = {}) {
	Route.useSearch = vi.fn(() => search)
	const Page = Route.options.component
	return render(<Page />)
}

beforeEach(() => {
	h.navigate.mockReset()
	h.invalidate.mockReset()
})

afterEach(cleanup)

describe('NewContactRoute', () => {
	it('renders the create modal (no contact)', () => {
		renderRoute()
		expect(screen.getByTestId('contact-modal')).toHaveAttribute('data-contact', 'null')
	})

	it('on save, opens the newly created contact, preserving search', () => {
		renderRoute({ q: 'ada' })
		fireEvent.click(screen.getByText('saved'))
		expect(h.invalidate).not.toHaveBeenCalled()
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/contacts/$contactId',
			params: { contactId: 'contact-new' },
			search: { q: 'ada' },
		})
	})

	it('on save without an id, returns to the list', () => {
		renderRoute()
		fireEvent.click(screen.getByText('saved-no-id'))
		expect(h.invalidate).not.toHaveBeenCalled()
		expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: {} })
	})

	it('on cancel, returns to the list without refreshing', () => {
		renderRoute()
		fireEvent.click(screen.getByText('cancelled'))
		expect(h.invalidate).not.toHaveBeenCalled()
		expect(h.navigate).toHaveBeenCalledWith({ to: '/contacts', search: {} })
	})

	it('validates the q search param', () => {
		expect(Route.options.validateSearch({ q: 'ada' })).toEqual({ q: 'ada' })
		expect(Route.options.validateSearch({ q: '' })).toEqual({})
	})
})
