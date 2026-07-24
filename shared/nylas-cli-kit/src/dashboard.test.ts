import { describe, expect, it, vi } from 'vitest'
import { DashboardAccountClient, DashboardAccountError } from './dashboard.js'
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
