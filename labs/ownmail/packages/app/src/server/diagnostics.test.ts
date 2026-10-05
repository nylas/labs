import { afterEach, describe, expect, it, vi } from 'vitest'
import { diagnostic, OperationFailure, untilAborted } from './diagnostics.js'

afterEach(() => vi.restoreAllMocks())

describe('safe diagnostics', () => {
	it('only emits allow-listed metadata, never arbitrary values or exception messages', () => {
		const log = vi.spyOn(console, 'info').mockImplementation(() => {})
		diagnostic({
			event: 'image.failed',
			stage: 'fetch',
			code: 'upstream_status',
			status: 403,
			durationMs: 10.7,
			requestId: 'a'.repeat(36),
		})
		expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
			event: 'image.failed',
			status: 403,
			durationMs: 11,
		})
		diagnostic({
			event: 'secret',
			stage: 'secret',
			code: 'secret',
			requestId: 'https://secret/token',
			status: 900,
			durationMs: -1,
			url: 'secret',
			error: new Error('secret'),
		} as never)
		expect(log.mock.calls[1]?.[0]).not.toContain('secret')
		expect(JSON.parse(log.mock.calls[1]?.[0] as string)).toMatchObject({
			event: 'request.failed',
			stage: 'request',
		})
		diagnostic({ event: 'request.completed', stage: 'request', durationMs: 400_000 })
		expect(log.mock.calls[2]?.[0]).toContain('300000')
	})
	it('bounds uncooperative operations and observes their eventual rejection', async () => {
		const controller = new AbortController()
		let reject!: (reason: Error) => void
		const pending = untilAborted(
			new Promise((_, fail) => {
				reject = fail
			}),
			controller.signal,
			'dns',
		)
		controller.abort()
		await expect(pending).rejects.toMatchObject({
			code: 'timeout',
			stage: 'dns',
			message: 'Image unavailable',
		})
		reject(new Error('private details'))
		await expect(untilAborted(Promise.resolve(1), controller.signal, 'fetch')).rejects.toBeInstanceOf(
			OperationFailure,
		)
	})
	it('passes completed values and errors through without hanging', async () => {
		const signal = new AbortController().signal
		await expect(untilAborted(Promise.resolve(3), signal, 'fetch')).resolves.toBe(3)
		await expect(untilAborted(Promise.reject(new Error('test')), signal, 'fetch')).rejects.toThrow('test')
	})
})
