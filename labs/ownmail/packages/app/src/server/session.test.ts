import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from './platform.js'
import {
	clearSessionCookie,
	consumePkce,
	createReferenceDevSessionCookie,
	createSession,
	destroySession,
	getSession,
	hasReferenceDevSessionCookie,
	storePkce,
} from './session.js'

/**
 * session.ts resolves the signing secret and KV binding via platform(). We mock
 * platform so each test picks KV mode vs. stateless mode deliberately — the two
 * modes encode different security trade-offs (server-side record vs. signed cookie).
 */
const platformMock = vi.fn()
vi.mock('./platform.js', () => ({ platform: () => platformMock() }))

const SESSION_SECRET = 'test-session-secret'

/** An in-memory KV so we can assert what the session layer persisted. */
function makeKv(): KvLike & { store: Map<string, string> } {
	const store = new Map<string, string>()
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

function usePlatform(kv: KvLike | null): void {
	platformMock.mockResolvedValue({ env: { SESSION_SECRET }, kv, runtime: kv ? 'cloudflare' : 'node' })
}

function req(cookie?: string): Request {
	return new Request('http://ownmail.local/', cookie ? { headers: { cookie } } : {})
}

beforeEach(() => {
	platformMock.mockReset()
})

describe('session helpers', () => {
	beforeEach(() => usePlatform(null))

	it('recognizes the reference app dev auth cookie without treating other values as authenticated', () => {
		expect(hasReferenceDevSessionCookie(req('ownmail_session=authenticated; theme=dark'))).toBe(true)
		expect(hasReferenceDevSessionCookie(req('ownmail_session=not-authenticated'))).toBe(false)
		expect(hasReferenceDevSessionCookie(req())).toBe(false)
	})

	it('creates and clears the reference dev auth cookie over local HTTP', () => {
		const sessionCookie = createReferenceDevSessionCookie()
		const clearCookie = clearSessionCookie()

		expect(sessionCookie).toContain('ownmail_session=authenticated')
		expect(sessionCookie).toContain('HttpOnly')
		expect(sessionCookie).toContain('SameSite=Lax')
		expect(sessionCookie).not.toContain('Secure')
		expect(clearCookie).toContain('ownmail_session=')
		expect(clearCookie).toContain('Max-Age=0')
		expect(clearCookie).not.toContain('Secure')
	})
})

describe('KV-backed sessions', () => {
	beforeEach(() => usePlatform(makeKv()))

	it('stores only an opaque id server-side and round-trips the grant via the signed cookie', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const setCookie = await createSession('grant-123', 'user@ownmail.com')

		// Cookie is <id>.<sig> and Secure by default (KV mode runs on HTTPS).
		expect(setCookie).toMatch(/^ownmail_session=[^.]+\.[^;]+;/)
		expect(setCookie).toContain('Secure')
		expect([...kv.store.keys()][0]).toMatch(/^session:/)

		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		const session = await getSession(req(`ownmail_session=${cookieValue}`))
		expect(session).toEqual({
			grantId: 'grant-123',
			email: 'user@ownmail.com',
			createdAt: expect.any(Number),
		})
	})

	it('returns null when the signed id has no matching KV record (expired/evicted)', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const setCookie = await createSession('g', 'e@x.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		kv.store.clear() // simulate TTL eviction

		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	it('returns null when the KV record is corrupt JSON rather than crashing the request', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const setCookie = await createSession('g', 'e@x.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		const id = cookieValue.split('.')[0]
		kv.store.set(`session:${id}`, 'not-json{')

		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	it('rejects a signed session id whose KV record has an invalid shape', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const setCookie = await createSession('g', 'e@x.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		const id = cookieValue.split('.')[0]
		kv.store.set(`session:${id}`, JSON.stringify({ grantId: 123, email: 'e@x.com', createdAt: Date.now() }))

		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	it('deletes the server-side record on destroy so the session cannot be replayed', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const setCookie = await createSession('g', 'e@x.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		expect(kv.store.size).toBe(1)

		await destroySession(req(`ownmail_session=${cookieValue}`))
		expect(kv.store.size).toBe(0)
	})

	it('is a no-op on destroy when there is no session cookie to look up', async () => {
		const kv = makeKv()
		usePlatform(kv)
		await destroySession(req())
		expect(kv.store.size).toBe(0)
	})

	it('persists PKCE verifiers server-side without setting a cookie', async () => {
		const kv = makeKv()
		usePlatform(kv)
		expect(await storePkce('state-1', 'verifier-1')).toBeNull()
		expect(kv.store.get('pkce:state-1')).toBe('verifier-1')
	})

	it('consumes and invalidates a stored PKCE verifier exactly once', async () => {
		const kv = makeKv()
		usePlatform(kv)
		await storePkce('state-1', 'verifier-1')

		const result = await consumePkce(req(), 'state-1')
		expect(result).toEqual({ verifier: 'verifier-1', clearCookie: null })
		expect(kv.store.has('pkce:state-1')).toBe(false)
		// A second consume finds nothing.
		expect(await consumePkce(req(), 'state-1')).toBeNull()
	})
})

describe('stateless sessions (no KV)', () => {
	beforeEach(() => usePlatform(null))

	it('round-trips the grant through a signed self-contained cookie', async () => {
		const setCookie = await createSession('grant-abc', 'ada@ownmail.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))

		const session = await getSession(req(`ownmail_session=${cookieValue}`))
		expect(session).toEqual({ grantId: 'grant-abc', email: 'ada@ownmail.com', createdAt: 0 })
	})

	it('returns null when no session cookie is present', async () => {
		expect(await getSession(req())).toBeNull()
	})

	it('rejects a cookie missing the signature segment', async () => {
		expect(await getSession(req('ownmail_session=onlypayload'))).toBeNull()
	})

	it('rejects a tampered signature (forged payload cannot be trusted)', async () => {
		const setCookie = await createSession('grant-abc', 'ada@ownmail.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		const [payload] = cookieValue.split('.')

		expect(await getSession(req(`ownmail_session=${payload}.deadbeef`))).toBeNull()
	})

	it('returns null for an expired stateless cookie', async () => {
		// Build a payload that is correctly signed but already past its exp.
		const { signedCookie } = await buildStatelessSession({
			g: 'g',
			e: 'e@x.com',
			exp: Math.floor(Date.now() / 1000) - 10,
		})
		expect(await getSession(req(`ownmail_session=${signedCookie}`))).toBeNull()
	})

	it('returns null when the signed payload is valid base64 but not JSON', async () => {
		const { signedCookieForRaw } = await buildStatelessSession()
		const cookie = await signedCookieForRaw(b64url('this is not json'))
		expect(await getSession(req(`ownmail_session=${cookie}`))).toBeNull()
	})

	it('returns null when the signed payload cannot be base64-decoded', async () => {
		// A payload with characters atob() rejects, but with a valid signature.
		const { signRaw } = await buildStatelessSession()
		const raw = '@@@invalid@@@'
		const cookie = `${raw}.${await signRaw(raw)}`
		expect(await getSession(req(`ownmail_session=${cookie}`))).toBeNull()
	})

	it('destroy is a no-op without KV — the cookie clearing kills the session', async () => {
		await expect(destroySession(req('ownmail_session=whatever'))).resolves.toBeUndefined()
	})

	it('stores PKCE state in a signed, short-lived cookie', async () => {
		const cookie = await storePkce('state-x', 'verifier-x')
		expect(cookie).toContain('ownmail_pkce=')
		expect(cookie).toContain('Max-Age=600')
	})

	it('consumes the PKCE cookie, returns a clear-cookie, and matches the expected state', async () => {
		const stored = (await storePkce('state-x', 'verifier-x')) as string
		const value = stored.slice('ownmail_pkce='.length, stored.indexOf(';'))
		const result = await consumePkce(req(`ownmail_pkce=${value}`), 'state-x')
		expect(result?.verifier).toBe('verifier-x')
		expect(result?.clearCookie).toContain('Max-Age=0')
	})

	it('returns null consuming PKCE when no cookie is present', async () => {
		expect(await consumePkce(req(), 'state-x')).toBeNull()
	})

	it('rejects a PKCE cookie missing its signature', async () => {
		expect(await consumePkce(req('ownmail_pkce=payloadonly'), 'state-x')).toBeNull()
	})

	it('rejects a PKCE cookie with a bad signature', async () => {
		const stored = (await storePkce('state-x', 'verifier-x')) as string
		const value = stored.slice('ownmail_pkce='.length, stored.indexOf(';'))
		const [payload] = value.split('.')
		expect(await consumePkce(req(`ownmail_pkce=${payload}.bad`), 'state-x')).toBeNull()
	})

	it('rejects a PKCE cookie whose payload is not base64-decodable', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = '@@@bad@@@'
		const cookie = `${raw}.${await signRaw(raw)}`
		expect(await consumePkce(req(`ownmail_pkce=${cookie}`), 'state-x')).toBeNull()
	})

	it('rejects a PKCE cookie whose signed state does not match the request state', async () => {
		const stored = (await storePkce('state-other', 'verifier-x')) as string
		const value = stored.slice('ownmail_pkce='.length, stored.indexOf(';'))
		expect(await consumePkce(req(`ownmail_pkce=${value}`), 'state-x')).toBeNull()
	})

	it('rejects a signed PKCE cookie after its server-enforced expiry', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = b64url(
			JSON.stringify({ s: 'state-x', v: 'verifier-x', exp: Math.floor(Date.now() / 1000) - 1 }),
		)
		const cookie = `${raw}.${await signRaw(raw)}`

		expect(await consumePkce(req(`ownmail_pkce=${cookie}`), 'state-x')).toBeNull()
	})

	it('rejects a PKCE cookie whose payload is valid base64 but not JSON', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = b64url('not json at all')
		const cookie = `${raw}.${await signRaw(raw)}`
		expect(await consumePkce(req(`ownmail_pkce=${cookie}`), 'state-x')).toBeNull()
	})
})

// ---- helpers that reproduce session.ts's signing to craft edge-case cookies ----

function b64url(value: string): string {
	const bytes = new TextEncoder().encode(value)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function hmacRaw(value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
	const bytes = new Uint8Array(sig)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function buildStatelessSession(payload?: { g: string; e: string; exp: number }) {
	const signRaw = (raw: string) => hmacRaw(raw)
	const signedCookieForRaw = async (raw: string) => `${raw}.${await signRaw(raw)}`
	let signedCookie = ''
	if (payload) {
		const raw = b64url(JSON.stringify(payload))
		signedCookie = `${raw}.${await signRaw(raw)}`
	}
	return { signRaw, signedCookieForRaw, signedCookie }
}
