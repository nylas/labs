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
	it('prompts the user to pick a contact and links to create, carrying the search', () => {
		renderRoute({ q: 'ada' })
		expect(screen.getByText('Select a contact to see their details.')).toBeInTheDocument()
		const link = screen.getByRole('link', { name: /New contact/ })
		expect(link).toHaveAttribute('data-to', '/contacts/new')
		expect(link).toHaveAttribute('data-search', JSON.stringify({ q: 'ada' }))
	})

	it('links to create with no search when none is active', () => {
		renderRoute()
		expect(screen.getByRole('link', { name: /New contact/ })).toHaveAttribute(
			'data-search',
			JSON.stringify({}),
		)
	})

	it('validates the q search param', () => {
		expect(Route.options.validateSearch({ q: 'ada' })).toEqual({ q: 'ada' })
		expect(Route.options.validateSearch({ q: '' })).toEqual({})
	})
})
