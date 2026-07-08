import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const nylas = vi.fn()
vi.mock('../server/nylas.js', () => ({ nylas: () => nylas() }))

const usingDevMocks = vi.fn()
vi.mock('../server/platform.js', () => ({ usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
vi.mock('../server/session.js', () => ({ getSession: (r: any) => getSession(r) }))

import {
	attachmentDownloadFilename,
	Route,
	validNylasAttachmentDownloadId,
} from './attachments.$attachmentId.js'

const GET = Route.options.server.handlers.GET

function get(attachmentId: string, query = '') {
	return GET({
		request: new Request(`https://ownmail.local/attachments/${attachmentId}${query}`),
		params: { attachmentId },
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('attachment download route helpers', () => {
	it('accepts provider attachment ids with special characters documented by Nylas', () => {
		expect(validNylasAttachmentDownloadId('att#abc=123')).toBe(true)
		expect(validNylasAttachmentDownloadId('message:id+provider@example')).toBe(true)
	})

	it('rejects missing, control-character, and overly long ids', () => {
		expect(validNylasAttachmentDownloadId(null)).toBe(false)
		expect(validNylasAttachmentDownloadId('')).toBe(false)
		expect(validNylasAttachmentDownloadId('att\nid')).toBe(false)
		expect(validNylasAttachmentDownloadId('a'.repeat(1001))).toBe(false)
	})

	it('keeps mock download filenames header-safe', () => {
		expect(attachmentDownloadFilename('att#abc=123')).toBe('att#abc=123')
		expect(attachmentDownloadFilename('../bad"name')).toBe('.._bad_name')
		expect(attachmentDownloadFilename('\n')).toBe('attachment')
	})
})

describe('attachment download route handler', () => {
	it('serves a header-safe mock attachment under local dev mocks without a session', async () => {
		usingDevMocks.mockResolvedValue(true)

		const response = await get('report.pdf')

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="report.pdf.txt"')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(await response.text()).toContain('Local mock attachment: report.pdf')
		expect(getSession).not.toHaveBeenCalled()
	})

	it('refuses anonymous downloads so mail is never reachable without a session', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		const response = await get('att-1', '?message_id=msg-1')

		expect(response.status).toBe(401)
		expect(nylas).not.toHaveBeenCalled()
	})

	it('rejects a request whose message id is missing', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1' })

		const response = await get('att-1')

		expect(response.status).toBe(400)
	})

	it('rejects a request whose attachment id carries a control character', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1' })

		const response = await GET({
			request: new Request('https://ownmail.local/attachments/x?message_id=msg-1'),
			params: { attachmentId: 'bad\nid' },
		})

		expect(response.status).toBe(400)
	})

	it('streams the upstream attachment scoped to the session grant, preserving upstream headers', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		const downloadAttachment = vi.fn().mockResolvedValue(
			new Response('binary', {
				headers: {
					'Content-Type': 'image/png',
					'Content-Disposition': 'attachment; filename="pic.png"',
				},
			}),
		)
		const forGrant = vi.fn().mockReturnValue({ downloadAttachment })
		nylas.mockResolvedValue({ forGrant })

		const response = await get('att-1', '?message_id=msg-1')

		expect(forGrant).toHaveBeenCalledWith('grant-1')
		expect(downloadAttachment).toHaveBeenCalledWith('att-1', 'msg-1')
		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('image/png')
		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="pic.png"')
		expect(response.headers.get('Cache-Control')).toBe('no-store')
	})

	it('falls back to generic streaming headers when upstream omits them', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		// A bare upstream with no Content-Type/Content-Disposition. (Constructing a real
		// Response from a string would auto-add text/plain, masking the fallback.)
		const downloadAttachment = vi.fn().mockResolvedValue({ ok: true, body: 'binary', headers: new Headers() })
		nylas.mockResolvedValue({ forGrant: () => ({ downloadAttachment }) })

		const response = await get('att-1', '?message_id=msg-1')

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
		expect(response.headers.get('Content-Disposition')).toBe('attachment')
	})

	it('returns 404 when the upstream response is not ok', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		const downloadAttachment = vi.fn().mockResolvedValue(new Response('nope', { status: 502 }))
		nylas.mockResolvedValue({ forGrant: () => ({ downloadAttachment }) })

		const response = await get('att-1', '?message_id=msg-1')

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('Attachment unavailable')
	})

	it('returns 404 when the upstream response has no body', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		const downloadAttachment = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
		nylas.mockResolvedValue({ forGrant: () => ({ downloadAttachment }) })

		const response = await get('att-1', '?message_id=msg-1')

		expect(response.status).toBe(404)
	})
})
