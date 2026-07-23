import { describe, expect, it, vi } from 'vitest'
import { DpopKey } from './dpop.js'
import { GatewayClient, GatewayError } from './gateway.js'

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

describe('GatewayClient errors', () => {
	it('retains the request ID, HTTP status, and GraphQL errors from a failed response', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () =>
			Response.json(
				{
					errors: [
						{
							message: 'request rejected',
							extensions: { code: 'INVALID_SESSION', supportId: 'support-body-123' },
						},
					],
				},
				{ status: 401, headers: { 'x-request-id': 'req-header-123' } },
			),
		)
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
		)

		const error = await client
			.listApplications({ userToken: 'token' }, 'us', 'org')
			.catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(GatewayError)
		expect(error).toMatchObject({
			status: 401,
			requestId: 'req-header-123',
			errors: [expect.objectContaining({ message: 'request rejected' })],
		})
	})

	it('uses a GraphQL support ID when a successful HTTP response contains errors', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () =>
			Response.json({
				errors: [{ extensions: { code: 'RATE_LIMITED', supportId: 'support-graphql-123' } }],
			}),
		)
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.listApiKeys({ userToken: 'token' }, 'us', 'app')).rejects.toMatchObject({
			requestId: 'support-graphql-123',
		})
	})

	it('does not retain unstructured non-JSON response text', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () => new Response('internal upstream detail', { status: 502 }))
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.listApiKeys({ userToken: 'token' }, 'us', 'app')).rejects.toMatchObject({
			message: 'gateway V3_ApiKeys failed with 502',
			status: 502,
		})
	})

	it('retains a response-header request ID when a successful response is not JSON', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(
			async () =>
				new Response('not json', {
					status: 200,
					headers: { 'x-request-id': 'req-invalid-json-123' },
				}),
		)
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.listApiKeys({ userToken: 'token' }, 'us', 'app')).rejects.toMatchObject({
			message: 'gateway V3_ApiKeys returned invalid JSON',
			requestId: 'req-invalid-json-123',
			status: 200,
		})
	})

	it('throws a typed error when a successful response is not an object', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () => Response.json(null))
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.listApiKeys({ userToken: 'token' }, 'us', 'app')).rejects.toMatchObject({
			message: 'gateway V3_ApiKeys returned a malformed response',
			status: 200,
		})
	})

	it('retains a body support ID when a successful response has no data', async () => {
		const dpop = await DpopKey.generate()
		const fetchImpl = vi.fn(async () => Response.json({ supportId: 'support-no-data-123' }))
		const client = new GatewayClient(
			dpop,
			{ us: 'https://gateway.us.test/graphql', eu: 'https://gateway.eu.test/graphql' },
			fetchImpl as unknown as typeof fetch,
		)

		await expect(client.listApiKeys({ userToken: 'token' }, 'us', 'app')).rejects.toMatchObject({
			requestId: 'support-no-data-123',
			status: 200,
		})
	})
})
