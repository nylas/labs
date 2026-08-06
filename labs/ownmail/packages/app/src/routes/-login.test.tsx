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

const getRequest = vi.fn(() => new Request('http://ownmail.local/login'))
vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () => getRequest(),
}))

const usingDevMocks = vi.fn()
const platform = vi.fn()
vi.mock('#server/platform', () => ({ platform: () => platform(), usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
const hasReferenceDevSessionCookie = vi.fn()
vi.mock('#server/session', () => ({
	getSession: (r: any) => getSession(r),
	hasReferenceDevSessionCookie: (r: any) => hasReferenceDevSessionCookie(r),
}))

vi.mock('#features/auth/components/LoginScreen', () => ({
	LoginScreen: (props: any) => (
		<div
			data-testid="login-screen"
			data-host={props.host}
			data-error={props.error ?? 'none'}
			data-adding={String(props.addingMailbox)}
			data-suggested={props.suggestedEmail}
		>
			{props.signInAction}
		</div>
	),
}))

import { Route } from './login.js'

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
	platform.mockResolvedValue({ env: {} })
	getRequest.mockReturnValue(new Request('http://ownmail.local/login'))
})

describe('login route loader', () => {
	it('shows the in-app sign-in form, addressed to this deployment’s own host', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		const state = await Route.options.loader()

		expect(state).toEqual({
			authenticated: false,
			signInAction: '/auth/signin',
			host: 'ownmail.local',
			error: null,
			addingMailbox: false,
			suggestedEmail: '',
		})
	})

	it('never stores the credential screen in a browser or shared cache', () => {
		expect(Route.options.headers()).toEqual({ 'Cache-Control': 'no-store' })
	})

	it('prefills only the deployment’s own configured inbox for a first sign-in', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)
		platform.mockResolvedValue({ env: { INBOX_EMAIL: ' ada@ownmail.com ' } })

		expect((await Route.options.loader()).suggestedEmail).toBe('ada@ownmail.com')
	})

	it('bounces an already-authenticated user to their mailbox rather than re-prompting login', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ email: 'a@b.com' })

		await expect(Route.options.loader()).rejects.toMatchObject({ to: '/' })
	})

	it('keeps serving the form to an authenticated user who is adding another mailbox', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ email: 'a@b.com' })
		getRequest.mockReturnValue(new Request('http://ownmail.local/login?add=1'))

		const state = await Route.options.loader()

		expect(state.addingMailbox).toBe(true)
		// Never hint at another mailbox's address while adding one.
		expect(state.suggestedEmail).toBe('')
	})

	it.each([
		{ label: 'a rejected credential', search: '?error=1', expected: 'invalid' },
		{ label: 'a lockout', search: '?error=rate', expected: 'rate-limit' },
	])('renders $label as its own state', async ({ search, expected }) => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)
		getRequest.mockReturnValue(new Request(`http://ownmail.local/login${search}`))

		expect((await Route.options.loader()).error).toBe(expected)
	})

	it('ignores an error value it did not issue, so a crafted link cannot dictate the copy', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)
		getRequest.mockReturnValue(new Request('http://ownmail.local/login?error=your-account-is-suspended'))

		expect((await Route.options.loader()).error).toBeNull()
	})

	it('falls back to the configured site name when the request carries no usable host', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)
		platform.mockResolvedValue({ env: { OWNMAIL_SITE_NAME: 'Faberon Mail' } })
		getRequest.mockReturnValue({ url: 'not-a-url' } as Request)

		expect((await Route.options.loader()).host).toBe('Faberon Mail')
	})

	it('reads the reference dev-session cookie to decide auth state under dev mocks', async () => {
		usingDevMocks.mockResolvedValue(true)
		hasReferenceDevSessionCookie.mockReturnValue(false)

		const state = await Route.options.loader()

		expect(state).toMatchObject({ authenticated: false, signInAction: '/auth/signin', suggestedEmail: '' })
		expect(getSession).not.toHaveBeenCalled()
	})

	it('redirects home when the dev-session cookie marks the developer as signed in', async () => {
		usingDevMocks.mockResolvedValue(true)
		hasReferenceDevSessionCookie.mockReturnValue(true)

		await expect(Route.options.loader()).rejects.toMatchObject({ to: '/' })
	})
})

describe('login route component', () => {
	it('hands the whole sign-in state to the screen', () => {
		const Login = Route.options.component
		Route.useLoaderData = () => ({
			signInAction: '/auth/signin',
			host: 'mail.faberonlabs.com',
			error: 'rate-limit',
			addingMailbox: true,
			suggestedEmail: 'ada@ownmail.com',
		})

		render(<Login />)

		const screenNode = screen.getByTestId('login-screen')
		expect(screenNode).toHaveTextContent('/auth/signin')
		expect(screenNode.dataset).toMatchObject({
			host: 'mail.faberonlabs.com',
			error: 'rate-limit',
			adding: 'true',
			suggested: 'ada@ownmail.com',
		})
	})
})
