// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const routerState = vi.hoisted(() => ({ isLoading: false, pathname: '/' }))

vi.mock('@tanstack/react-router', () => ({
	createRootRouteWithContext: () => (opts: any) => ({
		options: opts,
		useLoaderData: () => ({ preferences: null }),
	}),
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

const request = vi.hoisted(() => ({ cookie: '' }))
const setResponseHeader = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () =>
		new Request('http://ownmail.local/', { headers: request.cookie ? { cookie: request.cookie } : {} }),
	setResponseHeader,
}))

vi.mock('../styles.css?url', () => ({ default: '/assets/styles.css' }))
// The composer is exercised by its own suites; the root only has to mount it around the page.
vi.mock('#features/mail/components/ComposeProvider', () => ({
	ComposeProvider: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="compose-provider">{children}</div>
	),
}))

const platform = vi.fn()
vi.mock('#server/platform', () => ({ platform: () => platform() }))

import { encodePreferenceCookie, USER_PREFERENCES_COOKIE } from '#app/preferences/preference-cookie'
import { defaultUserPreferences } from '#app/preferences/user-preferences'
import { Route } from './__root.js'

/** The route announcer; the toast region beside it is a second, separate status region. */
function routeAnnouncer(): HTMLElement {
	return screen
		.getAllByRole('status')
		.find((region) => !region.classList.contains('toast-region')) as HTMLElement
}

afterEach(() => {
	request.cookie = ''
	routerState.isLoading = false
	routerState.pathname = '/'
	cleanup()
	vi.useRealTimers()
})

describe('root route', () => {
	it('gives the initial shell an accessible loading message', () => {
		const Pending = Route.options.pendingComponent
		render(<Pending />)
		expect(screen.getByRole('status')).toHaveTextContent('Opening your mailbox')
	})

	it('loads the validated deployment site name for document metadata', async () => {
		platform.mockResolvedValue({ env: { OWNMAIL_SITE_NAME: 'Acme Mail' } })
		expect(await Route.options.loader()).toEqual({ siteName: 'Acme Mail', preferences: null })
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

	it('loads this request’s cookie and keeps personalized HTML and server responses out of shared caches', async () => {
		platform.mockResolvedValue({ env: {} })
		const preferences = { ...defaultUserPreferences(), listDensity: 'compact' as const }
		request.cookie = `${USER_PREFERENCES_COOKIE}=${encodePreferenceCookie(preferences)}`
		expect(await Route.options.loader()).toMatchObject({ preferences })
		expect(setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
		expect(Route.options.headers()).toEqual({ 'Cache-Control': 'private, no-store' })
		request.cookie = ''
		expect(await Route.options.loader()).toMatchObject({ preferences: null })
	})

	it('uses the configured site name in document and installed-app titles', () => {
		const head = Route.options.head({ loaderData: { siteName: 'Acme Mail' } })
		expect(head.meta).toContainEqual({ title: 'Acme Mail — Mail & Calendar' })
		expect(head.meta).toContainEqual({ name: 'apple-mobile-web-app-title', content: 'Acme Mail' })
	})

	it('renders the html shell with the anti-flash theme bootstrap so dark mode applies before hydration', () => {
		const RootComponent = Route.options.shellComponent
		// React hoists the <html>/<head>/<body> shell onto the real document.
		render(
			<RootComponent>
				<div />
			</RootComponent>,
		)
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
		expect(routeAnnouncer()).toHaveTextContent('')

		routerState.isLoading = false
		rerender(<RootComponent />)
		expect(routeAnnouncer()).toHaveTextContent('Calendar loaded')

		routerState.pathname = '/contacts/abc'
		rerender(<RootComponent />)
		expect(routeAnnouncer()).toHaveTextContent('Contacts loaded')

		routerState.pathname = '/settings'
		rerender(<RootComponent />)
		expect(routeAnnouncer()).toHaveTextContent('Settings loaded')

		routerState.pathname = '/mail/f/inbox'
		rerender(<RootComponent />)
		expect(routeAnnouncer()).toHaveTextContent('Mail loaded')
	})

	it('does not repeat announcements when only search state changes', () => {
		const RootComponent = Route.options.component
		const { rerender } = render(<RootComponent />)
		routerState.pathname = '/contacts'
		rerender(<RootComponent />)
		expect(routeAnnouncer()).toHaveTextContent('Contacts loaded')

		rerender(<RootComponent />)
		expect(routeAnnouncer()).toHaveTextContent('Contacts loaded')
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
