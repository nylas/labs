import { describe, expect, it } from 'vitest'
import {
	DEPLOYMENT_API_KEY_LIFETIME_DAYS,
	reusableApiKey,
	TEMPORARY_API_KEY_LIFETIME_DAYS,
} from './api-key-lifecycle.js'

const NOW = Date.UTC(2026, 6, 31)
const DAY_MS = 24 * 60 * 60 * 1000

describe('API key lifecycle', () => {
	it('uses bounded day-based lifetimes', () => {
		expect(TEMPORARY_API_KEY_LIFETIME_DAYS).toBe(1)
		expect(DEPLOYMENT_API_KEY_LIFETIME_DAYS).toBe(365)
	})

	it('reuses only the tracked active key outside the renewal window', () => {
		const tracked = { id: 'tracked', name: 'ownmail', status: 'active', expiresAt: NOW + 31 * DAY_MS }
		expect(reusableApiKey([tracked], 'tracked', NOW)).toBe(tracked)
		expect(reusableApiKey([{ ...tracked, expiresAt: undefined }], 'tracked', NOW)?.id).toBe('tracked')
	})

	it('rejects missing, inactive, and near-expiry keys', () => {
		expect(reusableApiKey([], undefined, NOW)).toBeNull()
		expect(reusableApiKey([], 'missing', NOW)).toBeNull()
		expect(reusableApiKey([{ id: 'tracked', name: 'x', status: 'revoked' }], 'tracked', NOW)).toBeNull()
		expect(
			reusableApiKey(
				[{ id: 'tracked', name: 'x', status: 'active', expiresAt: NOW + 30 * DAY_MS }],
				'tracked',
				NOW,
			),
		).toBeNull()
	})
})
