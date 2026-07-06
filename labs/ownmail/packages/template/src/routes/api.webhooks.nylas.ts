import { createFileRoute } from '@tanstack/react-router'
import { platform } from '../server/platform.js'

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
				if (!kv) return new Response('ok', { status: 200 }) // nowhere to record; ack

				const signature = request.headers.get('x-nylas-signature') ?? ''
				const body = await request.text()
				if (!(await verifySignature(secret, body, signature))) {
					return new Response('invalid signature', { status: 401 })
				}

				try {
					const payload = JSON.parse(body) as {
						deltas?: { object_data?: { grant_id?: string } }[]
						data?: { object?: { grant_id?: string } }
					}
					const grantIds = new Set<string>()
					const fromData = payload.data?.object?.grant_id
					if (fromData) grantIds.add(fromData)
					for (const delta of payload.deltas ?? []) {
						if (delta.object_data?.grant_id) grantIds.add(delta.object_data.grant_id)
					}
					await Promise.all(
						[...grantIds].map(async (grantId) => {
							const key = `version:${grantId}`
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
	const sigBytes = new Uint8Array(signatureHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)))
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body))
}
