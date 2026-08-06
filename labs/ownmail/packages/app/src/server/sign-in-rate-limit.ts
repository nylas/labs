/**
 * Brute-force throttling for the in-app sign-in form.
 *
 * OwnMail now owns the credential-entry screen, so it also owns the brute-force
 * surface that the Nylas hosted screen used to absorb. Every attempt is counted
 * twice — once per mailbox address and once per client IP — inside a fixed time
 * window. Exceeding either budget locks further attempts out until the window
 * rolls over.
 *
 * Counter keys are window-bucketed, so they rotate on their own and a stale
 * bucket can never keep an address locked out. Addresses and IPs are keyed by
 * an HMAC of the deployment secret, so the counter store never holds — nor can
 * it be enumerated for — a raw identifier.
 *
 * Fail closed: if the counter store errors, the attempt is treated as
 * rate-limited rather than allowed through unmetered.
 */
import { type KvLike, platform } from './platform.js'

const WINDOW_SECONDS = 15 * 60
const MAX_ATTEMPTS_PER_EMAIL = 5
const MAX_ATTEMPTS_PER_IP = 20
/** Bounds the fallback limiter's memory when no shared counter store exists. */
const MAX_MEMORY_BUCKETS = 5000

type MemoryCounter = { count: number; expiresAt: number }

const memoryCounters = new Map<string, MemoryCounter>()

/**
 * Counts one sign-in attempt. Returns true when the attempt is over budget and
 * must be rejected before any credential is checked.
 */
export async function signInAttemptIsRateLimited(email: string, ip: string): Promise<boolean> {
	let kv: KvLike | null
	let secret: string
	try {
		const runtime = await platform()
		kv = runtime.kv
		secret = runtime.env.SESSION_SECRET
	} catch {
		return true
	}
	const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000))
	const emailCount = await countAttempt(
		kv,
		`signin:email:${window}:${await keyDigest(secret, canonicalEmail(email))}`,
	)
	const ipCount = await countAttempt(kv, `signin:ip:${window}:${await keyDigest(secret, ip)}`)
	return emailCount > MAX_ATTEMPTS_PER_EMAIL || ipCount > MAX_ATTEMPTS_PER_IP
}

/** Resolves the client address behind the deployment's proxy, or a shared bucket. */
export function clientIp(request: Request): string {
	const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')
	const candidate = forwarded?.split(',')[0]?.trim()
	return candidate && candidate.length <= 64 ? candidate : 'unknown'
}

/** Returns the running attempt count for this window, or Infinity if it cannot be established. */
async function countAttempt(kv: KvLike | null, key: string): Promise<number> {
	if (!kv) return countInMemory(key)
	try {
		if (kv.increment) {
			const count = await kv.increment(key)
			// Stores expose no standalone expire, so the first writer in a window
			// re-writes the same value with a TTL to keep buckets from accumulating.
			if (count === 1) await kv.put(key, '1', { expirationTtl: WINDOW_SECONDS })
			return count
		}
		const previous = Number.parseInt((await kv.get(key)) ?? '', 10)
		const count = (Number.isSafeInteger(previous) && previous > 0 ? previous : 0) + 1
		await kv.put(key, String(count), { expirationTtl: WINDOW_SECONDS })
		return count
	} catch {
		return Number.POSITIVE_INFINITY
	}
}

/**
 * Per-instance fallback for deployments with no shared store — the same
 * durability trade-off stateless sessions already accept. It still bounds a
 * sustained attack against any one instance, and refuses attempts outright once
 * tracking would grow without bound.
 */
function countInMemory(key: string): number {
	const now = Date.now()
	for (const [existing, counter] of memoryCounters) {
		if (counter.expiresAt <= now) memoryCounters.delete(existing)
	}
	const current = memoryCounters.get(key)
	if (current) {
		current.count += 1
		return current.count
	}
	if (memoryCounters.size >= MAX_MEMORY_BUCKETS) return Number.POSITIVE_INFINITY
	memoryCounters.set(key, { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 })
	return 1
}

function canonicalEmail(email: string): string {
	return email.trim().toLocaleLowerCase('en-US')
}

/** Keeps raw, enumerable identifiers out of counter keys. */
async function keyDigest(secret: string, value: string): Promise<string> {
	const encoder = new TextEncoder()
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
	return [...new Uint8Array(digest)]
		.slice(0, 16)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}
