// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadRowTime } from './ThreadRowTime.js'

const NOW = Date.UTC(2026, 9, 15, 12, 0)
const TODAY_941 = Date.UTC(2026, 9, 15, 9, 41) / 1000

afterEach(cleanup)

describe('ThreadRowTime', () => {
	it('says the time in the browser, in the list zone', () => {
		const { container } = render(
			<ThreadRowTime epochSeconds={TODAY_941} now={NOW} tz="UTC" className="text-xs" />,
		)
		const time = container.querySelector('time') as HTMLElement
		expect(time.textContent).toMatch(/^9:41\sAM$/)
		expect(time).toHaveAttribute('datetime', '2026-10-15T09:41:00.000Z')
		expect(time).toHaveClass('font-data', 'tabular-nums', 'text-xs')
	})

	it('carries its own day where no heading does', () => {
		const yesterday = Date.UTC(2026, 9, 14, 17, 14) / 1000
		const { container } = render(
			<ThreadRowTime epochSeconds={yesterday} now={NOW} tz="UTC" grouped={false} />,
		)
		expect(container.querySelector('time')?.textContent).toBe('Wed')
	})

	it('leaves the cell blank on the server, so hydration agrees', () => {
		const html = renderToString(<ThreadRowTime epochSeconds={TODAY_941} now={NOW} tz="UTC" />)
		expect(html).toMatch(/>\u00a0<\/time>$/)
		expect(html).not.toContain('AM')
	})

	it('renders nothing without a time', () => {
		const { container } = render(<ThreadRowTime now={NOW} tz="UTC" />)
		expect(container).toBeEmptyDOMElement()
	})
})
