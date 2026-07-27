import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OWNMAIL_VERSION } from '#shared/lib/version'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const exchangeCodeForToken = vi.fn()
vi.mock('@nylas-labs/cli-kit/v3', () => ({
	exchangeCodeForToken: (args: any) => exchangeCodeForToken(args),
}))

const platform = vi.fn()
vi.mock('#server/platform', () => ({ platform: () => platform() }))

const consumeConnectState = vi.fn()
const addVerifiedSessionAccount = vi.fn()
const getSession = vi.fn()
vi.mock('#server/session', () => ({
	consumeConnectState: (r: any, s: string) => consumeConnectState(r, s),
	addVerifiedSessionAccount: (request: Request, grantId: string, email: string) =>
		addVerifiedSessionAccount(request, grantId, email),
	getSession: (request: Request) => getSession(request),
}))

import { escapeHtml, Route } from './auth.callback.js'

const GET = Route.options.server.handlers.GET
let consoleError: ReturnType<typeof vi.spyOn>

function callbackRequest(query: string, cookie?: string) {
	return new Request(
		`https://ownmail.local/auth/callback${query}`,
		cookie ? { headers: { cookie } } : undefined,
	)
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
	getSession.mockResolvedValue(null)
})

afterEach(() => {
	consoleError.mockRestore()
})

describe('/auth/callback', () => {
	it('escapes every HTML metacharacter used in failure responses', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
	})

	it('does not reflect a hostile provider error verbatim', async () => {
		const response = await GET({ request: callbackRequest('?error=%3Cscript%3E%26%22%27') })

		expect(response.status).toBe(401)
		const body = await response.text()
		expect(body).toContain('We couldn’t complete your sign-in. Please try again.')
		expect(body).not.toContain('&lt;script&gt;&amp;&quot;&#39;')
		expect(body).not.toContain('<script>')
		expect(consumeConnectState).not.toHaveBeenCalled()
		expect(response.headers.get('Set-Cookie')).toBeNull()
	})

	it('explains when the provider denies the sign-in', async () => {
		const response = await GET({ request: callbackRequest('?error=access_denied') })

		expect(await response.text()).toContain('Sign-in was cancelled or denied')
	})

	it('consumes and clears a matching pending attempt when the provider denies it', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		const request = callbackRequest(
			'?error=access_denied&state=state-a',
			'ownmail_session=session-a; ownmail_connect_state=attempt-a',
		)

		const response = await GET({ request })

		expect(consumeConnectState).toHaveBeenCalledWith(request, 'state-a')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_connect_state=; Max-Age=0')
		expect(exchangeCodeForToken).not.toHaveBeenCalled()
	})

	it('leaves a pending attempt intact for unrelated provider errors and a later valid callback', async () => {
		const cookie = 'ownmail_session=session-a; ownmail_connect_state=attempt-a'
		consumeConnectState.mockResolvedValueOnce(null).mockResolvedValueOnce({
			clearCookie: 'ownmail_connect_state=; Max-Age=0',
		})
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-a', email: 'ada@ownmail.com' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=authenticated')

		const unrelated = await GET({
			request: callbackRequest('?error=access_denied&state=state-b', cookie),
		})
		const valid = await GET({ request: callbackRequest('?code=abc&state=state-a', cookie) })

		expect(unrelated.headers.get('Set-Cookie')).toBeNull()
		expect(valid.status).toBe(302)
		expect(consumeConnectState).toHaveBeenNthCalledWith(1, expect.any(Request), 'state-b')
		expect(consumeConnectState).toHaveBeenNthCalledWith(2, expect.any(Request), 'state-a')
	})

	it('leaves a pending attempt intact for a malformed callback and a later valid callback', async () => {
		const cookie = 'ownmail_session=session-a; ownmail_connect_state=attempt-a'
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-a', email: 'ada@ownmail.com' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=authenticated')

		const malformed = await GET({ request: callbackRequest('?error=access_denied', cookie) })
		const valid = await GET({ request: callbackRequest('?code=abc&state=state-a', cookie) })

		expect(malformed.headers.get('Set-Cookie')).toBeNull()
		expect(valid.status).toBe(302)
		expect(consumeConnectState).toHaveBeenCalledOnce()
		expect(consumeConnectState).toHaveBeenCalledWith(expect.any(Request), 'state-a')
	})

	it('rejects a callback missing the authorization code', async () => {
		const response = await GET({ request: callbackRequest('?state=abc') })

		expect(response.status).toBe(401)
		expect(await response.text()).toContain('We couldn’t complete your sign-in. Please try again.')
		expect(response.headers.get('Set-Cookie')).toBeNull()
	})

	it('rejects a callback whose Connect state cannot be found (expired attempt)', async () => {
		consumeConnectState.mockResolvedValue(null)

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(consumeConnectState).toHaveBeenCalledWith(expect.any(Request), 'xyz')
		expect(response.status).toBe(401)
		expect(await response.text()).toContain('expired login attempt')
		expect(response.headers.get('Set-Cookie')).toBeNull()
	})

	it('exchanges the Connect code server-side and establishes the session, clearing state', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-1', email: 'ada@ownmail.com' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=abc')

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('/')
		expect(addVerifiedSessionAccount).toHaveBeenCalledWith(expect.any(Request), 'grant-1', 'ada@ownmail.com')
		expect(response.headers.getSetCookie()).toEqual([
			'ownmail_session=abc',
			'ownmail_connect_state=; Max-Age=0',
		])
		expect(exchangeCodeForToken).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'abc',
				clientSecret: 'secret',
				userAgent: `ownmail/${OWNMAIL_VERSION}`,
			}),
		)
		expect(exchangeCodeForToken.mock.calls[0]?.[0]).not.toHaveProperty('codeVerifier')
	})

	it('falls back to the configured inbox email only on initial login', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-2' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=def')

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(addVerifiedSessionAccount).toHaveBeenCalledWith(
			expect.any(Request),
			'grant-2',
			'fallback@ownmail.com',
		)
		expect(response.headers.getSetCookie()).toEqual([
			'ownmail_session=def',
			'ownmail_connect_state=; Max-Age=0',
		])
	})

	it('fails closed on initial login when neither the token nor configuration supplies an email', async () => {
		platform.mockResolvedValue({
			env: {
				NYLAS_REGION: 'us',
				NYLAS_API_KEY: 'secret',
				NYLAS_CLIENT_ID: 'client',
			},
		})
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-2' })

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(401)
		expect(addVerifiedSessionAccount).not.toHaveBeenCalled()
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_connect_state=; Max-Age=0')
	})

	it('fails closed when an added inbox has no verified email instead of reusing the primary email', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-primary', email: 'primary@ownmail.com' })
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-added' })

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(401)
		expect(await response.text()).toContain('couldn’t verify the email address for that inbox')
		expect(addVerifiedSessionAccount).not.toHaveBeenCalled()
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_connect_state=; Max-Age=0')
	})

	it('uses the token-verified email when adding an inbox to an existing session', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-primary', email: 'primary@ownmail.com' })
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockResolvedValue({ grant_id: 'grant-added', email: ' added@ownmail.com ' })
		addVerifiedSessionAccount.mockResolvedValue('ownmail_session=next')

		await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(addVerifiedSessionAccount).toHaveBeenCalledWith(
			expect.any(Request),
			'grant-added',
			'added@ownmail.com',
		)
	})

	it('never surfaces token-exchange internals when the exchange fails', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(new Error('boom: client_secret leaked'))

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(response.status).toBe(401)
		const body = await response.text()
		expect(body).toContain('We couldn’t complete your sign-in. Please try again.')
		expect(body).not.toContain('client_secret')
		expect(consoleError).not.toHaveBeenCalled()
	})

	it.each([400, 401, 403])(
		'gives an actionable message for rejected inbox credentials (%i)',
		async (status) => {
			consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
			exchangeCodeForToken.mockRejectedValue(
				Object.assign(new Error('provider response included a secret'), {
					name: 'NylasApiError',
					status,
				}),
			)

			const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

			expect(await response.text()).toContain('That email or password was not accepted')
		},
	)

	it('asks the user to wait after a rate-limited token exchange', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }))

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(await response.text()).toContain('Too many sign-in attempts')
	})

	it('uses a safe retry message for unexpected token exchange failures', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
		exchangeCodeForToken.mockRejectedValue(null)

		const response = await GET({ request: callbackRequest('?code=abc&state=xyz') })

		expect(await response.text()).toContain('We couldn’t complete your sign-in. Please try again.')
	})

	it('logs only safe Nylas exchange identifiers for operators', async () => {
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
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
		consumeConnectState.mockResolvedValue({ clearCookie: 'ownmail_connect_state=; Max-Age=0' })
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
