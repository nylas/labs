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
