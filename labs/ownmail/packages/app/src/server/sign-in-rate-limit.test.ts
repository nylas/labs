import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike, RateLimiterBinding } from './platform.js'

/**
 * This limiter is the only brute-force control in the sign-in path — UAS applies
 * none to `POST /v3/connect/login/nylas` — so these tests are written against
 * the property that matters: attempts arriving *together* must not be able to
 * exceed the budget. Each supported store is exercised deliberately, because
 * they carry different atomicity guarantees.
 */
const platformMock = vi.fn()
vi.mock('./platform.js', () => ({ platform: () => platformMock() }))

const { clientIp, signInAttemptIsRateLimited } = await import('./sign-in-rate-limit.js')

type RecordingKv = KvLike & { gets: string[]; puts: string[]; expires: { key: string; seconds: number }[] }

/** Redis semantics: INCR is atomic and returns the caller's own count. */
function redisKv(): RecordingKv {
	const counters = new Map<string, number>()
	const kv: RecordingKv = {
		gets: [],
		puts: [],
		expires: [],
		get: async (key) => {
			kv.gets.push(key)
			return counters.get(key)?.toString() ?? null
		},
		put: async (key) => {
			kv.puts.push(key)
		},
		delete: async () => {},
		increment: async (key) => {
			const next = (counters.get(key) ?? 0) + 1
			counters.set(key, next)
			await Promise.resolve()
			return next
		},
		expire: async (key, seconds) => {
			kv.expires.push({ key, seconds })
		},
	}
	return kv
}

/** Cloudflare KV: no atomic increment, no expire — must never be used for counting. */
function cloudflareKv(): RecordingKv {
	const kv: RecordingKv = {
		gets: [],
		puts: [],
		expires: [],
		get: async (key) => {
			kv.gets.push(key)
			return null
		},
		put: async (key) => {
			kv.puts.push(key)
		},
		delete: async () => {},
	}
	return kv
}

/** Stands in for Cloudflare's edge limiter: one atomic counter per key. */
function edgeLimiter(limit: number): RateLimiterBinding & { keys: string[] } {
	const counts = new Map<string, number>()
	const keys: string[] = []
	return {
		keys,
		limit: async ({ key }) => {
			keys.push(key)
			const next = (counts.get(key) ?? 0) + 1
			counts.set(key, next)
			await Promise.resolve()
			return { success: next <= limit }
		},
	}
}

function useRuntime(options: { kv?: KvLike | null; env?: Record<string, unknown> } = {}) {
	platformMock.mockResolvedValue({
		env: { SESSION_SECRET: 'test-secret', ...options.env },
		kv: options.kv ?? null,
		runtime: 'node',
	})
}

/** Distinct identifiers per test keep the module-level fallback counters independent. */
let seed = 0
function nextEmail(): string {
	seed += 1
	return `user${seed}@ownmail.com`
}
function nextIp(): string {
	seed += 1
	return `198.51.${(seed >> 8) & 255}.${seed & 255}`
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('signInAttemptIsRateLimited on Cloudflare Workers', () => {
	it('delegates both dimensions to the edge limiter and never counts in KV', async () => {
		const kv = cloudflareKv()
		const emailLimiter = edgeLimiter(5)
		const ipLimiter = edgeLimiter(20)
		useRuntime({ kv, env: { SIGNIN_EMAIL_LIMITER: emailLimiter, SIGNIN_IP_LIMITER: ipLimiter } })

		expect(await signInAttemptIsRateLimited('ada@ownmail.com', '198.51.100.1')).toBe(false)

		expect(emailLimiter.keys).toHaveLength(1)
		expect(ipLimiter.keys).toHaveLength(1)
		// KV is eventually consistent with no atomic increment; counting there
		// would under-count exactly when requests arrive together.
		expect(kv.gets).toEqual([])
		expect(kv.puts).toEqual([])
	})

	/**
	 * The regression this file exists for: twelve simultaneous guesses at one
	 * mailbox must yield exactly the budget, not "however many raced through".
	 */
	it('cannot be beaten by parallel guesses at one mailbox', async () => {
		useRuntime({
			kv: cloudflareKv(),
			env: { SIGNIN_EMAIL_LIMITER: edgeLimiter(5), SIGNIN_IP_LIMITER: edgeLimiter(20) },
		})
		const email = nextEmail()

		const outcomes = await Promise.all(
			Array.from({ length: 12 }, () => signInAttemptIsRateLimited(email, nextIp())),
		)

		expect(outcomes.filter((limited) => !limited)).toHaveLength(5)
	})

	it('cannot be beaten by one address spreading parallel guesses across mailboxes', async () => {
		useRuntime({
			kv: cloudflareKv(),
			env: { SIGNIN_EMAIL_LIMITER: edgeLimiter(5), SIGNIN_IP_LIMITER: edgeLimiter(20) },
		})
		const ip = nextIp()

		const outcomes = await Promise.all(
			Array.from({ length: 40 }, () => signInAttemptIsRateLimited(nextEmail(), ip)),
		)

		expect(outcomes.filter((limited) => !limited)).toHaveLength(20)
	})

	it('keeps counting the client address even when the mailbox is already over budget', async () => {
		const ipLimiter = edgeLimiter(20)
		useRuntime({ env: { SIGNIN_EMAIL_LIMITER: edgeLimiter(1), SIGNIN_IP_LIMITER: ipLimiter } })
		const email = nextEmail()

		await signInAttemptIsRateLimited(email, '198.51.100.2')
		await signInAttemptIsRateLimited(email, '198.51.100.2')

		expect(ipLimiter.keys).toHaveLength(2)
	})

	it('never hands a raw mailbox address or IP to the edge limiter', async () => {
		const emailLimiter = edgeLimiter(5)
		const ipLimiter = edgeLimiter(20)
		useRuntime({ env: { SIGNIN_EMAIL_LIMITER: emailLimiter, SIGNIN_IP_LIMITER: ipLimiter } })

		await signInAttemptIsRateLimited('ada@ownmail.com', '198.51.100.3')

		expect(emailLimiter.keys[0]).not.toContain('ada@ownmail.com')
		expect(ipLimiter.keys[0]).not.toContain('198.51.100.3')
	})

	it('fails closed when the edge limiter itself errors', async () => {
		useRuntime({
			env: {
				SIGNIN_EMAIL_LIMITER: {
					limit: async () => {
						throw new Error('limiter unavailable')
					},
				},
				SIGNIN_IP_LIMITER: edgeLimiter(20),
			},
		})

		expect(await signInAttemptIsRateLimited(nextEmail(), nextIp())).toBe(true)
	})
})

describe('signInAttemptIsRateLimited on a Redis-backed store', () => {
	it('locks a mailbox out after its budget and keeps it locked within the window', async () => {
		useRuntime({ kv: redisKv() })
		const email = nextEmail()

		const attempts: boolean[] = []
		for (let i = 0; i < 7; i++) attempts.push(await signInAttemptIsRateLimited(email, '198.51.100.4'))

		expect(attempts).toEqual([false, false, false, false, false, true, true])
	})

	/**
	 * Mutation check: this is what fails if the TTL is ever re-attached by
	 * rewriting the value (`put(key, '1')`) instead of `EXPIRE`. A late write
	 * like that lands after other increments and resets a live counter.
	 */
	it('attaches the window TTL without ever rewriting a live counter', async () => {
		const kv = redisKv()
		useRuntime({ kv })
		const email = nextEmail()

		for (let i = 0; i < 3; i++) await signInAttemptIsRateLimited(email, '198.51.100.5')

		expect(kv.puts).toEqual([])
		expect(kv.gets).toEqual([])
		// Only the first writer in each window bucket stamps the TTL.
		expect(kv.expires).toHaveLength(2)
		expect(kv.expires.every((call) => call.seconds === 900)).toBe(true)
	})

	it('cannot be beaten by parallel guesses at one mailbox', async () => {
		const kv = redisKv()
		useRuntime({ kv })
		const email = nextEmail()

		const outcomes = await Promise.all(
			Array.from({ length: 12 }, () => signInAttemptIsRateLimited(email, nextIp())),
		)

		expect(outcomes.filter((limited) => !limited)).toHaveLength(5)
		expect(kv.puts).toEqual([])
	})

	it('forgets attempts once the time window rolls over', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		useRuntime({ kv: redisKv() })
		const email = nextEmail()
		for (let i = 0; i < 6; i++) await signInAttemptIsRateLimited(email, '198.51.100.6')
		expect(await signInAttemptIsRateLimited(email, '198.51.100.6')).toBe(true)

		vi.setSystemTime(new Date('2026-01-01T00:16:00Z'))

		expect(await signInAttemptIsRateLimited(email, '198.51.100.6')).toBe(false)
	})

	it('never puts a raw mailbox address or IP into a counter key', async () => {
		const kv = redisKv()
		useRuntime({ kv })

		await signInAttemptIsRateLimited('ada@ownmail.com', '198.51.100.7')

		expect(kv.expires).not.toHaveLength(0)
		for (const call of kv.expires) {
			expect(call.key).not.toContain('ada@ownmail.com')
			expect(call.key).not.toContain('198.51.100.7')
		}
	})

	it('fails closed when the counter store errors rather than letting the attempt through', async () => {
		useRuntime({
			kv: {
				get: async () => null,
				put: async () => {},
				delete: async () => {},
				increment: async () => {
					throw new Error('store offline')
				},
				expire: async () => {},
			},
		})

		expect(await signInAttemptIsRateLimited(nextEmail(), nextIp())).toBe(true)
	})
})

describe('signInAttemptIsRateLimited without an atomic shared counter', () => {
	it('falls back to per-instance counting rather than a non-atomic KV counter', async () => {
		const kv = cloudflareKv()
		useRuntime({ kv })
		const email = nextEmail()

		const attempts: boolean[] = []
		for (let i = 0; i < 6; i++) attempts.push(await signInAttemptIsRateLimited(email, '198.51.100.8'))

		expect(attempts).toEqual([false, false, false, false, false, true])
		expect(kv.gets).toEqual([])
		expect(kv.puts).toEqual([])
	})

	it('holds under parallel attempts within an instance', async () => {
		useRuntime()
		const email = nextEmail()

		const outcomes = await Promise.all(
			Array.from({ length: 12 }, () => signInAttemptIsRateLimited(email, nextIp())),
		)

		expect(outcomes.filter((limited) => !limited)).toHaveLength(5)
	})

	it('expires per-instance counters when the window rolls over', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-02-01T00:00:00Z'))
		useRuntime()
		const email = nextEmail()
		for (let i = 0; i < 6; i++) await signInAttemptIsRateLimited(email, '198.51.100.9')

		vi.setSystemTime(new Date('2026-02-01T00:31:00Z'))

		expect(await signInAttemptIsRateLimited(email, '198.51.100.9')).toBe(false)
	})

	it('refuses attempts outright rather than letting per-instance tracking grow without bound', async () => {
		useRuntime()
		// Each attempt opens two buckets (mailbox + address); fill the cap, then ask for one more.
		for (let i = 0; i < 2500; i++) await signInAttemptIsRateLimited(nextEmail(), `10.0.${i >> 8}.${i & 255}`)

		expect(await signInAttemptIsRateLimited(nextEmail(), '198.51.100.10')).toBe(true)
	})

	it('fails closed when the platform itself is unavailable', async () => {
		platformMock.mockRejectedValue(new Error('Platform env unavailable'))

		expect(await signInAttemptIsRateLimited(nextEmail(), nextIp())).toBe(true)
	})

	it('fails closed when counter keys cannot be derived at all', async () => {
		useRuntime()
		const importKey = vi
			.spyOn(crypto.subtle, 'importKey')
			.mockRejectedValue(new Error('secret unusable') as never)

		expect(await signInAttemptIsRateLimited(nextEmail(), nextIp())).toBe(true)
		importKey.mockRestore()
	})
})

/**
 * The Workers path is only atomic if the bindings actually exist. `ownmail
 * deploy` copies this config through, patching only name, KV id, vars, and
 * routes — so losing them here silently downgrades every Cloudflare deployment
 * to the per-instance fallback.
 */
describe('wrangler template', () => {
	const config = readFileSync(fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)), 'utf8')

	it('declares the edge rate-limit bindings the sign-in limiter depends on', () => {
		expect(config).toMatch(
			/"name": "SIGNIN_EMAIL_LIMITER",\s*"namespace_id": "\d+",\s*"simple": \{ "limit": 5, "period": 60 \}/,
		)
		expect(config).toMatch(
			/"name": "SIGNIN_IP_LIMITER",\s*"namespace_id": "\d+",\s*"simple": \{ "limit": 20, "period": 60 \}/,
		)
	})
})

describe('clientIp', () => {
	it.each([
		{
			label: 'the Cloudflare client IP',
			headers: { 'cf-connecting-ip': '198.51.100.11' },
			expected: '198.51.100.11',
		},
		{
			label: 'the first forwarded hop',
			headers: { 'x-forwarded-for': '198.51.100.12, 10.0.0.1' },
			expected: '198.51.100.12',
		},
		{
			label: 'the platform header over a spoofable forwarded chain',
			headers: { 'cf-connecting-ip': '198.51.100.13', 'x-forwarded-for': '1.1.1.1' },
			expected: '198.51.100.13',
		},
	])('reads $label', ({ headers, expected }) => {
		expect(clientIp(new Request('https://ownmail.local/auth/signin', { headers }))).toBe(expected)
	})

	it.each([
		{ label: 'no address headers', headers: {} },
		{ label: 'an empty header', headers: { 'x-forwarded-for': '   ' } },
		{ label: 'an implausibly long value', headers: { 'cf-connecting-ip': 'a'.repeat(65) } },
	])('buckets $label together rather than skipping the limit', ({ headers }) => {
		expect(clientIp(new Request('https://ownmail.local/auth/signin', { headers }))).toBe('unknown')
	})
})
