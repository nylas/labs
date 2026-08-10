import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => ({
	get: vi.fn(),
	set: vi.fn(),
	del: vi.fn(),
	incr: vi.fn(),
	expire: vi.fn(),
}))

vi.mock('@upstash/redis', () => ({
	Redis: class {
		get = redis.get
		set = redis.set
		del = redis.del
		incr = redis.incr
		expire = redis.expire
	},
}))

/**
 * platform() memoizes at module scope and branches on the process env plus the
 * availability of the `cloudflare:workers` module. Every case therefore resets
 * modules (to clear the cached Platform) and controls the env explicitly, since
 * the real deployment target is only known at runtime.
 */

const REQUIRED_ENV = {
	NYLAS_API_KEY: 'key',
	NYLAS_CLIENT_ID: 'client',
	NYLAS_REGION: 'us',
	APP_NAME: 'ownmail',
	INBOX_EMAIL: 'ada@ownmail.com',
	TEMPLATE_VERSION: '0.1.0',
}

function setEnv(overrides: Record<string, string | undefined>): void {
	// Start from a clean slate for the fields platform() reads, then apply.
	for (const key of [
		'OWNMAIL_DEV_MOCKS',
		'NODE_ENV',
		'SESSION_SECRET',
		'UPSTASH_REDIS_REST_URL',
		'UPSTASH_REDIS_REST_TOKEN',
	]) {
		vi.stubEnv(key, undefined as unknown as string)
	}
	for (const [key, value] of Object.entries(overrides)) {
		vi.stubEnv(key, value as string)
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.resetModules()
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.doUnmock('cloudflare:workers')
	vi.resetModules()
})

describe('platform()', () => {
	it('uses the node runtime with no KV when dev mocks are enabled locally', async () => {
		setEnv({ OWNMAIL_DEV_MOCKS: '1', NODE_ENV: 'development', SESSION_SECRET: 'secret' })
		const { platform, usingDevMocks } = await import('./platform.js')

		const p = await platform()
		expect(p.runtime).toBe('node')
		expect(p.kv).toBeNull()
		expect(p.env.SESSION_SECRET).toBe('secret')
		// Dev-mock stateless sessions run without KV, so this must report true.
		expect(await usingDevMocks()).toBe(true)
	})

	it('memoizes the resolved platform so repeated callers share one instance', async () => {
		setEnv({ OWNMAIL_DEV_MOCKS: '1', NODE_ENV: 'development', SESSION_SECRET: 'secret' })
		const { platform } = await import('./platform.js')

		const first = await platform()
		const second = await platform()
		expect(second).toBe(first)
	})

	it('refuses to start in dev-mock mode without a SESSION_SECRET to sign cookies', async () => {
		setEnv({ OWNMAIL_DEV_MOCKS: '1', NODE_ENV: 'development' })
		const { platform } = await import('./platform.js')

		await expect(platform()).rejects.toThrow('SESSION_SECRET not configured')
	})

	it('binds KV from the Workers env when SESSIONS is bound', async () => {
		const sessions = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
		vi.doMock('cloudflare:workers', () => ({
			env: { ...REQUIRED_ENV, SESSION_SECRET: 'cf', SESSIONS: sessions },
		}))
		setEnv({})
		const { platform, usingDevMocks } = await import('./platform.js')

		const p = await platform()
		expect(p.runtime).toBe('cloudflare')
		expect(p.kv).toBe(sessions)
		// On Cloudflare we are never in dev-mock mode regardless of the flag.
		expect(await usingDevMocks()).toBe(false)
	})

	it('runs statelessly on Cloudflare when no SESSIONS KV namespace is bound', async () => {
		// The default test stub for cloudflare:workers exports `env = {}` (no SESSIONS).
		setEnv({})
		const { platform } = await import('./platform.js')

		const p = await platform()
		expect(p.runtime).toBe('cloudflare')
		expect(p.kv).toBeNull()
	})

	it('falls back to the node runtime when the Workers module is unavailable', async () => {
		vi.doMock('cloudflare:workers', () => {
			throw new Error('not a workers runtime')
		})
		setEnv({ SESSION_SECRET: 'node-secret' })
		const { platform } = await import('./platform.js')

		const p = await platform()
		expect(p.runtime).toBe('node')
		expect(p.kv).toBeNull()
		expect(p.env.SESSION_SECRET).toBe('node-secret')
	})

	it('binds serverless Redis storage on the node runtime when Vercel injects both credentials', async () => {
		vi.doMock('cloudflare:workers', () => {
			throw new Error('not a workers runtime')
		})
		setEnv({
			SESSION_SECRET: 'node-secret',
			UPSTASH_REDIS_REST_URL: 'https://ownmail.upstash.io',
			UPSTASH_REDIS_REST_TOKEN: 'redis-token',
		})
		const { platform } = await import('./platform.js')

		const p = await platform()
		expect(p.runtime).toBe('node')
		expect(p.kv).toEqual(
			expect.objectContaining({
				get: expect.any(Function),
				put: expect.any(Function),
				delete: expect.any(Function),
				increment: expect.any(Function),
				expire: expect.any(Function),
				putIfAbsent: expect.any(Function),
			}),
		)
		redis.get.mockResolvedValue('value')
		redis.set.mockResolvedValue('OK')
		redis.del.mockResolvedValue(1)
		redis.incr.mockResolvedValue(2)
		redis.expire.mockResolvedValue(1)
		await expect(p.kv?.get('key')).resolves.toBe('value')
		await p.kv?.put('key', 'value', { expirationTtl: 60 })
		await p.kv?.put('key', 'value')
		await p.kv?.delete('key')
		await expect(p.kv?.increment?.('key')).resolves.toBe(2)
		// EXPIRE attaches the TTL without touching the value, so a rate-limit
		// counter is never reset by the write that gives it a lifetime.
		await p.kv?.expire?.('key', 900)
		await expect(p.kv?.putIfAbsent?.('claim', '1', 600)).resolves.toBe(true)
		expect(redis.expire).toHaveBeenCalledWith('key', 900)
		expect(redis.set).toHaveBeenNthCalledWith(1, 'key', 'value', { ex: 60 })
		expect(redis.set).toHaveBeenNthCalledWith(2, 'key', 'value', undefined)
		expect(redis.set).toHaveBeenNthCalledWith(3, 'claim', '1', { nx: true, ex: 600 })
	})

	it.each([
		['only a URL', { UPSTASH_REDIS_REST_URL: 'https://ownmail.upstash.io' }],
		['only a token', { UPSTASH_REDIS_REST_TOKEN: 'redis-token' }],
		[
			'an untrusted URL',
			{
				UPSTASH_REDIS_REST_URL: 'https://attacker.example.com',
				UPSTASH_REDIS_REST_TOKEN: 'redis-token',
			},
		],
		['a malformed URL', { UPSTASH_REDIS_REST_URL: 'not a URL', UPSTASH_REDIS_REST_TOKEN: 'redis-token' }],
		[
			'an invalid credential',
			{
				UPSTASH_REDIS_REST_URL: 'https://ownmail.upstash.io',
				UPSTASH_REDIS_REST_TOKEN: 'bad\ncredential',
			},
		],
	] as const)('fails closed for %s in the node storage configuration', async (_case, storageEnv) => {
		vi.doMock('cloudflare:workers', () => {
			throw new Error('not a workers runtime')
		})
		setEnv({ SESSION_SECRET: 'node-secret', ...storageEnv })
		const { platform } = await import('./platform.js')

		await expect(platform()).rejects.toThrow(/realtime storage/)
	})

	it('throws in the node fallback when SESSION_SECRET is missing', async () => {
		vi.doMock('cloudflare:workers', () => {
			throw new Error('not a workers runtime')
		})
		setEnv({})
		const { platform } = await import('./platform.js')

		await expect(platform()).rejects.toThrow('SESSION_SECRET not configured')
	})

	it('does not treat production as dev mocks even with the flag and a node fallback', async () => {
		// Flag on but NODE_ENV=production: the dev branch is skipped, and because the
		// Workers module is unavailable we land in the node fallback — usingDevMocks
		// must still be false so production never serves mock data.
		vi.doMock('cloudflare:workers', () => {
			throw new Error('not a workers runtime')
		})
		setEnv({ OWNMAIL_DEV_MOCKS: '1', NODE_ENV: 'production', SESSION_SECRET: 'prod-secret' })
		const { platform, usingDevMocks } = await import('./platform.js')

		const p = await platform()
		expect(p.runtime).toBe('node')
		expect(await usingDevMocks()).toBe(false)
	})
})
