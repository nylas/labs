import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const createSession = vi.fn()
vi.mock('../server/session.js', () => ({
	consumePkce: (r: any, s: string) => consumePkce(r, s),
	createSession: (grantId: string, email: string) => createSession(grantId, email),
}))

import { Route } from './auth.callback.js'

const GET = Route.options.server.handlers.GET

function callbackRequest(query: string) {
	return new Request(`https://ownmail.local/auth/callback${query}`)
}

beforeEach(() => {
	vi.clearAllMocks()
	platform.mockResolvedValue({
		env: {
			NYLAS_REGION: 'us',
			NYLAS_API_KEY: 'secret',
			NYLAS_CLIENT_ID: 'client',
			INBOX_EMAIL: 'fallback@ownmail.com',
		},
	})
})

describe('/auth/callback', () => {
	it('renders an HTML-escaped error page without reflecting a hostile provider error verbatim', async () => {
		const response = await GET({ request: callbackRequest('?error=%3Cscript%3E%26%22%27') })

		expect(response.status).toBe(401)
		const body = await response.text()
		expect(body).toContain('&lt;script&gt;&amp;&quot;&#39;')
		expect(body).not.toContain('<script>')
		expect(consumePkce).not.toHaveBeenCalled()
	})

	it('rejects a callback missing the authorization code', async () => {
		const response = await GET({ request: callbackRequest('?state=abc') })

		expect(response.status).toBe(401)
		expect(await response.text()).toContain('missing code')
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
		createSession.mockResolvedValue('ownmail_session=abc')

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('/')
		expect(createSession).toHaveBeenCalledWith('grant-1', 'ada@ownmail.com')
		expect(response.headers.getSetCookie()).toEqual(['ownmail_session=abc', 'ownmail_pkce=; Max-Age=0'])
		expect(exchangeCodeForToken).toHaveBeenCalledWith(
			expect.objectContaining({ code: 'abc', codeVerifier: 'v', clientSecret: 'secret' }),
		)
	})

	it('falls back to the configured inbox email and skips a clear cookie in KV mode', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: null })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-2' })
		createSession.mockResolvedValue('ownmail_session=def')

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(createSession).toHaveBeenCalledWith('grant-2', 'fallback@ownmail.com')
		expect(response.headers.getSetCookie()).toEqual(['ownmail_session=def'])
	})

	it('never surfaces token-exchange internals when the exchange fails', async () => {
		consumePkce.mockResolvedValue({ verifier: 'v', clearCookie: null })
		exchangeCodeForToken.mockRejectedValue(new Error('boom: client_secret leaked'))

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(401)
		const body = await response.text()
		expect(body).toContain('sign-in failed')
		expect(body).not.toContain('client_secret')
	})
})
