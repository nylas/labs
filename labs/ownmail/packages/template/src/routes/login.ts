import { buildAuthorizeUrl, generatePkcePair } from '@nylas-labs/cli-kit/v3'
import { createFileRoute } from '@tanstack/react-router'
import { platform } from '../server/platform.js'
import { storePkce } from '../server/session.js'

export const Route = createFileRoute('/login')({
	server: {
		handlers: {
			/** Kicks off Nylas Hosted Auth (provider "nylas") with PKCE. */
			GET: async ({ request }) => {
				const { env } = await platform()
				const origin = new URL(request.url).origin
				const state = crypto.randomUUID()
				const pkce = await generatePkcePair()
				const pkceCookie = await storePkce(state, pkce.verifier)

				const url = buildAuthorizeUrl({
					region: env.NYLAS_REGION,
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
