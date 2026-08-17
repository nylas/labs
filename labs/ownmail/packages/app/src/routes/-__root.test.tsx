// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const routerState = vi.hoisted(() => ({ isLoading: false, pathname: '/' }))

vi.mock('@tanstack/react-router', () => ({
	createRootRouteWithContext: () => (opts: any) => ({ options: opts }),
	HeadContent: () => null,
	Outlet: () => null,
	Scripts: () => null,
	useRouterState: (options: {
		select: (state: { isLoading: boolean; location: { pathname: string } }) => unknown
	}) => options.select({ isLoading: routerState.isLoading, location: { pathname: routerState.pathname } }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({ handler: (fn: () => unknown) => fn }),
}))

vi.mock('../styles.css?url', () => ({ default: '/assets/styles.css' }))

const platform = vi.fn()
vi.mock('#server/platform', () => ({ platform: () => platform() }))

import { Route } from './__root.js'

afterEach(() => {
	routerState.isLoading = false
	routerState.pathname = '/'
	cleanup()
	vi.useRealTimers()
})

describe('root route', () => {
	it('loads the validated deployment site name for document metadata', async () => {
		platform.mockResolvedValue({ env: { OWNMAIL_SITE_NAME: 'Acme Mail' } })
		expect(await Route.options.loader()).toEqual({ siteName: 'Acme Mail' })
	})

	it('declares document metadata so every page ships consistent SEO and PWA head tags', () => {
		const head = Route.options.head()
		expect(head.meta).toContainEqual({ charSet: 'utf-8' })
		expect(head.meta).toContainEqual({ name: 'color-scheme', content: 'light dark' })
		expect(head.meta).toContainEqual({ name: 'mobile-web-app-capable', content: 'yes' })
		expect(head.links).toContainEqual({ rel: 'manifest', href: '/manifest.webmanifest' })
		// The stylesheet link resolves through the bundler's ?url import.
		expect(head.links.some((l: any) => l.rel === 'stylesheet')).toBe(true)
	})

	it('uses the configured site name in document and installed-app titles', () => {
		const head = Route.options.head({ loaderData: { siteName: 'Acme Mail' } })
		expect(head.meta).toContainEqual({ title: 'Acme Mail — Mail & Calendar' })
		expect(head.meta).toContainEqual({ name: 'apple-mobile-web-app-title', content: 'Acme Mail' })
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

	it('does not flash progress for a fast route navigation', () => {
		vi.useFakeTimers()
		routerState.isLoading = true
		const RootComponent = Route.options.component
		const { rerender } = render(<RootComponent />)

		expect(screen.queryByRole('progressbar', { name: 'Loading page' })).not.toBeInTheDocument()
		act(() => vi.advanceTimersByTime(100))
		routerState.isLoading = false
		rerender(<RootComponent />)
		act(() => vi.advanceTimersByTime(500))
		expect(screen.queryByRole('progressbar', { name: 'Loading page' })).not.toBeInTheDocument()
	})

	it('shows progress for slower navigation without a one-frame disappearance', () => {
		vi.useFakeTimers()
		routerState.isLoading = true
		const RootComponent = Route.options.component
		const { rerender } = render(<RootComponent />)

		act(() => vi.advanceTimersByTime(150))
		expect(screen.getByRole('progressbar', { name: 'Loading page' })).toBeInTheDocument()

		routerState.isLoading = false
		rerender(<RootComponent />)
		act(() => vi.advanceTimersByTime(299))
		expect(screen.getByRole('progressbar', { name: 'Loading page' })).toBeInTheDocument()
		act(() => vi.advanceTimersByTime(1))
		expect(screen.queryByRole('progressbar', { name: 'Loading page' })).not.toBeInTheDocument()
	})

	it('announces meaningful route changes after navigation settles', () => {
		const RootComponent = Route.options.component
		const { rerender } = render(<RootComponent />)

		routerState.isLoading = true
		routerState.pathname = '/calendar/week'
		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('')

		routerState.isLoading = false
		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('Calendar loaded')

		routerState.pathname = '/contacts/abc'
		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('Contacts loaded')

		routerState.pathname = '/settings'
		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('Settings loaded')

		routerState.pathname = '/mail/f/inbox'
		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('Mail loaded')
	})

	it('does not repeat announcements when only search state changes', () => {
		const RootComponent = Route.options.component
		const { rerender } = render(<RootComponent />)
		routerState.pathname = '/contacts'
		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('Contacts loaded')

		rerender(<RootComponent />)
		expect(screen.getByRole('status')).toHaveTextContent('Contacts loaded')
	})

	it('renders a not-found page with a route back home so bad URLs are recoverable, not a dead end', () => {
		const NotFound = Route.options.notFoundComponent
		const { getByText, getByRole } = render(<NotFound />)
		expect(getByText('Page not found')).toBeTruthy()
		// The recovery link points at the canonical mail home rather than a broken URL.
		const backToMail = getByRole('link', { name: 'Back to mail' })
		expect(backToMail.getAttribute('href')).toBe('/')
		expect(backToMail).toHaveClass(
			'min-h-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'forced-colors:focus-visible:outline-2',
			'forced-colors:focus-visible:outline-offset-2',
			'forced-colors:focus-visible:outline-solid',
		)
	})

	it('renders actionable recovery choices when a route fails', () => {
		const AppError = Route.options.errorComponent
		const { getByRole, getByText } = render(<AppError />)

		expect(getByText('We couldn’t load this page.')).toBeTruthy()
		expect(getByText('Check your connection and try again. If it persists, sign in again.')).toBeTruthy()
		const retry = getByRole('button', { name: 'Retry' })
		const signInAgain = getByRole('button', { name: 'Sign in again' })
		expect(signInAgain.closest('form')).toHaveAttribute('action', '/logout')
		expect(signInAgain.closest('form')).toHaveAttribute('method', 'post')
		for (const action of [retry, signInAgain]) {
			expect(action).toHaveClass(
				'min-h-11',
				'focus-visible:ring-[3px]',
				'focus-visible:ring-ring',
				'forced-colors:focus-visible:outline-2',
				'forced-colors:focus-visible:outline-offset-2',
				'forced-colors:focus-visible:outline-solid',
			)
		}
		expect(retry.parentElement).toHaveClass('flex-wrap', 'justify-center')
		expect(() => fireEvent.click(retry)).not.toThrow()
	})
})
