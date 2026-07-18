import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const exchangeCodeForToken = vi.fn()
vi.mock('@nylas-labs/cli-kit/v3', () => ({
	exchangeCodeForToken: (args: any) => exchangeCodeForToken(args),
}))

const platform = vi.fn()
vi.mock('../server/platform.js', () => ({ platform: () => platform() }))

const consumePkce = vi.fn()
const addVerifiedSessionAccount = vi.fn()
const clearPkceCookie = vi.fn()
vi.mock('../server/session.js', () => ({
	consumePkce: (r: any, s: string) => consumePkce(r, s),
	addVerifiedSessionAccount: (request: Request, grantId: string, email: string) =>
		addVerifiedSessionAccount(request, grantId, email),
	clearPkceCookie: () => clearPkceCookie(),
}))

import { Route } from './auth.callback.js'

const GET = Route.options.server.handlers.GET
let consoleError: ReturnType<typeof vi.spyOn>

function callbackRequest(query: string) {
	return new Request(`https://ownmail.local/auth/callback${query}`)
}

beforeEach(() => {
	vi.clearAllMocks()
	consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	platform.mockResolvedValue({
		env: {
			NYLAS_REGION: 'us',
			NYLAS_API_KEY: 'secret',
			NYLAS_CLIENT_ID: 'client',
			INBOX_EMAIL: 'fallback@ownmail.com',
		},
	})
	clearPkceCookie.mockReturnValue('ownmail_pkce=; Max-Age=0')
})

afterEach(() => {
	consoleError.mockRestore()
})

describe('/auth/callback', () => {
	it('does not reflect a hostile provider error verbatim', async () => {
		const response = await GET({ request: callbackRequest('?error=%3Cscript%3E%26%22%27') })

		expect(response.status).toBe(401)
		const body = await response.text()
		expect(body).toContain('We couldn’t complete your sign-in. Please try again.')
		expect(body).not.toContain('&lt;script&gt;&amp;&quot;&#39;')
		expect(body).not.toContain('<script>')
		expect(consumePkce).not.toHaveBeenCalled()
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_pkce=; Max-Age=0')
	})

	it('explains when the provider denies the sign-in', async () => {
		const response = await GET({ request: callbackRequest('?error=access_denied') })

		expect(await response.text()).toContain('Sign-in was cancelled or denied')
	})

	it('rejects a callback missing the authorization code', async () => {
		const response = await GET({ request: callbackRequest('?state=abc') })

		expect(response.status).toBe(401)
		expect(await response.text()).toContain('We couldn’t complete your sign-in. Please try again.')
	})

	it('rejects a callback whose PKCE state cannot be found (expired attempt)', async () => {
		consumePkce.mockResolvedValue(null)

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(consumePkce).toHaveBeenCalledWith(expect.any(Request), 'xyz')
		expect(response.status).toBe(401)
		expect(await response.text()).toContain('expired login attempt')
	})

	it('exchanges the code for a grant and establishes the session, clearing the PKCE cookie', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-1', email: 'ada@ownmail.com' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=abc')

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('/')
		expect(addVerifiedSessionAccount).toHaveBeenCalledWith(expect.any(Request), 'grant-1', 'ada@ownmail.com')
		expect(response.headers.getSetCookie()).toEqual(['ownmail_session=abc', 'ownmail_pkce=; Max-Age=0'])
		expect(exchangeCodeForToken).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'abc',
				codeVerifier: 'v',
				clientSecret: 'secret',
				userAgent: 'ownmail',
			}),
		)
	})

	it('falls back to the configured inbox email and clears the browser-bound attempt in KV mode', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-2' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=def')

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(addVerifiedSessionAccount).toHaveBeenCalledWith(
			expect.any(Request),
			'grant-2',
			'fallback@ownmail.com',
		)
		expect(response.headers.getSetCookie()).toEqual(['ownmail_session=def', 'ownmail_pkce=; Max-Age=0'])
	})

	it('never surfaces token-exchange internals when the exchange fails', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(new Error('boom: client_secret leaked'))

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(401)
		const body = await response.text()
		expect(body).toContain('We couldn’t complete your sign-in. Please try again.')
		expect(body).not.toContain('client_secret')
		expect(consoleError).not.toHaveBeenCalled()
	})

	it.each([
		400, 401, 403,
	])('gives an actionable message for rejected inbox credentials (%i)', async (status) => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(
			Object.assign(new Error('provider response included a secret'), {
				name: 'NylasApiError',
				status,
			}),
		)

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(await response.text()).toContain('That email or password was not accepted')
	})

	it('asks the user to wait after a rate-limited token exchange', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }))

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(await response.text()).toContain('Too many sign-in attempts')
	})

	it('uses a safe retry message for unexpected token exchange failures', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(null)

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(await response.text()).toContain('We couldn’t complete your sign-in. Please try again.')
	})

	it('logs only safe Nylas exchange identifiers for operators', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(
			Object.assign(new Error('provider response included a secret'), {
				name: 'NylasApiError',
				status: 400,
				requestId: 'req-123',
				type: 'api.invalid_request',
			}),
		)

		await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(consoleError).toHaveBeenCalledWith('OwnMail token exchange failed', {
			status: 400,
			requestId: 'req-123',
			type: 'api.invalid_request',
		})
	})

	it('omits malformed Nylas exchange identifiers from operator logs', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: 'ownmail_pkce=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(
			Object.assign(new Error('provider response included a secret'), {
				name: 'NylasApiError',
				status: '400',
				requestId: 123,
				type: null,
			}),
		)

		await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(consoleError).toHaveBeenCalledWith('OwnMail token exchange failed', {})
	})
})
