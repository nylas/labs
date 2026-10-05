import { afterEach, expect, it, vi } from 'vitest'
import {
	currentRequestId,
	forgetRequestSession,
	requestSession,
	timeOperation,
	withRequestDiagnostics,
} from './request-context.js'

afterEach(() => vi.restoreAllMocks())
it('isolates concurrent requests and deduplicates only request-local session validation', async () => {
	vi.spyOn(console, 'info').mockImplementation(() => {})
	const request = new Request('https://mail.test')
	const load = vi.fn(async () => ({ valid: true }))
	expect(currentRequestId()).toBeUndefined()
	await requestSession(request, load)
	await requestSession(request, load)
	forgetRequestSession(request)
	expect(load).toHaveBeenCalledTimes(2)
	const ids = new Set<string | undefined>()
	await Promise.all(
		[1, 2].map(() =>
			withRequestDiagnostics(async () => {
				ids.add(currentRequestId())
				const first = requestSession(request, load)
				expect(requestSession(request, load)).toBe(first)
				await first
				forgetRequestSession(request)
				await requestSession(request, load)
				return { response: new Response('ok') }
			}),
		),
	)
	expect(ids.size).toBe(2)
	expect(load).toHaveBeenCalledTimes(6)
	expect(currentRequestId()).toBeUndefined()
})
it('preserves streams, headers and route context while adding bounded timings', async () => {
	const log = vi.spyOn(console, 'info').mockImplementation(() => {})
	const result = await withRequestDiagnostics(async () => {
		await timeOperation('session', async () => true)
		await timeOperation('session', async () => true)
		return {
			extra: 42,
			response: new Response('stream', {
				headers: { 'Server-Timing': 'existing;dur=1', 'X-Request-ID': 'route-id' },
			}),
		}
	})
	expect(result.extra).toBe(42)
	expect(await result.response.text()).toBe('stream')
	expect(result.response.headers.get('X-Request-ID')).toBe('route-id')
	expect(result.response.headers.get('Server-Timing')).toMatch(
		/existing;dur=1, session;dur=\d+, request;dur=\d+/,
	)
	expect(JSON.parse(log.mock.calls[0]?.[0])).toMatchObject({ event: 'request.completed', status: 200 })
})
it('logs safe failures and times rejected operations without swallowing errors', async () => {
	const log = vi.spyOn(console, 'info').mockImplementation(() => {})
	const error = new Error('private-secret')
	await expect(
		withRequestDiagnostics(async () =>
			timeOperation('folders', async () => {
				throw error
			}),
		),
	).rejects.toBe(error)
	expect(log.mock.calls.flat().join()).toContain('request.failed')
	expect(log.mock.calls.flat().join()).not.toContain('private-secret')
	await expect(timeOperation('session', async () => 'outside')).resolves.toBe('outside')
})
