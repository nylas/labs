import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const buildAuthorizeUrl = vi.fn()
const generatePkcePair = vi.fn()
vi.mock('@nylas-labs/cli-kit/v3', () => ({
	buildAuthorizeUrl: (args: any) => buildAuthorizeUrl(args),
	generatePkcePair: () => generatePkcePair(),
}))

const platform = vi.fn()
const usingDevMocks = vi.fn()
vi.mock('../server/platform.js', () => ({
	platform: () => platform(),
	usingDevMocks: () => usingDevMocks(),
}))

const storePkce = vi.fn()
const createReferenceDevSessionCookie = vi.fn()
vi.mock('../server/session.js', () => ({
	storePkce: (state: string, verifier: string) => storePkce(state, verifier),
	createReferenceDevSessionCookie: () => createReferenceDevSessionCookie(),
}))

import { Route } from './auth.js'

const GET = Route.options.server.handlers.GET

function req() {
	return new Request('https://ownmail.local/auth')
}

beforeEach(() => {
	vi.clearAllMocks()
	generatePkcePair.mockResolvedValue({ verifier: 'v', challenge: 'c' })
	buildAuthorizeUrl.mockReturnValue('https://api.nylas.com/authorize?x=1')
})

describe('/auth', () => {
	it('short-circuits to the mailbox with a dev-session cookie under local mocks', async () => {
		usingDevMocks.mockResolvedValue(true)
		platform.mockResolvedValue({ env: {} })
		createReferenceDevSessionCookie.mockReturnValue('ownmail_session=authenticated')

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('/')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_session=authenticated')
		expect(generatePkcePair).not.toHaveBeenCalled()
	})

	it('fails closed with a 500 config page when the Nylas client id is missing', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({ env: { NYLAS_CLIENT_ID: '   ' } })

		const response = await GET({ request: req() })

		expect(response.status).toBe(500)
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
		expect(await response.text()).toContain('App configuration error')
		expect(generatePkcePair).not.toHaveBeenCalled()
	})

	it('starts hosted auth with PKCE, a login hint, and a state cookie in stateless mode', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({
			env: {
				NYLAS_CLIENT_ID: 'client-123',
				NYLAS_REGION: 'us',
				NYLAS_API_BASE_URL: 'https://api.nylas.com',
				INBOX_EMAIL: 'ada@ownmail.com',
			},
		})
		storePkce.mockResolvedValue('ownmail_pkce=signed')

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('https://api.nylas.com/authorize?x=1')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_pkce=signed')
		expect(buildAuthorizeUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				clientId: 'client-123',
				provider: 'nylas',
				redirectUri: 'https://ownmail.local/auth/callback',
				codeChallenge: 'c',
				loginHint: 'ada@ownmail.com',
			}),
		)
		expect(storePkce).toHaveBeenCalledWith(expect.any(String), 'v')
	})

	it('omits the state cookie in KV mode and the login hint when no inbox is configured', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({
			env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'eu', INBOX_EMAIL: '' },
		})
		storePkce.mockResolvedValue(null)

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Set-Cookie')).toBeNull()
		expect(buildAuthorizeUrl).toHaveBeenCalledWith(
			expect.not.objectContaining({ loginHint: expect.anything() }),
		)
	})
})
