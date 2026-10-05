import type { PerformanceReport } from '#shared/lib/performance-report'

/** Small, sampled reports; never include paths, LCP text, error messages, or resource URLs. */
export function monitorPerformance(
	sampled = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0xffffffff) < 0x1_0000_0000 / 10,
): () => void {
	if (!sampled || typeof performance.getEntriesByType !== 'function') return () => {}
	const sent = new Set<PerformanceReport['metric']>()
	const standalone =
		window.matchMedia?.('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	function report(metric: PerformanceReport['metric'], value: number) {
		if (sent.has(metric) || !Number.isFinite(value) || value < 0 || value > 300_000) return
		sent.add(metric)
		void fetch('/api/diagnostics', {
			method: 'POST',
			credentials: 'same-origin',
			keepalive: true,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ metric, value: Math.round(value), standalone }),
		}).catch(() => {})
	}
	report('hydration', performance.now())
	const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
	if (navigation) report('ttfb', navigation.responseStart)
	let lcp = 0
	let observer: PerformanceObserver | undefined
	if (
		typeof PerformanceObserver !== 'undefined' &&
		PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')
	) {
		observer = new PerformanceObserver((entries) => {
			for (const entry of entries.getEntries()) lcp = entry.startTime
		})
		observer.observe({ type: 'largest-contentful-paint', buffered: true })
	}
	const inboxReady = () => {
		const entry = performance.getEntriesByName('ownmail:inbox-ready')[0]
		if (entry) report('inbox_ready', entry.startTime)
	}
	const hidden = () => {
		if (document.visibilityState === 'hidden' && lcp > 0) report('lcp', lcp)
	}
	const pagehide = () => {
		if (lcp > 0) report('lcp', lcp)
	}
	let navigationStarted: number | undefined
	let restoreFrame: number | undefined
	const navigationStart = () => {
		navigationStarted = performance.now()
		sent.delete('navigation_ready')
	}
	const listReady = () => {
		if (navigationStarted === undefined) return
		report('navigation_ready', performance.now() - navigationStarted)
		navigationStarted = undefined
	}
	const pageshow = (event: PageTransitionEvent) => {
		if (!event.persisted) return
		navigationStart()
		restoreFrame = requestAnimationFrame(() => {
			if (document.querySelector('[data-mail-list]')?.getClientRects().length) listReady()
		})
	}
	window.addEventListener('popstate', navigationStart)
	window.addEventListener('ownmail:back', navigationStart)
	window.addEventListener('ownmail:list-ready', listReady)
	window.addEventListener('pageshow', pageshow)
	const failed = () => report('client_error', 1)
	const syncFailed = () => report('sync_failed', 1)
	inboxReady()
	window.addEventListener('ownmail:inbox-ready', inboxReady)
	window.addEventListener('error', failed)
	window.addEventListener('unhandledrejection', failed)
	window.addEventListener('ownmail:sync-failed', syncFailed)
	window.addEventListener('pagehide', pagehide)
	document.addEventListener('visibilitychange', hidden)
	return () => {
		if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
		window.removeEventListener('popstate', navigationStart)
		window.removeEventListener('ownmail:back', navigationStart)
		window.removeEventListener('ownmail:list-ready', listReady)
		window.removeEventListener('pageshow', pageshow)
		observer?.disconnect()
		window.removeEventListener('ownmail:inbox-ready', inboxReady)
		window.removeEventListener('error', failed)
		window.removeEventListener('unhandledrejection', failed)
		window.removeEventListener('ownmail:sync-failed', syncFailed)
		window.removeEventListener('pagehide', pagehide)
		document.removeEventListener('visibilitychange', hidden)
	}
}
