/**
 * Cookie + KV session model, with a stateless fallback for platforms
 * without KV (e.g. Vercel functions).
 *
 * Security invariant: the Nylas API key is app-wide, so the grant_id MUST come
 * from this server-side session — never from client input.
 *
 * KV mode: cookie = <random id>.<hmac(id)>, KV maps id → {grantId, email}.
 * Stateless mode: cookie = <base64url payload>.<hmac(payload)> where the
 * payload carries {grantId, email, exp} directly. Both are HMAC-SHA256-signed
 * with SESSION_SECRET.
 */
import { platform } from './platform.js'

const COOKIE_NAME = 'ownmail_session'
const PKCE_COOKIE = 'ownmail_pkce'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days

export type Session = {
	grantId: string
	email: string
	createdAt: number
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

function setCookie(name: string, value: string, maxAge: number): string {
	return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

/** Returns the Set-Cookie header value establishing the session. */
export async function createSession(grantId: string, email: string): Promise<string> {
	const { kv } = await platform()
	if (kv) {
		const id = base64url(crypto.getRandomValues(new Uint8Array(32)))
		const record: Session = { grantId, email, createdAt: Date.now() }
		await kv.put(`session:${id}`, JSON.stringify(record), { expirationTtl: SESSION_TTL_SECONDS })
		return setCookie(COOKIE_NAME, `${id}.${await hmac(id)}`, SESSION_TTL_SECONDS)
	}
	// Stateless: signed payload cookie.
	const payload = base64url(
		encoder.encode(
			JSON.stringify({ g: grantId, e: email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
		),
	)
	return setCookie(COOKIE_NAME, `${payload}.${await hmac(payload)}`, SESSION_TTL_SECONDS)
}

export function clearSessionCookie(): string {
	return setCookie(COOKIE_NAME, '', 0)
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
			return JSON.parse(raw) as Session
		} catch {
			return null
		}
	}
	const decoded = fromBase64url(first)
	if (!decoded) return null
	try {
		const parsed = JSON.parse(decoded) as { g: string; e: string; exp: number }
		if (parsed.exp * 1000 < Date.now()) return null
		return { grantId: parsed.g, email: parsed.e, createdAt: 0 }
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
 * Persists the PKCE verifier for a login attempt. KV mode stores it
 * server-side and returns no cookie; stateless mode returns a signed,
 * short-lived Set-Cookie carrying state+verifier.
 */
export async function storePkce(state: string, verifier: string): Promise<string | null> {
	const { kv } = await platform()
	if (kv) {
		await kv.put(`pkce:${state}`, verifier, { expirationTtl: 600 })
		return null
	}
	const payload = base64url(encoder.encode(JSON.stringify({ s: state, v: verifier })))
	return setCookie(PKCE_COOKIE, `${payload}.${await hmac(payload)}`, 600)
}

/** Retrieves + invalidates the verifier for `state`. */
export async function consumePkce(
	request: Request,
	state: string,
): Promise<{ verifier: string; clearCookie: string | null } | null> {
	const { kv } = await platform()
	if (kv) {
		const verifier = await kv.get(`pkce:${state}`)
		if (!verifier) return null
		await kv.delete(`pkce:${state}`)
		return { verifier, clearCookie: null }
	}
	const value = cookieValue(request, PKCE_COOKIE)
	if (!value) return null
	const [payload, sig] = value.split('.')
	if (!payload || !sig) return null
	if (!timingSafeEqual(await hmac(payload), sig)) return null
	const decoded = fromBase64url(payload)
	if (!decoded) return null
	try {
		const parsed = JSON.parse(decoded) as { s: string; v: string }
		if (parsed.s !== state) return null
		return { verifier: parsed.v, clearCookie: setCookie(PKCE_COOKIE, '', 0) }
	} catch {
		return null
	}
}
