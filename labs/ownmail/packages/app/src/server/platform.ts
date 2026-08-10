import { Redis } from '@upstash/redis'

/**
 * Platform abstraction: Cloudflare Workers (env + KV via cloudflare:workers)
 * or a Node-ish runtime like Vercel functions (process.env + optional Upstash).
 *
 * Without shared storage the app runs in stateless mode: sessions and Connect
 * state live in signed cookies, and the realtime version signal degrades
 * gracefully.
 */

/**
 * Cloudflare's native rate-limit binding. It is atomic at the edge, which a KV
 * read-modify-write can never be, so it is the authoritative sign-in limiter on
 * Workers deployments.
 */
export type RateLimiterBinding = { limit(options: { key: string }): Promise<{ success: boolean }> }

export type AppEnv = {
	NYLAS_API_KEY: string
	/** Declared in wrangler.jsonc; absent on non-Workers targets. */
	SIGNIN_EMAIL_LIMITER?: RateLimiterBinding
	SIGNIN_IP_LIMITER?: RateLimiterBinding
	SESSION_SECRET: string
	NYLAS_WEBHOOK_SECRET?: string
	NYLAS_CLIENT_ID: string
	NYLAS_REGION: 'us' | 'eu'
	NYLAS_API_BASE_URL?: string
	UPSTASH_REDIS_REST_URL?: string
	UPSTASH_REDIS_REST_TOKEN?: string
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
	/** Atomic counter. Present on Redis-backed stores; absent on Cloudflare KV. */
	increment?(key: string): Promise<number>
	/** Attaches a TTL without touching the value, so a live counter is never reset. */
	expire?(key: string, seconds: number): Promise<void>
	/** Atomically creates an expiring key only when it does not already exist. */
	putIfAbsent?(key: string, value: string, expirationTtl: number): Promise<boolean>
}

export type Platform = { env: AppEnv; kv: KvLike | null; runtime: 'cloudflare' | 'node' }

let cached: Platform | null = null

export async function platform(): Promise<Platform> {
	if (cached) return cached
	const rawProcessEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
	const processEnv = rawProcessEnv as unknown as AppEnv | undefined
	if (processEnv?.OWNMAIL_DEV_MOCKS === '1' && rawProcessEnv?.NODE_ENV !== 'production') {
		if (!processEnv.SESSION_SECRET) {
			throw new Error('Platform env unavailable - SESSION_SECRET not configured')
		}
		cached = { env: processEnv, kv: null, runtime: 'node' }
		return cached
	}
	try {
		const { env } = await import('cloudflare:workers')
		cached = {
			env: env as unknown as AppEnv,
			kv: (env as { SESSIONS?: KvLike }).SESSIONS ?? null,
			runtime: 'cloudflare',
		}
	} catch {
		const env = processEnv
		if (!env?.SESSION_SECRET) {
			throw new Error('Platform env unavailable - SESSION_SECRET not configured')
		}
		cached = { env, kv: nodeKv(env), runtime: 'node' }
	}
	return cached
}

function nodeKv(env: AppEnv): KvLike | null {
	const url = env.UPSTASH_REDIS_REST_URL?.trim()
	const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
	if (!url && !token) return null
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
		expire: async (key, seconds) => {
			await redis.expire(key, seconds)
		},
		putIfAbsent: async (key, value, expirationTtl) => {
			const result = await redis.set(key, value, { nx: true, ex: expirationTtl })
			return result === 'OK'
		},
	}
}

export async function usingDevMocks(): Promise<boolean> {
	const { env, runtime } = await platform()
	const nodeEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
	return runtime === 'node' && env.OWNMAIL_DEV_MOCKS === '1' && nodeEnv?.NODE_ENV !== 'production'
}
