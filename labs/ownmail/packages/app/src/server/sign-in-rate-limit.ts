/**
 * Brute-force throttling for the in-app sign-in form.
 *
 * OwnMail owns the credential-entry screen, so it also owns the brute-force
 * surface the Nylas hosted screen used to absorb — and UAS applies no rate
 * limiting of its own to `POST /v3/connect/login/nylas`. This is the only such
 * control in the path, so it has to hold under parallel requests, not just
 * sequential ones. Every counting path here is therefore atomic:
 *
 * 1. **Cloudflare Workers** (the default deployment) uses the native rate-limit
 *    binding, which is atomic at the edge. Cloudflare KV is deliberately NOT
 *    used for counting: it has no atomic increment and is eventually consistent
 *    (writes take up to ~60s to propagate), so a read-modify-write counter
 *    under-counts exactly when requests arrive together.
 * 2. **Redis-backed deployments** use `INCR`, then set the window TTL only for
 *    the first writer in that window. `EXPIRE` never touches the value, so a
 *    live counter can never be reset to 1 by a late TTL write.
 * 3. **Anything else** (no shared store, no edge limiter) falls back to a
 *    per-instance counter — see `countInMemory` for what that does and does not
 *    buy.
 *
 * Attempts are counted per mailbox and per client address, before any
 * credential is checked, so the outcome is identical for a real mailbox and one
 * that never existed. Identifiers are HMAC'd with the deployment secret before
 * they become keys, so no store holds a raw address or IP.
 *
 * Fail closed: if a limiter errors, the attempt is treated as rate-limited.
 */
import { type AppEnv, type KvLike, type Platform, platform } from './platform.js'

/**
 * Window lengths differ by store, deliberately. Cloudflare's binding supports
 * only a 10s or 60s period (declared in wrangler.jsonc); Redis can hold a long
 * window. Both bound guessing to the same per-minute rate — only how long the
 * limiter remembers differs — so user-facing copy must not promise a specific
 * lockout duration.
 */
const REDIS_WINDOW_SECONDS = 15 * 60
const MAX_ATTEMPTS_PER_EMAIL = 5
const MAX_ATTEMPTS_PER_IP = 20
/** Bounds the fallback limiter's memory when no shared store exists. */
const MAX_MEMORY_BUCKETS = 5000

type MemoryCounter = { count: number; expiresAt: number }

const memoryCounters = new Map<string, MemoryCounter>()

/**
 * Counts one sign-in attempt. Returns true when the attempt is over budget and
 * must be rejected before any credential is checked.
 */
export async function signInAttemptIsRateLimited(email: string, ip: string): Promise<boolean> {
	let runtime: Platform
	try {
		runtime = await platform()
	} catch {
		return true
	}
	let emailKey: string
	let ipKey: string
	try {
		const secret = runtime.env.SESSION_SECRET
		emailKey = `email:${await keyDigest(secret, canonicalEmail(email))}`
		ipKey = `ip:${await keyDigest(secret, ip)}`
	} catch {
		return true
	}
	// Both dimensions are always counted, so one being over budget — or failing —
	// never stops the other from recording the attempt. `allSettled` keeps a
	// failure on one dimension from abandoning the other mid-flight.
	const outcomes = await Promise.allSettled([
		overBudget(runtime, runtime.env.SIGNIN_EMAIL_LIMITER, emailKey, MAX_ATTEMPTS_PER_EMAIL),
		overBudget(runtime, runtime.env.SIGNIN_IP_LIMITER, ipKey, MAX_ATTEMPTS_PER_IP),
	])
	// A limiter that could not answer is treated as over budget: fail closed.
	return outcomes.some((outcome) => outcome.status === 'rejected' || outcome.value)
}

/** Resolves the client address behind the deployment's proxy, or a shared bucket. */
export function clientIp(request: Request): string {
	const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')
	const candidate = forwarded?.split(',')[0]?.trim()
	return candidate && candidate.length <= 64 ? candidate : 'unknown'
}

async function overBudget(
	runtime: Platform,
	binding: AppEnv['SIGNIN_EMAIL_LIMITER'],
	key: string,
	maxAttempts: number,
): Promise<boolean> {
	if (binding) {
		// Atomic at the edge: a parallel burst cannot slip past this the way a
		// read-modify-write counter would.
		const { success } = await binding.limit({ key })
		return !success
	}
	const kv = runtime.kv
	const windowKey = `signin:${currentWindow()}:${key}`
	if (kv?.increment && kv.expire) return (await countInRedis(kv, windowKey)) > maxAttempts
	return countInMemory(windowKey) > maxAttempts
}

/**
 * `INCR` is atomic and returns this caller's own count. The TTL is attached
 * separately, and only by the first writer in the window — `EXPIRE` leaves the
 * value alone, so no late write can reset a counter other requests have already
 * advanced.
 */
async function countInRedis(kv: KvLike, key: string): Promise<number> {
	const count = await (kv.increment as NonNullable<KvLike['increment']>)(key)
	if (count === 1) await (kv.expire as NonNullable<KvLike['expire']>)(key, REDIS_WINDOW_SECONDS)
	return count
}

/**
 * Per-instance fallback for deployments with no shared store and no edge
 * limiter — the same durability trade-off stateless sessions already accept. It
 * is atomic within an isolate (nothing awaits between its read and its write)
 * but is NOT shared across instances, so it bounds a sustained attack against
 * any one instance rather than the deployment as a whole. It refuses attempts
 * outright once tracking would grow without bound.
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
	memoryCounters.set(key, { count: 1, expiresAt: now + REDIS_WINDOW_SECONDS * 1000 })
	return 1
}

/** Window-bucketed keys rotate on their own, so a stale bucket cannot strand anyone. */
function currentWindow(): number {
	return Math.floor(Date.now() / (REDIS_WINDOW_SECONDS * 1000))
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
