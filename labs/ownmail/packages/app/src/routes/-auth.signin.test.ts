import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const platform = vi.fn()
const usingDevMocks = vi.fn()
vi.mock('#server/platform', () => ({
	platform: () => platform(),
	usingDevMocks: () => usingDevMocks(),
}))

const storeConnectState = vi.fn()
const createReferenceDevSessionCookie = vi.fn()
const getSession = vi.fn()
vi.mock('#server/session', () => ({
	storeConnectState: (request: Request, state: string) => storeConnectState(request, state),
	createReferenceDevSessionCookie: () => createReferenceDevSessionCookie(),
	getSession: (request: Request) => getSession(request),
}))

const requestAgentAccountCallback = vi.fn()
vi.mock('#server/agent-account-login', () => ({
	requestAgentAccountCallback: (input: unknown) => requestAgentAccountCallback(input),
}))

const signInAttemptIsRateLimited = vi.fn()
vi.mock('#server/sign-in-rate-limit', () => ({
	signInAttemptIsRateLimited: (email: string, ip: string) => signInAttemptIsRateLimited(email, ip),
	clientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? 'unknown',
}))

import { Route } from './auth.signin.js'

const POST = Route.options.server.handlers.POST

const GENERIC_FAILURE = '/login?error=1'
const RATE_LIMITED = '/login?error=rate'

function signInRequest(
	fields: Record<string, string> | string = {
		email: 'ada@ownmail.com',
		app_password: 'hunter2-app-password',
	},
	init: RequestInit = {},
): Request {
	const body = typeof fields === 'string' ? fields : new URLSearchParams(fields).toString()
	const { headers, ...rest } = init
	return new Request('https://ownmail.local/auth/signin', {
		method: 'POST',
		body,
		...rest,
		headers: {
			origin: 'https://ownmail.local',
			'content-type': 'application/x-www-form-urlencoded',
			...((headers as Record<string, string>) ?? {}),
		},
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	usingDevMocks.mockResolvedValue(false)
	getSession.mockResolvedValue(null)
	platform.mockResolvedValue({ env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'us' } })
	signInAttemptIsRateLimited.mockResolvedValue(false)
	requestAgentAccountCallback.mockResolvedValue('/auth/callback?code=uas-code-1&state=state-1')
	storeConnectState.mockResolvedValue('ownmail_connect_state=signed')
})

describe('/auth/signin', () => {
	it('hands valid credentials to the provider and sends the browser to this app’s own callback', async () => {
		const response = await POST({ request: signInRequest() })

		expect(response.status).toBe(303)
		expect(response.headers.get('Location')).toBe('/auth/callback?code=uas-code-1&state=state-1')
		// The unchanged callback route performs the exchange, so the single-use
		// nonce cookie must ride along on this very response.
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_connect_state=signed')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(requestAgentAccountCallback).toHaveBeenCalledWith(
			expect.objectContaining({
				email: 'ada@ownmail.com',
				appPassword: 'hunter2-app-password',
				redirectUri: 'https://ownmail.local/auth/callback',
				state: expect.any(String),
			}),
		)
	})

	it('signs the state it just issued, so a forged or replayed state fails at the callback', async () => {
		await POST({ request: signInRequest() })

		const issuedState = requestAgentAccountCallback.mock.calls[0][0].state
		expect(storeConnectState).toHaveBeenCalledWith(expect.any(Request), issuedState)
		expect(issuedState).toMatch(/^[0-9a-f-]{36}$/)
	})

	it('never places the password in the redirect the browser follows', async () => {
		const response = await POST({ request: signInRequest() })

		expect(response.headers.get('Location')).not.toContain('hunter2-app-password')
		expect(await response.text()).toBe('')
	})

	it('never binds state before the provider has accepted the credentials', async () => {
		requestAgentAccountCallback.mockResolvedValue(null)

		await POST({ request: signInRequest() })

		expect(storeConnectState).not.toHaveBeenCalled()
	})

	it('rejects a cross-origin credential post before touching the session or the provider', async () => {
		const response = await POST({
			request: signInRequest(undefined, { headers: { origin: 'https://attacker.example' } }),
		})

		expect(response.status).toBe(403)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
		expect(getSession).not.toHaveBeenCalled()
	})

	it('short-circuits to a dev session under local mocks without contacting the provider', async () => {
		usingDevMocks.mockResolvedValue(true)
		createReferenceDevSessionCookie.mockReturnValue('ownmail_session=authenticated')

		const response = await POST({ request: signInRequest() })

		expect(response.status).toBe(303)
		expect(response.headers.get('Location')).toBe('/')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_session=authenticated')
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
		expect(getSession).not.toHaveBeenCalled()
	})

	it('keeps a signed-in visitor on the add-mailbox form when adding another inbox fails', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1', email: 'ada@ownmail.com' })
		requestAgentAccountCallback.mockResolvedValue(null)

		const response = await POST({ request: signInRequest() })

		expect(response.headers.get('Location')).toBe('/login?error=1&add=1')
	})

	it('rate-limits per mailbox and per client address before any credential is checked', async () => {
		signInAttemptIsRateLimited.mockResolvedValue(true)

		const response = await POST({
			request: signInRequest(undefined, { headers: { 'cf-connecting-ip': '198.51.100.5' } }),
		})

		expect(signInAttemptIsRateLimited).toHaveBeenCalledWith('ada@ownmail.com', '198.51.100.5')
		expect(response.status).toBe(303)
		expect(response.headers.get('Location')).toBe(RATE_LIMITED)
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
	})

	/**
	 * A lockout is allowed its own (actionable) message precisely because it is
	 * decided by attempt counts alone — before any credential is checked — so it
	 * is identical for a real mailbox and one that has never existed.
	 */
	it('locks out identically whichever address is being guessed', async () => {
		signInAttemptIsRateLimited.mockResolvedValue(true)

		const known = await POST({ request: signInRequest() })
		const invented = await POST({
			request: signInRequest({ email: 'nobody@ownmail.com', app_password: 'hunter2-app-password' }),
		})

		expect(invented.status).toBe(known.status)
		expect(invented.headers.get('Location')).toBe(known.headers.get('Location'))
		expect(known.headers.get('Location')).toBe(RATE_LIMITED)
	})

	/**
	 * The point of the test: an attacker must not be able to tell an unknown
	 * mailbox from a wrong password, a provider outage, or a misconfigured
	 * deployment. If any of those ever gains its own message, this fails.
	 */
	it('answers every rejected credential with one byte-identical response', async () => {
		const responses: Response[] = []

		// Unknown mailbox, wrong password, provider outage, misconfiguration —
		// all of these reach the route as the same null from the provider call.
		requestAgentAccountCallback.mockResolvedValue(null)
		responses.push(
			await POST({ request: signInRequest({ email: 'ghost@ownmail.com', app_password: 'x'.repeat(20) }) }),
		)
		responses.push(
			await POST({ request: signInRequest({ email: 'ada@ownmail.com', app_password: 'wrong' }) }),
		)
		responses.push(await POST({ request: signInRequest({ email: 'not-an-email', app_password: 'x' }) }))
		responses.push(await POST({ request: signInRequest({ email: 'ada@ownmail.com' }) }))

		const shapes = await Promise.all(
			responses.map(async (response) => ({
				status: response.status,
				location: response.headers.get('Location'),
				cacheControl: response.headers.get('Cache-Control'),
				setCookie: response.headers.get('Set-Cookie'),
				body: await response.text(),
			})),
		)
		expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1)
		expect(shapes[0]).toEqual({
			status: 303,
			location: GENERIC_FAILURE,
			cacheControl: 'no-store',
			setCookie: null,
			body: '',
		})
	})

	it.each([
		{ label: 'a missing password', fields: { email: 'ada@ownmail.com', app_password: '' } },
		{ label: 'a missing email', fields: { email: '', app_password: 'hunter2-app-password' } },
		{ label: 'an address with no domain', fields: { email: 'ada@ownmail', app_password: 'hunter2' } },
		{ label: 'an oversized address', fields: { email: `${'a'.repeat(320)}@ownmail.com`, app_password: 'x' } },
		{
			label: 'duplicate credential fields',
			fields: 'email=ada@ownmail.com&email=eve@ownmail.com&app_password=x',
		},
		{ label: 'duplicate passwords', fields: 'email=ada@ownmail.com&app_password=a&app_password=b' },
		{ label: 'a control character in the password', fields: 'email=ada@ownmail.com&app_password=a%0Db' },
		{ label: 'an oversized password', fields: { email: 'ada@ownmail.com', app_password: 'x'.repeat(513) } },
	])('refuses $label without contacting the provider', async ({ fields }) => {
		const response = await POST({ request: signInRequest(fields as never) })

		expect(response.headers.get('Location')).toBe(GENERIC_FAILURE)
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
		expect(signInAttemptIsRateLimited).not.toHaveBeenCalled()
	})

	it.each([
		{ label: 'a non-form media type', init: { headers: { 'content-type': 'application/json' } } },
		{
			label: 'a lookalike media type',
			init: { headers: { 'content-type': 'application/x-www-form-urlencoded-evil' } },
		},
		{ label: 'an implausible declared length', init: { headers: { 'content-length': 'nope' } } },
		{ label: 'a declared length beyond the cap', init: { headers: { 'content-length': '2049' } } },
		{ label: 'a length that disagrees with the body', init: { headers: { 'content-length': '3' } } },
	])('refuses $label before parsing credentials', async ({ init }) => {
		const response = await POST({ request: signInRequest(undefined, init) })

		expect(response.headers.get('Location')).toBe(GENERIC_FAILURE)
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
	})

	it('refuses a credential post that declares no media type at all', async () => {
		const request = new Request('https://ownmail.local/auth/signin', {
			method: 'POST',
			headers: { origin: 'https://ownmail.local' },
			body: new TextEncoder().encode('email=ada@ownmail.com&app_password=x'),
		})

		expect(request.headers.get('content-type')).toBeNull()
		expect((await POST({ request })).headers.get('Location')).toBe(GENERIC_FAILURE)
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
	})

	it('refuses a body with no stream at all', async () => {
		const request = new Request('https://ownmail.local/auth/signin', {
			method: 'POST',
			headers: { origin: 'https://ownmail.local', 'content-type': 'application/x-www-form-urlencoded' },
		})

		expect((await POST({ request })).headers.get('Location')).toBe(GENERIC_FAILURE)
	})

	it('refuses an oversized streaming body without buffering it', async () => {
		const request = signInRequest(`email=ada@ownmail.com&app_password=${'x'.repeat(2100)}`)

		expect((await POST({ request })).headers.get('Location')).toBe(GENERIC_FAILURE)
	})

	it('refuses a body that is not valid UTF-8', async () => {
		const request = new Request('https://ownmail.local/auth/signin', {
			method: 'POST',
			headers: { origin: 'https://ownmail.local', 'content-type': 'application/x-www-form-urlencoded' },
			body: new Uint8Array([0xff]),
		})

		expect((await POST({ request })).headers.get('Location')).toBe(GENERIC_FAILURE)
	})

	it('fails closed when the body stream errors mid-read', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error('read failed'))
			},
		})
		const request = new Request('https://ownmail.local/auth/signin', {
			method: 'POST',
			headers: { origin: 'https://ownmail.local', 'content-type': 'application/x-www-form-urlencoded' },
			body,
			duplex: 'half',
		} as RequestInit)

		expect((await POST({ request })).headers.get('Location')).toBe(GENERIC_FAILURE)
		expect(requestAgentAccountCallback).not.toHaveBeenCalled()
	})
})
