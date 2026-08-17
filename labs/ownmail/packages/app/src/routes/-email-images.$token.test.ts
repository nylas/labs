import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: unknown) => ({ options }),
}))

const mocks = vi.hoisted(() => ({
	fetchRemoteImage: vi.fn(),
	getSession: vi.fn(),
	nylas: vi.fn(),
	processEmailImage: vi.fn(),
	verifyEmailImageSource: vi.fn(),
}))

vi.mock('#features/mail/server/email-image-proxy', () => ({
	fetchRemoteImage: mocks.fetchRemoteImage,
	processEmailImage: mocks.processEmailImage,
}))
vi.mock('#features/mail/server/email-image-sources', () => ({
	verifyEmailImageSource: mocks.verifyEmailImageSource,
}))
vi.mock('#server/nylas', () => ({ nylas: mocks.nylas }))
vi.mock('#server/session', () => ({ getSession: mocks.getSession }))

import { emailImageRouteHelpers, Route } from './email-images.$token.js'

const GET = Route.options.server.handlers.GET

function request(query = '?mode=automatic&theme=dark') {
	return GET({
		request: new Request(`https://mail.example/email-images/token${query}`),
		params: { token: 'token' },
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.getSession.mockResolvedValue({ grantId: 'grant-1' })
})

describe('email image route', () => {
	it('requires an authenticated session before inspecting source tokens', async () => {
		mocks.getSession.mockResolvedValue(null)
		const response = await request()
		expect(response.status).toBe(401)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(mocks.verifyEmailImageSource).not.toHaveBeenCalled()
	})

	it('strictly validates treatment query parameters', async () => {
		for (const query of ['?mode=unsafe&theme=dark', '?mode=automatic&theme=sepia']) {
			const response = await request(query)
			expect(response.status).toBe(400)
		}
		expect(emailImageRouteHelpers.requestedMode(new URL('https://x.test'))).toBe('automatic')
		expect(emailImageRouteHelpers.requestedTheme(new URL('https://x.test'))).toBe('light')
	})

	it('returns a generic unavailable response for invalid tokens', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue(null)
		const response = await request()
		expect(response.status).toBe(404)
		expect(await response.text()).toBe('Image unavailable')
	})

	it('blocks high-confidence tracking sources without contacting the origin', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue({
			kind: 'remote',
			url: 'https://metrics.example/open.gif',
			trackingHint: true,
		})
		const response = await request()
		expect(response.status).toBe(204)
		expect(response.headers.get('X-OwnMail-Image-Class')).toBe('tracking')
		expect(mocks.fetchRemoteImage).not.toHaveBeenCalled()
	})

	it('serves a processed remote image with hardened response headers', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue({
			kind: 'remote',
			url: 'https://images.example/logo.png',
			trackingHint: false,
		})
		mocks.fetchRemoteImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
		mocks.processEmailImage.mockResolvedValue({
			bytes: new Uint8Array([4, 5]),
			classification: 'transparent-dark-logo',
			contentType: 'image/png',
		})

		const response = await request()
		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('image/png')
		expect(response.headers.get('X-OwnMail-Image-Class')).toBe('transparent-dark-logo')
		expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
		expect(mocks.fetchRemoteImage).toHaveBeenCalledWith('https://images.example/logo.png', {
			blockedOrigin: 'https://mail.example',
		})
		expect(mocks.processEmailImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'automatic', 'dark')
	})

	it('downloads attachments only through the active session grant', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue({
			kind: 'attachment',
			attachmentId: 'attachment-1',
			messageId: 'message-1',
		})
		const downloadAttachment = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
		const forGrant = vi.fn(() => ({ downloadAttachment }))
		mocks.nylas.mockResolvedValue({ forGrant })
		mocks.processEmailImage.mockResolvedValue({
			bytes: new Uint8Array([7]),
			classification: 'photo',
			contentType: 'image/jpeg',
		})

		const response = await request('?mode=original&theme=light')
		expect(response.status).toBe(200)
		expect(forGrant).toHaveBeenCalledWith('grant-1')
		expect(downloadAttachment).toHaveBeenCalledWith('attachment-1', 'message-1')
		expect(mocks.processEmailImage).toHaveBeenCalledWith(expect.any(Uint8Array), 'original', 'light')
	})

	it('rejects failed and oversized attachment downloads', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue({
			kind: 'attachment',
			attachmentId: 'attachment-1',
			messageId: 'message-1',
		})
		const downloadAttachment = vi
			.fn()
			.mockResolvedValueOnce(new Response('missing', { status: 404 }))
			.mockResolvedValueOnce(
				new Response('large', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }),
			)
			.mockResolvedValueOnce(
				new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
					headers: { 'Content-Length': '0' },
				}),
			)
		mocks.nylas.mockResolvedValue({ forGrant: () => ({ downloadAttachment }) })

		for (let index = 0; index < 3; index += 1) {
			const response = await request()
			expect(response.status).toBe(404)
			expect(await response.text()).toBe('Image unavailable')
		}
		expect(mocks.processEmailImage).not.toHaveBeenCalled()
	})

	it('returns no content when processor classification discovers a tracking pixel', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue({
			kind: 'remote',
			url: 'https://images.example/tiny.png',
			trackingHint: false,
		})
		mocks.fetchRemoteImage.mockResolvedValue(new Uint8Array([1]))
		mocks.processEmailImage.mockResolvedValue({
			bytes: new Uint8Array(),
			classification: 'tracking',
			contentType: 'image/png',
		})
		expect((await request()).status).toBe(204)
	})

	it('contains all upstream and processing failures behind one generic response', async () => {
		mocks.verifyEmailImageSource.mockResolvedValue({
			kind: 'remote',
			url: 'https://images.example/fail.png',
			trackingHint: false,
		})
		mocks.fetchRemoteImage.mockRejectedValue(new Error('private upstream details'))
		const response = await request()
		expect(response.status).toBe(404)
		expect(await response.text()).toBe('Image unavailable')
	})
})
