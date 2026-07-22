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
vi.mock('#server/platform', () => ({
	platform: () => platform(),
	usingDevMocks: () => usingDevMocks(),
}))

const storePkce = vi.fn()
const createReferenceDevSessionCookie = vi.fn()
const switchSessionAccount = vi.fn()
const getSession = vi.fn()
vi.mock('#server/session', () => ({
	storePkce: (request: Request, state: string, verifier: string) => storePkce(request, state, verifier),
	createReferenceDevSessionCookie: () => createReferenceDevSessionCookie(),
	switchSessionAccount: (request: Request, handle: string) => switchSessionAccount(request, handle),
	getSession: (request: Request) => getSession(request),
}))

import { Route } from './auth.js'

const GET = Route.options.server.handlers.GET
const POST = Route.options.server.handlers.POST

function req() {
	return new Request('https://ownmail.local/auth')
}

beforeEach(() => {
	vi.clearAllMocks()
	getSession.mockResolvedValue(null)
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
		expect(storePkce).toHaveBeenCalledWith(expect.any(Request), expect.any(String), 'v')
	})

	it('always binds auth state to a browser cookie and omits the login hint when no inbox is configured', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({
			env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'eu', INBOX_EMAIL: '' },
		})
		storePkce.mockResolvedValue('ownmail_pkce=signed-kv-attempt')

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_pkce=signed-kv-attempt')
		expect(buildAuthorizeUrl).toHaveBeenCalledWith(
			expect.not.objectContaining({ loginHint: expect.anything() }),
		)
	})

	it('does not pin Hosted Auth to the primary inbox while adding another verified account', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1', email: 'ada@ownmail.com' })
		platform.mockResolvedValue({
			env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'us', INBOX_EMAIL: 'ada@ownmail.com' },
		})
		storePkce.mockResolvedValue('ownmail_pkce=signed-add-attempt')

		await GET({ request: req() })

		expect(buildAuthorizeUrl).toHaveBeenCalledWith(
			expect.not.objectContaining({ loginHint: expect.anything() }),
		)
	})

	it('switches through the server-owned session allow-list and hard-navigates to clear scoped caches', async () => {
		const handle = 'a'.repeat(43)
		switchSessionAccount.mockResolvedValue('ownmail_session=next')
		const body = new URLSearchParams({ account: handle }).toString()
		const request = new Request('https://ownmail.local/auth', {
			method: 'POST',
			headers: {
				origin: 'https://ownmail.local',
				'content-type': 'application/x-www-form-urlencoded',
				'content-length': String(body.length),
			},
			body,
		})

		const response = await POST({ request })

		expect(switchSessionAccount).toHaveBeenCalledWith(request, handle)
		expect(response.status).toBe(303)
		expect(response.headers.get('Location')).toBe('/')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_session=next')
	})

	it('accepts a bounded streaming body when Content-Length is unavailable', async () => {
		const handle = 'b'.repeat(43)
		switchSessionAccount.mockResolvedValue('ownmail_session=next')
		const request = new Request('https://ownmail.local/auth', {
			method: 'POST',
			headers: {
				origin: 'https://ownmail.local',
				'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			body: new URLSearchParams({ account: handle }),
		})

		const response = await POST({ request })

		expect(response.status).toBe(303)
		expect(switchSessionAccount).toHaveBeenCalledWith(request, handle)
	})

	it('rejects cross-origin account switches before reading session state', async () => {
		const response = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					origin: 'https://attacker.example',
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({ account: 'a'.repeat(43) }),
			}),
		})

		expect(response.status).toBe(403)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})

	it('fails closed for an unknown or stale account handle', async () => {
		switchSessionAccount.mockResolvedValue(null)
		const response = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					origin: 'https://ownmail.local',
					'content-type': 'application/x-www-form-urlencoded',
					'content-length': '51',
				},
				body: new URLSearchParams({ account: 'z'.repeat(43) }),
			}),
		})

		expect(response.status).toBe(403)
		expect(await response.text()).toBe('Forbidden')
	})

	it('rejects unsupported or oversized switch bodies', async () => {
		const wrongType = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: { origin: 'https://ownmail.local', 'content-type': 'application/json' },
				body: '{}',
			}),
		})
		const oversized = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					origin: 'https://ownmail.local',
					'content-type': 'application/x-www-form-urlencoded',
					'content-length': '1025',
				},
				body: 'account=x',
			}),
		})

		expect(wrongType.status).toBe(400)
		expect(oversized.status).toBe(400)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})

	it.each([
		{ headers: { 'content-length': 'nope' }, label: 'invalid length' },
		{ headers: { 'content-length': '1e1' }, label: 'non-decimal length' },
		{ headers: { 'content-length': '0' }, label: 'empty body' },
		{ headers: { 'content-length': '9', 'content-type': '' }, label: 'missing media type' },
		{
			headers: {
				'content-length': '9',
				'content-type': 'application/x-www-form-urlencoded-evil',
			},
			label: 'lookalike media type',
		},
	])('rejects $label before parsing the body', async ({ headers }) => {
		const response = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					origin: 'https://ownmail.local',
					'content-type': 'application/x-www-form-urlencoded',
					...headers,
				},
				body: 'account=x',
			}),
		})

		expect(response.status).toBe(400)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})

	it('rejects a missing Content-Type even when the length is bounded', async () => {
		const response = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: { origin: 'https://ownmail.local', 'content-length': '9' },
				body: new TextEncoder().encode('account=x'),
			}),
		})
		expect(response.status).toBe(400)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})

	it('rejects a request with valid form headers but no body stream', async () => {
		const response = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					origin: 'https://ownmail.local',
					'content-type': 'application/x-www-form-urlencoded',
				},
			}),
		})

		expect(response.status).toBe(400)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})

	it('rejects malformed, ambiguous, mismatched, and actually oversized streaming bodies', async () => {
		const baseHeaders = {
			origin: 'https://ownmail.local',
			'content-type': 'application/x-www-form-urlencoded',
		}
		const invalidUtf8 = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: baseHeaders,
				body: new Uint8Array([0xff]),
			}),
		})
		const missing = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					...baseHeaders,
					'content-length': '7',
				},
				body: 'other=x',
			}),
		})
		const duplicate = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: baseHeaders,
				body: 'account=a&account=b',
			}),
		})
		const mismatchedLength = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: { ...baseHeaders, 'content-length': '1' },
				body: 'account=x',
			}),
		})
		const oversized = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: baseHeaders,
				body: `account=${'x'.repeat(1025)}`,
			}),
		})

		expect(invalidUtf8.status).toBe(400)
		expect(missing.status).toBe(400)
		expect(duplicate.status).toBe(400)
		expect(mismatchedLength.status).toBe(400)
		expect(oversized.status).toBe(400)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})

	it('fails closed when the request body stream errors while being read', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error('read failed'))
			},
		})
		const response = await POST({
			request: new Request('https://ownmail.local/auth', {
				method: 'POST',
				headers: {
					origin: 'https://ownmail.local',
					'content-type': 'application/x-www-form-urlencoded',
				},
				body,
				duplex: 'half',
			} as RequestInit),
		})

		expect(response.status).toBe(400)
		expect(switchSessionAccount).not.toHaveBeenCalled()
	})
})
