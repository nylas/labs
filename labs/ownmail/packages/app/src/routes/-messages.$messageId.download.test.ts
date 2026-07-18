import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const nylas = vi.fn()
vi.mock('../server/nylas.js', () => ({ nylas: () => nylas() }))

const usingDevMocks = vi.fn()
vi.mock('../server/platform.js', () => ({ usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
vi.mock('../server/session.js', () => ({ getSession: (request: Request) => getSession(request) }))

import {
	decodeRawMime,
	Route,
	rawEmailFilename,
	validNylasMessageId,
} from './messages.$messageId.download.js'

const GET = Route.options.server.handlers.GET

function get(messageId: string) {
	return GET({
		request: new Request(`https://ownmail.local/messages/${encodeURIComponent(messageId)}/download`),
		params: { messageId },
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	usingDevMocks.mockResolvedValue(false)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('raw email download helpers', () => {
	it('accepts bounded opaque provider message ids and rejects unsafe values', () => {
		expect(validNylasMessageId('msg#abc=123+provider@example')).toBe(true)
		expect(validNylasMessageId(null)).toBe(false)
		expect(validNylasMessageId('')).toBe(false)
		expect(validNylasMessageId('msg\nid')).toBe(false)
		expect(validNylasMessageId('a'.repeat(1001))).toBe(false)
	})

	it('decodes padded and unpadded Base64url without changing the raw bytes', () => {
		expect(decodeRawMime('TUlNRS1WZXJzaW9uOiAxLjA')).toEqual(new TextEncoder().encode('MIME-Version: 1.0'))
		expect(decodeRawMime('-_8=')).toEqual(new Uint8Array([251, 255]))
	})

	it('fails closed for missing, oversized, malformed, or undecodable MIME payloads', () => {
		expect(decodeRawMime(undefined)).toBeNull()
		expect(decodeRawMime('')).toBeNull()
		expect(decodeRawMime('AAAA', 3)).toBeNull()
		expect(decodeRawMime('not/base64')).toBeNull()
		expect(decodeRawMime('A')).toBeNull()
		expect(decodeRawMime('TQ=')).toBeNull()
		vi.stubGlobal(
			'atob',
			vi.fn(() => {
				throw new Error('decode failed')
			}),
		)
		expect(decodeRawMime('TQ')).toBeNull()
	})

	it('creates a short header-safe eml filename from an opaque id', () => {
		expect(rawEmailFilename('msg#abc/123')).toBe('message-msg_abc_123.eml')
		expect(rawEmailFilename('../')).toBe('message-email.eml')
		expect(rawEmailFilename(`safe-${'a'.repeat(100)}`)).toHaveLength('message-.eml'.length + 64)
	})
})

describe('raw email download route', () => {
	it('serves a local raw email with secure attachment headers in dev mode', async () => {
		usingDevMocks.mockResolvedValue(true)

		const response = await get('mock#1')

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('message/rfc822')
		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="message-mock_1.eml"')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
		expect(await response.text()).toContain('MIME-Version: 1.0')
		expect(getSession).not.toHaveBeenCalled()
	})

	it('rejects invalid ids in dev mode', async () => {
		usingDevMocks.mockResolvedValue(true)

		const response = await get('bad\nid')

		expect(response.status).toBe(400)
	})

	it('refuses anonymous raw message downloads', async () => {
		getSession.mockResolvedValue(null)

		const response = await get('msg-1')

		expect(response.status).toBe(401)
		expect(nylas).not.toHaveBeenCalled()
	})

	it('rejects invalid message ids after authenticating', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })

		const response = await get('bad\nid')

		expect(response.status).toBe(400)
		expect(nylas).not.toHaveBeenCalled()
	})

	it('downloads decoded MIME from the session-scoped grant', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		const getRawMime = vi.fn().mockResolvedValue({
			data: { raw_mime: 'TUlNRS1WZXJzaW9uOiAxLjANCg0KSGVsbG8' },
		})
		const forGrant = vi.fn().mockReturnValue({ getRawMime })
		nylas.mockResolvedValue({ forGrant })

		const response = await get('msg#1')

		expect(forGrant).toHaveBeenCalledWith('grant-1')
		expect(getRawMime).toHaveBeenCalledWith('msg#1')
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('MIME-Version: 1.0\r\n\r\nHello')
		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="message-msg_1.eml"')
	})

	it('fails closed when Nylas omits or malforms the raw MIME payload', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		nylas.mockResolvedValue({ forGrant: () => ({ getRawMime: () => null }) })

		const response = await get('msg-1')

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('Raw email unavailable')
	})

	it('returns a generic error without exposing an upstream failure', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		nylas.mockRejectedValue(new Error('sensitive upstream details'))

		const response = await get('msg-1')

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('Raw email unavailable')
	})
})
