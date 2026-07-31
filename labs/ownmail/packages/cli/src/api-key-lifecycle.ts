import type { GatewayApiKey } from '@nylas-labs/cli-kit'

/** Nylas API-key expiry values are expressed in days, not seconds. */
export const DEPLOYMENT_API_KEY_LIFETIME_DAYS = 365
export const TEMPORARY_API_KEY_LIFETIME_DAYS = 1

const API_KEY_RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export function reusableApiKey(
	keys: GatewayApiKey[],
	trackedKeyId: string | undefined,
	now = Date.now(),
): GatewayApiKey | null {
	if (!trackedKeyId) return null
	const key = keys.find((candidate) => candidate.id === trackedKeyId)
	if (key?.status.toLowerCase() !== 'active') return null
	if (key.expiresAt !== undefined && key.expiresAt <= now + API_KEY_RENEWAL_WINDOW_MS) return null
	return key
}
