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
const PKCE_COOKIE = 'ownmail_pkce'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days
const PKCE_TTL_SECONDS = 600
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
 * Adds a mailbox only after Hosted Auth has verified its credentials. Existing
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
	const cookie = await persistSession({
		accounts: [...accounts, { grantId, email: email.trim() }],
		activeGrantId: grantId,
		createdAt,
		expiresAt: current?.expiresAt ?? createdAt + SESSION_TTL_SECONDS * 1000,
	})
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

async function persistSession(record: StoredSession): Promise<string> {
	if (!validStoredSession(record)) throw new Error('Invalid session')
	const remainingTtl = Math.ceil((record.expiresAt - Date.now()) / 1000)
	if (remainingTtl <= 0) throw new Error('Session expired')
	const { kv } = await platform()
	if (kv) {
		const id = base64url(crypto.getRandomValues(new Uint8Array(32)))
		await kv.put(`session:${id}`, JSON.stringify(record), { expirationTtl: remainingTtl })
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
	if (id) await kv.delete(`session:${id}`)
}

// ---- PKCE state (login flow) ---------------------------------------------------

/**
 * Persists one browser-bound PKCE attempt. The signed nonce cookie is always
 * required; KV additionally binds the verifier to the initiating account set.
 */
export async function storePkce(request: Request, state: string, verifier: string): Promise<string> {
	const { kv } = await platform()
	const nonce = base64url(crypto.getRandomValues(new Uint8Array(32)))
	const identity = await sessionAccountSetIdentity(request)
	const exp = Math.floor(Date.now() / 1000) + PKCE_TTL_SECONDS
	if (kv) {
		await kv.put(`pkce:${state}`, JSON.stringify({ verifier, nonce, identity }), {
			expirationTtl: PKCE_TTL_SECONDS,
		})
	}
	const payload = base64url(
		encoder.encode(JSON.stringify({ s: state, n: nonce, i: identity, ...(!kv ? { v: verifier } : {}), exp })),
	)
	return setCookie(PKCE_COOKIE, `${payload}.${await hmac(payload)}`, PKCE_TTL_SECONDS)
}

export function clearPkceCookie(): string {
	return setCookie(PKCE_COOKIE, '', 0)
}

/** Retrieves + invalidates a verifier only in the browser/session that initiated it. */
export async function consumePkce(
	request: Request,
	state: string,
): Promise<{ verifier: string; clearCookie: string } | null> {
	const value = cookieValue(request, PKCE_COOKIE)
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
			v?: unknown
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
		let verifier: string
		if (kv) {
			const raw = await kv.get(`pkce:${state}`)
			if (!raw) return null
			const stored = parseStoredPkce(raw)
			if (!stored || !timingSafeEqual(stored.nonce, parsed.n) || !timingSafeEqual(stored.identity, parsed.i))
				return null
			verifier = stored.verifier
			await kv.delete(`pkce:${state}`)
		} else {
			if (typeof parsed.v !== 'string') return null
			verifier = parsed.v
		}
		return { verifier, clearCookie: clearPkceCookie() }
	} catch {
		return null
	}
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

function parseStoredPkce(raw: string): { verifier: string; nonce: string; identity: string } | null {
	try {
		const value = JSON.parse(raw) as Record<string, unknown>
		return typeof value.verifier === 'string' &&
			typeof value.nonce === 'string' &&
			typeof value.identity === 'string'
			? { verifier: value.verifier, nonce: value.nonce, identity: value.identity }
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
