import type { AnyRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { preloadReaderCode } from './reader-preload.js'

describe('preloadReaderCode', () => {
	it('fetches the reader’s conversation and error card code', async () => {
		const route = { id: '/mail/f/$folderId/t/$threadId' }
		const loadRouteChunk = vi.fn(() => Promise.resolve())
		preloadReaderCode({ routesById: { [route.id]: route }, loadRouteChunk } as unknown as AnyRouter)
		expect(loadRouteChunk.mock.calls).toEqual([[route], [route, 'errorComponent']])
	})

	it('treats a failed fetch, or a router without the reader, as not preloading', async () => {
		const route = { id: '/mail/f/$folderId/t/$threadId' }
		const loadRouteChunk = vi.fn(() => Promise.reject(new Error('offline')))
		preloadReaderCode({ routesById: { [route.id]: route }, loadRouteChunk } as unknown as AnyRouter)
		await Promise.resolve()
		const none = vi.fn()
		preloadReaderCode({ routesById: {}, loadRouteChunk: none } as unknown as AnyRouter)
		expect(none).not.toHaveBeenCalled()
	})
})
