import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from './platform.js'

/**
 * The limiter resolves its counter store through platform(), so each test picks
 * the store deliberately: a shared store with an atomic counter, a shared store
 * without one, no store at all, and a store that fails. Those four cases carry
 * different security guarantees.
 */
const platformMock = vi.fn()
vi.mock('./platform.js', () => ({ platform: () => platformMock() }))

const { clientIp, signInAttemptIsRateLimited } = await import('./sign-in-rate-limit.js')

type CountingKv = KvLike & { puts: { key: string; ttl?: number }[] }

function atomicKv(): CountingKv {
	const counters = new Map<string, number>()
	const puts: { key: string; ttl?: number }[] = []
	return {
		puts,
		get: async (key) => counters.get(key)?.toString() ?? null,
		put: async (key, _value, options) => {
			puts.push({ key, ttl: options?.expirationTtl })
		},
		delete: async () => {},
		increment: async (key) => {
			const next = (counters.get(key) ?? 0) + 1
			counters.set(key, next)
			return next
		},
	}
}

function readWriteKv(): CountingKv {
	const store = new Map<string, string>()
	const puts: { key: string; ttl?: number }[] = []
	return {
		puts,
		get: async (key) => store.get(key) ?? null,
		put: async (key, value, options) => {
			store.set(key, value)
			puts.push({ key, ttl: options?.expirationTtl })
		},
		delete: async () => {},
	}
}

function useKv(kv: KvLike | null) {
	platformMock.mockResolvedValue({ env: { SESSION_SECRET: 'test-secret' }, kv, runtime: 'node' })
}

/** Distinct addresses per test keep the module-level fallback counters independent. */
let mailbox = 0
function nextEmail(): string {
	mailbox += 1
	return `user${mailbox}@ownmail.com`
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('signInAttemptIsRateLimited', () => {
	it('locks a mailbox out after its attempt budget and keeps it locked within the window', async () => {
		useKv(atomicKv())
		const email = nextEmail()
		const attempts: boolean[] = []
		for (let i = 0; i < 7; i++) attempts.push(await signInAttemptIsRateLimited(email, '198.51.100.7'))

		// Five attempts are allowed; everything after is refused before any credential check.
		expect(attempts).toEqual([false, false, false, false, false, true, true])
	})

	it('locks an IP out even while it spreads guesses across different mailboxes', async () => {
		useKv(atomicKv())
		const ip = '203.0.113.9'
		let limited = false
		for (let i = 0; i < 20; i++) limited = await signInAttemptIsRateLimited(nextEmail(), ip)
		expect(limited).toBe(false)

		expect(await signInAttemptIsRateLimited(nextEmail(), ip)).toBe(true)
	})

	it('forgets attempts once the time window rolls over', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
		useKv(atomicKv())
		const email = nextEmail()
		for (let i = 0; i < 6; i++) await signInAttemptIsRateLimited(email, '198.51.100.8')
		expect(await signInAttemptIsRateLimited(email, '198.51.100.8')).toBe(true)

		vi.setSystemTime(new Date('2026-01-01T00:16:00Z'))

		expect(await signInAttemptIsRateLimited(email, '198.51.100.8')).toBe(false)
	})

	it('gives each counter bucket a TTL so windows cannot accumulate forever', async () => {
		const kv = atomicKv()
		useKv(kv)

		await signInAttemptIsRateLimited(nextEmail(), '198.51.100.10')
		await signInAttemptIsRateLimited(nextEmail(), '198.51.100.10')

		// Only the first writer in a bucket stamps the TTL; the IP bucket is shared.
		expect(kv.puts.map((put) => put.ttl)).toEqual([900, 900, 900])
	})

	it('never puts a raw mailbox address or IP into a counter key', async () => {
		const kv = atomicKv()
		useKv(kv)

		await signInAttemptIsRateLimited('ada@ownmail.com', '198.51.100.11')

		expect(kv.puts).not.toHaveLength(0)
		for (const put of kv.puts) {
			expect(put.key).not.toContain('ada@ownmail.com')
			expect(put.key).not.toContain('198.51.100.11')
		}
	})

	it('still counts on a store with no atomic increment', async () => {
		useKv(readWriteKv())
		const email = nextEmail()
		const attempts: boolean[] = []
		for (let i = 0; i < 6; i++) attempts.push(await signInAttemptIsRateLimited(email, '198.51.100.12'))

		expect(attempts.at(-1)).toBe(true)
	})

	it('recovers from a corrupt counter value instead of trusting it', async () => {
		const kv = readWriteKv()
		await kv.put('unused', 'x')
		useKv({ ...kv, get: async () => 'not-a-number' })

		expect(await signInAttemptIsRateLimited(nextEmail(), '198.51.100.13')).toBe(false)
	})

	it('falls back to per-instance counting when the deployment has no shared store', async () => {
		useKv(null)
		const email = nextEmail()
		const attempts: boolean[] = []
		for (let i = 0; i < 6; i++) attempts.push(await signInAttemptIsRateLimited(email, '198.51.100.14'))

		expect(attempts).toEqual([false, false, false, false, false, true])
	})

	it('expires per-instance counters when the window rolls over', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-02-01T00:00:00Z'))
		useKv(null)
		const email = nextEmail()
		for (let i = 0; i < 6; i++) await signInAttemptIsRateLimited(email, '198.51.100.15')

		vi.setSystemTime(new Date('2026-02-01T00:31:00Z'))

		expect(await signInAttemptIsRateLimited(email, '198.51.100.15')).toBe(false)
	})

	it('refuses attempts outright rather than letting per-instance tracking grow without bound', async () => {
		useKv(null)
		// Each attempt opens two buckets (mailbox + IP); fill the cap, then ask for one more.
		for (let i = 0; i < 2500; i++) await signInAttemptIsRateLimited(nextEmail(), `10.0.${i >> 8}.${i & 255}`)

		expect(await signInAttemptIsRateLimited(nextEmail(), '198.51.100.99')).toBe(true)
	})

	it('fails closed when the counter store errors rather than letting the attempt through', async () => {
		useKv({
			get: async () => {
				throw new Error('store offline')
			},
			put: async () => {},
			delete: async () => {},
		})

		expect(await signInAttemptIsRateLimited(nextEmail(), '198.51.100.16')).toBe(true)
	})

	it('fails closed when the platform itself is unavailable', async () => {
		platformMock.mockRejectedValue(new Error('Platform env unavailable'))

		expect(await signInAttemptIsRateLimited(nextEmail(), '198.51.100.17')).toBe(true)
	})
})

describe('clientIp', () => {
	it.each([
		{
			label: 'the Cloudflare client IP',
			headers: { 'cf-connecting-ip': '198.51.100.1' },
			expected: '198.51.100.1',
		},
		{
			label: 'the first forwarded hop',
			headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' },
			expected: '198.51.100.2',
		},
		{
			label: 'the platform header over a spoofable forwarded chain',
			headers: { 'cf-connecting-ip': '198.51.100.3', 'x-forwarded-for': '1.1.1.1' },
			expected: '198.51.100.3',
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
