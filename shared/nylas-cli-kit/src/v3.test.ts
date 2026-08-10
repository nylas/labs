import { describe, expect, it } from 'vitest'
import {
	buildAuthorizeUrl,
	exchangeCodeForToken,
	NylasApiError,
	NylasV3Client,
	nylasPkceS256Challenge,
} from './v3.js'

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
	it('uses Nylas’s documented S256 challenge encoding', async () => {
		await expect(nylasPkceS256Challenge('nylas')).resolves.toBe(
			'ZTk2YmY2Njg2YTNjMzUxMGU5ZTkyN2RiNzA2OWNiMWNiYTliOTliMDIyZjQ5NDgzYTZjZTMyNzA4MDllNjhhMg',
		)
	})

	it('posts the documented authorization_code body to a custom API base URL', async () => {
		let requestUrl = ''
		let requestBody: unknown = null
		let requestHeaders: HeadersInit | undefined
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestBody = JSON.parse(String(init?.body))
			requestHeaders = init?.headers
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
				userAgent: 'ownmail',
			},
			fetchImpl,
		)

		expect(requestUrl).toBe('https://api-staging.us.nylas.com/v3/connect/token')
		expect(requestHeaders).toMatchObject({ 'Content-Type': 'application/json', 'User-Agent': 'ownmail' })
		expect(requestBody).toMatchObject({
			client_id: 'app-123',
			client_secret: 'api-key-123',
			grant_type: 'authorization_code',
			code: 'code-123',
			redirect_uri: 'https://mail.example.com/auth/callback',
			code_verifier: 'verifier-123',
		})
	})

	it('retains the request ID from a failed token exchange', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json(
				{ error: 'invalid_grant', error_description: 'authorization code expired' },
				{ status: 400, headers: { 'x-request-id': 'req-token-123' } },
			)

		await expect(
			exchangeCodeForToken(
				{
					region: 'us',
					clientId: 'app-123',
					clientSecret: 'secret-123',
					redirectUri: 'https://mail.example.test/auth/callback',
					code: 'expired-code',
				},
				fetchImpl,
			),
		).rejects.toMatchObject({
			status: 400,
			requestId: 'req-token-123',
			type: 'invalid_grant',
		})
	})

	it.each([
		['not json', 'invalid JSON'],
		['null', 'malformed response'],
	])('rejects unsafe token response bodies while retaining the request ID', async (body, message) => {
		const fetchImpl: typeof fetch = async () =>
			new Response(body, {
				status: 502,
				headers: { 'x-request-id': 'req-token-invalid-123' },
			})

		await expect(
			exchangeCodeForToken(
				{
					region: 'us',
					clientId: 'app-123',
					clientSecret: 'secret-123',
					redirectUri: 'https://mail.example.test/auth/callback',
					code: 'code',
				},
				fetchImpl,
			),
		).rejects.toMatchObject({
			message: expect.stringContaining(message),
			requestId: 'req-token-invalid-123',
			type: 'invalid_response',
		})
	})
})

describe('NylasV3Client', () => {
	it('uses a custom API base URL for requests', async () => {
		let requestUrl = ''
		let requestHeaders: HeadersInit | undefined
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestHeaders = init?.headers
			return Response.json({ data: [] })
		}
		const client = new NylasV3Client(
			'api-key-123',
			'us',
			fetchImpl,
			'https://api-staging.us.nylas.com/',
			'ownmail',
		)

		await client.listGrants()

		expect(requestUrl).toBe('https://api-staging.us.nylas.com/v3/grants')
		expect(requestHeaders).toMatchObject({ 'User-Agent': 'ownmail' })
	})

	it('retains a header request ID on JSON API failures without logging the body', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json(
				{
					request_id: 'req-body-123',
					error: { type: 'invalid_request', message: 'sensitive upstream detail' },
				},
				{ status: 400, headers: { 'x-nylas-request-id': 'req-header-123' } },
			)
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const error = await client.listGrants().catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(NylasApiError)
		expect(error).toMatchObject({
			status: 400,
			requestId: 'req-header-123',
			type: 'invalid_request',
		})
	})

	it('retains a body request ID on raw response failures', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json(
				{
					request_id: 'req-raw-123',
					error: { type: 'not_found', message: 'missing' },
				},
				{ status: 404 },
			)
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(client.rawRequest('GET', '/v3/raw')).rejects.toMatchObject({
			status: 404,
			requestId: 'req-raw-123',
			type: 'not_found',
		})
	})

	it('rejects successful non-JSON API responses with their request ID', async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response('not json', {
				status: 200,
				headers: { 'x-request-id': 'req-invalid-json-123' },
			})
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(client.listGrants()).rejects.toMatchObject({
			status: 200,
			requestId: 'req-invalid-json-123',
			type: 'invalid_response',
		})
	})

	it('allows empty successful DELETE responses', async () => {
		const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 })
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(client.deleteGrant('grant-123')).resolves.toBeUndefined()
	})

	it('drops null and scalar members from live list responses', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json({
				data: [{ id: 'grant-123', provider: 'nylas' }, null, 'not-a-grant', 42],
			})
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const grants = await client.listGrants()

		expect(grants.data).toEqual([{ id: 'grant-123', provider: 'nylas' }])
	})

	it('gets a grant and updates its top-level display name with its settings', async () => {
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

		await client.getGrant('grant/123')
		expect(requestUrl).toBe('https://api.us.nylas.com/v3/grants/grant%2F123')
		expect(requestMethod).toBe('GET')

		await client.updateGrant('grant-123', {
			name: 'Ada Lovelace',
			settings: { email: 'contact@example.com', app_password: 'New-password-123456' },
		})

		expect(requestUrl).toBe('https://api.us.nylas.com/v3/grants/grant-123')
		expect(requestMethod).toBe('PATCH')
		expect(requestBody).toEqual({
			name: 'Ada Lovelace',
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
					trigger_types: ['message.created'],
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
						trigger_types: ['message.created'],
						webhook_url: 'https://mail.example.com/api/webhooks/nylas',
						status: 'active',
						description: 'ownmail realtime',
					},
					{
						id: 'webhook-legacy',
						trigger_types: ['message.created'],
						callback_url: 'https://legacy.example.com/api/webhooks/nylas',
						status: 'active',
						description: 'ownmail realtime',
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

	it('moves a tracked webhook and reconciles triggers without rotating its secret', async () => {
		const requests: Array<{ method: string; url: string; body?: unknown }> = []
		const fetchImpl: typeof fetch = async (input, init) => {
			const method = init?.method ?? 'GET'
			const url = String(input)
			requests.push({
				method,
				url,
				...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
			})
			if (method === 'GET') {
				return Response.json({
					request_id: 'req-list',
					data: [
						{
							id: 'webhook-1',
							trigger_types: ['message.created'],
							webhook_url: 'https://old.example.com/api/webhooks/nylas',
							status: 'active',
							description: 'ownmail realtime',
						},
					],
				})
			}
			return Response.json({
				request_id: 'req-update',
				data: {
					id: 'webhook-1',
					trigger_types: ['message.created', 'message.deleted'],
					webhook_url: 'https://mail.example.com/api/webhooks/nylas',
					status: 'active',
					description: 'ownmail realtime',
				},
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const result = await client.reconcileWebhook(
			'https://mail.example.com/api/webhooks/nylas',
			['message.created', 'message.deleted'],
			{
				webhookId: 'webhook-1',
				knownCallbackUrls: ['https://old.example.com/api/webhooks/nylas'],
			},
		)

		expect(result).toMatchObject({
			operation: 'updated',
			adopted: false,
			previousUrl: 'https://old.example.com/api/webhooks/nylas',
			webhook: { id: 'webhook-1' },
		})
		expect(requests).toEqual([
			{
				method: 'GET',
				url: 'https://api.us.nylas.com/v3/webhooks',
			},
			{
				method: 'PUT',
				url: 'https://api.us.nylas.com/v3/webhooks/webhook-1',
				body: {
					trigger_types: ['message.created', 'message.deleted'],
					webhook_url: 'https://mail.example.com/api/webhooks/nylas',
					description: 'ownmail realtime',
					status: 'active',
				},
			},
		])
	})

	it('adopts a known destination when the recorded id is stale', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json({
				request_id: 'req-list',
				data: [
					{
						id: 'webhook-current',
						trigger_types: ['message.created'],
						webhook_url: 'https://mail.example.com/api/webhooks/nylas',
						status: 'active',
						description: 'ownmail realtime',
					},
				],
			})
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created'], {
				webhookId: 'webhook-stale',
			}),
		).resolves.toMatchObject({
			operation: 'unchanged',
			adopted: true,
			webhook: { id: 'webhook-current' },
		})
	})

	it('refuses to mutate a tracked destination that is not owned by this project', async () => {
		let calls = 0
		const fetchImpl: typeof fetch = async () => {
			calls++
			return Response.json({
				request_id: 'req-list',
				data: [
					{
						id: 'hostile-webhook',
						trigger_types: ['message.created'],
						webhook_url: 'https://other.example.com/hooks',
						status: 'active',
						description: 'customer webhook',
					},
				],
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created'], {
				webhookId: 'hostile-webhook',
			}),
		).rejects.toMatchObject({ code: 'tracked-destination-ownership-mismatch' })
		expect(calls).toBe(1)
	})

	it('keeps the current owned destination and deletes a known legacy duplicate', async () => {
		const requests: string[] = []
		const fetchImpl: typeof fetch = async (input, init) => {
			requests.push(`${init?.method ?? 'GET'} ${String(input)}`)
			return Response.json({
				request_id: 'req-list',
				data: [
					{
						id: 'webhook-current',
						trigger_types: ['message.created'],
						webhook_url: 'https://mail.example.com/api/webhooks/nylas',
						status: 'active',
						description: 'ownmail realtime',
					},
					{
						id: 'webhook-legacy',
						trigger_types: ['message.created'],
						webhook_url: 'https://app.workers.dev/api/webhooks/nylas',
						status: 'active',
						description: 'ownmail realtime',
					},
				],
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created'], {
				knownCallbackUrls: ['https://app.workers.dev/api/webhooks/nylas'],
			}),
		).resolves.toMatchObject({ webhook: { id: 'webhook-current' }, operation: 'unchanged' })
		expect(requests).toEqual([
			'GET https://api.us.nylas.com/v3/webhooks',
			'DELETE https://api.us.nylas.com/v3/webhooks/webhook-legacy',
		])
	})

	it('fails closed when multiple owned legacy destinations have no safe winner', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json({
				request_id: 'req-list',
				data: [
					{
						id: 'webhook-a',
						trigger_types: ['message.created'],
						webhook_url: 'https://a.workers.dev/api/webhooks/nylas',
						description: 'ownmail realtime',
					},
					{
						id: 'webhook-b',
						trigger_types: ['message.created'],
						webhook_url: 'https://b.workers.dev/api/webhooks/nylas',
						description: 'ownmail realtime',
					},
				],
			})
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created'], {
				knownCallbackUrls: [
					'https://a.workers.dev/api/webhooks/nylas',
					'https://b.workers.dev/api/webhooks/nylas',
				],
			}),
		).rejects.toMatchObject({ code: 'ambiguous-ownmail-destinations' })
	})

	it('refuses an unrecognized destination at the requested callback URL', async () => {
		const fetchImpl: typeof fetch = async () =>
			Response.json({
				request_id: 'req-list',
				data: [
					{
						id: 'customer-webhook',
						trigger_types: ['message.created'],
						webhook_url: 'https://mail.example.com/api/webhooks/nylas',
						description: 'customer webhook',
					},
				],
			})
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created']),
		).rejects.toMatchObject({ code: 'unrecognized-callback-destination' })
	})

	it('adopts the single winner after losing a concurrent create race', async () => {
		let listCount = 0
		const fetchImpl: typeof fetch = async (_input, init) => {
			if (init?.method === 'POST') {
				return Response.json({ request_id: 'req-create', message: 'Webhook already exists' }, { status: 409 })
			}
			listCount++
			return Response.json({
				request_id: `req-list-${listCount}`,
				data:
					listCount === 1
						? []
						: [
								{
									id: 'webhook-winner',
									trigger_types: ['message.created'],
									webhook_url: 'https://mail.example.com/api/webhooks/nylas',
									status: 'active',
									description: 'ownmail realtime',
								},
							],
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created']),
		).resolves.toMatchObject({
			adopted: true,
			operation: 'unchanged',
			webhook: { id: 'webhook-winner' },
		})
	})

	it('rejects invalid recorded callback URLs before changing a webhook', async () => {
		const client = new NylasV3Client('api-key-123', 'us', async () =>
			Response.json({ request_id: 'req-list', data: [] }),
		)

		await expect(
			client.reconcileWebhook('https://mail.example.com/api/webhooks/nylas', ['message.created'], {
				knownCallbackUrls: ['http://insecure.example.com/api/webhooks/nylas'],
			}),
		).rejects.toThrow(/recorded OwnMail webhook callback URL is invalid/)
	})

	it('rotates an existing webhook secret by encoded webhook id', async () => {
		let requestUrl = ''
		let requestMethod = ''
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestMethod = init?.method ?? 'GET'
			return Response.json({
				request_id: 'req-rotate',
				data: { id: 'webhook/123', webhook_secret: 'wh-secret' },
			})
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl)

		const response = await client.rotateWebhookSecret('webhook/123')

		expect(requestMethod).toBe('POST')
		expect(requestUrl).toBe('https://api.us.nylas.com/v3/webhooks/rotate-secret/webhook%2F123')
		expect(response.data.webhook_secret).toBe('wh-secret')
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
		let requestHeaders: HeadersInit | undefined
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestHeaders = init?.headers
			return new Response('pdf-bytes', { headers: { 'Content-Type': 'application/pdf' } })
		}
		const client = new NylasV3Client('api-key-123', 'us', fetchImpl, undefined, 'ownmail')

		const response = await client.forGrant('grant-123').downloadAttachment('att#1', 'msg=1')

		expect(requestUrl).toBe(
			'https://api.us.nylas.com/v3/grants/grant-123/attachments/att%231/download?message_id=msg%3D1',
		)
		expect(requestHeaders).toMatchObject({ 'User-Agent': 'ownmail' })
		expect(response.headers.get('Content-Type')).toBe('application/pdf')
		expect(await response.text()).toBe('pdf-bytes')
	})

	it('requests raw MIME for one encoded message id', async () => {
		let requestUrl = ''
		const fetchImpl: typeof fetch = async (input) => {
			requestUrl = String(input)
			return Response.json({
				request_id: 'req-mime',
				data: {
					id: 'msg#1',
					grant_id: 'grant-123',
					object: 'message',
					raw_mime: 'TUlNRS1WZXJzaW9uOiAxLjA',
				},
			})
		}
		const mailbox = new NylasV3Client('api-key-123', 'us', fetchImpl).forGrant('grant-123')

		const response = await mailbox.getRawMime('msg#1')

		expect(requestUrl).toBe('https://api.us.nylas.com/v3/grants/grant-123/messages/msg%231?fields=raw_mime')
		expect(response.data.raw_mime).toBe('TUlNRS1WZXJzaW9uOiAxLjA')
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

	it('performs folder and calendar CRUD against encoded grant-scoped endpoints', async () => {
		const calls: { method: string; url: string; body: unknown }[] = []
		const fetchImpl: typeof fetch = async (input, init) => {
			calls.push({
				method: init?.method ?? 'GET',
				url: String(input),
				body: init?.body ? JSON.parse(String(init.body)) : null,
			})
			return Response.json({ request_id: 'req', data: { id: 'resource#1', name: 'Projects' } })
		}
		const mailbox = new NylasV3Client('api-key-123', 'us', fetchImpl).forGrant('grant-123')

		await mailbox.createFolder({ name: 'Projects' })
		await mailbox.updateFolder('folder#1', { name: 'Roadmap' })
		await mailbox.deleteFolder('folder#1')
		await mailbox.createCalendar({ name: 'Projects', timezone: 'America/Toronto' })
		await mailbox.updateCalendar('calendar#1', { name: 'Roadmap' })
		await mailbox.deleteCalendar('calendar#1')

		expect(calls).toEqual([
			{
				method: 'POST',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/folders',
				body: { name: 'Projects' },
			},
			{
				method: 'PUT',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/folders/folder%231',
				body: { name: 'Roadmap' },
			},
			{
				method: 'DELETE',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/folders/folder%231',
				body: null,
			},
			{
				method: 'POST',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/calendars',
				body: { name: 'Projects', timezone: 'America/Toronto' },
			},
			{
				method: 'PUT',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/calendars/calendar%231',
				body: { name: 'Roadmap' },
			},
			{
				method: 'DELETE',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/calendars/calendar%231',
				body: null,
			},
		])
	})

	it('can create an event without notifying participants', async () => {
		let requestUrl = ''
		let requestBody: unknown
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestBody = JSON.parse(String(init?.body))
			return Response.json({
				request_id: 'req-event',
				data: { id: 'event-1', calendar_id: 'calendar#1', when: { time: 100 } },
			})
		}
		const mailbox = new NylasV3Client('api-key-123', 'us', fetchImpl).forGrant('grant-123')

		await mailbox.createEvent({ title: 'Imported invitation', when: { time: 100 } }, 'calendar#1', {
			notifyParticipants: false,
		})

		expect(requestUrl).toBe(
			'https://api.us.nylas.com/v3/grants/grant-123/events?calendar_id=calendar%231&notify_participants=false',
		)
		expect(requestBody).toEqual({ title: 'Imported invitation', when: { time: 100 } })
	})

	it('can reconcile an event without notifying participants', async () => {
		let requestUrl = ''
		let requestMethod = ''
		const fetchImpl: typeof fetch = async (input, init) => {
			requestUrl = String(input)
			requestMethod = init?.method ?? 'GET'
			return Response.json({
				request_id: 'req-event',
				data: { id: 'event#1', calendar_id: 'calendar#1', when: { time: 100 } },
			})
		}
		const mailbox = new NylasV3Client('api-key-123', 'us', fetchImpl).forGrant('grant-123')

		await mailbox.updateEvent('event#1', { title: 'Updated invitation' }, 'calendar#1', {
			notifyParticipants: false,
		})

		expect(requestMethod).toBe('PUT')
		expect(requestUrl).toBe(
			'https://api.us.nylas.com/v3/grants/grant-123/events/event%231?calendar_id=calendar%231&notify_participants=false',
		)
	})

	it('can delete an imported event with explicit participant notification control', async () => {
		const requests: { method: string; url: string }[] = []
		const fetchImpl: typeof fetch = async (input, init) => {
			requests.push({ method: init?.method ?? 'GET', url: String(input) })
			return Response.json({ request_id: 'req-event' })
		}
		const mailbox = new NylasV3Client('api-key-123', 'us', fetchImpl).forGrant('grant-123')

		await mailbox.deleteEvent('event#1', 'calendar#1')
		await mailbox.deleteEvent('event#1', 'calendar#1', { notifyParticipants: false })

		expect(requests).toEqual([
			{
				method: 'DELETE',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/events/event%231?calendar_id=calendar%231',
			},
			{
				method: 'DELETE',
				url: 'https://api.us.nylas.com/v3/grants/grant-123/events/event%231?calendar_id=calendar%231&notify_participants=false',
			},
		])
	})
})
