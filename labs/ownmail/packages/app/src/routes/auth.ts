import { buildAuthorizeUrl, generatePkcePair } from '@nylas-labs/cli-kit/v3'
import { createFileRoute } from '@tanstack/react-router'
import { MAIL_HOME_PATH } from '../app/config/route-paths.js'
import { platform, usingDevMocks } from '../server/platform.js'
import {
	createReferenceDevSessionCookie,
	getSession,
	storePkce,
	switchSessionAccount,
} from '../server/session.js'

const MAX_SWITCH_BODY_BYTES = 1024

export const Route = createFileRoute('/auth')({
	server: {
		handlers: {
			/** Kicks off Nylas Hosted Auth (provider "nylas") with PKCE. */
			GET: async ({ request }) => {
				const { env } = await platform()
				if (await usingDevMocks()) {
					return new Response(null, {
						status: 302,
						headers: { Location: MAIL_HOME_PATH, 'Set-Cookie': createReferenceDevSessionCookie() },
					})
				}
				if (!env.NYLAS_CLIENT_ID?.trim()) {
					return configurationErrorResponse('NYLAS_CLIENT_ID is not configured for this deployment.')
				}

				const origin = new URL(request.url).origin
				const state = crypto.randomUUID()
				const pkce = await generatePkcePair()
				const pkceCookie = await storePkce(request, state, pkce.verifier)
				const existingSession = await getSession(request)

				const url = buildAuthorizeUrl({
					region: env.NYLAS_REGION,
					baseUrl: env.NYLAS_API_BASE_URL,
					clientId: env.NYLAS_CLIENT_ID,
					redirectUri: `${origin}/auth/callback`,
					provider: 'nylas',
					state,
					codeChallenge: pkce.challenge,
					...(!existingSession && env.INBOX_EMAIL ? { loginHint: env.INBOX_EMAIL } : {}),
				})
				const headers = new Headers({ Location: url })
				headers.set('Set-Cookie', pkceCookie)
				return new Response(null, { status: 302, headers })
			},
			/** Switches only to an inbox previously verified through this session's Hosted Auth flow. */
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

function configurationErrorResponse(message: string): Response {
	const html = `<!doctype html><meta charset="utf-8"><title>Configuration error</title>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:36rem;padding:2rem">
<h1 style="font-size:1.25rem">App configuration error</h1>
<p style="color:#666">${escapeHtml(message)}</p>
</div></body>`
	return new Response(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
	)
}
