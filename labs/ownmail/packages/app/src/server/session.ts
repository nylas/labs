/**
 * Cookie + KV session model, with a stateless fallback for platforms
 * without KV (e.g. Vercel functions).
 *
 * Security invariant: the Nylas API key is app-wide, so the grant_id MUST come
 * from this server-side session — never from client input.
 *
 * KV mode: cookie = <random id>.<hmac(id)>, KV maps id → the verified inboxes.
 * Stateless mode: cookie = <base64url payload>.<hmac(payload)> where the
 * payload carries the verified inboxes and expiry directly. Both are HMAC-SHA256-signed
 * with SESSION_SECRET.
 */
import { platform } from './platform.js'

const COOKIE_NAME = 'ownmail_session'
const CONNECT_STATE_COOKIE = 'ownmail_connect_state'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days
/**
 * Sliding-window throttle: the 14-day deadline only moves once a day of activity
 * has elapsed, so a continuously used session costs at most one KV write per day.
 */
const SESSION_SLIDE_INTERVAL_SECONDS = 60 * 60 * 24 // 1 day
/**
 * How long a destroyed session id stays tombstoned. It only has to outlive requests
 * that were already in flight when the session died, so minutes are generous — but
 * Cloudflare KV rejects an expirationTtl under 60s, and the keys are tiny.
 */
const SESSION_REVOCATION_TTL_SECONDS = 300
const CONNECT_STATE_TTL_SECONDS = 600
const MAX_SESSION_ACCOUNTS = 10
const MAX_SESSION_COOKIE_VALUE_LENGTH = 3800

export type SessionAccount = {
	grantId: string
	email: string
}

export type Session = {
	grantId: string
	email: string
	accounts: SessionAccount[]
	createdAt: number
	expiresAt: number
}

type StoredSession = {
	accounts: SessionAccount[]
	activeGrantId: string
	createdAt: number
	expiresAt: number
}

const encoder = new TextEncoder()

function base64url(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64url(value: string): string | null {
	try {
		const b64 = value.replaceAll('-', '+').replaceAll('_', '/')
		return atob(b64)
	} catch {
		return null
	}
}

async function hmac(value: string): Promise<string> {
	const { env } = await platform()
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(env.SESSION_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return diff === 0
}

function cookieValue(request: Request, name: string): string | null {
	const cookies = request.headers.get('cookie') ?? ''
	const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
	return match?.[1] ?? null
}

function setCookie(name: string, value: string, maxAge: number, secure = true): string {
	return `${name}=${value}; Path=/; HttpOnly${secure ? '; Secure' : ''}; SameSite=Lax; Max-Age=${maxAge}`
}

/** Returns the Set-Cookie header value establishing the session. */
export async function createSession(grantId: string, email: string): Promise<string> {
	const createdAt = Date.now()
	return persistSession({
		accounts: [{ grantId, email }],
		activeGrantId: grantId,
		createdAt,
		expiresAt: createdAt + SESSION_TTL_SECONDS * 1000,
	})
}

/**
 * Adds a mailbox only after Nylas Connect has verified its credentials. Existing
 * verified mailboxes remain available and the newly verified mailbox becomes active.
 */
export async function addVerifiedSessionAccount(
	request: Request,
	grantId: string,
	email: string,
): Promise<string> {
	const current = await getSession(request)
	const canonicalEmail = canonicalAccountEmail(email)
	const accounts =
		current?.accounts.filter(
			(account) => account.grantId !== grantId && canonicalAccountEmail(account.email) !== canonicalEmail,
		) ?? []
	if (accounts.length >= MAX_SESSION_ACCOUNTS) throw new Error('Too many inboxes in this session')
	const createdAt = current?.createdAt ?? Date.now()
	// Verifying a mailbox is activity: the window restarts from now rather than
	// keeping the deadline set at the user's very first login.
	const cookie = await persistSession({
		accounts: [...accounts, { grantId, email: email.trim() }],
		activeGrantId: grantId,
		createdAt,
		expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
	})
	// Only once the replacement is durable. If the write above fails, the user keeps
	// the session they already had rather than being logged out by a transient outage.
	if (current) await destroySession(request)
	return cookie
}

/** Selects an already verified mailbox. A client-provided grant id is never accepted. */
export async function switchSessionAccount(request: Request, handle: string): Promise<string | null> {
	if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) return null
	const current = await getSession(request)
	if (!current) return null
	let selected: SessionAccount | undefined
	for (const account of current.accounts) {
		if (timingSafeEqual(await accountHandle(account.grantId), handle)) {
			selected = account
			break
		}
	}
	if (!selected) return null
	const cookie = await persistSession({
		accounts: current.accounts,
		activeGrantId: selected.grantId,
		createdAt: current.createdAt,
		expiresAt: current.expiresAt,
	})
	// Same ordering as above: a failed switch must leave the user on their current
	// inbox, not signed out.
	await destroySession(request)
	return cookie
}

export async function sessionAccountSummaries(
	request: Request,
): Promise<{ email: string; handle: string; active: boolean }[] | null> {
	const session = await getSession(request)
	if (!session) return null
	return Promise.all(
		session.accounts.map(async (account) => ({
			email: account.email,
			handle: await accountHandle(account.grantId),
			active: account.grantId === session.grantId,
		})),
	)
}

async function accountHandle(grantId: string): Promise<string> {
	return hmac(`account:${grantId}`)
}

/**
 * Extends the session deadline on authenticated activity, at most once per
 * SESSION_SLIDE_INTERVAL_SECONDS. Returns a Set-Cookie header value when the window
 * moved (the cookie Max-Age has to move with it), or null when the throttle says the
 * write isn't due yet — or when the session must not be extended at all.
 *
 * A refresh must never outlive a session mutation. A `/logout` or account switch that
 * happens while a request is in flight deletes the record; if this slide then wrote the
 * old record back and its response landed last, the browser would adopt a resurrected
 * cookie — the user would stay signed in after signing out. Every path that destroys a
 * record tombstones its id first, and the slide refuses to write when it sees one.
 *
 * KV offers no compare-and-swap, so this narrows the race rather than closing it: the
 * slide can still resurrect a record if the tombstone is written after this check *and*
 * the delete beats the write below. That is a single KV round-trip wide, against the
 * whole request lifetime before.
 *
 * The caller passes the session it already resolved, so sliding costs one read, not two.
 */
export async function slideSessionExpiry(request: Request, session: Session): Promise<string | null> {
	// Only the request's own cookie may be extended — never mint a record for a
	// request that carries no session.
	const value = cookieValue(request, COOKIE_NAME)
	if (!value) return null
	const now = Date.now()
	const extendedAt = session.expiresAt - SESSION_TTL_SECONDS * 1000
	if (now - extendedAt < SESSION_SLIDE_INTERVAL_SECONDS * 1000) return null
	const { kv } = await platform()
	// Stateless mode: the cookie *is* the record, so there is nothing to tombstone and
	// no way to tell a live session from a just-destroyed one. A reissued cookie racing
	// behind a logout would silently restore it. Sliding therefore *requires* shared
	// storage (Cloudflare KV or Upstash) — that limit is documented in the deployment
	// docs rather than papered over, and KV-less targets keep a fixed 14-day window
	// running from their last sign-in.
	if (!kv) return null
	const id = value.split('.')[0]
	// Checked as late as possible, immediately before the write.
	if (await kv.get(`revoked:${id}`)) return null
	// Reuse the existing id so the slide is a single idempotent write and concurrent
	// requests can't strand orphan records or invalidate each other's cookie.
	return persistSession(
		{
			accounts: session.accounts,
			activeGrantId: session.grantId,
			createdAt: session.createdAt,
			expiresAt: now + SESSION_TTL_SECONDS * 1000,
		},
		id,
	)
}

async function persistSession(record: StoredSession, existingId?: string): Promise<string> {
	if (!validStoredSession(record)) throw new Error('Invalid session')
	const remainingTtl = Math.ceil((record.expiresAt - Date.now()) / 1000)
	if (remainingTtl <= 0) throw new Error('Session expired')
	const { kv } = await platform()
	if (kv) {
		const id = existingId ?? base64url(crypto.getRandomValues(new Uint8Array(32)))
		await kv.put(`session:${id}`, JSON.stringify(record), { expirationTtl: Math.max(60, remainingTtl) })
		return setCookie(COOKIE_NAME, `${id}.${await hmac(id)}`, remainingTtl)
	}
	// Stateless: signed payload cookie.
	const payload = base64url(
		encoder.encode(
			JSON.stringify({
				a: record.accounts.map((account) => ({ g: account.grantId, e: account.email })),
				active: record.activeGrantId,
				exp: Math.floor(record.expiresAt / 1000),
			}),
		),
	)
	const value = `${payload}.${await hmac(payload)}`
	if (value.length > MAX_SESSION_COOKIE_VALUE_LENGTH) throw new Error('Session is too large')
	return setCookie(COOKIE_NAME, value, remainingTtl)
}

export function clearSessionCookie(): string {
	return setCookie(COOKIE_NAME, '', 0, false)
}

export function createReferenceDevSessionCookie(): string {
	return setCookie(COOKIE_NAME, 'authenticated', 60 * 60 * 24 * 30, false)
}

export function hasReferenceDevSessionCookie(request: Request): boolean {
	return cookieValue(request, COOKIE_NAME) === 'authenticated'
}

export async function getSession(request: Request): Promise<Session | null> {
	const value = cookieValue(request, COOKIE_NAME)
	if (!value) return null
	const [first, sig] = value.split('.')
	if (!first || !sig) return null
	if (!timingSafeEqual(await hmac(first), sig)) return null

	const { kv } = await platform()
	if (kv) {
		const raw = await kv.get(`session:${first}`)
		if (!raw) return null
		try {
			const parsed = JSON.parse(raw) as Partial<StoredSession> & Partial<Session>
			return restoreSession(parsed)
		} catch {
			return null
		}
	}
	const decoded = fromBase64url(first)
	if (!decoded) return null
	try {
		const parsed = JSON.parse(decoded) as {
			a?: unknown
			active?: unknown
			g?: unknown
			e?: unknown
			exp?: unknown
		}
		if (typeof parsed.exp !== 'number' || !Number.isSafeInteger(parsed.exp) || parsed.exp * 1000 < Date.now())
			return null
		// Accept legacy one-inbox cookies until their normal expiry.
		const expiresAt = parsed.exp * 1000
		const stored = Array.isArray(parsed.a)
			? {
					accounts: parsed.a.map((account) => {
						const value = account as { g?: unknown; e?: unknown }
						return { grantId: value.g, email: value.e }
					}),
					activeGrantId: parsed.active,
					createdAt: expiresAt - SESSION_TTL_SECONDS * 1000,
					expiresAt,
				}
			: {
					accounts: [{ grantId: parsed.g, email: parsed.e }],
					activeGrantId: parsed.g,
					createdAt: expiresAt - SESSION_TTL_SECONDS * 1000,
					expiresAt,
				}
		return restoreSession(stored)
	} catch {
		return null
	}
}

export async function destroySession(request: Request): Promise<void> {
	const { kv } = await platform()
	if (!kv) return // stateless sessions die with the cleared cookie
	const value = cookieValue(request, COOKIE_NAME)
	const id = value?.split('.')[0]
	if (!id) return
	// Tombstone before deleting, never after: a refresh that is already in flight
	// checks for this key before it writes, so it cannot re-create the record behind
	// the delete below. Ordering matters — a tombstone written after the delete would
	// leave exactly the gap it exists to close.
	await kv.put(`revoked:${id}`, '1', { expirationTtl: SESSION_REVOCATION_TTL_SECONDS })
	await kv.delete(`session:${id}`)
}

// ---- Nylas Connect state (login flow) ------------------------------------------

/**
 * Persists one browser-bound Nylas Connect attempt. The signed nonce cookie is
 * always required; KV additionally makes state single-use across the deployment.
 */
export async function storeConnectState(request: Request, state: string): Promise<string> {
	if (!validConnectState(state)) throw new Error('Invalid Nylas Connect state')
	const { kv } = await platform()
	const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)))
	const identity = await sessionAccountSetIdentity(request)
	const exp = Math.floor(Date.now() / 1000) + CONNECT_STATE_TTL_SECONDS
	if (kv) {
		await kv.put(`connect:${state}`, JSON.stringify({ nonce, identity }), {
			expirationTtl: CONNECT_STATE_TTL_SECONDS,
		})
	}
	const payload = base64url(encoder.encode(JSON.stringify({ s: state, n: nonce, i: identity, exp })))
	return setCookie(CONNECT_STATE_COOKIE, `${payload}.${await hmac(payload)}`, CONNECT_STATE_TTL_SECONDS)
}

export function clearConnectStateCookie(): string {
	return setCookie(CONNECT_STATE_COOKIE, '', 0)
}

/** Retrieves + invalidates state only in the browser/session that initiated it. */
export async function consumeConnectState(
	request: Request,
	state: string,
): Promise<{ clearCookie: string } | null> {
	if (!validConnectState(state)) return null
	const value = cookieValue(request, CONNECT_STATE_COOKIE)
	if (!value) return null
	const [payload, sig] = value.split('.')
	if (!payload || !sig) return null
	if (!timingSafeEqual(await hmac(payload), sig)) return null
	const decoded = fromBase64url(payload)
	if (!decoded) return null
	try {
		const parsed = JSON.parse(decoded) as {
			s?: unknown
			n?: unknown
			i?: unknown
			exp?: unknown
		}
		if (
			typeof parsed.s !== 'string' ||
			typeof parsed.n !== 'string' ||
			typeof parsed.i !== 'string' ||
			typeof parsed.exp !== 'number' ||
			!Number.isSafeInteger(parsed.exp) ||
			parsed.exp * 1000 < Date.now() ||
			parsed.s !== state
		)
			return null
		const currentIdentity = await sessionAccountSetIdentity(request)
		if (!timingSafeEqual(parsed.i, currentIdentity)) return null
		const { kv } = await platform()
		if (kv) {
			const raw = await kv.get(`connect:${state}`)
			if (!raw) return null
			const stored = parseStoredConnectState(raw)
			if (!stored || !timingSafeEqual(stored.nonce, parsed.n) || !timingSafeEqual(stored.identity, parsed.i))
				return null
			await kv.delete(`connect:${state}`)
		}
		return { clearCookie: clearConnectStateCookie() }
	} catch {
		return null
	}
}

function validConnectState(state: string): boolean {
	return /^[A-Za-z0-9_-]{1,128}$/.test(state)
}

async function sessionAccountSetIdentity(request: Request): Promise<string> {
	const session = await getSession(request)
	if (!session) return 'anonymous'
	const grantIds = session.accounts
		.map((account) => account.grantId)
		.sort()
		.join('\0')
	return hmac(`session-accounts:${grantIds}`)
}

function parseStoredConnectState(raw: string): { nonce: string; identity: string } | null {
	try {
		const value = JSON.parse(raw) as Record<string, unknown>
		return typeof value.nonce === 'string' && typeof value.identity === 'string'
			? { nonce: value.nonce, identity: value.identity }
			: null
	} catch {
		return null
	}
}

function validAccount(value: unknown): value is SessionAccount {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const account = value as Partial<SessionAccount>
	return (
		typeof account.grantId === 'string' &&
		account.grantId.length > 0 &&
		account.grantId.length <= 1000 &&
		!/\r|\n/.test(account.grantId) &&
		typeof account.email === 'string' &&
		account.email.length > 0 &&
		account.email.length <= 320 &&
		!/[\r\n\0]/.test(account.email)
	)
}

function canonicalAccountEmail(email: string): string {
	return email.trim().toLocaleLowerCase('en-US')
}

function validStoredSession(value: unknown): value is StoredSession {
	const session = value as Partial<StoredSession>
	return (
		Array.isArray(session.accounts) &&
		session.accounts.length > 0 &&
		session.accounts.length <= MAX_SESSION_ACCOUNTS &&
		session.accounts.every(validAccount) &&
		new Set(session.accounts.map((account) => account.grantId)).size === session.accounts.length &&
		typeof session.activeGrantId === 'string' &&
		session.accounts.some((account) => account.grantId === session.activeGrantId) &&
		typeof session.createdAt === 'number' &&
		Number.isFinite(session.createdAt) &&
		typeof session.expiresAt === 'number' &&
		Number.isFinite(session.expiresAt) &&
		session.expiresAt > session.createdAt
	)
}

function restoreSession(value: unknown): Session | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const record = value as Record<string, unknown>
	const createdAt = record.createdAt
	const expiresAt =
		typeof record.expiresAt === 'number'
			? record.expiresAt
			: typeof createdAt === 'number'
				? createdAt + SESSION_TTL_SECONDS * 1000
				: undefined
	const stored: unknown = Array.isArray(record.accounts)
		? {
				accounts: record.accounts,
				activeGrantId: record.activeGrantId,
				createdAt,
				expiresAt,
			}
		: {
				accounts: [{ grantId: record.grantId, email: record.email }],
				activeGrantId: record.grantId,
				createdAt,
				expiresAt,
			}
	if (!validStoredSession(stored)) return null
	if (stored.expiresAt <= Date.now()) return null
	const active = stored.accounts.find((account) => account.grantId === stored.activeGrantId) as SessionAccount
	return {
		...active,
		accounts: stored.accounts,
		createdAt: stored.createdAt,
		expiresAt: stored.expiresAt,
	}
}
