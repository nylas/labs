import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl, exchangeCodeForToken, NylasV3Client } from './v3.js'

describe('Hosted auth URLs', () => {
	it('uses a custom API base URL for authorization requests', () => {
		const url = new URL(
			buildAuthorizeUrl({
				region: 'us',
				baseUrl: 'https://api-staging.us.nylas.com/',
				clientId: 'app-123',
				redirectUri: 'https://mail.example.com/auth/callback',
			}),
		)

		expect(url.origin).toBe('https://api-staging.us.nylas.com')
		expect(url.pathname).toBe('/v3/connect/auth')
		expect(url.searchParams.get('client_id')).toBe('app-123')
		expect(url.searchParams.get('response_type')).toBe('code')
	})
})

describe('Hosted auth token exchange', () => {
	it('posts the documented authorization_code body to a custom API base URL', async () => {
		let requestUrl = ''
		let requestBody: unknown = null
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestBody = JSON.parse(String(init?.body))
			return Response.json({ grant_id: 'grant-123', access_token: 'token' })
		}

		await exchangeCodeForToken(
			{
				region: 'us',
				baseUrl: 'https://api-staging.us.nylas.com',
				clientId: 'app-123',
				clientSecret: 'api-key-123',
				redirectUri: 'https://mail.example.com/auth/callback',
				code: 'code-123',
				codeVerifier: 'verifier-123',
			},
			fetchImpl,
		)

		expect(requestUrl).toBe('https://api-staging.us.nylas.com/v3/connect/token')
		expect(requestBody).toMatchObject({
			client_id: 'app-123',
			client_secret: 'api-key-123',
			grant_type: 'authorization_code',
			code: 'code-123',
			redirect_uri: 'https://mail.example.com/auth/callback',
			code_verifier: 'verifier-123',
		})
	})
})

describe('NylasV3Client', () => {
	it('uses a custom API base URL for requests', async () => {
		let requestUrl = ''
		const fetchImpl: typeof fetch = async (input) => {
			requestUrl = String(input)
			return Response.json({ data: [] })
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl, 'https://api-staging.us.nylas.com/')

		await client.listGrants()

		expect(requestUrl).toBe('https://api-staging.us.nylas.com/v3/grants')
	})

	it('creates a webhook when the list response has null data', async () => {
		const requests: string[] = []
		const fetchImpl: typeof fetch = async (input, init) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`)
			if (String(input).endsWith('/v3/webhooks') && init?.method === 'GET') {
				return Response.json({ request_id: 'req-list', data: null })
			}
			return Response.json({
				request_id: 'req-create',
				data: {
					id: 'webhook-123',
					callback_url: 'https://mail.example.com/api/webhooks/nylas',
					status: 'active',
				},
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const webhook = await client.ensureWebhook('https://mail.example.com/api/webhooks/nylas', [
			'message.created',
		])

		expect(webhook.id).toBe('webhook-123')
		expect(requests).toEqual([
			'GET https://api.us.nylas.com/v3/webhooks',
			'POST https://api.us.nylas.com/v3/webhooks',
		])
	})
})
