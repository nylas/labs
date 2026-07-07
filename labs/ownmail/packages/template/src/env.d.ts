// Augments `Cloudflare.Env` — the type of `import { env } from 'cloudflare:workers'`
// (declaration merging with @cloudflare/workers-types). Mirrors template.json's
// requiredSecrets/requiredVars/kvBindings.
declare namespace Cloudflare {
	interface Env {
		SESSIONS: KVNamespace
		NYLAS_API_KEY: string
		SESSION_SECRET: string
		/** Optional — realtime falls back to slow polling without it. */
		NYLAS_WEBHOOK_SECRET?: string
		NYLAS_CLIENT_ID: string
		NYLAS_REGION: 'us' | 'eu'
		NYLAS_API_BASE_URL?: string
		APP_NAME: string
		INBOX_EMAIL: string
		TEMPLATE_VERSION: string
	}
}
