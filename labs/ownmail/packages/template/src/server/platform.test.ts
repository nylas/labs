import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
	for (const key of ['OWNMAIL_DEV_MOCKS', 'NODE_ENV', 'SESSION_SECRET']) {
		vi.stubEnv(key, undefined as unknown as string)
	}
	for (const [key, value] of Object.entries(overrides)) {
		vi.stubEnv(key, value as string)
	}
}

beforeEach(() => {
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
