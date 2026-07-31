import type { GatewayApiKey } from '@nylas-labs/cli-kit'

/** Nylas API-key expiry values are expressed in days, not seconds. */
export const DEPLOYMENT_API_KEY_LIFETIME_DAYS = 365
export const TEMPORARY_API_KEY_LIFETIME_DAYS = 1

const API_KEY_RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DEPLOYMENT_API_KEY_MAX_AGE_MS = DEPLOYMENT_API_KEY_LIFETIME_DAYS * 24 * 60 * 60 * 1000
const EXPIRY_CLOCK_SKEW_MS = 5 * 60 * 1000

/** Dashboard APIs may serialize epoch timestamps in seconds or milliseconds. */
export function apiKeyExpiresAtMs(expiresAt: number | undefined): number | null {
	if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) return null
	const expiresAtMs = expiresAt < 1_000_000_000_000 ? expiresAt * 1_000 : expiresAt
	return Number.isSafeInteger(expiresAtMs) ? expiresAtMs : null
}

export function reusableApiKey(
	keys: GatewayApiKey[],
	trackedKeyId: string | undefined,
	now = Date.now(),
): GatewayApiKey | null {
	if (!trackedKeyId) return null
	const key = keys.find((candidate) => candidate.id === trackedKeyId)
	if (key?.status.trim().toLowerCase() !== 'active') return null
	const expiresAtMs = apiKeyExpiresAtMs(key.expiresAt)
	if (expiresAtMs === null || expiresAtMs <= now + API_KEY_RENEWAL_WINDOW_MS) return null
	if (expiresAtMs > now + DEPLOYMENT_API_KEY_MAX_AGE_MS + EXPIRY_CLOCK_SKEW_MS) return null
	return key
}
