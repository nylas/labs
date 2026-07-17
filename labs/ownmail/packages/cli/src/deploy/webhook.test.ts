import { describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { setupRealtimeWebhook } from './webhook.js'

vi.mock('node:fs', () => ({ rmSync: vi.fn() }))
vi.mock('./materialize.js', () => ({ materializeVercel: vi.fn(() => ({ dir: '/tmp/vercel' })) }))
vi.mock('./provider-cli.js', () => ({
	deployVercel: vi.fn(async () => 'https://acme.vercel.app'),
	ensureVercelProject: vi.fn(),
	ensureVercelRealtimeStore: vi.fn(),
	setVercelEnvironment: vi.fn(),
}))
vi.mock('./wrangler.js', () => ({
	putSecret: vi.fn(),
}))

import {
	deployVercel,
	ensureVercelProject,
	ensureVercelRealtimeStore,
	setVercelEnvironment,
} from './provider-cli.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	} as ProjectState
}

describe('setupRealtimeWebhook', () => {
	it('does not attempt automatic webhook setup for manual hosting', async () => {
		const ensureWebhook = vi.fn()

		const result = await setupRealtimeWebhook(project({ hostingProvider: 'manual' }), {
			ensureWebhook,
		} as never)

		expect(result).toEqual({ status: 'skipped', reason: 'manual-hosting' })
		expect(ensureWebhook).not.toHaveBeenCalled()
	})

	it.each(['netlify', 'local'] as const)('uses polling for %s hosting', async (hostingProvider) => {
		const ensureWebhook = vi.fn()
		await expect(
			setupRealtimeWebhook(project({ hostingProvider }), { ensureWebhook } as never),
		).resolves.toEqual({
			status: 'skipped',
			reason: 'non-cloudflare-hosting',
		})
		expect(ensureWebhook).not.toHaveBeenCalled()
	})

	it('stores the webhook secret in Vercel and redeploys the linked project', async () => {
		const ensureWebhook = vi.fn().mockResolvedValue({
			id: 'webhook-1',
			webhook_secret: 'wh-secret',
		})
		const rotateWebhookSecret = vi.fn()
		const input = project({
			hostingProvider: 'vercel',
			providerAppUrl: 'https://acme.vercel.app',
			vercelProjectId: 'prj_1',
			vercelOrgId: 'team_1',
		})

		await expect(
			setupRealtimeWebhook(input, { ensureWebhook, rotateWebhookSecret } as never, { checkHealth: false }),
		).resolves.toEqual({
			status: 'registered',
			callbackUrl: 'https://acme.vercel.app/api/webhooks/nylas',
			secretStored: true,
		})

		expect(ensureVercelProject).toHaveBeenCalledWith('/tmp/vercel', 'acme-ownmail', 'team_1', {
			projectId: 'prj_1',
			orgId: 'team_1',
		})
		expect(ensureVercelRealtimeStore).toHaveBeenCalledWith('/tmp/vercel', 'acme-realtime', 'us')
		expect(setVercelEnvironment).toHaveBeenCalledWith(
			'/tmp/vercel',
			{ NYLAS_WEBHOOK_SECRET: 'wh-secret' },
			new Set(['NYLAS_WEBHOOK_SECRET']),
		)
		expect(deployVercel).toHaveBeenCalledWith('/tmp/vercel', 'team_1')
		expect(rotateWebhookSecret).not.toHaveBeenCalled()
	})

	it('rotates an existing webhook secret before storing it', async () => {
		const ensureWebhook = vi.fn().mockResolvedValue({ id: 'webhook-1' })
		const rotateWebhookSecret = vi.fn().mockResolvedValue({
			data: { id: 'webhook-1', webhook_secret: 'rotated-secret' },
		})

		const result = await setupRealtimeWebhook(
			project({ workerName: 'worker', workersDevUrl: 'https://acme.workers.dev' }),
			{ ensureWebhook, rotateWebhookSecret } as never,
			{ checkHealth: false },
		)

		expect(result.status).toBe('registered')
		expect(rotateWebhookSecret).toHaveBeenCalledWith('webhook-1')
	})

	it('fails closed when Vercel project identifiers are missing', async () => {
		const result = await setupRealtimeWebhook(
			project({ hostingProvider: 'vercel', providerAppUrl: 'https://acme.vercel.app' }),
			{
				ensureWebhook: vi.fn().mockResolvedValue({ webhook_secret: 'wh-secret' }),
				rotateWebhookSecret: vi.fn(),
			} as never,
			{ checkHealth: false },
		)

		expect(result).toEqual({
			status: 'failed',
			callbackUrl: 'https://acme.vercel.app/api/webhooks/nylas',
		})
	})

	it('fails closed if the Vercel production URL changes during webhook setup', async () => {
		vi.mocked(deployVercel).mockResolvedValueOnce('https://unexpected.vercel.app')
		const result = await setupRealtimeWebhook(
			project({
				hostingProvider: 'vercel',
				providerAppUrl: 'https://acme.vercel.app',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
			}),
			{
				ensureWebhook: vi.fn().mockResolvedValue({ webhook_secret: 'wh-secret' }),
				rotateWebhookSecret: vi.fn(),
			} as never,
			{ checkHealth: false },
		)

		expect(result).toEqual({
			status: 'failed',
			callbackUrl: 'https://acme.vercel.app/api/webhooks/nylas',
		})
	})
})
