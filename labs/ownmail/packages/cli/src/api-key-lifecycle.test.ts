import { describe, expect, it } from 'vitest'
import {
	apiKeyExpiresAtMs,
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
	})

	it('normalizes epoch-second expiry timestamps before applying the renewal window', () => {
		const tracked = {
			id: 'tracked',
			name: 'ownmail',
			status: 'active',
			expiresAt: Math.floor((NOW + 31 * DAY_MS) / 1_000),
		}
		expect(reusableApiKey([tracked], 'tracked', NOW)).toBe(tracked)
	})

	it('fails closed for non-positive and unsafe expiry timestamps', () => {
		expect(apiKeyExpiresAtMs(0)).toBeNull()
		expect(apiKeyExpiresAtMs(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
	})

	it('rejects missing, inactive, near-expiry, malformed, and overlong keys', () => {
		expect(reusableApiKey([], undefined, NOW)).toBeNull()
		expect(reusableApiKey([], 'missing', NOW)).toBeNull()
		expect(reusableApiKey([{ id: 'tracked', name: 'x', status: 'revoked' }], 'tracked', NOW)).toBeNull()
		expect(reusableApiKey([{ id: 'tracked', name: 'x', status: 'active' }], 'tracked', NOW)).toBeNull()
		expect(
			reusableApiKey([{ id: 'tracked', name: 'x', status: 'active', expiresAt: Number.NaN }], 'tracked', NOW),
		).toBeNull()
		expect(
			reusableApiKey(
				[{ id: 'tracked', name: 'x', status: 'active', expiresAt: NOW + 30 * DAY_MS }],
				'tracked',
				NOW,
			),
		).toBeNull()
		expect(
			reusableApiKey(
				[{ id: 'tracked', name: 'x', status: 'active', expiresAt: NOW + 366 * DAY_MS }],
				'tracked',
				NOW,
			),
		).toBeNull()
	})
})
