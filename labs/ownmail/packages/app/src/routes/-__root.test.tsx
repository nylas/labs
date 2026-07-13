// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createRootRoute: (opts: any) => ({ options: opts }),
	HeadContent: () => null,
	Outlet: () => null,
	Scripts: () => null,
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}))

vi.mock('../styles.css?url', () => ({ default: '/assets/styles.css' }))

import { Route } from './__root.js'

afterEach(cleanup)

describe('root route', () => {
	it('declares document metadata so every page ships consistent SEO and PWA head tags', () => {
		const head = Route.options.head()
		expect(head.meta).toContainEqual({ charSet: 'utf-8' })
		expect(head.meta).toContainEqual({ name: 'color-scheme', content: 'light dark' })
		expect(head.links).toContainEqual({ rel: 'manifest', href: '/manifest.webmanifest' })
		// The stylesheet link resolves through the bundler's ?url import.
		expect(head.links.some((l: any) => l.rel === 'stylesheet')).toBe(true)
	})

	it('renders the html shell with the anti-flash theme bootstrap so dark mode applies before hydration', () => {
		const RootComponent = Route.options.component
		// React hoists the <html>/<head>/<body> shell onto the real document.
		render(<RootComponent />)
		const script = document.head.querySelector('script')
		expect(script?.innerHTML).toContain("localStorage.getItem('theme')")
		// Both theme-color metas ship so the browser chrome matches light and dark.
		expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(2)
	})

	it('renders a not-found page with a route back home so bad URLs are recoverable, not a dead end', () => {
		const NotFound = Route.options.notFoundComponent
		const { getByText, getByRole } = render(<NotFound />)
		expect(getByText('Page not found')).toBeTruthy()
		// The recovery link points at the canonical mail home rather than a broken URL.
		expect(getByRole('link', { name: 'Back to mail' }).getAttribute('href')).toBe('/')
	})
})
