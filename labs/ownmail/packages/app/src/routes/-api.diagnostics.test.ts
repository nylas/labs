import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: any) => ({ options }) }))
const getSession = vi.hoisted(() => vi.fn())
vi.mock('#server/session', () => ({ getSession }))

import { Route } from './api.diagnostics.js'

const POST = (Route.options.server as any).handlers.POST
function req(
	body: string | ReadableStream | null = JSON.stringify({ metric: 'lcp', value: 222.2, standalone: true }),
	headers: Record<string, string> = {},
) {
	return new Request('https://mail.test/api/diagnostics', {
		method: 'POST',
		headers: { Origin: 'https://mail.test', 'Content-Type': 'application/json', ...headers },
		body,
		duplex: 'half',
	} as RequestInit)
}
let now = Date.now()
beforeEach(() => {
	vi.clearAllMocks()
	now += 120000
	vi.spyOn(console, 'info').mockImplementation(() => {})
	getSession.mockResolvedValue({})
	vi.spyOn(Date, 'now').mockReturnValue(now)
})
afterEach(() => vi.restoreAllMocks())
it('accepts authenticated anonymous metrics through the route', async () => {
	const response = await POST({ request: req() })
	expect(response.status).toBe(204)
	expect(response.headers.get('Cache-Control')).toBe('no-store')
	expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"value":222'))
})
it('rejects cross-origin, untyped, unauthenticated and absent bodies', async () => {
	await POST({ request: req(null, { Origin: 'https://other.test' }) })
	await POST({ request: req(null, { 'Content-Type': 'text/plain' }) })
	expect(getSession).not.toHaveBeenCalled()
	getSession.mockResolvedValueOnce(null)
	await POST({ request: req() })
	await POST({ request: req(null) })
	expect(console.info).not.toHaveBeenCalled()
})
it('discards oversized, malformed and sensitive reports and broken streams', async () => {
	for (const body of [
		'x'.repeat(513),
		'no json',
		JSON.stringify({ metric: 'lcp', value: 1, standalone: true, url: 'secret' }),
		new ReadableStream({
			start(controller) {
				controller.error(new Error('private'))
			},
		}),
	])
		await POST({ request: req(body) })
	expect(console.info).not.toHaveBeenCalled()
})
it('stops a stalled body at its deadline', async () => {
	vi.useFakeTimers()
	const cancel = vi.fn()
	const pending = POST({ request: req(new ReadableStream({ cancel })) })
	// AbortSignal.timeout uses a native timer; supply a controllable signal.
	vi.useRealTimers()
	await pending
	expect(cancel).toHaveBeenCalled()
	expect(console.info).not.toHaveBeenCalled()
})
it('bounds reports per isolate per minute', async () => {
	for (let i = 0; i < 61; i++) await POST({ request: req() })
	expect(console.info).toHaveBeenCalledTimes(60)
})
