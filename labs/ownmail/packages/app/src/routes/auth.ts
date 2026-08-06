import { createFileRoute } from '@tanstack/react-router'
import { LOGIN_PATH, MAIL_HOME_PATH } from '#app/config/route-paths'
import { usingDevMocks } from '#server/platform'
import { createReferenceDevSessionCookie, getSession, switchSessionAccount } from '#server/session'

const MAX_SWITCH_BODY_BYTES = 1024

export const Route = createFileRoute('/auth')({
	server: {
		handlers: {
			/**
			 * Sign-in starts on OwnMail's own credential form. Nothing is delegated
			 * to a hosted screen, so this entry point only points at that form —
			 * and keeps pointing at it while an existing session adds a mailbox.
			 */
			GET: async ({ request }) => {
				if (await usingDevMocks()) {
					return new Response(null, {
						status: 302,
						headers: { Location: MAIL_HOME_PATH, 'Set-Cookie': createReferenceDevSessionCookie() },
					})
				}
				const addingMailbox = Boolean(await getSession(request))
				return new Response(null, {
					status: 302,
					headers: {
						Location: addingMailbox ? `${LOGIN_PATH}?add=1` : LOGIN_PATH,
						'Cache-Control': 'no-store',
					},
				})
			},
			/** Switches only to an inbox previously verified through this session's Nylas Connect flow. */
			POST: async ({ request }) => {
				if (request.headers.get('origin') !== new URL(request.url).origin) {
					return new Response('Forbidden', { status: 403 })
				}
				const mediaType = (request.headers.get('content-type') ?? '').replace(/;.*$/, '').trim().toLowerCase()
				const rawContentLength = request.headers.get('content-length')
				if (
					mediaType !== 'application/x-www-form-urlencoded' ||
					(rawContentLength !== null && !validContentLength(rawContentLength))
				) {
					return new Response('Invalid request', { status: 400 })
				}
				const handle = await readBoundedSwitchHandle(request, rawContentLength)
				if (!handle) return new Response('Invalid request', { status: 400 })
				const cookie = await switchSessionAccount(request, handle)
				if (!cookie) return new Response('Forbidden', { status: 403 })
				return new Response(null, {
					status: 303,
					headers: { Location: MAIL_HOME_PATH, 'Set-Cookie': cookie },
				})
			},
		},
	},
})

function validContentLength(value: string): boolean {
	if (!/^[1-9]\d{0,3}$/.test(value)) return false
	return Number(value) <= MAX_SWITCH_BODY_BYTES
}

async function readBoundedSwitchHandle(
	request: Request,
	declaredLength: string | null,
): Promise<string | null> {
	if (!request.body) return null
	const reader = request.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			length += value.byteLength
			if (length > MAX_SWITCH_BODY_BYTES) {
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
	let body: string
	try {
		body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		return null
	}
	const values = new URLSearchParams(body).getAll('account')
	return values.length === 1 && values[0] ? values[0] : null
}
