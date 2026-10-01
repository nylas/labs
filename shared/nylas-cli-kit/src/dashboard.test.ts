import { describe, expect, it, vi } from 'vitest'
import {
	createOAuthPkcePair,
	DASHBOARD_SESSION_OAUTH_SCOPE,
	DashboardAccountClient,
	DashboardAccountError,
} from './dashboard.js'
import { DpopKey } from './dpop.js'

async function clientWithResponse(payload: unknown): Promise<DashboardAccountClient> {
	const dpop = await DpopKey.generate()
	const fetchImpl = vi.fn(
		async () => new Response(JSON.stringify(payload), { status: 200 }),
	) as unknown as typeof fetch
	return new DashboardAccountClient(dpop, 'https://dashboard-account.test', fetchImpl)
}

async function clientAndFetchWithResponse(payload: unknown): Promise<{
	client: DashboardAccountClient
	fetchImpl: ReturnType<typeof vi.fn>
}> {
	const dpop = await DpopKey.generate()
	const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))
	return {
		client: new DashboardAccountClient(
			dpop,
			'https://dashboard-account.test',
			fetchImpl as unknown as typeof fetch,
		),
		fetchImpl,
	}
}

describe('DashboardAccountClient email/password login', () => {
	it('attributes requests with a fixed User-Agent without changing auth headers', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () =>
			Response.json({
				request_id: 'req',
				success: true,
				data: { user: { publicId: 'user-public-id' }, organizations: [] },
			}),
		)
		const client = new DashboardAccountClient(
			dpop,
			'https://dashboard-account.test',
			fetchImpl as unknown as typeof fetch,
			'ownmail',
		)

		await client.currentSession({ userToken: 'user-token' })

		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(init.headers).toMatchObject({
			'User-Agent': 'ownmail',
			Authorization: 'Bearer user-token',
			DPoP: expect.any(String),
		})
	})

	it('logs in with email/password and validates the token response', async () => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({
			request_id: 'req-password',
			success: true,
			data: {
				userToken: 'user-token',
				orgToken: 'org-token',
				user: { publicId: 'user-public-id', emailAddress: 'user@example.test' },
				organizations: [{ publicId: 'org-public-id', name: 'Acme' }],
			},
		})

		await expect(
			client.loginWithPassword({
				email: 'user@example.test',
				password: 'correct horse battery staple',
				orgPublicId: 'org-public-id',
			}),
		).resolves.toMatchObject({
			status: 'complete',
			userToken: 'user-token',
			orgToken: 'org-token',
			user: { publicId: 'user-public-id' },
		})

		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
		expect(JSON.parse(String(init.body))).toEqual({
			email: 'user@example.test',
			password: 'correct horse battery staple',
			orgPublicId: 'org-public-id',
		})
	})

	it('normalizes an MFA challenge without retaining factor details', async () => {
		const client = await clientWithResponse({
			request_id: 'req-mfa',
			success: true,
			data: {
				user: { publicId: 'user-public-id' },
				organizations: [{ publicId: 'org-public-id' }],
				totpFactor: { factorSid: 'sensitive-factor-id' },
			},
		})

		await expect(
			client.loginWithPassword({ email: 'user@example.test', password: 'password' }),
		).resolves.toEqual({
			status: 'mfa_required',
			user: { publicId: 'user-public-id' },
			organizations: [{ publicId: 'org-public-id' }],
		})
	})

	it('completes MFA login and sends only the required fields', async () => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({
			request_id: 'req-mfa-complete',
			success: true,
			data: {
				userToken: 'user-token',
				orgToken: 'org-token',
				user: { publicId: 'user-public-id' },
				organizations: [],
			},
		})

		await expect(
			client.completeMfaLogin({
				userPublicId: 'user-public-id',
				code: '123456',
				orgPublicId: 'org-public-id',
			}),
		).resolves.toMatchObject({ userToken: 'user-token', orgToken: 'org-token' })

		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://dashboard-account.test/auth/cli/login/mfa')
		expect(JSON.parse(String(init.body))).toEqual({
			userPublicId: 'user-public-id',
			code: '123456',
			orgPublicId: 'org-public-id',
		})
	})

	it('rejects malformed MFA challenges', async () => {
		const client = await clientWithResponse({
			request_id: 'req-bad-mfa',
			success: true,
			data: {
				user: { publicId: 'user-public-id' },
				organizations: [],
				totpFactor: 'unexpected',
			},
		})

		await expect(
			client.loginWithPassword({ email: 'user@example.test', password: 'password' }),
		).rejects.toThrow('malformed response')
	})
})

describe('DashboardAccountClient SSO', () => {
	it('unwraps and validates the SSO start envelope', async () => {
		const client = await clientWithResponse({
			request_id: 'req-1',
			success: true,
			data: {
				flowId: 'flow-1',
				verificationUri: 'https://dashboard.test/verify',
				verificationUriComplete: 'https://dashboard.test/verify?user_code=ABCD',
				userCode: 'ABCD',
				expiresIn: 600,
				interval: 5,
			},
		})

		await expect(client.ssoStart({ loginType: 'google_SSO', mode: 'login' })).resolves.toMatchObject({
			flowId: 'flow-1',
			verificationUri: 'https://dashboard.test/verify',
			verificationUriComplete: 'https://dashboard.test/verify?user_code=ABCD',
			userCode: 'ABCD',
			expiresIn: 600,
			interval: 5,
		})
	})

	it('starts Enterprise SAML login with a normalized work email', async () => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({
			request_id: 'req-saml',
			success: true,
			data: {
				flowId: 'flow-saml',
				verificationUri: 'https://dashboard.test/pages/cli-saml',
				verificationUriComplete: 'https://dashboard.test/pages/cli-saml?code=ABCD2345',
				userCode: 'ABCD2345',
				expiresIn: 600,
				interval: 5,
			},
		})

		await client.ssoStart({
			loginType: 'saml_SSO',
			mode: 'login',
			email: ' User@Acme.com ',
		})

		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(JSON.parse(String(init.body))).toEqual({
			loginType: 'saml_SSO',
			mode: 'login',
			email: 'user@acme.com',
		})
	})

	it.each([
		{
			name: 'missing SAML email',
			input: { loginType: 'saml_SSO', mode: 'login' },
			message: 'valid work email',
		},
		{
			name: 'malformed SAML email',
			input: { loginType: 'saml_SSO', mode: 'login', email: 'not-an-email' },
			message: 'valid work email',
		},
		{
			name: 'control characters in SAML email',
			input: { loginType: 'saml_SSO', mode: 'login', email: 'user\u0000@acme.com' },
			message: 'valid work email',
		},
		{
			name: 'SAML registration',
			input: { loginType: 'saml_SSO', mode: 'register', email: 'user@acme.com' },
			message: 'sign-in only',
		},
		{
			name: 'email supplied to social SSO',
			input: { loginType: 'google_SSO', mode: 'login', email: 'user@acme.com' },
			message: 'only be supplied',
		},
		{
			name: 'unsupported SSO provider',
			input: { loginType: 'oidc_SSO', mode: 'login' },
			message: 'Unsupported dashboard SSO login type',
		},
		{
			name: 'unsupported SSO mode',
			input: { loginType: 'google_SSO', mode: 'impersonate' },
			message: 'Unsupported dashboard SSO mode',
		},
	])('rejects $name before making a request', async ({ input, message }) => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({})

		await expect(client.ssoStart(input as never)).rejects.toThrow(message)
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('unwraps and validates the SSO poll envelope', async () => {
		const client = await clientWithResponse({
			request_id: 'req-2',
			success: true,
			data: { status: 'authorization_pending', retryAfter: 3 },
		})

		await expect(client.ssoPoll({ flowId: 'flow-1' })).resolves.toEqual({
			status: 'authorization_pending',
			retryAfter: 3,
		})
	})

	it('rejects malformed SSO start responses before UI code uses them', async () => {
		const client = await clientWithResponse({
			request_id: 'req-3',
			success: true,
			data: {
				flowId: 'flow-1',
				userCode: 'ABCD',
				expiresIn: 600,
				interval: 5,
			},
		})

		await expect(client.ssoStart({ loginType: 'google_SSO', mode: 'login' })).rejects.toThrow(
			'malformed response',
		)
	})

	it('rejects non-TLS browser URLs except for loopback development', async () => {
		const insecureClient = await clientWithResponse({
			request_id: 'req-insecure-url',
			success: true,
			data: {
				flowId: 'flow-1',
				verificationUri: 'http://login.example.test/device',
				userCode: 'ABCD',
				expiresIn: 600,
				interval: 5,
			},
		})
		const loopbackClient = await clientWithResponse({
			request_id: 'req-loopback-url',
			success: true,
			data: {
				flowId: 'flow-2',
				verificationUri: 'http://localhost:3001/pages/cli-saml',
				userCode: 'ABCD2345',
				expiresIn: 600,
				interval: 5,
			},
		})

		await expect(insecureClient.ssoStart({ loginType: 'google_SSO', mode: 'login' })).rejects.toThrow(
			'malformed response',
		)
		await expect(
			loopbackClient.ssoStart({
				loginType: 'saml_SSO',
				mode: 'login',
				email: 'user@acme.com',
			}),
		).resolves.toMatchObject({ flowId: 'flow-2' })
	})

	it.each([
		{
			name: 'terminal controls in a browser URL',
			overrides: { verificationUri: 'https://dashboard.test/device\u001B]0;owned\u0007' },
		},
		{
			name: 'Unicode formatting controls in a browser URL',
			overrides: { verificationUri: 'https://dashboard.test/device\u202Etxt.exe' },
		},
		{
			name: 'credentials in a browser URL',
			overrides: { verificationUri: 'https://user:secret@dashboard.test/device' },
		},
		{
			name: 'terminal controls in the browser code',
			overrides: { userCode: 'ABCD\u001B[2J' },
		},
		{
			name: 'an excessive expiry',
			overrides: { expiresIn: 86_400 },
		},
		{
			name: 'an excessive polling interval',
			overrides: { interval: 3_600 },
		},
	])('rejects $name before the CLI displays or uses it', async ({ overrides }) => {
		const client = await clientWithResponse({
			request_id: 'req-unsafe-display',
			success: true,
			data: {
				flowId: 'flow-1',
				verificationUri: 'https://dashboard.test/device',
				userCode: 'ABCD-2345',
				expiresIn: 600,
				interval: 5,
				...overrides,
			},
		})

		await expect(client.ssoStart({ loginType: 'google_SSO', mode: 'login' })).rejects.toThrow(
			'malformed response',
		)
	})

	it('canonicalizes a safe browser URL before returning it to display code', async () => {
		const client = await clientWithResponse({
			request_id: 'req-canonical-url',
			success: true,
			data: {
				flowId: 'flow-1',
				verificationUri: 'https://dashboard.test/a path',
				userCode: 'ABCD-2345',
				expiresIn: 600,
				interval: 5,
			},
		})

		await expect(client.ssoStart({ loginType: 'google_SSO', mode: 'login' })).resolves.toMatchObject({
			verificationUri: 'https://dashboard.test/a%20path',
		})
	})
})

describe('DashboardAccountClient sessions', () => {
	it('unwraps current session relations from the dashboard-account response shape', async () => {
		const client = await clientWithResponse({
			request_id: 'req-4',
			success: true,
			data: {
				user: {
					id: 'user-id',
					publicId: 'user-public-id',
					emailAddress: 'user@example.test',
					firstName: 'Ada',
					lastName: 'Lovelace',
				},
				currentOrg: 'org-public-id',
				relations: [
					{
						orgId: 'org-id',
						orgPublicId: 'org-public-id',
						orgRelationPublicId: 'rel-id',
						orgName: 'Acme',
						orgRegion: 'us',
						role: 'admin',
						billing: { status: 'enabled' },
					},
				],
				claims: {},
				preferences: null,
			},
		})

		await expect(client.currentSession({ userToken: 'user-token' })).resolves.toMatchObject({
			user: {
				publicId: 'user-public-id',
				emailAddress: 'user@example.test',
				firstName: 'Ada',
				lastName: 'Lovelace',
			},
			organization: {
				publicId: 'org-public-id',
				name: 'Acme',
				region: 'us',
				role: 'admin',
			},
			organizations: [
				{
					publicId: 'org-public-id',
					name: 'Acme',
					region: 'us',
					role: 'admin',
				},
			],
		})
	})

	it('unwraps switch-org responses without requiring a user token in the payload', async () => {
		const client = await clientWithResponse({
			request_id: 'req-5',
			success: true,
			data: {
				orgToken: 'org-token',
				orgSessionId: 'org-session-id',
				org: {
					publicId: 'org-public-id',
					name: 'Acme',
				},
				previousOrgSessionRevoked: true,
			},
		})

		await expect(client.switchOrg({ userToken: 'user-token' }, 'org-public-id')).resolves.toEqual({
			orgToken: 'org-token',
			orgSessionId: 'org-session-id',
			org: {
				publicId: 'org-public-id',
				name: 'Acme',
			},
			previousOrgSessionRevoked: true,
		})
	})
})

describe('DashboardAccountClient errors', () => {
	it('retains a validated response request ID on HTTP failures', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () =>
			Response.json(
				{
					request_id: 'req-body-123',
					success: false,
					error: { message: 'sensitive upstream detail' },
				},
				{ status: 403, headers: { 'x-request-id': 'req-header-123' } },
			),
		)
		const client = new DashboardAccountClient(
			dpop,
			'https://dashboard-account.test',
			fetchImpl as unknown as typeof fetch,
		)

		const error = await client.currentSession({ userToken: 'user-token' }).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(DashboardAccountError)
		expect(error).toMatchObject({ status: 403, requestId: 'req-header-123' })
	})

	it('retains an envelope request ID when the success response is malformed', async () => {
		const client = await clientWithResponse({
			request_id: 'req-malformed-123',
			success: false,
			data: null,
		})

		await expect(client.currentSession({ userToken: 'user-token' })).rejects.toMatchObject({
			status: 200,
			requestId: 'req-malformed-123',
		})
	})

	it('retains a header request ID when a successful response is not JSON', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(
			async () =>
				new Response('not json', {
					status: 200,
					headers: { 'x-request-id': 'req-invalid-json-123' },
				}),
		)
		const client = new DashboardAccountClient(
			dpop,
			'https://dashboard-account.test',
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.currentSession({ userToken: 'user-token' })).rejects.toMatchObject({
			status: 200,
			requestId: 'req-invalid-json-123',
		})
	})
})

describe('DashboardAccountClient OAuth sign-in', () => {
	const exchanged = {
		userToken: 'user-token',
		orgToken: 'org-token',
		user: { publicId: 'user-public-id' },
		orgPublicId: 'org-public-id',
		expiresAt: '2026-10-01T00:15:00.000Z',
	}

	it('derives the PKCE challenge as the S256 hash of a fresh verifier', async () => {
		const first = await createOAuthPkcePair()
		const second = await createOAuthPkcePair()
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.codeVerifier))

		// The server recomputes this hash; any other derivation fails every sign-in.
		expect(first.codeChallenge).toBe(Buffer.from(digest).toString('base64url'))
		expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(second.codeVerifier).not.toBe(first.codeVerifier)
	})

	it('asks for a dashboard session with PKCE, and names the sign-up region only when given', async () => {
		const client = await clientWithResponse({})
		const input = {
			clientId: 'client-id',
			redirectUri: 'http://127.0.0.1:5123/callback',
			state: 'state-value',
			codeChallenge: 'challenge',
		}

		const url = new URL(client.oauthAuthorizeUrl({ ...input, region: 'eu' }))

		expect(`${url.origin}${url.pathname}`).toBe('https://dashboard-account.test/oauth/authorize')
		// Without dashboard.session the exchange refuses the token.
		expect(DASHBOARD_SESSION_OAUTH_SCOPE.split(' ')).toContain('dashboard.session')
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: 'code',
			client_id: 'client-id',
			redirect_uri: 'http://127.0.0.1:5123/callback',
			scope: DASHBOARD_SESSION_OAUTH_SCOPE,
			state: 'state-value',
			code_challenge: 'challenge',
			code_challenge_method: 'S256',
			region: 'eu',
		})
		expect(new URL(client.oauthAuthorizeUrl(input)).searchParams.has('region')).toBe(false)
	})

	it('redeems an authorization code as a form-encoded public client with no credential', async () => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({
			access_token: 'access',
			token_type: 'Bearer',
			expires_in: 900,
			refresh_token: 'refresh',
		})

		await expect(
			client.oauthToken({
				clientId: 'client-id',
				code: 'code',
				redirectUri: 'http://127.0.0.1:5123/callback',
				codeVerifier: 'verifier',
			}),
		).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' })

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe('https://dashboard-account.test/oauth/token')
		expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
		expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
			grant_type: 'authorization_code',
			client_id: 'client-id',
			code: 'code',
			redirect_uri: 'http://127.0.0.1:5123/callback',
			code_verifier: 'verifier',
		})
	})

	it('rotates a refresh token and tolerates an answer without a new one', async () => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({ access_token: 'access-2' })

		await expect(client.oauthRefresh({ clientId: 'client-id', refreshToken: 'refresh' })).resolves.toEqual({
			accessToken: 'access-2',
		})

		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
			grant_type: 'refresh_token',
			client_id: 'client-id',
			refresh_token: 'refresh',
		})
	})

	it('surfaces a refused token request with the OAuth error body', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
		const client = new DashboardAccountClient(
			dpop,
			'https://dashboard-account.test',
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.oauthRefresh({ clientId: 'client-id', refreshToken: 'spent' })).rejects.toMatchObject(
			{
				name: 'DashboardAccountError',
				status: 400,
				body: { error: 'invalid_grant' },
			},
		)
	})

	it.each([null, {}, { access_token: '' }])('rejects a malformed token response %j', async (payload) => {
		const client = await clientWithResponse(payload)

		await expect(client.oauthRefresh({ clientId: 'client-id', refreshToken: 'refresh' })).rejects.toThrow(
			/malformed response/,
		)
	})

	it('exchanges an access token for a DPoP-bound session without sending it as a bearer', async () => {
		const { client, fetchImpl } = await clientAndFetchWithResponse({
			request_id: 'req',
			success: true,
			data: exchanged,
		})

		await expect(client.oauthExchange('access')).resolves.toEqual({
			...exchanged,
			expiresAt: Date.parse(exchanged.expiresAt),
		})

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe('https://dashboard-account.test/auth/cli/oauth/exchange')
		expect(JSON.parse(init.body as string)).toEqual({ accessToken: 'access' })
		expect(init.headers).toMatchObject({ DPoP: expect.any(String) })
		expect(init.headers).not.toHaveProperty('Authorization')
	})

	it.each([null, { ...exchanged, orgPublicId: undefined }, { ...exchanged, expiresAt: 'soon' }])(
		'rejects a malformed exchange response %j',
		async (data) => {
			const client = await clientWithResponse({ request_id: 'req', success: true, data })

			await expect(client.oauthExchange('access')).rejects.toThrow(/malformed response/)
		},
	)
})
