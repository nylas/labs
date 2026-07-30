// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ClientListDate, ClientMessageTime, useMounted } from './ClientTime.js'

afterEach(cleanup)

describe('ClientListDate', () => {
	it('renders nothing without an epoch (no date to show)', () => {
		const { container } = render(<ClientListDate />)
		expect(container.firstChild).toBeNull()
	})

	it('renders a relative label once mounted on the client', () => {
		render(<ClientListDate epochSeconds={1_700_000_000} className="date" />)
		const span = document.querySelector('span.date')
		expect(span).not.toBeNull()
		expect(span).toHaveClass('min-w-14', 'text-right')
		expect(span?.textContent).not.toBe('')
	})
})

describe('ClientMessageTime', () => {
	it('always emits a machine-readable dateTime even before the label resolves', () => {
		render(<ClientMessageTime epochSeconds={1_700_000_000} />)
		const time = document.querySelector('time')
		expect(time?.getAttribute('datetime')).toBe(new Date(1_700_000_000 * 1000).toISOString())
		expect(time).toHaveClass('min-w-40', 'whitespace-nowrap', 'text-right')
	})
})

describe('useMounted', () => {
	function MountProbe() {
		// Renders the flag so we can observe the false → true transition that lets
		// callers defer client-only rendering until after hydration.
		return <span data-testid="mounted">{String(useMounted())}</span>
	}

	it('keeps server HTML stable but treats later client navigation as already mounted', async () => {
		expect(renderToString(<MountProbe />)).toContain('false')
		render(<MountProbe />)
		await waitFor(() => expect(screen.getByTestId('mounted').textContent).toBe('true'))
	})
})
