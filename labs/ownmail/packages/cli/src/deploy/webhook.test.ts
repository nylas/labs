import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { setupRealtimeWebhook, WEBHOOK_TRIGGER_TYPES } from './webhook.js'

vi.mock('node:fs', () => ({ rmSync: vi.fn() }))
vi.mock('./materialize.js', () => ({
	materializeVercel: vi.fn(() => ({ dir: '/tmp/vercel' })),
	materializeNetlify: vi.fn(() => ({ dir: '/tmp/netlify' })),
}))
vi.mock('./provider-cli.js', () => ({
	deployVercel: vi.fn(async () => 'https://acme.vercel.app'),
	deployNetlify: vi.fn(async () => 'https://acme.netlify.app'),
	ensureVercelProject: vi.fn(),
	ensureVercelRealtimeStore: vi.fn(),
	ensureNetlifySite: vi.fn(),
	setVercelEnvironment: vi.fn(),
	setNetlifyEnvironment: vi.fn(),
}))
vi.mock('./wrangler.js', () => ({ putSecret: vi.fn() }))

import { deployNetlify, deployVercel, setNetlifyEnvironment, setVercelEnvironment } from './provider-cli.js'
import { putSecret } from './wrangler.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		appDomains: [],
		...overrides,
	} as ProjectState
}

function createdWebhook(secret = 'wh-secret') {
	return {
		webhook: {
			id: 'webhook-1',
			trigger_types: WEBHOOK_TRIGGER_TYPES,
			webhook_url: 'https://acme.workers.dev/api/webhooks/nylas',
			status: 'active',
			webhook_secret: secret,
		},
		operation: 'created' as const,
		adopted: false,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(deployVercel).mockResolvedValue('https://acme.vercel.app')
	vi.mocked(deployNetlify).mockResolvedValue('https://acme.netlify.app')
})

describe('setupRealtimeWebhook', () => {
	it.each([
		['manual', 'manual-hosting'],
		['local', 'non-cloudflare-hosting'],
	] as const)('skips unsupported %s hosting', async (hostingProvider, reason) => {
		const reconcileWebhook = vi.fn()
		await expect(
			setupRealtimeWebhook(project({ hostingProvider }), {
				reconcileWebhook,
				deleteWebhook: vi.fn(),
			}),
		).resolves.toEqual({ status: 'skipped', reason })
		expect(reconcileWebhook).not.toHaveBeenCalled()
	})

	it('creates one Cloudflare webhook, stores its returned secret, and records its id', async () => {
		const input = project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' })
		const reconcileWebhook = vi.fn().mockResolvedValue(createdWebhook())
		const deleteWebhook = vi.fn()

		await expect(
			setupRealtimeWebhook(input, { reconcileWebhook, deleteWebhook }, { checkHealth: false }),
		).resolves.toEqual({
			status: 'registered',
			callbackUrl: 'https://acme.workers.dev/api/webhooks/nylas',
			secretStored: true,
		})

		expect(reconcileWebhook).toHaveBeenCalledWith(
			'https://acme.workers.dev/api/webhooks/nylas',
			WEBHOOK_TRIGGER_TYPES,
			{
				knownCallbackUrls: ['https://acme.workers.dev/api/webhooks/nylas'],
			},
		)
		expect(putSecret).toHaveBeenCalledWith('worker', 'NYLAS_WEBHOOK_SECRET', 'wh-secret')
		expect(deleteWebhook).not.toHaveBeenCalled()
		expect(input.realtimeWebhookId).toBe('webhook-1')
	})

	it('updates a tracked webhook without rotating or rewriting its secret', async () => {
		const input = project({
			workerName: 'worker',
			workersDevUrl: 'https://acme.workers.dev',
			realtimeWebhookId: 'webhook-1',
		})
		const reconcileWebhook = vi.fn().mockResolvedValue({
			webhook: {
				id: 'webhook-1',
				trigger_types: WEBHOOK_TRIGGER_TYPES,
				webhook_url: 'https://mail.acme.com/api/webhooks/nylas',
				status: 'active',
			},
			operation: 'updated',
			adopted: false,
			previousUrl: 'https://acme.workers.dev/api/webhooks/nylas',
		})
		const rotateWebhookSecret = vi.fn()

		await expect(
			setupRealtimeWebhook(
				input,
				{ reconcileWebhook, rotateWebhookSecret, deleteWebhook: vi.fn() },
				{ baseUrl: 'https://mail.acme.com', checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'registered' })

		expect(putSecret).not.toHaveBeenCalled()
		expect(rotateWebhookSecret).not.toHaveBeenCalled()
	})

	it('rotates and installs the secret when adopting an interrupted destination', async () => {
		const input = project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' })
		const reconcileWebhook = vi.fn().mockResolvedValue({
			webhook: {
				id: 'webhook-legacy',
				trigger_types: WEBHOOK_TRIGGER_TYPES,
				webhook_url: 'https://acme.workers.dev/api/webhooks/nylas',
				status: 'active',
			},
			operation: 'unchanged',
			adopted: true,
		})
		const rotateWebhookSecret = vi.fn().mockResolvedValue({
			data: { id: 'webhook-legacy', webhook_secret: 'repaired-secret' },
		})

		await expect(
			setupRealtimeWebhook(
				input,
				{ reconcileWebhook, rotateWebhookSecret, deleteWebhook: vi.fn() },
				{ checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'registered', secretStored: true })

		expect(rotateWebhookSecret).toHaveBeenCalledWith('webhook-legacy')
		expect(putSecret).toHaveBeenCalledWith('worker', 'NYLAS_WEBHOOK_SECRET', 'repaired-secret')
		expect(input.realtimeWebhookId).toBe('webhook-legacy')
	})

	it('trusts a completed legacy installation without rotating its secret', async () => {
		const reconcileWebhook = vi.fn().mockResolvedValue({
			webhook: {
				id: 'webhook-legacy',
				trigger_types: WEBHOOK_TRIGGER_TYPES,
				webhook_url: 'https://acme.workers.dev/api/webhooks/nylas',
				status: 'active',
			},
			operation: 'unchanged',
			adopted: true,
		})
		const rotateWebhookSecret = vi.fn()

		await expect(
			setupRealtimeWebhook(
				project({
					workerName: 'worker',
					workersDevUrl: 'https://acme.workers.dev',
					completedSteps: ['webhook'],
				}),
				{ reconcileWebhook, rotateWebhookSecret, deleteWebhook: vi.fn() },
				{ checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'registered' })

		expect(rotateWebhookSecret).not.toHaveBeenCalled()
		expect(putSecret).not.toHaveBeenCalled()
	})

	it('fails without deleting an adopted destination when secret repair is unavailable', async () => {
		const deleteWebhook = vi.fn()

		await expect(
			setupRealtimeWebhook(
				project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
				{
					reconcileWebhook: vi.fn().mockResolvedValue({
						webhook: {
							id: 'webhook-legacy',
							trigger_types: WEBHOOK_TRIGGER_TYPES,
							webhook_url: 'https://acme.workers.dev/api/webhooks/nylas',
							status: 'active',
						},
						operation: 'unchanged',
						adopted: true,
					}),
					deleteWebhook,
				},
				{ checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'failed' })

		expect(deleteWebhook).not.toHaveBeenCalled()
	})

	it('does not delete an adopted destination when repaired secret storage fails', async () => {
		vi.mocked(putSecret).mockRejectedValueOnce(new Error('temporary provider failure'))
		const deleteWebhook = vi.fn()

		await expect(
			setupRealtimeWebhook(
				project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
				{
					reconcileWebhook: vi.fn().mockResolvedValue({
						webhook: {
							id: 'webhook-legacy',
							trigger_types: WEBHOOK_TRIGGER_TYPES,
							webhook_url: 'https://acme.workers.dev/api/webhooks/nylas',
							status: 'active',
						},
						operation: 'unchanged',
						adopted: true,
					}),
					rotateWebhookSecret: vi.fn().mockResolvedValue({
						data: { id: 'webhook-legacy', webhook_secret: 'repaired-secret' },
					}),
					deleteWebhook,
				},
				{ checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'failed' })

		expect(deleteWebhook).not.toHaveBeenCalled()
	})

	it('deletes a newly-created destination if provider secret storage fails', async () => {
		vi.mocked(putSecret).mockRejectedValueOnce(new Error('hidden'))
		const deleteWebhook = vi.fn()

		const result = await setupRealtimeWebhook(
			project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
			{ reconcileWebhook: vi.fn().mockResolvedValue(createdWebhook()), deleteWebhook },
			{ checkHealth: false },
		)

		expect(result.status).toBe('failed')
		expect(deleteWebhook).toHaveBeenCalledWith('webhook-1')
	})

	it('deletes a created webhook that does not return its one-time secret', async () => {
		const deleteWebhook = vi.fn()
		const created = createdWebhook()
		delete created.webhook.webhook_secret

		await expect(
			setupRealtimeWebhook(
				project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
				{ reconcileWebhook: vi.fn().mockResolvedValue(created), deleteWebhook },
				{ checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'failed' })

		expect(deleteWebhook).toHaveBeenCalledWith('webhook-1')
	})

	it('does not mask the original error if webhook rollback also fails', async () => {
		vi.mocked(putSecret).mockRejectedValueOnce(
			Object.assign(new Error('hidden'), { requestId: 'req-store-1' }),
		)
		const deleteWebhook = vi.fn().mockRejectedValue(new Error('hidden rollback error'))

		await expect(
			setupRealtimeWebhook(
				project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
				{ reconcileWebhook: vi.fn().mockResolvedValue(createdWebhook()), deleteWebhook },
				{ checkHealth: false },
			),
		).resolves.toMatchObject({ status: 'failed', requestId: 'req-store-1' })
	})

	it('stores a newly-created webhook secret in Vercel and keeps the provider URL stable', async () => {
		const input = project({
			hostingProvider: 'vercel',
			providerAppUrl: 'https://acme.vercel.app',
			vercelProjectId: 'prj_1',
			vercelOrgId: 'team_1',
		})
		const reconcileWebhook = vi.fn().mockResolvedValue({
			...createdWebhook(),
			webhook: {
				...createdWebhook().webhook,
				webhook_url: 'https://acme.vercel.app/api/webhooks/nylas',
			},
		})

		await expect(
			setupRealtimeWebhook(input, { reconcileWebhook, deleteWebhook: vi.fn() }, { checkHealth: false }),
		).resolves.toMatchObject({ status: 'registered' })

		expect(setVercelEnvironment).toHaveBeenCalledWith(
			'/tmp/vercel',
			{ NYLAS_WEBHOOK_SECRET: 'wh-secret' },
			new Set(['NYLAS_WEBHOOK_SECRET']),
		)
		expect(deployVercel).toHaveBeenCalledWith('/tmp/vercel', 'team_1')
	})

	it('stores a newly-created webhook secret in Netlify', async () => {
		const input = project({
			hostingProvider: 'netlify',
			providerAppUrl: 'https://acme.netlify.app',
			netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
		})
		const reconcileWebhook = vi.fn().mockResolvedValue({
			...createdWebhook(),
			webhook: {
				...createdWebhook().webhook,
				webhook_url: 'https://acme.netlify.app/api/webhooks/nylas',
			},
		})

		await expect(
			setupRealtimeWebhook(input, { reconcileWebhook, deleteWebhook: vi.fn() }, { checkHealth: false }),
		).resolves.toMatchObject({ status: 'registered' })

		expect(setNetlifyEnvironment).toHaveBeenCalledWith(
			'/tmp/netlify',
			'123e4567-e89b-42d3-a456-426614174000',
			{ NYLAS_WEBHOOK_SECRET: 'wh-secret' },
			new Set(['NYLAS_WEBHOOK_SECRET']),
		)
		expect(deployNetlify).toHaveBeenCalled()
	})

	it('fails closed when hosted provider state or redeployment URLs drift', async () => {
		const netlifyMissing = await setupRealtimeWebhook(
			project({ hostingProvider: 'netlify', providerAppUrl: 'https://acme.netlify.app' }),
			{
				reconcileWebhook: vi.fn().mockResolvedValue({
					...createdWebhook(),
					webhook: {
						...createdWebhook().webhook,
						webhook_url: 'https://acme.netlify.app/api/webhooks/nylas',
					},
				}),
				deleteWebhook: vi.fn(),
			},
			{ checkHealth: false },
		)
		expect(netlifyMissing.status).toBe('failed')

		vi.mocked(deployNetlify).mockResolvedValueOnce('https://changed.netlify.app')
		const netlifyChanged = await setupRealtimeWebhook(
			project({
				hostingProvider: 'netlify',
				providerAppUrl: 'https://acme.netlify.app',
				netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
			}),
			{
				reconcileWebhook: vi.fn().mockResolvedValue({
					...createdWebhook(),
					webhook: {
						...createdWebhook().webhook,
						webhook_url: 'https://acme.netlify.app/api/webhooks/nylas',
					},
				}),
				deleteWebhook: vi.fn(),
			},
			{ checkHealth: false },
		)
		expect(netlifyChanged.status).toBe('failed')

		const vercelMissing = await setupRealtimeWebhook(
			project({ hostingProvider: 'vercel', providerAppUrl: 'https://acme.vercel.app' }),
			{
				reconcileWebhook: vi.fn().mockResolvedValue({
					...createdWebhook(),
					webhook: {
						...createdWebhook().webhook,
						webhook_url: 'https://acme.vercel.app/api/webhooks/nylas',
					},
				}),
				deleteWebhook: vi.fn(),
			},
			{ checkHealth: false },
		)
		expect(vercelMissing.status).toBe('failed')

		vi.mocked(deployVercel).mockResolvedValueOnce('https://changed.vercel.app')
		const vercelChanged = await setupRealtimeWebhook(
			project({
				hostingProvider: 'vercel',
				providerAppUrl: 'https://acme.vercel.app',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
			}),
			{
				reconcileWebhook: vi.fn().mockResolvedValue({
					...createdWebhook(),
					webhook: {
						...createdWebhook().webhook,
						webhook_url: 'https://acme.vercel.app/api/webhooks/nylas',
					},
				}),
				deleteWebhook: vi.fn(),
			},
			{ checkHealth: false },
		)
		expect(vercelChanged.status).toBe('failed')
	})

	it('returns only validated upstream request IDs on failures', async () => {
		const input = project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' })
		const withRequestId = await setupRealtimeWebhook(
			input,
			{
				reconcileWebhook: vi
					.fn()
					.mockRejectedValue(Object.assign(new Error('hidden'), { requestId: 'req-webhook-123' })),
				deleteWebhook: vi.fn(),
			},
			{ checkHealth: false },
		)
		const withUnsafeId = await setupRealtimeWebhook(
			input,
			{
				reconcileWebhook: vi
					.fn()
					.mockRejectedValue(Object.assign(new Error('hidden'), { requestId: 'bad\nid' })),
				deleteWebhook: vi.fn(),
			},
			{ checkHealth: false },
		)

		expect(withRequestId).toMatchObject({ status: 'failed', requestId: 'req-webhook-123' })
		expect(withUnsafeId).toEqual({
			status: 'failed',
			callbackUrl: 'https://acme.workers.dev/api/webhooks/nylas',
		})
	})

	it.each([
		'ambiguous-ownmail-destinations',
		'tracked-destination-ownership-mismatch',
		'unrecognized-callback-destination',
	] as const)('returns the safe reconciliation reason %s', async (code) => {
		const result = await setupRealtimeWebhook(
			project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
			{
				reconcileWebhook: vi.fn().mockRejectedValue(
					Object.assign(new Error('private destination details'), {
						code,
					}),
				),
			},
			{ checkHealth: false },
		)

		expect(result).toEqual({
			status: 'failed',
			callbackUrl: 'https://acme.workers.dev/api/webhooks/nylas',
			reason: code,
		})
	})

	it.each([null, { code: 'unsafe-code' }])(
		'does not return an unrecognized reconciliation reason',
		async (failure) => {
			const result = await setupRealtimeWebhook(
				project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
				{ reconcileWebhook: vi.fn().mockRejectedValue(failure) },
				{ checkHealth: false },
			)

			expect(result).toEqual({
				status: 'failed',
				callbackUrl: 'https://acme.workers.dev/api/webhooks/nylas',
			})
		},
	)

	it('fails closed when an injected legacy client has no webhook method', async () => {
		const result = await setupRealtimeWebhook(
			project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
			{},
			{ checkHealth: false },
		)
		expect(result.status).toBe('failed')
	})
})
