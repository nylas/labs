import { describe, expect, it, vi } from 'vitest'
import { DpopKey } from './dpop.js'
import { GatewayClient } from './gateway.js'

describe('GatewayClient usage attribution', () => {
	it('adds the configured User-Agent alongside authorization and DPoP', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () => Response.json({ data: { applications: { applications: [] } } }))
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
			'ownmail',
		)

		await client.listApplications({ userToken: 'user-token', orgToken: 'org-token' }, 'us', 'org-public-id')

		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(init.headers).toMatchObject({
			'User-Agent': 'ownmail',
			Authorization: 'Bearer user-token',
			'X-Nylas-Org': 'org-token',
			DPoP: expect.any(String),
		})
	})
})
