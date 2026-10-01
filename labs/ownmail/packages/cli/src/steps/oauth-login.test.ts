import * as p from '@clack/prompts'
import type { DashboardAccountClient } from '@nylas-labs/cli-kit'
import open from 'open'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signInWithBrowser } from './oauth-login.js'

/**
 * The loopback listener is the only thing standing between "the person
 * approved in their browser" and a stored session, and it is reachable by
 * anything on the machine. These tests drive it over real HTTP, the way the
 * browser's redirect does.
 */

vi.mock('@clack/prompts', () => ({
	log: { warn: vi.fn() },
	note: vi.fn(),
	spinner: vi.fn(),
}))

vi.mock('open', () => ({ default: vi.fn() }))

vi.mock('@nylas-labs/cli-kit', () => ({
	createOAuthPkcePair: vi.fn(async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' })),
}))

vi.mock('../nylas-env.js', () => ({ OWNMAIL_OAUTH_CLIENT_ID: 'ownmail-client' }))

const session = {
	userToken: 'ut',
	orgToken: 'ot',
	user: { publicId: 'user-pub' },
	orgPublicId: 'org-pub',
	expiresAt: 1_800_000_000_000,
}
const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() }

type AuthorizeInput = Parameters<DashboardAccountClient['oauthAuthorizeUrl']>[0]

function fakeDashboard(tokens: { accessToken: string; refreshToken?: string }) {
	const oauthAuthorizeUrl = vi.fn(
		(input: AuthorizeInput) => `https://dashboard.test/oauth/authorize?s=${input.state}`,
	)
	const oauthToken = vi.fn().mockResolvedValue(tokens)
	const oauthExchange = vi.fn().mockResolvedValue(session)
	return {
		client: { oauthAuthorizeUrl, oauthToken, oauthExchange } as unknown as DashboardAccountClient,
		oauthAuthorizeUrl,
		oauthToken,
		oauthExchange,
	}
}

/** Makes `open` behave like the browser: follow the authorize redirect back to the CLI. */
function browserRedirects(
	query: (input: AuthorizeInput) => Record<string, string>,
	before?: (base: string) => Promise<void>,
) {
	return (dashboard: ReturnType<typeof fakeDashboard>) => {
		vi.mocked(open).mockImplementation(async () => {
			const input = dashboard.oauthAuthorizeUrl.mock.calls[0]?.[0] as AuthorizeInput
			await before?.(input.redirectUri)
			const res = await fetch(`${input.redirectUri}?${new URLSearchParams(query(input))}`)
			pages.push({ status: res.status, headers: res.headers, body: await res.text() })
			return undefined as never
		})
	}
}

let pages: { status: number; headers: Headers; body: string }[] = []

beforeEach(() => {
	vi.clearAllMocks()
	pages = []
	vi.mocked(p.spinner).mockReturnValue(spinner as unknown as ReturnType<typeof p.spinner>)
})

describe('signInWithBrowser', () => {
	it('redeems the code the browser brings back and returns a renewable session', async () => {
		const dashboard = fakeDashboard({ accessToken: 'access', refreshToken: 'refresh' })
		browserRedirects((input) => ({ code: 'auth-code', state: input.state }))(dashboard)

		await expect(signInWithBrowser(dashboard.client, 'eu')).resolves.toEqual({
			session,
			refreshToken: 'refresh',
		})

		const authorize = dashboard.oauthAuthorizeUrl.mock.calls[0]?.[0] as AuthorizeInput
		expect(authorize).toMatchObject({ clientId: 'ownmail-client', codeChallenge: 'challenge', region: 'eu' })
		// RFC 8252 loopback redirect: the server only admits 127.0.0.1 or localhost with /callback.
		expect(authorize.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
		expect(authorize.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
		// The redirect URI and verifier must match the authorize request or the server refuses the code.
		expect(dashboard.oauthToken).toHaveBeenCalledWith({
			clientId: 'ownmail-client',
			code: 'auth-code',
			redirectUri: authorize.redirectUri,
			codeVerifier: 'verifier',
		})
		expect(dashboard.oauthExchange).toHaveBeenCalledWith('access')
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('https://dashboard.test/oauth/authorize'),
			expect.any(String),
		)
		expect(spinner.stop).toHaveBeenCalledWith('Browser sign-in complete')

		expect(pages[0]?.status).toBe(200)
		expect(pages[0]?.body).toContain('You’re signed in')
		expect(pages[0]?.headers.get('content-security-policy')).toContain("default-src 'none'")
		expect(pages[0]?.headers.get('cache-control')).toBe('no-store')
		expect(pages[0]?.headers.get('x-content-type-options')).toBe('nosniff')
		// The listener is gone once the sign-in ends.
		await expect(fetch(authorize.redirectUri)).rejects.toThrow()
	})

	it('ignores requests that are not the authorization server’s redirect', async () => {
		// Anything on the machine can reach the port. Only our own state may finish the sign-in.
		const dashboard = fakeDashboard({ accessToken: 'access', refreshToken: 'refresh' })
		const strays: number[] = []
		browserRedirects(
			(input) => ({ code: 'auth-code', state: input.state }),
			async (redirectUri) => {
				const base = new URL(redirectUri).origin
				strays.push((await fetch(`${redirectUri}?code=stolen&state=guessed`)).status)
				strays.push((await fetch(`${redirectUri}?error=access_denied`)).status)
				strays.push((await fetch(`${base}/`)).status)
				strays.push((await fetch(redirectUri, { method: 'POST' })).status)
			},
		)(dashboard)

		await signInWithBrowser(dashboard.client, 'us')

		expect(strays).toEqual([400, 400, 404, 404])
		expect(dashboard.oauthToken).toHaveBeenCalledTimes(1)
		expect(dashboard.oauthToken).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth-code' }))
	})

	it('explains a sign-in the person declined, without echoing the server’s text', async () => {
		const dashboard = fakeDashboard({ accessToken: 'access', refreshToken: 'refresh' })
		browserRedirects((input) => ({
			error: 'access_denied',
			error_description: '<script>alert(1)</script>',
			state: input.state,
		}))(dashboard)

		await expect(signInWithBrowser(dashboard.client, 'us')).rejects.toThrow(
			'Sign-in was cancelled in the browser. Re-run ownmail to try again.',
		)

		expect(dashboard.oauthToken).not.toHaveBeenCalled()
		expect(spinner.stop).toHaveBeenCalledWith('Browser sign-in did not complete')
		expect(pages[0]?.status).toBe(400)
		expect(pages[0]?.body).not.toContain('script>')
	})

	it.each([[{ error: 'server_error' }], [{}]])(
		'fails when the redirect carries no usable code %j',
		async (query) => {
			const dashboard = fakeDashboard({ accessToken: 'access', refreshToken: 'refresh' })
			browserRedirects((input) => ({ ...query, state: input.state }))(dashboard)

			await expect(signInWithBrowser(dashboard.client, 'us')).rejects.toThrow(
				/Nylas could not complete the sign-in/,
			)
		},
	)

	it('refuses a sign-in that could never be renewed', async () => {
		const dashboard = fakeDashboard({ accessToken: 'access' })
		browserRedirects((input) => ({ code: 'auth-code', state: input.state }))(dashboard)

		await expect(signInWithBrowser(dashboard.client, 'us')).rejects.toThrow(/renewable sign-in/)
		expect(dashboard.oauthExchange).not.toHaveBeenCalled()
	})

	it('keeps waiting on the printed URL when the browser cannot be opened, then gives up in time', async () => {
		const dashboard = fakeDashboard({ accessToken: 'access', refreshToken: 'refresh' })
		vi.mocked(open).mockRejectedValue(new Error('no browser'))

		await expect(signInWithBrowser(dashboard.client, 'us', 20)).rejects.toThrow(/not finished in time/)

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringMatching(/Could not open your browser/))
		expect(spinner.start).toHaveBeenCalled()
	})
})
