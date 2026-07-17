import { createFileRoute } from '@tanstack/react-router'
import { validNylasProviderId } from '../server/ids.js'
import { platform } from '../server/platform.js'

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024
const MAX_GRANTS_PER_WEBHOOK = 100

/**
 * Nylas webhook receiver. `message.created` (and friends) bump a per-grant
 * version counter in KV; clients poll /api/version and refetch on change.
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
						deltas?: { object_data?: { grant_id?: string } }[]
						data?: { object?: { grant_id?: string } }
					}
					const grantIds = new Set<string>()
					const fromData = payload.data?.object?.grant_id
					if (validNylasProviderId(fromData)) grantIds.add(fromData)
					for (const delta of payload.deltas ?? []) {
						if (validNylasProviderId(delta.object_data?.grant_id)) grantIds.add(delta.object_data.grant_id)
					}
					if (grantIds.size > MAX_GRANTS_PER_WEBHOOK) return new Response('too many grants', { status: 400 })
					await Promise.all(
						[...grantIds].map(async (grantId) => {
							const key = `version:${grantId}`
							if (kv.increment) {
								await kv.increment(key)
								return
							}
							const current = Number((await kv.get(key)) ?? '0')
							await kv.put(key, String(current + 1))
						}),
					)
				} catch {
					// Malformed payloads are acknowledged so Nylas doesn't retry forever.
				}
				return new Response('ok', { status: 200 })
			},
		},
	},
})

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
