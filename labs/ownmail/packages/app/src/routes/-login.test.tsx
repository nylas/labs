// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	redirect: (o: any) => {
		throw Object.assign(new Error('REDIRECT'), { isRedirect: true, to: o?.to, options: o })
	},
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({ handler: (fn: any) => fn }),
}))

vi.mock('@tanstack/react-start/server', () => ({
	getRequest: vi.fn(() => new Request('http://ownmail.local/login')),
}))

const usingDevMocks = vi.fn()
const platform = vi.fn()
vi.mock('../server/platform.js', () => ({ platform: () => platform(), usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
const hasReferenceDevSessionCookie = vi.fn()
vi.mock('../server/session.js', () => ({
	getSession: (r: any) => getSession(r),
	hasReferenceDevSessionCookie: (r: any) => hasReferenceDevSessionCookie(r),
}))

vi.mock('../components/LoginScreen.js', () => ({
	LoginScreen: (props: any) => (
		<div data-testid="login-screen" data-site-name={props.siteName}>
			{props.signInHref}
		</div>
	),
}))

import { Route } from './login.js'

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
	platform.mockResolvedValue({ env: {} })
})

describe('login route loader', () => {
	it('shows the login screen with the hosted-auth href for a real anonymous visitor', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		const state = await Route.options.loader()

		expect(state).toEqual({ authenticated: false, signInHref: '/auth', siteName: 'ownmail' })
	})

	it('bounces an already-authenticated user to their mailbox rather than re-prompting login', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ email: 'a@b.com' })

		await expect(Route.options.loader()).rejects.toMatchObject({ to: '/' })
	})

	it('reads the reference dev-session cookie to decide auth state under dev mocks', async () => {
		usingDevMocks.mockResolvedValue(true)
		hasReferenceDevSessionCookie.mockReturnValue(false)

		const state = await Route.options.loader()

		expect(state).toEqual({ authenticated: false, signInHref: '/auth', siteName: 'ownmail' })
		expect(getSession).not.toHaveBeenCalled()
	})

	it('redirects home when the dev-session cookie marks the developer as signed in', async () => {
		usingDevMocks.mockResolvedValue(true)
		hasReferenceDevSessionCookie.mockReturnValue(true)

		await expect(Route.options.loader()).rejects.toMatchObject({ to: '/' })
	})
})

describe('login route component', () => {
	it('passes the resolved sign-in href through to the login screen', () => {
		Route.useLoaderData = vi.fn(() => ({ authenticated: false, signInHref: '/auth', siteName: 'Acme Mail' }))
		const Login = Route.options.component
		render(<Login />)
		expect(screen.getByTestId('login-screen').textContent).toBe('/auth')
		expect(screen.getByTestId('login-screen')).toHaveAttribute('data-site-name', 'Acme Mail')
	})
})
