/**
 * Platform abstraction: Cloudflare Workers (env + KV via cloudflare:workers)
 * or a Node-ish runtime like Vercel functions (process.env, no KV).
 *
 * Without KV the app runs in stateless mode: sessions and PKCE state live in
 * signed cookies, and the realtime version signal degrades gracefully.
 */

export type AppEnv = {
	NYLAS_API_KEY: string
	SESSION_SECRET: string
	NYLAS_WEBHOOK_SECRET?: string
	NYLAS_CLIENT_ID: string
	NYLAS_REGION: 'us' | 'eu'
	NYLAS_API_BASE_URL?: string
	APP_NAME: string
	INBOX_EMAIL: string
	TEMPLATE_VERSION: string
}

export type KvLike = {
	get(key: string): Promise<string | null>
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
	delete(key: string): Promise<void>
}

export type Platform = { env: AppEnv; kv: KvLike | null }

let cached: Platform | null = null

export async function platform(): Promise<Platform> {
	if (cached) return cached
	try {
		const { env } = await import('cloudflare:workers')
		cached = { env: env as unknown as AppEnv, kv: (env as { SESSIONS?: KvLike }).SESSIONS ?? null }
	} catch {
		const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
			?.env as unknown as AppEnv
		if (!env?.SESSION_SECRET) {
			throw new Error('Platform env unavailable — SESSION_SECRET not configured')
		}
		cached = { env, kv: null }
	}
	return cached
}
