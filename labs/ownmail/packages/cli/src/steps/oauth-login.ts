import { randomBytes } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as p from '@clack/prompts'
import {
	createOAuthPkcePair,
	type DashboardAccountClient,
	type OAuthSessionResponse,
	type Region,
} from '@nylas-labs/cli-kit'
import open from 'open'
import { OWNMAIL_OAUTH_CLIENT_ID } from '../nylas-env.js'

const CALLBACK_PATH = '/callback'
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

export type BrowserSignIn = {
	session: OAuthSessionResponse
	refreshToken: string
}

/**
 * Signs in on the Nylas dashboard's own login page: any method the dashboard
 * offers, or a new account. The browser returns an authorization code to a
 * loopback port (RFC 8252 §7.3), PKCE binds the code to this process, and the
 * access token is exchanged for a DPoP-bound dashboard session.
 */
export async function signInWithBrowser(
	dashboard: DashboardAccountClient,
	region: Region,
	timeoutMs = SIGN_IN_TIMEOUT_MS,
): Promise<BrowserSignIn> {
	const { codeVerifier, codeChallenge } = await createOAuthPkcePair()
	const state = randomBytes(32).toString('base64url')
	const callback = await listenForOAuthCallback(state, timeoutMs)
	const spinner = p.spinner()
	try {
		const url = dashboard.oauthAuthorizeUrl({
			clientId: OWNMAIL_OAUTH_CLIENT_ID,
			redirectUri: callback.redirectUri,
			state,
			codeChallenge,
			region,
		})
		p.note(
			`Log in or create a free Nylas account, then approve OwnMail.\nIf you belong to several organizations, pick the one that should own this mailbox.\n\nIf your browser did not open, visit:\n\n  ${url}`,
			'Continue in your browser',
		)
		await open(url).catch(() => {
			p.log.warn('Could not open your browser automatically. Use the URL above.')
		})
		spinner.start('Waiting for you to finish in the browser…')
		const code = await callback.code
		const issued = await dashboard.oauthToken({
			clientId: OWNMAIL_OAUTH_CLIENT_ID,
			code,
			redirectUri: callback.redirectUri,
			codeVerifier,
		})
		if (!issued.refreshToken) {
			throw new Error('Nylas did not return a renewable sign-in. Re-run ownmail to try again.')
		}
		const session = await dashboard.oauthExchange(issued.accessToken)
		spinner.stop('Browser sign-in complete')
		return { session, refreshToken: issued.refreshToken }
	} catch (err) {
		spinner.stop('Browser sign-in did not complete')
		throw err
	} finally {
		callback.close()
	}
}

type OAuthCallback = {
	redirectUri: string
	code: Promise<string>
	close: () => void
}

/**
 * Serves exactly one useful request: the authorization server's redirect to
 * `/callback`. Bound to 127.0.0.1 on a port the OS picks. A request whose
 * `state` is not ours is answered and ignored, so nothing else on the machine
 * can end or complete the sign-in.
 */
async function listenForOAuthCallback(state: string, timeoutMs: number): Promise<OAuthCallback> {
	let settle: { resolve: (code: string) => void; reject: (err: Error) => void }
	const code = new Promise<string>((resolve, reject) => {
		settle = { resolve, reject }
	})
	// Awaited by the caller only once the browser is open; never leave it unhandled.
	code.catch(() => {})

	const server = createServer((req, res) => {
		const url = new URL(req.url as string, 'http://127.0.0.1')
		if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
			respond(res, 404, 'Not found', 'This page is not part of OwnMail sign-in.')
			return
		}
		if (url.searchParams.get('state') !== state) {
			respond(res, 400, 'Sign-in link not recognised', 'Return to your terminal and re-run ownmail.')
			return
		}
		const authorizationCode = url.searchParams.get('code')
		if (url.searchParams.has('error') || !authorizationCode) {
			respond(res, 400, 'Sign-in was not completed', 'Return to your terminal to try again.')
			settle.reject(
				new Error(
					url.searchParams.get('error') === 'access_denied'
						? 'Sign-in was cancelled in the browser. Re-run ownmail to try again.'
						: 'Nylas could not complete the sign-in. Re-run ownmail to try again.',
				),
			)
			return
		}
		respond(res, 200, 'You’re signed in', 'You can close this tab and return to your terminal.')
		settle.resolve(authorizationCode)
	})

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const timer = setTimeout(() => {
		settle.reject(new Error('The browser sign-in was not finished in time. Re-run ownmail to try again.'))
	}, timeoutMs)

	return {
		redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}${CALLBACK_PATH}`,
		code,
		close: () => {
			clearTimeout(timer)
			server.close()
			server.closeAllConnections()
		},
	}
}

/** A static page: nothing from the request is ever written into it. */
function respond(res: ServerResponse, status: number, title: string, message: string): void {
	res.writeHead(status, {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-store',
		'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
		'Referrer-Policy': 'no-referrer',
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		Connection: 'close',
	})
	res.end(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OwnMail</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`,
	)
}
