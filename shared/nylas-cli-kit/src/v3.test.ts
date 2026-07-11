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

	it('updates an agent account app password on the grant settings', async () => {
		let requestUrl = ''
		let requestMethod = ''
		let requestBody: unknown = null
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestMethod = init?.method ?? ''
			requestBody = JSON.parse(String(init?.body))
			return Response.json({ data: { id: 'grant-123', provider: 'nylas' } })
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await client.updateGrant('grant-123', {
			settings: { email: 'contact@example.com', app_password: 'New-password-123456' },
		})

		expect(requestUrl).toBe('https://api.us.nylas.com/v3/grants/grant-123')
		expect(requestMethod).toBe('PATCH')
		expect(requestBody).toEqual({
			settings: { email: 'contact@example.com', app_password: 'New-password-123456' },
		})
	})

	it('creates a webhook when the list response has null data', async () => {
		const requests: string[] = []
		let createBody: unknown = null
		const fetchImpl: typeof fetch = async (input, init) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`)
			if (String(input).endsWith('/v3/webhooks') && init?.method === 'GET') {
				return Response.json({ request_id: 'req-list', data: null })
			}
			createBody = JSON.parse(String(init?.body))
			return Response.json({
				request_id: 'req-create',
				data: {
					id: 'webhook-123',
					webhook_url: 'https://mail.example.com/api/webhooks/nylas',
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
		expect(createBody).toEqual({
			trigger_types: ['message.created'],
			webhook_url: 'https://mail.example.com/api/webhooks/nylas',
			description: 'ownmail realtime',
		})
	})

	it('reuses existing webhooks from either response URL field', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json({
				request_id: 'req-list',
				data: [
					{
						id: 'webhook-current',
						webhook_url: 'https://mail.example.com/api/webhooks/nylas',
						status: 'active',
					},
					{
						id: 'webhook-legacy',
						callback_url: 'https://legacy.example.com/api/webhooks/nylas',
						status: 'active',
					},
				],
			})
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.ensureWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created']),
		).resolves.toMatchObject({ id: 'webhook-current' })
		await expect(
			client.ensureWebhook('https://legacy.example.com/api/webhooks/nylas', ['message.created']),
		).resolves.toMatchObject({ id: 'webhook-legacy' })
	})

	it('reads a draft directly by id', async () => {
		let requestUrl = ''
		let requestMethod = ''
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestMethod = init?.method ?? 'GET'
			return Response.json({
				request_id: 'req-draft',
				data: {
					id: 'draft#123',
					grant_id: 'grant-123',
					subject: 'Direct lookup',
				},
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const draft = await client.forGrant('grant-123').getDraft('draft#123')

		expect(requestMethod).toBe('GET')
		expect(requestUrl).toBe('https://api.us.nylas.com/v3/grants/grant-123/drafts/draft%23123')
		expect(draft.data.subject).toBe('Direct lookup')
	})

	it('downloads attachments as a raw response', async () => {
		let requestUrl = ''
		const fetchImpl: typeof fetch = async (input) => {
			requestUrl = String(input)
			return new Response('pdf-bytes', { headers: { 'Content-Type': 'application/pdf' } })
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const response = await client.forGrant('grant-123').downloadAttachment('att#1', 'msg=1')

		expect(requestUrl).toBe(
			'https://api.us.nylas.com/v3/grants/grant-123/attachments/att%231/download?message_id=msg%3D1',
		)
		expect(response.headers.get('Content-Type')).toBe('application/pdf')
		expect(await response.text()).toBe('pdf-bytes')
	})

	it('performs the full contact CRUD cycle against grant-scoped contact endpoints', async () => {
		const calls: { method: string; url: string; body: unknown }[] = []
		const fetchImpl: typeof fetch = async (input, init) => {
			calls.push({
				method: init?.method ?? 'GET',
				url: String(input),
				body: init?.body ? JSON.parse(String(init.body)) : null,
			})
			return Response.json({ request_id: 'req', data: { id: 'contact#1', given_name: 'Ada' } })
		}
		const mailbox = new NylasV3Client('api-key-123', 'us', fetchImpl).forGrant('grant-123')

		const created = await mailbox.createContact({ given_name: 'Ada', emails: [{ email: 'ada@x.com' }] })
		await mailbox.getContact('contact#1')
		await mailbox.updateContact('contact#1', { job_title: 'Engineer' })
		await mailbox.deleteContact('contact#1')

		expect(created.data.given_name).toBe('Ada')
		expect(calls).toEqual([
			{
				method: 'POST',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/contacts',
				body: { given_name: 'Ada', emails: [{ email: 'ada@x.com' }] },
			},
			{
				method: 'GET',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/contacts/contact%231',
				body: null,
			},
			{
				method: 'PUT',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/contacts/contact%231',
				body: { job_title: 'Engineer' },
			},
			{
				method: 'DELETE',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/contacts/contact%231',
				body: null,
			},
		])
	})
})
