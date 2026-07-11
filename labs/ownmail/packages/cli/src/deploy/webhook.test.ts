import { describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { setupRealtimeWebhook } from './webhook.js'

vi.mock('./wrangler.js', () => ({
	putSecret: vi.fn(),
}))

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
})
