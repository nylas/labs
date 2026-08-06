import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from './platform.js'
import {
	addVerifiedSessionAccount,
	clearSessionCookie,
	consumeConnectState,
	createReferenceDevSessionCookie,
	createSession,
	destroySession,
	getSession,
	hasReferenceDevSessionCookie,
	type Session,
	sessionAccountSummaries,
	slideSessionExpiry,
	storeConnectState,
	switchSessionAccount,
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
function makeKv(): KvLike & {
	store: Map<string, string>
	puts: { key: string; value: string; options?: { expirationTtl?: number } }[]
} {
	const store = new Map<string, string>()
	const puts: { key: string; value: string; options?: { expirationTtl?: number } }[] = []
	return {
		store,
		puts,
		get: async (key) => store.get(key) ?? null,
		put: async (key, value, options) => {
			store.set(key, value)
			puts.push({ key, value, options })
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

function cookieFromSetCookie(setCookie: string): string {
	return setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
}

function connectCookieFromSetCookie(setCookie: string): string {
	return setCookie.slice('ownmail_connect_state='.length, setCookie.indexOf(';'))
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
			accounts: [{ grantId: 'grant-123', email: 'user@ownmail.com' }],
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number),
		})
	})

	it('adds only callback-verified accounts and switches by opaque handle', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const initialCookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const initialRequest = req(`ownmail_session=${initialCookie}`)
		const nextCookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(initialRequest, 'grant-b', 'b@ownmail.com'),
		)
		const nextRequest = req(`ownmail_session=${nextCookie}`)

		expect(await getSession(nextRequest)).toEqual({
			grantId: 'grant-b',
			email: 'b@ownmail.com',
			accounts: [
				{ grantId: 'grant-a', email: 'a@ownmail.com' },
				{ grantId: 'grant-b', email: 'b@ownmail.com' },
			],
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number),
		})
		const summaries = await sessionAccountSummaries(nextRequest)
		expect(summaries).toEqual([
			{ email: 'a@ownmail.com', handle: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), active: false },
			{ email: 'b@ownmail.com', handle: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), active: true },
		])
		expect(JSON.stringify(summaries)).not.toContain('grant-a')

		const firstHandle = summaries?.[0]?.handle
		expect(firstHandle).toBeTruthy()
		const switchedCookie = cookieFromSetCookie(
			(await switchSessionAccount(nextRequest, firstHandle as string)) as string,
		)
		expect(await getSession(req(`ownmail_session=${switchedCookie}`))).toEqual(
			expect.objectContaining({ grantId: 'grant-a', email: 'a@ownmail.com' }),
		)
	})

	it('uses the KV minimum TTL in the final minute without extending the session deadline', async () => {
		const kv = makeKv()
		usePlatform(kv)
		vi.useFakeTimers()
		try {
			const startedAt = new Date('2026-01-01T00:00:00.000Z')
			vi.setSystemTime(startedAt)
			let cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
			cookie = cookieFromSetCookie(
				await addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), 'grant-b', 'b@ownmail.com'),
			)
			const expiresAt = startedAt.getTime() + 14 * 24 * 60 * 60 * 1000
			vi.setSystemTime(new Date(expiresAt - 30_000))
			const request = req(`ownmail_session=${cookie}`)
			const handle = (await sessionAccountSummaries(request))?.find(
				(account) => account.email === 'a@ownmail.com',
			)?.handle as string

			const switched = (await switchSessionAccount(request, handle)) as string

			expect(kv.puts.findLast((put) => put.key.startsWith('session:'))?.options?.expirationTtl).toBe(60)
			expect(switched).toContain('Max-Age=30')
			const switchedCookie = cookieFromSetCookie(switched)
			vi.setSystemTime(new Date(expiresAt + 1))
			expect(await getSession(req(`ownmail_session=${switchedCookie}`))).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it('fails closed for arbitrary handles that are not in the verified account allow-list', async () => {
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		expect(await switchSessionAccount(req(`ownmail_session=${cookie}`), 'z'.repeat(43))).toBeNull()
		expect(await switchSessionAccount(req(`ownmail_session=${cookie}`), 'grant-a')).toBeNull()
		const handle = (await sessionAccountSummaries(req(`ownmail_session=${cookie}`)))?.[0]?.handle as string
		expect(await switchSessionAccount(req(), handle)).toBeNull()
	})

	it('deduplicates a re-verified grant and rejects invalid verified account records', async () => {
		const firstCookie = cookieFromSetCookie(await createSession('grant-a', 'old@ownmail.com'))
		const nextCookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(req(`ownmail_session=${firstCookie}`), 'grant-a', 'new@ownmail.com'),
		)
		expect((await getSession(req(`ownmail_session=${nextCookie}`)))?.accounts).toEqual([
			{ grantId: 'grant-a', email: 'new@ownmail.com' },
		])
		await expect(createSession('', 'a@ownmail.com')).rejects.toThrow('Invalid session')
	})

	it('replaces a stale grant for the same canonical email address', async () => {
		const firstCookie = cookieFromSetCookie(await createSession('grant-old', 'Ada@OwnMail.com'))
		const nextCookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(
				req(`ownmail_session=${firstCookie}`),
				'grant-new',
				'  ada@ownmail.com  ',
			),
		)

		expect((await getSession(req(`ownmail_session=${nextCookie}`)))?.accounts).toEqual([
			{ grantId: 'grant-new', email: 'ada@ownmail.com' },
		])
	})

	it('migrates a valid legacy KV session record to the one-account session model', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const id = cookie.split('.')[0] as string
		const createdAt = Date.now() - 1_000
		kv.store.set(
			`session:${id}`,
			JSON.stringify({ grantId: 'grant-old', email: 'old@ownmail.com', createdAt }),
		)
		expect(await getSession(req(`ownmail_session=${cookie}`))).toEqual({
			grantId: 'grant-old',
			email: 'old@ownmail.com',
			accounts: [{ grantId: 'grant-old', email: 'old@ownmail.com' }],
			createdAt,
			expiresAt: createdAt + 14 * 24 * 60 * 60 * 1000,
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

	it.each([null, 'text', []])('rejects a parsed KV session that is not a record (%j)', async (record) => {
		const kv = makeKv()
		usePlatform(kv)
		const cookieValue = cookieFromSetCookie(await createSession('g', 'e@x.com'))
		const id = cookieValue.split('.')[0] as string
		kv.store.set(`session:${id}`, JSON.stringify(record))

		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	it('rejects a KV session with a non-record account entry', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookieValue = cookieFromSetCookie(await createSession('g', 'e@x.com'))
		const id = cookieValue.split('.')[0] as string
		kv.store.set(
			`session:${id}`,
			JSON.stringify({ accounts: [null], activeGrantId: 'g', createdAt: Date.now() }),
		)
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

	it('rejects a KV session record with no lifetime metadata', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookieValue = cookieFromSetCookie(await createSession('g', 'e@x.com'))
		const id = cookieValue.split('.')[0] as string
		kv.store.set(
			`session:${id}`,
			JSON.stringify({ accounts: [{ grantId: 'g', email: 'e@x.com' }], activeGrantId: 'g' }),
		)

		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	it('rejects an explicitly expired KV session record', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookieValue = cookieFromSetCookie(await createSession('g', 'e@x.com'))
		const id = cookieValue.split('.')[0] as string
		kv.store.set(
			`session:${id}`,
			JSON.stringify({
				accounts: [{ grantId: 'g', email: 'e@x.com' }],
				activeGrantId: 'g',
				createdAt: Date.now() - 2_000,
				expiresAt: Date.now() - 1_000,
			}),
		)

		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	it('deletes the server-side record on destroy so the session cannot be replayed', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const setCookie = await createSession('g', 'e@x.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))
		expect(kv.store.size).toBe(1)

		await destroySession(req(`ownmail_session=${cookieValue}`))
		// The record is gone; only the short-lived revocation tombstone remains.
		expect([...kv.store.keys()]).toEqual([`revoked:${cookieValue.split('.')[0]}`])
		expect(await getSession(req(`ownmail_session=${cookieValue}`))).toBeNull()
	})

	/**
	 * `/logout` is reachable without a valid session, so the tombstone it writes is a
	 * key name derived from client input. Signing has to be checked first, or anyone
	 * could POST random cookies in a loop and mint unbounded KV keys — burning write
	 * quota and storage — while an oversized value could make logout throw before the
	 * response clears the cookie.
	 */
	it('writes no tombstone for a session cookie it did not sign', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const realId = 'a'.repeat(43)
		const forged = [
			`ownmail_session=${realId}.not-the-real-signature`, // right shape, bad HMAC
			`ownmail_session=${'b'.repeat(4000)}.${'c'.repeat(4000)}`, // oversized
			'ownmail_session=short.sig', // wrong id shape
			'ownmail_session=nodotseparator',
		]

		for (const cookie of forged) await destroySession(req(cookie))

		// Nothing written, nothing named by the caller — and no throw for the caller to
		// trip over, so the route still clears the client cookie.
		expect(kv.puts).toEqual([])
		expect(kv.store.size).toBe(0)
	})

	it('refuses to slide a session cookie it did not sign', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const session = (await getSession(req(`ownmail_session=${cookie}`))) as Session
		const writesAfterLogin = kv.puts.length

		// A valid session object paired with a cookie whose signature does not check out:
		// the id is client input, so it must never reach a KV key.
		const forged = req(`ownmail_session=${'z'.repeat(43)}.${cookie.split('.')[1]}`)
		expect(await slideSessionExpiry(forged, { ...session, expiresAt: Date.now() })).toBeNull()
		expect(kv.puts.length).toBe(writesAfterLogin)
	})

	it('is a no-op on destroy when there is no session cookie to look up', async () => {
		const kv = makeKv()
		usePlatform(kv)
		await destroySession(req())
		expect(kv.store.size).toBe(0)
	})

	it('persists Nylas Connect state server-side and binds it to a signed browser nonce', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = await storeConnectState(req(), 'state-1')
		expect(cookie).toContain('ownmail_connect_state=')
		expect(kv.store.get('connect:state-1')).toContain('"nonce"')
	})

	it('consumes and invalidates stored Nylas Connect state exactly once', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = await storeConnectState(req(), 'state-1')

		const result = await consumeConnectState(
			req(`ownmail_connect_state=${connectCookieFromSetCookie(cookie)}`),
			'state-1',
		)
		expect(result).toEqual({ clearCookie: expect.stringContaining('Max-Age=0') })
		expect(kv.store.has('connect:state-1')).toBe(false)
		// A second consume finds nothing.
		expect(await consumeConnectState(req(), 'state-1')).toBeNull()
	})

	it('does not let one browser consume another browser’s KV-backed auth attempt', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookieA = connectCookieFromSetCookie(await storeConnectState(req(), 'state-a'))
		const cookieB = connectCookieFromSetCookie(await storeConnectState(req(), 'state-b'))

		expect(await consumeConnectState(req(`ownmail_connect_state=${cookieB}`), 'state-a')).toBeNull()
		expect(kv.store.has('connect:state-a')).toBe(true)
		expect(await consumeConnectState(req(`ownmail_connect_state=${cookieA}`), 'state-a')).toEqual({
			clearCookie: expect.stringContaining('Max-Age=0'),
		})
	})

	it.each(['not-json{', JSON.stringify({ nonce: 'nonce-a' })])(
		'rejects a malformed server-side Connect record without consuming it (%s)',
		async (record) => {
			const kv = makeKv()
			usePlatform(kv)
			const cookie = connectCookieFromSetCookie(await storeConnectState(req(), 'state-a'))
			kv.store.set('connect:state-a', record)

			expect(await consumeConnectState(req(`ownmail_connect_state=${cookie}`), 'state-a')).toBeNull()
			expect(kv.store.has('connect:state-a')).toBe(true)
		},
	)

	it('rejects a browser-bound attempt whose server-side state has expired or been evicted', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = connectCookieFromSetCookie(await storeConnectState(req(), 'state-a'))
		kv.store.delete('connect:state-a')

		expect(await consumeConnectState(req(`ownmail_connect_state=${cookie}`), 'state-a')).toBeNull()
	})

	it('rejects an add-inbox callback from a different verified account set without burning state', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const sessionA = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const attempt = connectCookieFromSetCookie(
			await storeConnectState(req(`ownmail_session=${sessionA}`), 'state-add'),
		)
		const sessionB = cookieFromSetCookie(await createSession('grant-b', 'b@ownmail.com'))

		expect(
			await consumeConnectState(
				req(`ownmail_session=${sessionB}; ownmail_connect_state=${attempt}`),
				'state-add',
			),
		).toBeNull()
		expect(kv.store.has('connect:state-add')).toBe(true)
		expect(
			await consumeConnectState(
				req(`ownmail_session=${sessionA}; ownmail_connect_state=${attempt}`),
				'state-add',
			),
		).toEqual({ clearCookie: expect.stringContaining('Max-Age=0') })
	})
})

describe('stateless sessions (no KV)', () => {
	beforeEach(() => usePlatform(null))

	it('starts a verified account session when Nylas Connect completes without an existing session', async () => {
		const cookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(req(), 'grant-first', 'first@ownmail.com'),
		)
		expect(await getSession(req(`ownmail_session=${cookie}`))).toEqual(
			expect.objectContaining({ grantId: 'grant-first', email: 'first@ownmail.com' }),
		)
		expect(await sessionAccountSummaries(req())).toBeNull()
	})

	it('round-trips the grant through a signed self-contained cookie', async () => {
		const setCookie = await createSession('grant-abc', 'ada@ownmail.com')
		const cookieValue = setCookie.slice('ownmail_session='.length, setCookie.indexOf(';'))

		const session = await getSession(req(`ownmail_session=${cookieValue}`))
		expect(session).toEqual({
			grantId: 'grant-abc',
			email: 'ada@ownmail.com',
			accounts: [{ grantId: 'grant-abc', email: 'ada@ownmail.com' }],
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number),
		})
	})

	it('migrates a valid legacy stateless cookie to the one-account session model', async () => {
		const { signedCookie } = await buildStatelessSession({
			g: 'grant-legacy',
			e: 'legacy@ownmail.com',
			exp: Math.floor(Date.now() / 1000) + 60,
		})

		expect(await getSession(req(`ownmail_session=${signedCookie}`))).toEqual({
			grantId: 'grant-legacy',
			email: 'legacy@ownmail.com',
			accounts: [{ grantId: 'grant-legacy', email: 'legacy@ownmail.com' }],
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number),
		})
	})

	it('persists verified accounts and active selection inside a signed stateless cookie', async () => {
		const firstCookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const firstRequest = req(`ownmail_session=${firstCookie}`)
		const secondCookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(firstRequest, 'grant-b', 'b@ownmail.com'),
		)
		const secondRequest = req(`ownmail_session=${secondCookie}`)
		const summaries = await sessionAccountSummaries(secondRequest)
		const firstHandle = summaries?.find((account) => account.email === 'a@ownmail.com')?.handle
		const switched = await switchSessionAccount(secondRequest, firstHandle as string)

		expect(switched).toBeTruthy()
		expect(await getSession(req(`ownmail_session=${cookieFromSetCookie(switched as string)}`))).toEqual({
			grantId: 'grant-a',
			email: 'a@ownmail.com',
			accounts: [
				{ grantId: 'grant-a', email: 'a@ownmail.com' },
				{ grantId: 'grant-b', email: 'b@ownmail.com' },
			],
			createdAt: expect.any(Number),
			expiresAt: expect.any(Number),
		})
	})

	it('does not extend the absolute session lifetime when switching accounts near expiry', async () => {
		vi.useFakeTimers()
		try {
			const startedAt = new Date('2026-01-01T00:00:00.000Z')
			vi.setSystemTime(startedAt)
			let cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
			cookie = cookieFromSetCookie(
				await addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), 'grant-b', 'b@ownmail.com'),
			)
			vi.setSystemTime(new Date(startedAt.getTime() + 13 * 24 * 60 * 60 * 1000))
			const request = req(`ownmail_session=${cookie}`)
			const handle = (await sessionAccountSummaries(request))?.find(
				(account) => account.email === 'a@ownmail.com',
			)?.handle as string
			const switched = (await switchSessionAccount(request, handle)) as string

			expect(switched).toContain('Max-Age=86400')
			const switchedCookie = cookieFromSetCookie(switched)
			vi.setSystemTime(new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000 + 1))
			expect(await getSession(req(`ownmail_session=${switchedCookie}`))).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it('fails closed if a session expires during an account-switch rotation', async () => {
		vi.useFakeTimers()
		try {
			const startedAt = new Date('2026-01-01T00:00:00.000Z')
			vi.setSystemTime(startedAt)
			const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
			const request = req(`ownmail_session=${cookie}`)
			const handle = (await sessionAccountSummaries(request))?.[0]?.handle as string
			let platformCalls = 0
			platformMock.mockImplementation(async () => {
				platformCalls += 1
				if (platformCalls === 3) {
					vi.setSystemTime(new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000 + 1))
				}
				return { env: { SESSION_SECRET }, kv: null, runtime: 'node' }
			})

			await expect(switchSessionAccount(request, handle)).rejects.toThrow('Session expired')
		} finally {
			vi.useRealTimers()
		}
	})

	it('keeps ten normal verified accounts within the practical cookie budget', async () => {
		let cookie = cookieFromSetCookie(await createSession('grant-0', 'inbox0@ownmail.com'))
		for (let index = 1; index < 10; index += 1) {
			cookie = cookieFromSetCookie(
				await addVerifiedSessionAccount(
					req(`ownmail_session=${cookie}`),
					`grant-${index}`,
					`inbox${index}@ownmail.com`,
				),
			)
		}

		expect(cookie.length).toBeLessThanOrEqual(3800)
		expect((await getSession(req(`ownmail_session=${cookie}`)))?.accounts).toHaveLength(10)
		cookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(
				req(`ownmail_session=${cookie}`),
				'grant-replacement',
				' INBOX9@OWNMAIL.COM ',
			),
		)
		expect((await getSession(req(`ownmail_session=${cookie}`)))?.accounts).toHaveLength(10)
		expect((await getSession(req(`ownmail_session=${cookie}`)))?.accounts.at(-1)).toEqual({
			grantId: 'grant-replacement',
			email: 'INBOX9@OWNMAIL.COM',
		})
		await expect(
			addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), 'grant-10', 'inbox10@ownmail.com'),
		).rejects.toThrow('Too many inboxes')
	})

	it('fails closed rather than emitting an oversized stateless session cookie', async () => {
		const longGrant = (suffix: string) => `${'g'.repeat(900)}${suffix}`
		let cookie = cookieFromSetCookie(await createSession(longGrant('0'), 'a@ownmail.com'))
		cookie = cookieFromSetCookie(
			await addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), longGrant('1'), 'b@ownmail.com'),
		)

		await expect(
			addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), longGrant('2'), 'c@ownmail.com'),
		).rejects.toThrow('Session is too large')
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

	it('stores Nylas Connect state in a signed, short-lived cookie', async () => {
		const cookie = await storeConnectState(req(), 'state-x')
		expect(cookie).toContain('ownmail_connect_state=')
		expect(cookie).toContain('Max-Age=600')
	})

	it('consumes the Connect cookie, returns a clear-cookie, and matches the expected state', async () => {
		const stored = await storeConnectState(req(), 'state-x')
		const value = connectCookieFromSetCookie(stored)
		const result = await consumeConnectState(req(`ownmail_connect_state=${value}`), 'state-x')
		expect(result?.clearCookie).toContain('Max-Age=0')
	})

	it('returns null consuming Connect state when no cookie is present', async () => {
		expect(await consumeConnectState(req(), 'state-x')).toBeNull()
	})

	it('rejects a Connect cookie missing its signature', async () => {
		expect(await consumeConnectState(req('ownmail_connect_state=payloadonly'), 'state-x')).toBeNull()
	})

	it('rejects a Connect cookie with a bad signature', async () => {
		const stored = await storeConnectState(req(), 'state-x')
		const value = connectCookieFromSetCookie(stored)
		const [payload] = value.split('.')
		expect(await consumeConnectState(req(`ownmail_connect_state=${payload}.bad`), 'state-x')).toBeNull()
	})

	it('rejects a Connect cookie whose payload is not base64-decodable', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = '@@@bad@@@'
		const cookie = `${raw}.${await signRaw(raw)}`
		expect(await consumeConnectState(req(`ownmail_connect_state=${cookie}`), 'state-x')).toBeNull()
	})

	it('rejects a Connect cookie whose signed state does not match the request state', async () => {
		const stored = await storeConnectState(req(), 'state-other')
		const value = connectCookieFromSetCookie(stored)
		expect(await consumeConnectState(req(`ownmail_connect_state=${value}`), 'state-x')).toBeNull()
	})

	it('rejects a signed Connect cookie after its server-enforced expiry', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = b64url(
			JSON.stringify({
				s: 'state-x',
				n: 'nonce-x',
				i: 'anonymous',
				exp: Math.floor(Date.now() / 1000) - 1,
			}),
		)
		const cookie = `${raw}.${await signRaw(raw)}`

		expect(await consumeConnectState(req(`ownmail_connect_state=${cookie}`), 'state-x')).toBeNull()
	})

	it.each(['state with spaces', 'a'.repeat(129), 'state/with/slashes'])(
		'rejects invalid callback state before reading cookies (%s)',
		async (state) => {
			expect(await consumeConnectState(req('ownmail_connect_state=payload.signature'), state)).toBeNull()
		},
	)

	it.each(['state with spaces', 'a'.repeat(129), 'state/with/slashes'])(
		'refuses to store invalid Nylas Connect state (%s)',
		async (state) => {
			await expect(storeConnectState(req(), state)).rejects.toThrow('Invalid Nylas Connect state')
		},
	)

	it('consumes valid stateless Connect state without exposing token material', async () => {
		const stored = await storeConnectState(req(), 'state-x')
		const value = connectCookieFromSetCookie(stored)

		expect(await consumeConnectState(req(`ownmail_connect_state=${value}`), 'state-x')).toEqual({
			clearCookie: expect.stringContaining('Max-Age=0'),
		})
	})

	it('rejects a Connect cookie whose payload is valid base64 but not JSON', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = b64url('not json at all')
		const cookie = `${raw}.${await signRaw(raw)}`
		expect(await consumeConnectState(req(`ownmail_connect_state=${cookie}`), 'state-x')).toBeNull()
	})
})

/**
 * The 14-day window is a *sliding* one: it must survive continuous use, but re-persisting
 * on every request would put a KV write in the hot path of every authenticated call. The
 * throttle is the whole point of these tests — extend after a day of use, never before.
 */
describe('sliding session expiry', () => {
	const DAY_MS = 24 * 60 * 60 * 1000
	const TTL_MS = 14 * DAY_MS
	const START = new Date('2026-03-01T00:00:00.000Z')

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(START)
	})
	afterEach(() => vi.useRealTimers())

	async function sessionFor(cookie: string): Promise<[Request, Session]> {
		const request = req(`ownmail_session=${cookie}`)
		return [request, (await getSession(request)) as Session]
	}

	it('extends the KV deadline after a day of use, with one write against the same record', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const writesAfterLogin = kv.puts.length

		vi.setSystemTime(new Date(START.getTime() + DAY_MS + 1_000))
		const [request, session] = await sessionFor(cookie)
		const refreshed = (await slideSessionExpiry(request, session)) as string

		// Cookie Max-Age moves too, or the browser would still drop it on the old deadline.
		expect(refreshed).toContain(`Max-Age=${TTL_MS / 1000}`)
		// The opaque pointer is unchanged, so the slide is one idempotent write, not a rotation.
		expect(cookieFromSetCookie(refreshed)).toBe(cookie)
		expect(kv.puts.length).toBe(writesAfterLogin + 1)
		expect(kv.puts.at(-1)?.options?.expirationTtl).toBe(TTL_MS / 1000)

		// Past the original 14-day deadline the actively used session is still valid.
		vi.setSystemTime(new Date(START.getTime() + TTL_MS + 1_000))
		expect((await getSession(request))?.grantId).toBe('grant-a')
	})

	it('does not touch KV for a session used again inside the once-a-day throttle window', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const writesAfterLogin = kv.puts.length

		vi.setSystemTime(new Date(START.getTime() + DAY_MS - 1_000))
		const [request, session] = await sessionFor(cookie)

		expect(await slideSessionExpiry(request, session)).toBeNull()
		expect(kv.puts.length).toBe(writesAfterLogin)
	})

	it('still expires an idle KV session 14 days after its last activity', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))

		// One burst of activity on day 2, then the user goes quiet.
		vi.setSystemTime(new Date(START.getTime() + 2 * DAY_MS))
		const [request, session] = await sessionFor(cookie)
		const lastActivity = Date.now()
		expect(await slideSessionExpiry(request, session)).toBeTruthy()

		vi.setSystemTime(new Date(lastActivity + TTL_MS - 1_000))
		expect(await getSession(request)).not.toBeNull()
		vi.setSystemTime(new Date(lastActivity + TTL_MS + 1))
		expect(await getSession(request)).toBeNull()
	})

	/**
	 * Without KV there is no server-side record, so nothing a logout does can invalidate
	 * a signed cookie — a refresh that landed after the logout would hand the browser a
	 * fresh, still-valid cookie and quietly sign the user back in. Not sliding is the
	 * only outcome we can actually guarantee, so KV-less deployments keep the fixed
	 * 14-day window that runs from their last sign-in.
	 */
	it('never reissues a stateless cookie, which no logout could invalidate', async () => {
		usePlatform(null)
		const original = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))

		vi.setSystemTime(new Date(START.getTime() + DAY_MS + 1_000))
		const [request, session] = await sessionFor(original)

		expect(await slideSessionExpiry(request, session)).toBeNull()
		// The original window is untouched: still valid now, still gone at 14 days.
		expect((await getSession(req(`ownmail_session=${original}`)))?.grantId).toBe('grant-a')
		vi.setSystemTime(new Date(START.getTime() + TTL_MS + 1_000))
		expect(await getSession(req(`ownmail_session=${original}`))).toBeNull()
	})

	/**
	 * The resurrection race: a request reads the session, the user hits `/logout` and the
	 * record is deleted, and only then does the slide reach its write. Writing the old
	 * record back under the same id would leave a logged-out user authenticated as soon
	 * as the browser applied the refresh response's cookie. The tombstone the logout
	 * leaves behind is what the slide checks, so ordering can stay write-then-delete.
	 */
	it('leaves the user logged out when a logout lands mid-slide', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))

		vi.setSystemTime(new Date(START.getTime() + DAY_MS + 1_000))
		const [request, session] = await sessionFor(cookie)
		// The concurrent logout wins the race to KV.
		await destroySession(request)
		const sessionWritesBefore = kv.puts.filter((put) => put.key.startsWith('session:')).length

		expect(await slideSessionExpiry(request, session)).toBeNull()
		// No cookie to resurrect the session with, and no record written behind it.
		expect(kv.puts.filter((put) => put.key.startsWith('session:')).length).toBe(sessionWritesBefore)
		expect([...kv.store.keys()].some((key) => key.startsWith('session:'))).toBe(false)
		expect(await getSession(request)).toBeNull()
	})

	/**
	 * The tombstone is written *before* the record is deleted. Written after, it would
	 * leave open the exact window it exists to close — a slide that checked in between
	 * would see neither a tombstone nor, later, a record to stop it.
	 */
	it('tombstones a destroyed session id before deleting the record', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const request = req(`ownmail_session=${cookie}`)
		const order: string[] = []
		const realPut = kv.put
		const realDelete = kv.delete
		kv.put = async (key, value, options) => {
			order.push(`put ${key.split(':')[0]}`)
			return realPut(key, value, options)
		}
		kv.delete = async (key) => {
			order.push(`delete ${key.split(':')[0]}`)
			return realDelete(key)
		}

		await destroySession(request)

		expect(order).toEqual(['put revoked', 'delete session'])
		// And it outlives any request that could still be in flight.
		expect(kv.puts.at(-1)?.options?.expirationTtl).toBeGreaterThanOrEqual(60)
	})

	/**
	 * The narrow case the pre-check alone cannot catch: the tombstone lands *after* the
	 * slide reads it but before the write completes. The post-write check is what closes
	 * it — the slide removes the record it just created and issues no cookie, so the
	 * logout still wins even though the write technically happened.
	 */
	it('deletes the record it just wrote when a logout lands between the two checks', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const id = cookie.split('.')[0]

		vi.setSystemTime(new Date(START.getTime() + DAY_MS + 1_000))
		const [request, session] = await sessionFor(cookie)
		// Absent on the pre-check, present by the post-check: the logout landed in between.
		const realGet = kv.get
		let revocationReads = 0
		kv.get = async (key) => {
			if (!key.startsWith('revoked:')) return realGet(key)
			revocationReads += 1
			return revocationReads === 1 ? null : '1'
		}

		expect(await slideSessionExpiry(request, session)).toBeNull()
		// The write did happen — proving this is the post-check cleaning up, not the
		// pre-check bailing out — and the record is gone again.
		expect(kv.puts.some((put) => put.key === `session:${id}`)).toBe(true)
		expect(kv.store.has(`session:${id}`)).toBe(false)
	})

	/**
	 * The cleanup must only ever remove the slide's *own* write. If another writer put a
	 * record under this id in the meantime, deleting it would turn a race fix into the
	 * session-destroying bug it replaced.
	 */
	it('leaves a record another writer replaced ours with alone while still issuing no cookie', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const id = cookie.split('.')[0]

		vi.setSystemTime(new Date(START.getTime() + DAY_MS + 1_000))
		const [request, session] = await sessionFor(cookie)
		const realGet = kv.get
		let revocationReads = 0
		kv.get = async (key) => {
			if (!key.startsWith('revoked:')) return realGet(key)
			revocationReads += 1
			return revocationReads === 1 ? null : '1'
		}
		// Someone else rewrites this id immediately after our write lands.
		const replacement = JSON.stringify({ replaced: 'by another writer' })
		const realPut = kv.put
		kv.put = async (key, value, options) => {
			await realPut(key, value, options)
			if (key === `session:${id}`) kv.store.set(key, replacement)
		}

		expect(await slideSessionExpiry(request, session)).toBeNull()
		// No cookie either way, but the other writer's record survives untouched.
		expect(kv.store.get(`session:${id}`)).toBe(replacement)
	})

	/** Same race against an account switch: the slide must not restore the old inbox. */
	it('does not undo an account switch that lands mid-slide', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))

		vi.setSystemTime(new Date(START.getTime() + DAY_MS + 1_000))
		const [request, session] = await sessionFor(cookie)
		const switched = cookieFromSetCookie(await addVerifiedSessionAccount(request, 'grant-b', 'b@ownmail.com'))

		expect(await slideSessionExpiry(request, session)).toBeNull()
		// The pre-switch cookie stays dead and the switched-to inbox stays active.
		expect(await getSession(req(`ownmail_session=${cookie}`))).toBeNull()
		expect((await getSession(req(`ownmail_session=${switched}`)))?.grantId).toBe('grant-b')
	})

	/**
	 * Closing the resurrection race must not open a data-loss one. The replacement record
	 * is written first and the old one destroyed only once that write is durable, so a
	 * transient store failure costs the user a failed action — never their session.
	 */
	it('leaves the original session intact and usable when adding an inbox fails to persist', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const request = req(`ownmail_session=${cookie}`)
		// Only the record write fails. Everything else still works, so this catches an
		// ordering that destroys the old record before the replacement is durable.
		const realPut = kv.put
		kv.put = async (key, value, options) => {
			if (key.startsWith('session:')) throw new Error('KV write quota exceeded')
			return realPut(key, value, options)
		}

		await expect(addVerifiedSessionAccount(request, 'grant-b', 'b@ownmail.com')).rejects.toThrow()

		// Still signed in on the inbox they had, and not tombstoned into a dead end.
		expect((await getSession(request))?.grantId).toBe('grant-a')
		expect(kv.store.has(`session:${cookie.split('.')[0]}`)).toBe(true)
	})

	it('leaves the original session intact and usable when an account switch fails to persist', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const joined = cookieFromSetCookie(
			await addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), 'grant-b', 'b@ownmail.com'),
		)
		const request = req(`ownmail_session=${joined}`)
		const summaries = (await sessionAccountSummaries(request)) as { email: string; handle: string }[]
		const target = summaries.find((entry) => entry.email === 'a@ownmail.com') as { handle: string }
		const realPut = kv.put
		kv.put = async (key, value, options) => {
			if (key.startsWith('session:')) throw new Error('KV write timeout')
			return realPut(key, value, options)
		}

		await expect(switchSessionAccount(request, target.handle)).rejects.toThrow()

		// A failed switch leaves the user where they were, not signed out.
		expect((await getSession(request))?.grantId).toBe('grant-b')
	})

	it('never mints a record for a request that carries no session cookie', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		vi.setSystemTime(new Date(START.getTime() + 2 * DAY_MS))
		const [, session] = await sessionFor(cookie)
		const writesAfterLogin = kv.puts.length

		expect(await slideSessionExpiry(req(), session)).toBeNull()
		expect(kv.puts.length).toBe(writesAfterLogin)
	})

	it('restarts the window when a newly verified mailbox joins an older session', async () => {
		usePlatform(null)
		const cookie = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))

		vi.setSystemTime(new Date(START.getTime() + 10 * DAY_MS))
		const joined = cookieFromSetCookie(
			await addVerifiedSessionAccount(req(`ownmail_session=${cookie}`), 'grant-b', 'b@ownmail.com'),
		)

		// The deadline runs from the re-auth, not from the very first login.
		vi.setSystemTime(new Date(START.getTime() + TTL_MS + 1_000))
		expect((await getSession(req(`ownmail_session=${joined}`)))?.grantId).toBe('grant-b')
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
