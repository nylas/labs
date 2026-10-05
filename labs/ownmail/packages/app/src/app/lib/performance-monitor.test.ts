// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { monitorPerformance } from './performance-monitor.js'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
function setup(entries: PerformanceEntry[] = []) {
	const fetch = vi.fn().mockResolvedValue({})
	vi.stubGlobal('fetch', fetch)
	vi.stubGlobal('performance', { now: () => 50, getEntriesByType: () => entries, getEntriesByName: () => [] })
	return fetch
}
it('skips unsampled and unsupported browsers', () => {
	expect(monitorPerformance(false)).toBeTypeOf('function')
	monitorPerformance(false)()
	vi.stubGlobal('performance', {})
	monitorPerformance(true)()
	vi.spyOn(crypto, 'getRandomValues').mockReturnValue(new Uint32Array([0xffffffff]) as any)
	monitorPerformance()()
	vi.mocked(crypto.getRandomValues).mockReturnValue(new Uint32Array([]) as any)
	monitorPerformance()()
})
it('reports only numeric metrics once and disposes every listener', async () => {
	const fetch = setup([{ responseStart: 22 } as any])
	let callback: PerformanceObserverCallback | undefined
	const disconnect = vi.fn()
	const observe = vi.fn()
	vi.stubGlobal(
		'PerformanceObserver',
		class {
			static supportedEntryTypes = ['largest-contentful-paint']
			constructor(fn: PerformanceObserverCallback) {
				callback = fn
			}
			observe = observe
			disconnect = disconnect
		},
	)
	vi.stubGlobal('matchMedia', () => ({ matches: true }))
	const stop = monitorPerformance(true)
	expect(observe).toHaveBeenCalledWith({ type: 'largest-contentful-paint', buffered: true })
	window.dispatchEvent(new Event('pagehide'))
	document.dispatchEvent(new Event('visibilitychange'))
	callback?.({ getEntries: () => [{ startTime: 120 }, { startTime: 150 }] } as any, {} as any)
	document.dispatchEvent(new Event('visibilitychange'))
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
	document.dispatchEvent(new Event('visibilitychange'))
	window.dispatchEvent(new Event('pagehide'))
	vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ startTime: 90 } as any])
	window.dispatchEvent(new Event('ownmail:inbox-ready'))
	window.dispatchEvent(new Event('error'))
	window.dispatchEvent(new Event('unhandledrejection'))
	window.dispatchEvent(new Event('ownmail:sync-failed'))
	const reports = fetch.mock.calls.map(([, options]) => JSON.parse(options.body))
	expect(reports).toEqual([
		{ metric: 'hydration', value: 50, standalone: true },
		{ metric: 'ttfb', value: 22, standalone: true },
		{ metric: 'lcp', value: 150, standalone: true },
		{ metric: 'inbox_ready', value: 90, standalone: true },
		{ metric: 'client_error', value: 1, standalone: true },
		{ metric: 'sync_failed', value: 1, standalone: true },
	])
	stop()
	expect(disconnect).toHaveBeenCalled()
	window.dispatchEvent(new Event('ownmail:sync-failed'))
	expect(fetch).toHaveBeenCalledTimes(6)
})
it('tolerates report delivery failures and browser API differences', async () => {
	const fetch = setup()
	fetch.mockRejectedValue(new Error('offline'))
	vi.stubGlobal('matchMedia', undefined)
	vi.stubGlobal('PerformanceObserver', undefined)
	const stop = monitorPerformance(true)
	expect(JSON.parse(fetch.mock.calls[0]?.[1].body).standalone).toBe(false)
	stop()
	await Promise.resolve()
})
it('ignores invalid measurements and unsupported entry types', () => {
	const fetch = setup([{ responseStart: NaN } as any])
	vi.stubGlobal('PerformanceObserver', { supportedEntryTypes: [] })
	vi.spyOn(performance, 'now').mockReturnValue(-1)
	vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ startTime: 300001 } as any])
	monitorPerformance(true)()
	expect(fetch).not.toHaveBeenCalled()
})
