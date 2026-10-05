import { expect, it } from 'vitest'
import { PERFORMANCE_METRICS, performanceReport } from './performance-report.js'

it('accepts only bounded, anonymous metrics and normalizes precision', () => {
	for (const metric of PERFORMANCE_METRICS)
		expect(performanceReport({ metric, value: 123.4, standalone: true })).toEqual({
			metric,
			value: 123,
			standalone: true,
		})
	for (const input of [
		null,
		'x',
		[],
		{},
		{ metric: 'url', value: 1, standalone: false },
		{ metric: 'lcp', value: '1', standalone: false },
		...[NaN, Infinity, -1, 300001].map((value) => ({ metric: 'lcp', value, standalone: false })),
		{ metric: 'lcp', value: 1, standalone: 'yes' },
		{ metric: 'lcp', value: 1, standalone: true, url: 'private' },
	])
		expect(performanceReport(input)).toBeNull()
})
