import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentAccountCode, requestAgentAccountCallback } from './agent-account-login.js'
import type { AppEnv } from './platform.js'

const env = {
	NYLAS_CLIENT_ID: ' client-123 ',
	NYLAS_REGION: 'us',
	NYLAS_API_KEY: 'never-sent-on-this-call',
	SESSION_SECRET: 'secret',
	APP_NAME: 'ownmail',
	INBOX_EMAIL: 'ada@ownmail.com',
	TEMPLATE_VERSION: '1',
} as AppEnv

const input = {
	env,
	email: 'ada@ownmail.com',
	appPassword: 'correct horse battery staple',
	redirectUri: 'https://ownmail.local/auth/callback',
	state: 'state-1',
}

/** The documented-by-source UAS body: Go field names, no JSON tags. */
function uasSuccessBody(overrides: Record<string, unknown> = {}) {
	return {
		BaseURL: 'https://ownmail.local/auth/callback?code=uas-code-1&state=state-1',
		Success: true,
		GrantID: 'grant-1',
		State: 'state-1',
		Provider: 'nylas',
		Email: 'ada@ownmail.com',
		UASCode: 'uas-code-1',
		IsOauthV2: true,
		...overrides,
	}
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('requestAgentAccountCallback', () => {
	it('posts credentials as JSON to the UAS connect login endpoint and returns this app’s own callback path', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(uasSuccessBody()))

		const callbackPath = await requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)

		expect(callbackPath).toBe('/auth/callback?code=uas-code-1&state=state-1')
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe('https://api.us.nylas.com/v3/connect/login/nylas')
		expect(init.method).toBe('POST')
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
		// A redirect would mean this is not the JSON contract; never follow one with credentials
		// attached. It must also be a mode workerd accepts — these tests run under node, which
		// tolerates `error`, while workerd rejects it at Request construction and broke every
		// sign-in. Only `follow` and `manual` exist there, and `follow` would send the password on.
		expect(init.redirect).toBe('manual')
		expect(JSON.parse(init.body as string)).toEqual({
			public_application_id: 'client-123',
			email: 'ada@ownmail.com',
			app_password: 'correct horse battery staple',
			redirect_uri: 'https://ownmail.local/auth/callback',
			state: 'state-1',
		})
	})

	it('sends the redirect_uri byte-identically to the one the token exchange will replay, and no client secret', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(uasSuccessBody()))

		await requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)

		const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
		expect(body.redirect_uri).toBe(input.redirectUri)
		// The hosted-flow login-session id is not ours to send, and the API key stays server-side.
		expect(Object.keys(body)).not.toContain('id')
		expect(JSON.stringify(body)).not.toContain('never-sent-on-this-call')
	})

	it('honours an explicit API base url and region override', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(uasSuccessBody()))

		await requestAgentAccountCallback(
			{ ...input, env: { ...env, NYLAS_REGION: 'eu', NYLAS_API_BASE_URL: 'https://uas.test/' } as AppEnv },
			fetchImpl as unknown as typeof fetch,
		)

		expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
			'https://uas.test/v3/connect/login/nylas',
		)
	})

	it('never calls the provider when the deployment has no client id', async () => {
		const fetchImpl = vi.fn()

		const result = await requestAgentAccountCallback(
			{ ...input, env: { ...env, NYLAS_CLIENT_ID: '  ' } as AppEnv },
			fetchImpl as unknown as typeof fetch,
		)

		expect(result).toBeNull()
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it.each([
		{ label: 'rejected credentials', response: () => jsonResponse({ error: { message: 'x' } }, 400) },
		{ label: 'an unreadable body', response: () => new Response('<html>', { status: 200 }) },
		{ label: 'a failed response', response: () => jsonResponse(uasSuccessBody({ Success: false })) },
	])('returns null for $label', async ({ response }) => {
		const fetchImpl = vi.fn(async () => response())

		expect(await requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)).toBeNull()
	})

	it('returns null when the provider is unreachable and logs nothing about the attempt', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('connect ECONNREFUSED 10.0.0.1:443')
		})

		expect(await requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)).toBeNull()
		for (const call of (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
			expect(JSON.stringify(call)).not.toContain('correct horse battery staple')
		}
	})

	it('refuses a redirect instead of replaying the credentials at its target', async () => {
		const fetchImpl = vi.fn(
			async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/login' } }),
		)

		expect(await requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)).toBeNull()
		// The 3xx comes back unfollowed under `manual`; nothing may chase it.
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})

	it('gives up on a provider that never answers instead of hanging the sign-in', async () => {
		vi.useFakeTimers()
		const fetchImpl = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
				}),
		)

		const pending = requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)
		await vi.advanceTimersByTimeAsync(15_000)

		expect(await pending).toBeNull()
		vi.useRealTimers()
	})

	it('uses the runtime’s own fetch when the caller supplies none', async () => {
		const globalFetch = vi.fn(async () => jsonResponse(uasSuccessBody()))
		vi.stubGlobal('fetch', globalFetch)

		expect(await requestAgentAccountCallback(input)).toBe('/auth/callback?code=uas-code-1&state=state-1')
		expect(globalFetch).toHaveBeenCalledTimes(1)
		vi.unstubAllGlobals()
	})

	it.each([
		{ label: 'the app password', needle: 'correct horse battery staple' },
		{ label: 'the UAS code', needle: 'uas-code-1' },
		{ label: 'the grant id', needle: 'grant-1' },
	])('never logs $label when the provider rejects the attempt', async ({ needle }) => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ error: { message: 'Invalid credentials provided', request_id: 'req-1' } }, 400),
		)

		await requestAgentAccountCallback(input, fetchImpl as unknown as typeof fetch)

		const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls)
		expect(logged).not.toContain(needle)
		expect(logged).not.toContain('request_id')
	})
})

describe('agentAccountCode contract', () => {
	it('reads the authorization code from the PascalCase UAS body', () => {
		expect(agentAccountCode(uasSuccessBody(), 'state-1')).toBe('uas-code-1')
	})

	it.each([
		{ label: 'snake_case keys', body: { success: true, uas_code: 'uas-code-1', state: 'state-1' } },
		{ label: 'camelCase keys', body: { success: true, uasCode: 'uas-code-1', state: 'state-1' } },
		{ label: 'a nested envelope', body: { data: uasSuccessBody() } },
	])('fails loudly rather than silently accepting $label', ({ body }) => {
		expect(agentAccountCode(body, 'state-1')).toBeNull()
	})

	it('rejects a body whose state is not the one this request issued', () => {
		expect(agentAccountCode(uasSuccessBody({ State: 'someone-elses-state' }), 'state-1')).toBeNull()
	})

	it.each([
		{ label: 'a missing code', body: uasSuccessBody({ UASCode: undefined }) },
		{ label: 'an empty code', body: uasSuccessBody({ UASCode: '' }) },
		{ label: 'a non-string code', body: uasSuccessBody({ UASCode: 42 }) },
		{ label: 'a non-object body', body: 'ok' },
		{ label: 'an array body', body: [uasSuccessBody()] },
		{ label: 'a null body', body: null },
	])('rejects $label', ({ body }) => {
		expect(agentAccountCode(body, 'state-1')).toBeNull()
	})
})
