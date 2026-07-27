import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const connectMocks = vi.hoisted(() => ({ createClient: vi.fn(), getAuthUrl: vi.fn() }))
vi.mock('@nylas/connect', () => ({
	NylasConnect: class {
		constructor(config: unknown) {
			connectMocks.createClient(config)
		}

		getAuthUrl(options: unknown) {
			return connectMocks.getAuthUrl(options)
		}
	},
}))

const platform = vi.fn()
const usingDevMocks = vi.fn()
vi.mock('#server/platform', () => ({
	platform: () => platform(),
	usingDevMocks: () => usingDevMocks(),
}))

const storeConnectState = vi.fn()
const createReferenceDevSessionCookie = vi.fn()
const switchSessionAccount = vi.fn()
const getSession = vi.fn()
vi.mock('#server/session', () => ({
	storeConnectState: (request: Request, state: string) => storeConnectState(request, state),
	createReferenceDevSessionCookie: () => createReferenceDevSessionCookie(),
	switchSessionAccount: (request: Request, handle: string) => switchSessionAccount(request, handle),
	getSession: (request: Request) => getSession(request),
}))

import { escapeHtml, Route } from './auth.js'

const GET = Route.options.server.handlers.GET
const POST = Route.options.server.handlers.POST

function req() {
	return new Request('https://ownmail.local/auth')
}

beforeEach(() => {
	vi.clearAllMocks()
	getSession.mockResolvedValue(null)
	connectMocks.getAuthUrl.mockResolvedValue({
		url: 'https://api.nylas.com/v3/connect/auth?x=1',
		state: 'state-1',
		scopes: [],
	})
})

describe('/auth', () => {
	it('escapes every HTML metacharacter used in configuration responses', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
	})

	it('short-circuits to the mailbox with a dev-session cookie under local mocks', async () => {
		usingDevMocks.mockResolvedValue(true)
		platform.mockResolvedValue({ env: {} })
		createReferenceDevSessionCookie.mockReturnValue('ownmail_session=authenticated')

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('/')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_session=authenticated')
		expect(connectMocks.createClient).not.toHaveBeenCalled()
	})

	it('fails closed with a 500 config page when the Nylas client id is missing', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({ env: { NYLAS_CLIENT_ID: '   ' } })

		const response = await GET({ request: req() })

		expect(response.status).toBe(500)
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
		expect(await response.text()).toContain('App configuration error')
		expect(connectMocks.createClient).not.toHaveBeenCalled()
	})

	it('starts backend Nylas Connect pinned to the Nylas connector with a login hint and browser-bound state', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({
			env: {
				NYLAS_CLIENT_ID: 'client-123',
				NYLAS_REGION: 'us',
				NYLAS_API_BASE_URL: 'https://api.nylas.com',
				INBOX_EMAIL: 'ada@ownmail.com',
			},
		})
		storeConnectState.mockResolvedValue('ownmail_connect_state=signed')

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('https://api.nylas.com/v3/connect/auth?x=1')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_connect_state=signed')
		expect(connectMocks.createClient).toHaveBeenCalledWith({
			clientId: 'client-123',
			redirectUri: 'https://ownmail.local/auth/callback',
			apiUrl: 'https://api.nylas.com',
			persistTokens: false,
			autoHandleCallback: false,
			logLevel: 'off',
		})
		expect(connectMocks.getAuthUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'nylas',
				state: expect.any(String),
				loginHint: 'ada@ownmail.com',
			}),
		)
		expect(storeConnectState).toHaveBeenCalledWith(expect.any(Request), expect.any(String))
	})

	it('always binds auth state to a browser cookie and omits the login hint when no inbox is configured', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({
			env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'eu', INBOX_EMAIL: '' },
		})
		storeConnectState.mockResolvedValue('ownmail_connect_state=signed-kv-attempt')

		const response = await GET({ request: req() })

		expect(response.status).toBe(302)
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_connect_state=signed-kv-attempt')
		expect(connectMocks.createClient).toHaveBeenCalledWith(
			expect.objectContaining({ apiUrl: 'https://api.eu.nylas.com' }),
		)
		expect(connectMocks.getAuthUrl).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'nylas', state: expect.any(String) }),
		)
		expect(connectMocks.getAuthUrl).toHaveBeenCalledWith(
			expect.not.objectContaining({ loginHint: expect.anything() }),
		)
	})

	it('does not pin Nylas Connect to the primary inbox while adding another verified account', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1', email: 'ada@ownmail.com' })
		platform.mockResolvedValue({
			env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'us', INBOX_EMAIL: 'ada@ownmail.com' },
		})
		storeConnectState.mockResolvedValue('ownmail_connect_state=signed-add-attempt')

		await GET({ request: req() })

		expect(connectMocks.getAuthUrl).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'nylas', state: expect.any(String) }),
		)
		expect(connectMocks.getAuthUrl).toHaveBeenCalledWith(
			expect.not.objectContaining({ loginHint: expect.anything() }),
		)
	})

	it('fails closed without setting state when Nylas Connect rejects its configuration', async () => {
		usingDevMocks.mockResolvedValue(false)
		platform.mockResolvedValue({
			env: { NYLAS_CLIENT_ID: 'client-123', NYLAS_REGION: 'us', INBOX_EMAIL: '' },
		})
		connectMocks.getAuthUrl.mockRejectedValueOnce(new Error('unsafe internal detail'))

		const response = await GET({ request: req() })

		expect(response.status).toBe(500)
		const body = await response.text()
		expect(body).toContain('Nylas Connect is not configured correctly')
		expect(body).not.toContain('unsafe internal detail')
		expect(storeConnectState).not.toHaveBeenCalled()
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
