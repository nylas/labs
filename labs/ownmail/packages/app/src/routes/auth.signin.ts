import { createFileRoute } from '@tanstack/react-router'
import { LOGIN_PATH, MAIL_HOME_PATH } from '#app/config/route-paths'
import { requestAgentAccountCallback } from '#server/agent-account-login'
import { platform, usingDevMocks } from '#server/platform'
import { createReferenceDevSessionCookie, getSession, storeConnectState } from '#server/session'
import { clientIp, signInAttemptIsRateLimited } from '#server/sign-in-rate-limit'

const MAX_CREDENTIAL_BODY_BYTES = 2048
const MAX_EMAIL_LENGTH = 320
const MAX_PASSWORD_LENGTH = 512
// Deliberately permissive: format policing belongs to the mailbox provider, and
// a stricter rule here would only tell an attacker which addresses parse.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/**
 * Submits mailbox credentials from OwnMail's own sign-in form.
 *
 * Every failure — malformed input, unknown mailbox, wrong password, lockout,
 * misconfiguration, or an unreachable provider — leaves through the same
 * response, so nothing here reveals whether an address exists. On success the
 * browser is sent to this deployment's own `/auth/callback`, which performs the
 * unchanged code-for-grant exchange.
 */
export const Route = createFileRoute('/auth/signin')({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const requestUrl = new URL(request.url)
				if (request.headers.get('origin') !== requestUrl.origin) {
					return new Response('Forbidden', { status: 403, headers: noStore() })
				}
				const devMocks = await usingDevMocks()
				const addingMailbox = !devMocks && Boolean(await getSession(request))
				const credentials = await readCredentials(request)
				if (!credentials) return signInFailed(addingMailbox)

				if (devMocks) {
					return new Response(null, {
						status: 303,
						headers: noStore({
							Location: MAIL_HOME_PATH,
							'Set-Cookie': createReferenceDevSessionCookie(),
						}),
					})
				}

				if (await signInAttemptIsRateLimited(credentials.email, clientIp(request))) {
					// Driven purely by attempt counts, so this says nothing about the
					// address — only that this browser and mailbox must wait.
					return signInFailed(addingMailbox, 'rate')
				}

				const { env } = await platform()
				const state = crypto.randomUUID()
				const callbackPath = await requestAgentAccountCallback({
					env,
					email: credentials.email,
					appPassword: credentials.appPassword,
					redirectUri: `${requestUrl.origin}/auth/callback`,
					state,
				})
				if (!callbackPath) return signInFailed(addingMailbox)

				// The signed, single-use nonce cookie is issued on the same response
				// that sends the browser to the callback, so a replayed or forged
				// state still fails there exactly as it did under the hosted flow.
				return new Response(null, {
					status: 303,
					headers: noStore({
						Location: callbackPath,
						'Set-Cookie': await storeConnectState(request, state),
					}),
				})
			},
		},
	},
})

function noStore(headers: Record<string, string> = {}): Headers {
	return new Headers({ ...headers, 'Cache-Control': 'no-store' })
}

/**
 * The one and only outcome for every rejected credential — malformed input,
 * unknown mailbox, wrong password, provider outage, or misconfiguration. Only a
 * lockout differs, and only because waiting is actionable.
 */
function signInFailed(addingMailbox: boolean, reason: '1' | 'rate' = '1'): Response {
	const location = `${LOGIN_PATH}?error=${reason}${addingMailbox ? '&add=1' : ''}`
	return new Response(null, { status: 303, headers: noStore({ Location: location }) })
}

async function readCredentials(request: Request): Promise<{ email: string; appPassword: string } | null> {
	const mediaType = (request.headers.get('content-type') ?? '').replace(/;.*$/, '').trim().toLowerCase()
	if (mediaType !== 'application/x-www-form-urlencoded') return null
	const rawContentLength = request.headers.get('content-length')
	if (rawContentLength !== null && !validContentLength(rawContentLength)) return null
	const body = await readBoundedBody(request, rawContentLength)
	if (body === null) return null
	const form = new URLSearchParams(body)
	const emails = form.getAll('email')
	const passwords = form.getAll('app_password')
	if (emails.length !== 1 || passwords.length !== 1) return null
	const email = `${emails[0]}`.trim()
	const appPassword = `${passwords[0]}`
	if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null
	if (appPassword.length === 0 || appPassword.length > MAX_PASSWORD_LENGTH) return null
	if (hasControlCharacter(appPassword)) return null
	return { email, appPassword }
}

/** Matches the app's existing convention for keeping control bytes out of provider payloads. */
function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0)
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
	})
}

function validContentLength(value: string): boolean {
	if (!/^[1-9]\d{0,3}$/.test(value)) return false
	return Number(value) <= MAX_CREDENTIAL_BODY_BYTES
}

async function readBoundedBody(request: Request, declaredLength: string | null): Promise<string | null> {
	if (!request.body) return null
	const reader = request.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			length += value.byteLength
			if (length > MAX_CREDENTIAL_BODY_BYTES) {
				await reader.cancel()
				return null
			}
			chunks.push(value)
		}
	} catch {
		return null
	}
	if (length === 0 || (declaredLength !== null && length !== Number(declaredLength))) return null
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		return null
	}
}
