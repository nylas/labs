export const PERFORMANCE_METRICS = [
	'lcp',
	'ttfb',
	'hydration',
	'inbox_ready',
	'navigation_ready',
	'client_error',
	'sync_failed',
] as const
export type PerformanceReport = {
	metric: (typeof PERFORMANCE_METRICS)[number]
	value: number
	standalone: boolean
}

export function performanceReport(input: unknown): PerformanceReport | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const data = input as Record<string, unknown>
	if (
		Object.keys(data).length !== 3 ||
		!PERFORMANCE_METRICS.includes(data.metric as PerformanceReport['metric']) ||
		typeof data.value !== 'number' ||
		!Number.isFinite(data.value) ||
		data.value < 0 ||
		data.value > 300_000 ||
		typeof data.standalone !== 'boolean'
	)
		return null
	return {
		metric: data.metric as PerformanceReport['metric'],
		value: Math.round(data.value),
		standalone: data.standalone,
	}
}
