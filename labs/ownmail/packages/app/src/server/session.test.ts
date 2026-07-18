import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvLike } from './platform.js'
import {
	addVerifiedSessionAccount,
	clearSessionCookie,
	consumePkce,
	createReferenceDevSessionCookie,
	createSession,
	destroySession,
	getSession,
	hasReferenceDevSessionCookie,
	sessionAccountSummaries,
	storePkce,
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

function pkceCookieFromSetCookie(setCookie: string): string {
	return setCookie.slice('ownmail_pkce='.length, setCookie.indexOf(';'))
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

			expect(kv.puts.at(-1)?.options?.expirationTtl).toBe(60)
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
		expect(kv.store.size).toBe(0)
	})

	it('is a no-op on destroy when there is no session cookie to look up', async () => {
		const kv = makeKv()
		usePlatform(kv)
		await destroySession(req())
		expect(kv.store.size).toBe(0)
	})

	it('persists PKCE verifiers server-side and binds them to a signed browser nonce', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = await storePkce(req(), 'state-1', 'verifier-1')
		expect(cookie).toContain('ownmail_pkce=')
		expect(kv.store.get('pkce:state-1')).toContain('"verifier":"verifier-1"')
	})

	it('consumes and invalidates a stored PKCE verifier exactly once', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = await storePkce(req(), 'state-1', 'verifier-1')

		const result = await consumePkce(req(`ownmail_pkce=${pkceCookieFromSetCookie(cookie)}`), 'state-1')
		expect(result).toEqual({ verifier: 'verifier-1', clearCookie: expect.stringContaining('Max-Age=0') })
		expect(kv.store.has('pkce:state-1')).toBe(false)
		// A second consume finds nothing.
		expect(await consumePkce(req(), 'state-1')).toBeNull()
	})

	it('does not let one browser consume another browser’s KV-backed auth attempt', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookieA = pkceCookieFromSetCookie(await storePkce(req(), 'state-a', 'verifier-a'))
		const cookieB = pkceCookieFromSetCookie(await storePkce(req(), 'state-b', 'verifier-b'))

		expect(await consumePkce(req(`ownmail_pkce=${cookieB}`), 'state-a')).toBeNull()
		expect(kv.store.has('pkce:state-a')).toBe(true)
		expect(await consumePkce(req(`ownmail_pkce=${cookieA}`), 'state-a')).toEqual({
			verifier: 'verifier-a',
			clearCookie: expect.stringContaining('Max-Age=0'),
		})
	})

	it.each([
		'not-json{',
		JSON.stringify({ verifier: 'verifier-a', nonce: 'nonce-a' }),
	])('rejects a malformed server-side PKCE record without consuming it (%s)', async (record) => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = pkceCookieFromSetCookie(await storePkce(req(), 'state-a', 'verifier-a'))
		kv.store.set('pkce:state-a', record)

		expect(await consumePkce(req(`ownmail_pkce=${cookie}`), 'state-a')).toBeNull()
		expect(kv.store.has('pkce:state-a')).toBe(true)
	})

	it('rejects a browser-bound attempt whose server-side verifier has expired or been evicted', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const cookie = pkceCookieFromSetCookie(await storePkce(req(), 'state-a', 'verifier-a'))
		kv.store.delete('pkce:state-a')

		expect(await consumePkce(req(`ownmail_pkce=${cookie}`), 'state-a')).toBeNull()
	})

	it('rejects an add-inbox callback from a different verified account set without burning state', async () => {
		const kv = makeKv()
		usePlatform(kv)
		const sessionA = cookieFromSetCookie(await createSession('grant-a', 'a@ownmail.com'))
		const attempt = pkceCookieFromSetCookie(
			await storePkce(req(`ownmail_session=${sessionA}`), 'state-add', 'verifier-add'),
		)
		const sessionB = cookieFromSetCookie(await createSession('grant-b', 'b@ownmail.com'))

		expect(
			await consumePkce(req(`ownmail_session=${sessionB}; ownmail_pkce=${attempt}`), 'state-add'),
		).toBeNull()
		expect(kv.store.has('pkce:state-add')).toBe(true)
		expect(
			await consumePkce(req(`ownmail_session=${sessionA}; ownmail_pkce=${attempt}`), 'state-add'),
		).toEqual({ verifier: 'verifier-add', clearCookie: expect.stringContaining('Max-Age=0') })
	})
})

describe('stateless sessions (no KV)', () => {
	beforeEach(() => usePlatform(null))

	it('starts a verified account session when Hosted Auth completes without an existing session', async () => {
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

	it('stores PKCE state in a signed, short-lived cookie', async () => {
		const cookie = await storePkce(req(), 'state-x', 'verifier-x')
		expect(cookie).toContain('ownmail_pkce=')
		expect(cookie).toContain('Max-Age=600')
	})

	it('consumes the PKCE cookie, returns a clear-cookie, and matches the expected state', async () => {
		const stored = await storePkce(req(), 'state-x', 'verifier-x')
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
		const stored = await storePkce(req(), 'state-x', 'verifier-x')
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
		const stored = await storePkce(req(), 'state-other', 'verifier-x')
		const value = stored.slice('ownmail_pkce='.length, stored.indexOf(';'))
		expect(await consumePkce(req(`ownmail_pkce=${value}`), 'state-x')).toBeNull()
	})

	it('rejects a signed PKCE cookie after its server-enforced expiry', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = b64url(
			JSON.stringify({
				s: 'state-x',
				n: 'nonce-x',
				i: 'anonymous',
				v: 'verifier-x',
				exp: Math.floor(Date.now() / 1000) - 1,
			}),
		)
		const cookie = `${raw}.${await signRaw(raw)}`

		expect(await consumePkce(req(`ownmail_pkce=${cookie}`), 'state-x')).toBeNull()
	})

	it('rejects a stateless PKCE cookie without an embedded verifier', async () => {
		const { signRaw } = await buildStatelessSession()
		const raw = b64url(
			JSON.stringify({
				s: 'state-x',
				n: 'nonce-x',
				i: 'anonymous',
				exp: Math.floor(Date.now() / 1000) + 60,
			}),
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
