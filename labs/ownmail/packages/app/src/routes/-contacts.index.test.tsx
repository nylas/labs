// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	Link: ({ children, to, search, ...rest }: any) => (
		<a href={typeof to === 'string' ? to : '#'} data-to={to} data-search={JSON.stringify(search)} {...rest}>
			{children}
		</a>
	),
}))

import { Route } from './contacts.index.js'

function renderRoute(search: { q?: string } = {}) {
	Route.useSearch = vi.fn(() => search)
	const Page = Route.options.component
	return render(<Page />)
}

afterEach(cleanup)

describe('ContactsIndex', () => {
	it('prompts the user to pick a contact and points to the one create action in the list', () => {
		renderRoute({ q: 'ada' })
		expect(
			screen.getByText('Select a contact to see their details, or add one with New contact.'),
		).toBeInTheDocument()
		// "New contact" lives once, at the top of the contact list; a second copy
		// here would be a duplicate CTA (design.md "CTA voice").
		expect(screen.queryByRole('link')).toBeNull()
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('validates the q search param', () => {
		expect(Route.options.validateSearch({ q: 'ada' })).toEqual({ q: 'ada' })
		expect(Route.options.validateSearch({ q: '' })).toEqual({})
	})
})
