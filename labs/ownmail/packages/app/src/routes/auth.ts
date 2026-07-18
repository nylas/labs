import { buildAuthorizeUrl, generatePkcePair } from '@nylas-labs/cli-kit/v3'
import { createFileRoute } from '@tanstack/react-router'
import { MAIL_HOME_PATH } from '../components/route-paths.js'
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
				const pkceCookie = await storePkce(state, pkce.verifier)
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
				if (pkceCookie) headers.set('Set-Cookie', pkceCookie)
				return new Response(null, { status: 302, headers })
			},
			/** Switches only to an inbox previously verified through this session's Hosted Auth flow. */
			POST: async ({ request }) => {
				if (request.headers.get('origin') !== new URL(request.url).origin) {
					return new Response('Forbidden', { status: 403 })
				}
				const mediaType = (request.headers.get('content-type') ?? '').replace(/;.*$/, '').trim().toLowerCase()
				const rawContentLength = request.headers.get('content-length')
				const contentLength = Number(rawContentLength)
				if (
					mediaType !== 'application/x-www-form-urlencoded' ||
					rawContentLength === null ||
					!Number.isSafeInteger(contentLength) ||
					contentLength <= 0 ||
					contentLength > MAX_SWITCH_BODY_BYTES
				) {
					return new Response('Invalid request', { status: 400 })
				}
				let handle: FormDataEntryValue | null
				try {
					handle = (await request.formData()).get('account')
				} catch {
					return new Response('Invalid request', { status: 400 })
				}
				if (typeof handle !== 'string') return new Response('Invalid request', { status: 400 })
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
