import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OWNMAIL_VERSION } from '#shared/lib/version'

/**
 * nylas.ts is the only module that mints a Nylas client. Its security-critical
 * job is to derive the grant id from the server session (never client input),
 * so we mock the session + platform layers and assert the resolution paths.
 */

const platformMock = vi.fn()
const usingDevMocksMock = vi.fn()
vi.mock('./platform.js', () => ({
	platform: () => platformMock(),
	usingDevMocks: () => usingDevMocksMock(),
}))

const getSessionMock = vi.fn()
const slideSessionExpiryMock = vi.fn()
vi.mock('./session.js', () => ({
	getSession: (r: Request) => getSessionMock(r),
	slideSessionExpiry: (r: Request, s: unknown) => slideSessionExpiryMock(r, s),
}))

const devMailbox = { kind: 'dev-mailbox' }
const devMailboxNameMock = vi.fn()
vi.mock('./dev-mocks.js', () => ({
	createDevMailbox: () => devMailbox,
	devMailboxEmail: (email?: string) => `resolved:${email}`,
	devMailboxName: (email?: string) => devMailboxNameMock(email),
}))

const clientCtor = vi.fn()
const forGrant = vi.fn()
vi.mock('@nylas-labs/cli-kit/v3', () => ({
	NylasV3Client: class {
		forGrant = forGrant
		constructor(...args: unknown[]) {
			clientCtor(...args)
		}
	},
}))

const ENV = {
	NYLAS_API_KEY: 'api-key',
	NYLAS_REGION: 'us',
	NYLAS_API_BASE_URL: 'https://base',
	INBOX_EMAIL: 'ada@ownmail.com',
}

function req(): Request {
	return new Request('http://ownmail.local/')
}

beforeEach(() => {
	vi.resetModules()
	platformMock.mockReset().mockResolvedValue({ env: ENV, kv: null, runtime: 'node' })
	usingDevMocksMock.mockReset()
	getSessionMock.mockReset()
	slideSessionExpiryMock.mockReset().mockResolvedValue(null)
	devMailboxNameMock.mockReset()
	clientCtor.mockReset()
	forGrant.mockReset()
})

describe('nylas()', () => {
	it('constructs the app-wide client once and memoizes it across calls', async () => {
		const { nylas } = await import('./nylas.js')
		const first = await nylas()
		const second = await nylas()

		expect(first).toBe(second)
		expect(clientCtor).toHaveBeenCalledTimes(1)
		expect(clientCtor).toHaveBeenCalledWith(
			'api-key',
			'us',
			expect.any(Function),
			'https://base',
			`ownmail/${OWNMAIL_VERSION}`,
		)
	})
})

describe('mailboxFromRequest()', () => {
	it('serves the dev mailbox with a display name when running against mocks', async () => {
		usingDevMocksMock.mockResolvedValue(true)
		devMailboxNameMock.mockReturnValue('Ada Lovelace')
		const { mailboxFromRequest } = await import('./nylas.js')

		const result = await mailboxFromRequest(req())
		expect(result).toEqual({
			mailbox: devMailbox,
			grantId: 'dev-grant',
			email: 'resolved:ada@ownmail.com',
			displayName: 'Ada Lovelace',
		})
		// Dev mode never consults the session cookie.
		expect(getSessionMock).not.toHaveBeenCalled()
	})

	it('omits displayName in dev mode when the mailbox name is unknown', async () => {
		usingDevMocksMock.mockResolvedValue(true)
		devMailboxNameMock.mockReturnValue(undefined)
		const { mailboxFromRequest } = await import('./nylas.js')

		const result = await mailboxFromRequest(req())
		expect(result).not.toHaveProperty('displayName')
		expect(result?.email).toBe('resolved:ada@ownmail.com')
	})

	it('returns null when there is no server session (unauthenticated)', async () => {
		usingDevMocksMock.mockResolvedValue(false)
		getSessionMock.mockResolvedValue(null)
		const { mailboxFromRequest } = await import('./nylas.js')

		expect(await mailboxFromRequest(req())).toBeNull()
	})

	it('scopes the client to the grant id taken from the session, not client input', async () => {
		usingDevMocksMock.mockResolvedValue(false)
		getSessionMock.mockResolvedValue({ grantId: 'grant-xyz', email: 'user@ownmail.com', createdAt: 0 })
		const scoped = { scoped: true }
		forGrant.mockReturnValue(scoped)
		const { mailboxFromRequest } = await import('./nylas.js')

		const result = await mailboxFromRequest(req())
		expect(forGrant).toHaveBeenCalledWith('grant-xyz')
		expect(result).toEqual({ mailbox: scoped, grantId: 'grant-xyz', email: 'user@ownmail.com' })
		// No refresh cookie when the sliding-window throttle says a write isn't due.
		expect(result).not.toHaveProperty('refreshCookie')
	})

	it('hands back the refreshed cookie when activity slid the session deadline', async () => {
		usingDevMocksMock.mockResolvedValue(false)
		const session = { grantId: 'grant-xyz', email: 'user@ownmail.com', createdAt: 0 }
		getSessionMock.mockResolvedValue(session)
		slideSessionExpiryMock.mockResolvedValue('ownmail_session=next; Max-Age=1209600')
		forGrant.mockReturnValue({ scoped: true })
		const { mailboxFromRequest } = await import('./nylas.js')

		const request = req()
		const result = await mailboxFromRequest(request)
		// The already-resolved session is reused, so sliding costs no extra read.
		expect(slideSessionExpiryMock).toHaveBeenCalledWith(request, session)
		expect(result?.refreshCookie).toBe('ownmail_session=next; Max-Age=1209600')
	})

	/**
	 * The session was already validated before the slide runs, so a store that can read
	 * but not write must not take mail, calendar, and contacts down with it. Extending
	 * the deadline is a convenience; serving an authenticated request is not.
	 */
	it('still serves the request when the session refresh write fails', async () => {
		usingDevMocksMock.mockResolvedValue(false)
		getSessionMock.mockResolvedValue({ grantId: 'grant-xyz', email: 'user@ownmail.com', createdAt: 0 })
		slideSessionExpiryMock.mockRejectedValue(new Error('KV write quota exceeded'))
		const scoped = { scoped: true }
		forGrant.mockReturnValue(scoped)
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { mailboxFromRequest } = await import('./nylas.js')

		const result = await mailboxFromRequest(req())

		expect(result).toEqual({ mailbox: scoped, grantId: 'grant-xyz', email: 'user@ownmail.com' })
		// No cookie to send, but the request goes through on the existing deadline.
		expect(result).not.toHaveProperty('refreshCookie')
		// Operators still hear about it — without the message, which can echo key material.
		expect(consoleError).toHaveBeenCalledWith('OwnMail session refresh failed', { error: 'Error' })
		consoleError.mockRestore()
	})

	it('reports a non-Error refresh failure by type rather than swallowing it', async () => {
		usingDevMocksMock.mockResolvedValue(false)
		getSessionMock.mockResolvedValue({ grantId: 'grant-xyz', email: 'user@ownmail.com', createdAt: 0 })
		slideSessionExpiryMock.mockRejectedValue('upstash: 429')
		const scoped = { scoped: true }
		forGrant.mockReturnValue(scoped)
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { mailboxFromRequest } = await import('./nylas.js')

		expect((await mailboxFromRequest(req()))?.grantId).toBe('grant-xyz')
		expect(consoleError).toHaveBeenCalledWith('OwnMail session refresh failed', { error: 'string' })
		consoleError.mockRestore()
	})
})
