import { buildAuthorizeUrl, generatePkcePair } from '@nylas-labs/cli-kit/v3'
import { createFileRoute } from '@tanstack/react-router'
import { platform } from '../server/platform.js'
import { storePkce } from '../server/session.js'

export const Route = createFileRoute('/auth')({
	server: {
		handlers: {
			/** Kicks off Nylas Hosted Auth (provider "nylas") with PKCE. */
			GET: async ({ request }) => {
				const { env } = await platform()
				if (!env.NYLAS_CLIENT_ID?.trim()) {
					return configurationErrorResponse('NYLAS_CLIENT_ID is not configured for this deployment.')
				}

				const origin = new URL(request.url).origin
				const state = crypto.randomUUID()
				const pkce = await generatePkcePair()
				const pkceCookie = await storePkce(state, pkce.verifier)

				const url = buildAuthorizeUrl({
					region: env.NYLAS_REGION,
					baseUrl: env.NYLAS_API_BASE_URL,
					clientId: env.NYLAS_CLIENT_ID,
					redirectUri: `${origin}/auth/callback`,
					provider: 'nylas',
					state,
					codeChallenge: pkce.challenge,
					...(env.INBOX_EMAIL ? { loginHint: env.INBOX_EMAIL } : {}),
				})
				const headers = new Headers({ Location: url })
				if (pkceCookie) headers.set('Set-Cookie', pkceCookie)
				return new Response(null, { status: 302, headers })
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
