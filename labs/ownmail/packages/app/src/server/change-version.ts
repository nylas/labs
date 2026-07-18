import { type KvLike, platform } from './platform.js'

export const CHANGE_DOMAINS = ['mail', 'contacts', 'calendar'] as const
export type ChangeDomain = (typeof CHANGE_DOMAINS)[number]

export type ChangeVersions = {
	version: number
	domains: Record<ChangeDomain, number>
}

function legacyKey(grantId: string): string {
	return `version:${grantId}`
}

function domainKey(grantId: string, domain: ChangeDomain): string {
	return `${legacyKey(grantId)}:${domain}`
}

function parseCounter(value: string | null): number | undefined {
	if (value === null || !/^\d+$/.test(value)) return undefined
	const parsed = Number(value)
	return Number.isSafeInteger(parsed) ? parsed : undefined
}

/**
 * Reads both the legacy aggregate counter and scoped counters. Existing KV
 * records created before scoped counters were introduced safely seed every
 * domain from the aggregate value. Once any scoped counter exists, absent or
 * malformed domain counters remain at zero so aggregate bumps do not invalidate
 * unrelated domains.
 */
export async function readChangeVersions(kv: KvLike | null, grantId: string): Promise<ChangeVersions> {
	if (!kv) return { version: 0, domains: { mail: 0, contacts: 0, calendar: 0 } }
	const [legacyValue, mailValue, contactsValue, calendarValue] = await Promise.all([
		kv.get(legacyKey(grantId)),
		kv.get(domainKey(grantId, 'mail')),
		kv.get(domainKey(grantId, 'contacts')),
		kv.get(domainKey(grantId, 'calendar')),
	])
	const version = parseCounter(legacyValue) ?? 0
	const hasScopedCounters = [mailValue, contactsValue, calendarValue].some((value) => value !== null)
	const fallback = hasScopedCounters ? 0 : version
	return {
		version,
		domains: {
			mail: parseCounter(mailValue) ?? fallback,
			contacts: parseCounter(contactsValue) ?? fallback,
			calendar: parseCounter(calendarValue) ?? fallback,
		},
	}
}

async function increment(kv: KvLike, key: string): Promise<void> {
	if (kv.increment) {
		await kv.increment(key)
		return
	}
	const current = parseCounter(await kv.get(key)) ?? 0
	await kv.put(key, String(current + 1))
}

/** Increments the aggregate signal and each affected domain signal. */
export async function bumpChangeVersionsInKv(
	kv: KvLike,
	grantId: string,
	domains: Iterable<ChangeDomain>,
): Promise<void> {
	const uniqueDomains = [...new Set(domains)]
	await Promise.all([
		increment(kv, legacyKey(grantId)),
		...uniqueDomains.map((domain) => increment(kv, domainKey(grantId, domain))),
	])
}

/**
 * Local mutations use the same signal as webhooks. Signaling is deliberately
 * best-effort: a provider mutation that already succeeded must not be reported
 * as failed merely because optional shared storage is unavailable.
 */
export async function signalLocalChange(grantId: string, ...domains: ChangeDomain[]): Promise<void> {
	try {
		const { kv } = await platform()
		if (kv) await bumpChangeVersionsInKv(kv, grantId, domains)
	} catch {
		// Polling/revalidation remains the fallback when shared storage is unavailable.
	}
}
