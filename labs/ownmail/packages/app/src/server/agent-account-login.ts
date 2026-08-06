/**
 * Server-side credential submission for Agent Account (Nylas connector) mailboxes.
 *
 * This replaces the Nylas-hosted credential screen only. The app password is
 * posted as JSON from this server to UAS and never reaches a URL, a cookie, a
 * log line, or any response to the browser.
 *
 * Contract (`POST /v3/connect/login/nylas`, UAS `NylasCallback`): a 200 with a
 * JSON body whose keys are the Go struct's PascalCase field names, because the
 * struct carries no JSON tags. The authorization code is `UASCode`; the browser
 * is then sent to this app's own `/auth/callback`, which runs the unchanged
 * code-for-grant exchange. `BaseURL` is never fetched or followed.
 *
 * That contract is undocumented and unpinned upstream, so `agentAccountCode`
 * asserts the exact shape it depends on — a UAS change must fail our tests
 * loudly instead of breaking sign-in silently.
 */
import { resolveV3BaseUrl } from '@nylas-labs/cli-kit/v3'
import type { AppEnv } from './platform.js'
import { OWNMAIL_USER_AGENT } from './usage-attribution.js'

const REQUEST_TIMEOUT_MS = 15_000

export type AgentAccountLoginInput = {
	env: AppEnv
	email: string
	appPassword: string
	redirectUri: string
	state: string
}

/**
 * Returns the app-owned callback path to hand back to the browser, or null for
 * every failure. Callers must translate null into one generic message: UAS
 * itself refuses to distinguish "no such mailbox" from "wrong password", and
 * neither may this app.
 */
export async function requestAgentAccountCallback(
	input: AgentAccountLoginInput,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	const clientId = input.env.NYLAS_CLIENT_ID?.trim()
	if (!clientId) {
		console.error('OwnMail sign-in is not configured: NYLAS_CLIENT_ID is missing.')
		return null
	}
	const url = `${resolveV3BaseUrl(input.env.NYLAS_REGION, input.env.NYLAS_API_BASE_URL)}/v3/connect/login/nylas`
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
	let response: Response
	try {
		response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'User-Agent': OWNMAIL_USER_AGENT,
			},
			body: JSON.stringify({
				public_application_id: clientId,
				email: input.email,
				app_password: input.appPassword,
				redirect_uri: input.redirectUri,
				state: input.state,
			}),
			// The contract answers 200 with JSON; a redirect would mean something
			// else entirely and must never be followed with credentials attached.
			redirect: 'error',
			signal: controller.signal,
		})
	} catch {
		console.error('OwnMail sign-in could not reach the Nylas connect endpoint.')
		return null
	} finally {
		clearTimeout(timeout)
	}
	// Never log or forward the UAS body: it carries the code, the grant id, and
	// an error payload with internal codes. Only the status is safe to record.
	if (!response.ok) {
		console.error('OwnMail sign-in was rejected', { status: response.status })
		return null
	}
	let parsed: unknown
	try {
		parsed = await response.json()
	} catch {
		console.error('OwnMail sign-in received an unreadable response', { status: response.status })
		return null
	}
	const code = agentAccountCode(parsed, input.state)
	if (!code) return null
	return `${new URL(input.redirectUri).pathname}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(input.state)}`
}

/**
 * Pins the exact response shape this app depends on: `Success: true`, a
 * non-empty `UASCode`, and the `State` this request issued echoed back. Any
 * other shape — including a renamed or re-cased key — yields null, so a silent
 * upstream contract change surfaces as a failed sign-in and a failing test
 * rather than a mis-parsed success.
 */
export function agentAccountCode(parsed: unknown, state: string): string | null {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	const body = parsed as { Success?: unknown; UASCode?: unknown; State?: unknown }
	if (body.Success !== true) return null
	if (typeof body.UASCode !== 'string' || body.UASCode.length === 0) return null
	if (body.State !== state) return null
	return body.UASCode
}
