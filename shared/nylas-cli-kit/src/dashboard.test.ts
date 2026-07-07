import { describe, expect, it, vi } from 'vitest'
import { DashboardAccountClient } from './dashboard.js'
import { DpopKey } from './dpop.js'

async function clientWithResponse(payload: unknown): Promise<DashboardAccountClient> {
	const dpop = await DpopKey.generate()
	const fetchImpl = vi.fn(
		async () => new Response(JSON.stringify(payload), { status: 200 }),
	) as unknown as typeof fetch
	return new DashboardAccountClient(dpop, 'https://dashboard-account.test', fetchImpl)
}

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
