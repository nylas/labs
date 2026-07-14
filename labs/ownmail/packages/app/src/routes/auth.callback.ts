import { exchangeCodeForToken } from '@nylas-labs/cli-kit/v3'
import { createFileRoute } from '@tanstack/react-router'
import { MAIL_HOME_PATH } from '../components/route-paths.js'
import { platform } from '../server/platform.js'
import { consumePkce, createSession } from '../server/session.js'

export const Route = createFileRoute('/auth/callback')({
	server: {
		handlers: {
			/** Hosted-auth callback: code → grant, then cookie (+KV) session. */
			GET: async ({ request }) => {
				const { env } = await platform()
				const url = new URL(request.url)
				const code = url.searchParams.get('code')
				const state = url.searchParams.get('state')
				const error = url.searchParams.get('error')
				if (error || !code || !state) {
					return loginFailedResponse(callbackFailureMessage(error))
				}
				const pkce = await consumePkce(request, state)
				if (!pkce) {
					return loginFailedResponse('expired login attempt — please try again')
				}

				try {
					const token = await exchangeCodeForToken({
						region: env.NYLAS_REGION,
						baseUrl: env.NYLAS_API_BASE_URL,
						clientId: env.NYLAS_CLIENT_ID,
						clientSecret: env.NYLAS_API_KEY,
						redirectUri: `${url.origin}/auth/callback`,
						code,
						codeVerifier: pkce.verifier,
					})
					const headers = new Headers({ Location: MAIL_HOME_PATH })
					headers.append('Set-Cookie', await createSession(token.grant_id, token.email ?? env.INBOX_EMAIL))
					if (pkce.clearCookie) headers.append('Set-Cookie', pkce.clearCookie)
					return new Response(null, { status: 302, headers })
				} catch (err) {
					reportTokenExchangeFailure(err)
					// Never surface exchange internals to the browser.
					return loginFailedResponse(tokenExchangeFailureMessage(err))
				}
			},
		},
	},
})

/**
 * Records identifiers that let operators find a failed exchange in provider logs
 * without logging the authorization code, API key, password, or response body.
 */
function reportTokenExchangeFailure(error: unknown): void {
	if (!error || typeof error !== 'object' || (error as { name?: unknown }).name !== 'NylasApiError') return

	const details = error as { status?: unknown; requestId?: unknown; type?: unknown }
	console.error('OwnMail token exchange failed', {
		...(typeof details.status === 'number' ? { status: details.status } : {}),
		...(typeof details.requestId === 'string' ? { requestId: details.requestId } : {}),
		...(typeof details.type === 'string' ? { type: details.type } : {}),
	})
}

/**
 * Only use allow-listed provider outcomes in browser copy. Provider-supplied
 * error strings can contain implementation details or untrusted text.
 */
function callbackFailureMessage(providerError: string | null): string {
	if (providerError === 'access_denied') {
		return 'Sign-in was cancelled or denied. Check your OwnMail inbox email and password, then try again.'
	}
	return 'We couldn’t complete your sign-in. Please try again.'
}

/** Keeps invalid credentials actionable while treating all other exchange failures safely. */
function tokenExchangeFailureMessage(error: unknown): string {
	const status =
		error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
			? (error as { status: number }).status
			: undefined
	if (status === 400 || status === 401 || status === 403) {
		return 'That email or password was not accepted. Check your OwnMail inbox credentials and try again.'
	}
	if (status === 429) return 'Too many sign-in attempts. Wait a moment, then try again.'
	return 'We couldn’t complete your sign-in. Please try again.'
}

function loginFailedResponse(message: string): Response {
	const html = `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center">
<h1 style="font-size:1.25rem">Couldn’t sign you in</h1>
<p style="color:#666">${escapeHtml(message)}</p>
<a href="/auth" style="color:#2563eb">Try again</a>
</div></body>`
	return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
	)
}
