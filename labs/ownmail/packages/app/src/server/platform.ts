import { Redis } from '@upstash/redis'

/**
 * Platform abstraction: Cloudflare Workers (env + KV via cloudflare:workers)
 * or a Node-ish runtime like Vercel functions (process.env + optional Upstash).
 *
 * Without shared storage the app runs in stateless mode: sessions and PKCE
 * state live in signed cookies, and the realtime version signal degrades
 * gracefully.
 */

export type AppEnv = {
	NYLAS_API_KEY: string
	SESSION_SECRET: string
	NYLAS_WEBHOOK_SECRET?: string
	NYLAS_CLIENT_ID: string
	NYLAS_REGION: 'us' | 'eu'
	NYLAS_API_BASE_URL?: string
	UPSTASH_REDIS_REST_URL?: string
	UPSTASH_REDIS_REST_TOKEN?: string
	OWNMAIL_SHARED_STORAGE?: 'enabled' | 'disabled'
	OWNMAIL_DEV_MOCKS?: string
	/** Explicit opt-in for authenticated mailbox password changes in the web UI. */
	OWNMAIL_ALLOW_PASSWORD_RESET?: string
	/** Optional, display-safe branding for the web app. */
	OWNMAIL_SITE_NAME?: string
	APP_NAME: string
	INBOX_EMAIL: string
	TEMPLATE_VERSION: string
}

export type KvLike = {
	get(key: string): Promise<string | null>
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
	delete(key: string): Promise<void>
	increment?(key: string): Promise<number>
}

export type Platform = { env: AppEnv; kv: KvLike | null; runtime: 'cloudflare' | 'node' }

let cached: Platform | null = null

export async function platform(): Promise<Platform> {
	if (cached) return cached
	const rawProcessEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
	const processEnv = rawProcessEnv as unknown as AppEnv | undefined
	if (processEnv) sharedStorageMode(processEnv)
	if (processEnv?.OWNMAIL_DEV_MOCKS === '1' && rawProcessEnv?.NODE_ENV !== 'production') {
		if (!processEnv.SESSION_SECRET) {
			throw new Error('Platform env unavailable - SESSION_SECRET not configured')
		}
		cached = { env: processEnv, kv: null, runtime: 'node' }
		return cached
	}
	let workerEnv: (AppEnv & { SESSIONS?: KvLike }) | undefined
	try {
		const { env } = await import('cloudflare:workers')
		workerEnv = env as unknown as AppEnv & { SESSIONS?: KvLike }
	} catch {
		const env = processEnv
		if (!env?.SESSION_SECRET) {
			throw new Error('Platform env unavailable - SESSION_SECRET not configured')
		}
		cached = { env, kv: nodeKv(env), runtime: 'node' }
		return cached
	}
	const sessions = workerEnv.SESSIONS
	const storageMode = sharedStorageMode(workerEnv)
	if (storageMode === 'enabled' && !sessions) {
		throw new Error('Platform env unavailable - realtime storage is incomplete')
	}
	cached = {
		env: workerEnv,
		kv: storageMode === 'disabled' ? null : (sessions ?? null),
		runtime: 'cloudflare',
	}
	return cached
}

function nodeKv(env: AppEnv): KvLike | null {
	const storageMode = sharedStorageMode(env)
	if (storageMode === 'disabled') return null
	const url = env.UPSTASH_REDIS_REST_URL?.trim()
	const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
	if (!url && !token && storageMode !== 'enabled') return null
	if (!url || !token) throw new Error('Platform env unavailable - realtime storage is incomplete')
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error('Platform env unavailable - realtime storage URL is invalid')
	}
	if (
		parsed.protocol !== 'https:' ||
		!parsed.hostname.endsWith('.upstash.io') ||
		parsed.username ||
		parsed.password ||
		parsed.port ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error('Platform env unavailable - realtime storage URL is invalid')
	}
	if (token.length > 16_384 || /[\r\n\0]/.test(token)) {
		throw new Error('Platform env unavailable - realtime storage credential is invalid')
	}
	const redis = new Redis({
		url: parsed.toString(),
		token,
		automaticDeserialization: false,
		enableTelemetry: false,
	})
	return {
		get: (key) => redis.get<string>(key),
		put: async (key, value, options) => {
			await redis.set(key, value, options?.expirationTtl ? { ex: options.expirationTtl } : undefined)
		},
		delete: async (key) => {
			await redis.del(key)
		},
		increment: (key) => redis.incr(key),
	}
}

function sharedStorageMode(env: AppEnv): 'enabled' | 'disabled' | undefined {
	const mode = env.OWNMAIL_SHARED_STORAGE
	if (mode !== undefined && mode !== 'enabled' && mode !== 'disabled') {
		throw new Error('Platform env unavailable - shared storage mode is invalid')
	}
	return mode
}

export async function usingDevMocks(): Promise<boolean> {
	const { env, runtime } = await platform()
	const nodeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
	return runtime === 'node' && env.OWNMAIL_DEV_MOCKS === '1' && nodeEnv?.NODE_ENV !== 'production'
}
