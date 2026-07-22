import { createFileRoute } from '@tanstack/react-router'
import { bumpChangeVersionsInKv, CHANGE_DOMAINS, type ChangeDomain } from '#server/change-version'
import { validNylasProviderId } from '#server/ids'
import { platform } from '#server/platform'

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024
const MAX_GRANTS_PER_WEBHOOK = 100

/**
 * Nylas webhook receiver. Notifications bump a legacy aggregate counter and
 * the affected mail, contacts, or calendar counter in KV; clients poll
 * /api/version and refetch only the changed domain.
 * POSTs are HMAC-verified against NYLAS_WEBHOOK_SECRET; without the secret
 * configured, notifications are rejected (the app falls back to slow polling).
 */
export const Route = createFileRoute('/api/webhooks/nylas')({
	server: {
		handlers: {
			// Nylas verifies a new webhook by echoing the challenge query param.
			GET: ({ request }) => {
				const challenge = new URL(request.url).searchParams.get('challenge')
				return new Response(challenge ?? '', { status: 200 })
			},
			POST: async ({ request }) => {
				const { env, kv } = await platform()
				const secret = env.NYLAS_WEBHOOK_SECRET
				if (!secret) return new Response('webhook secret not configured', { status: 401 })
				const contentLength = Number(request.headers.get('content-length'))
				if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
					return new Response('payload too large', { status: 413 })
				}

				const signature = request.headers.get('x-nylas-signature') ?? ''
				const body = await request.text()
				if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BODY_BYTES) {
					return new Response('payload too large', { status: 413 })
				}
				if (!(await verifySignature(secret, body, signature))) {
					return new Response('invalid signature', { status: 401 })
				}
				if (!kv) return new Response('ok', { status: 200 }) // nowhere to record; authenticated ack

				try {
					const payload = JSON.parse(body) as {
						type?: unknown
						deltas?: { type?: unknown; object_data?: { grant_id?: string } }[]
						data?: { object?: { grant_id?: string } }
					}
					const changes = new Map<string, Set<ChangeDomain>>()
					const addChange = (grantId: string, type: unknown) => {
						const domains = changes.get(grantId) ?? new Set<ChangeDomain>()
						for (const domain of domainsForWebhookType(type)) domains.add(domain)
						changes.set(grantId, domains)
					}
					const fromData = payload.data?.object?.grant_id
					if (validNylasProviderId(fromData)) addChange(fromData, payload.type)
					for (const delta of payload.deltas ?? []) {
						if (validNylasProviderId(delta.object_data?.grant_id)) {
							addChange(delta.object_data.grant_id, delta.type ?? payload.type)
						}
					}
					if (changes.size > MAX_GRANTS_PER_WEBHOOK) return new Response('too many grants', { status: 400 })
					await Promise.all(
						[...changes].map(([grantId, domains]) => bumpChangeVersionsInKv(kv, grantId, domains)),
					)
				} catch {
					// Malformed payloads are acknowledged so Nylas doesn't retry forever.
				}
				return new Response('ok', { status: 200 })
			},
		},
	},
})

function domainsForWebhookType(type: unknown): readonly ChangeDomain[] {
	if (typeof type !== 'string') return CHANGE_DOMAINS
	const objectType = type.split('.')[0]?.toLowerCase()
	if (
		objectType === 'message' ||
		objectType === 'thread' ||
		objectType === 'folder' ||
		objectType === 'draft'
	) {
		return ['mail']
	}
	if (objectType === 'contact') return ['contacts']
	if (objectType === 'event' || objectType === 'calendar') return ['calendar']
	// Grant changes and future event types may affect every domain. Fail safe by
	// refreshing all scoped server state rather than silently missing a change.
	return CHANGE_DOMAINS
}

async function verifySignature(secret: string, body: string, signatureHex: string): Promise<boolean> {
	if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	)
	const hexPairs = signatureHex.match(/.{2}/g)
	/* v8 ignore next -- signatureHex already passed the /^[0-9a-f]{64}$/ gate above, so match(/.{2}/g) always returns 32 pairs; this guard is unreachable */
	if (!hexPairs) return false
	const sigBytes = new Uint8Array(hexPairs.map((h) => Number.parseInt(h, 16)))
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body))
}
