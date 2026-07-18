import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from '../server/platform.js'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const platform = vi.fn()
vi.mock('../server/platform.js', () => ({ platform: () => platform() }))

import { Route } from './api.webhooks.nylas.js'

const GET = Route.options.server.handlers.GET
const POST = Route.options.server.handlers.POST

const SECRET = 'whsec_test'

/** Produces the hex HMAC-SHA256 signature Nylas would send for a body. */
async function sign(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function makeKv(seed: Record<string, string> = {}): KvLike & { store: Map<string, string> } {
	const store = new Map(Object.entries(seed))
	return {
		store,
		get: async (key) => store.get(key) ?? null,
		put: async (key, value) => {
			store.set(key, value)
		},
		delete: async (key) => {
			store.delete(key)
		},
	}
}

function post(body: string, signature: string) {
	return POST({
		request: new Request('https://ownmail.local/api/webhooks/nylas', {
			method: 'POST',
			headers: { 'x-nylas-signature': signature },
			body,
		}),
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('/api/webhooks/nylas GET verification', () => {
	it('echoes the challenge Nylas sends to verify a new webhook', async () => {
		const response = GET({
			request: new Request('https://ownmail.local/api/webhooks/nylas?challenge=abc123'),
		})
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('abc123')
	})

	it('answers with an empty body when no challenge is present', async () => {
		const response = GET({ request: new Request('https://ownmail.local/api/webhooks/nylas') })
		expect(await response.text()).toBe('')
	})
})

describe('/api/webhooks/nylas POST', () => {
	it('rejects notifications when no webhook secret is configured (falls back to polling)', async () => {
		platform.mockResolvedValue({ env: {}, kv: makeKv() })

		const response = await post('{}', 'deadbeef')

		expect(response.status).toBe(401)
		expect(await response.text()).toBe('webhook secret not configured')
	})

	it('rejects an oversized payload from its Content-Length before reading its body', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: makeKv() })
		const text = vi.fn()

		const response = await POST({
			request: {
				headers: new Headers({ 'content-length': String(1024 * 1024 + 1) }),
				text,
			} as unknown as Request,
		})

		expect(response.status).toBe(413)
		expect(text).not.toHaveBeenCalled()
	})

	it('rejects an oversized payload when Content-Length is unavailable or untrusted', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: makeKv() })
		const body = 'x'.repeat(1024 * 1024 + 1)

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(413)
		expect(await response.text()).toBe('payload too large')
	})

	it('requires a valid signature before acknowledging when there is no KV to bump', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: null })
		const body = '{}'

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
	})

	it('rejects unsigned notifications even when there is no KV binding', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: null })

		const response = await post('{}', 'deadbeef')

		expect(response.status).toBe(401)
	})

	it('rejects a well-formed but incorrectly-signed payload', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: makeKv() })
		const body = JSON.stringify({ data: { object: { grant_id: 'g1' } } })

		const response = await post(body, 'f'.repeat(64))

		expect(response.status).toBe(401)
		expect(await response.text()).toBe('invalid signature')
	})

	it('rejects a signature that is not a 64-character hex digest', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: makeKv() })

		const response = await post('{}', 'not-a-real-signature')

		expect(response.status).toBe(401)
	})

	it('rejects a payload that arrives with no signature header at all', async () => {
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv: makeKv() })

		// No x-nylas-signature header — the handler must treat the absent header as an empty
		// (and therefore invalid) signature rather than throwing.
		const response = await POST({
			request: new Request('https://ownmail.local/api/webhooks/nylas', { method: 'POST', body: '{}' }),
		})

		expect(response.status).toBe(401)
		expect(await response.text()).toBe('invalid signature')
	})

	it('bumps only the top-level data grant when the payload carries no deltas', async () => {
		const kv = makeKv({ 'version:g1': '2' })
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		// A `data`-only notification (no `deltas` array) must still bump its grant.
		const body = JSON.stringify({ data: { object: { grant_id: 'g1' } } })

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(200)
		expect(kv.store.get('version:g1')).toBe('3')
		expect(kv.store.get('version:g1:mail')).toBe('1')
		expect(kv.store.get('version:g1:contacts')).toBe('1')
		expect(kv.store.get('version:g1:calendar')).toBe('1')
	})

	it('routes a typed notification only to its affected domain while retaining the legacy counter', async () => {
		const kv = makeKv()
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		const body = JSON.stringify({
			type: 'contact.updated',
			data: { object: { grant_id: 'g1' } },
		})

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(200)
		expect(kv.store.get('version:g1')).toBe('1')
		expect(kv.store.get('version:g1:contacts')).toBe('1')
		expect(kv.store.has('version:g1:mail')).toBe(false)
		expect(kv.store.has('version:g1:calendar')).toBe(false)
	})

	it('routes mail types narrowly and unknown future types defensively to every domain', async () => {
		const kv = makeKv()
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		const body = JSON.stringify({
			deltas: [
				{ type: 'message.created', object_data: { grant_id: 'mail-grant' } },
				{ type: 'event.updated', object_data: { grant_id: 'calendar-grant' } },
				{ type: 'future.object', object_data: { grant_id: 'future-grant' } },
			],
		})

		expect((await post(body, await sign(SECRET, body))).status).toBe(200)
		expect(kv.store.get('version:mail-grant:mail')).toBe('1')
		expect(kv.store.has('version:mail-grant:contacts')).toBe(false)
		expect(kv.store.get('version:calendar-grant:calendar')).toBe('1')
		expect(kv.store.get('version:future-grant:mail')).toBe('1')
		expect(kv.store.get('version:future-grant:contacts')).toBe('1')
		expect(kv.store.get('version:future-grant:calendar')).toBe('1')
	})

	it('bumps the per-grant version counter for every grant in a validly-signed payload', async () => {
		const kv = makeKv({ 'version:g1': '5' })
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		const body = JSON.stringify({
			data: { object: { grant_id: 'g1' } },
			deltas: [{ object_data: { grant_id: 'g2' } }, { object_data: {} }],
		})

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
		expect(kv.store.get('version:g1')).toBe('6')
		expect(kv.store.get('version:g2')).toBe('1')
	})

	it('uses an atomic increment when the shared store supports it', async () => {
		const kv = makeKv({ 'version:g1': '5' })
		kv.increment = vi.fn(async (key) => {
			const next = Number(kv.store.get(key) ?? '0') + 1
			kv.store.set(key, String(next))
			return next
		})
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		const body = JSON.stringify({ data: { object: { grant_id: 'g1' } } })

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(200)
		expect(kv.increment).toHaveBeenCalledWith('version:g1')
		expect(kv.store.get('version:g1')).toBe('6')
	})

	it('rejects a validly-signed payload that targets too many grants', async () => {
		const kv = makeKv()
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		const body = JSON.stringify({
			deltas: Array.from({ length: 101 }, (_, index) => ({ object_data: { grant_id: `g${index}` } })),
		})

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(400)
		expect(await response.text()).toBe('too many grants')
		expect(kv.store.size).toBe(0)
	})

	it('acknowledges a validly-signed but malformed payload so Nylas stops retrying', async () => {
		const kv = makeKv()
		const putSpy = vi.spyOn(kv, 'put')
		platform.mockResolvedValue({ env: { NYLAS_WEBHOOK_SECRET: SECRET }, kv })
		const body = 'this is not json'

		const response = await post(body, await sign(SECRET, body))

		expect(response.status).toBe(200)
		expect(putSpy).not.toHaveBeenCalled()
	})
})
