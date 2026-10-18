// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartialLoadNotice, useOnline } from './PartialLoadNotice.js'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

function setOnline(online: boolean) {
	vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
	act(() => {
		window.dispatchEvent(new Event(online ? 'online' : 'offline'))
	})
}

describe('PartialLoadNotice', () => {
	it('renders nothing when every message loaded', () => {
		const { container } = render(<PartialLoadNotice failedCount={0} shownCount={14} onRetry={() => {}} />)
		expect(container).toBeEmptyDOMElement()
	})

	it('says exactly what is missing and retries in place', async () => {
		const onRetry = vi.fn()
		render(<PartialLoadNotice failedCount={2} shownCount={12} onRetry={onRetry} />)
		expect(screen.getByRole('note')).toHaveTextContent(
			'Couldn’t load 2 messages. Showing 12 saved on this device.',
		)
		expect(screen.queryByText('Mail refreshes when you’re back online.')).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
		expect(onRetry).toHaveBeenCalledOnce()
	})

	it('names one message, and says mail refreshes once back online while offline', () => {
		render(<PartialLoadNotice failedCount={1} shownCount={3} onRetry={() => {}} />)
		expect(screen.getByRole('note')).toHaveTextContent(
			'Couldn’t load 1 message. Showing 3 saved on this device.',
		)
		setOnline(false)
		expect(screen.getByText('Mail refreshes when you’re back online.')).toBeInTheDocument()
		setOnline(true)
		expect(screen.queryByText('Mail refreshes when you’re back online.')).toBeNull()
	})
})

describe('useOnline', () => {
	it('assumes a connection while rendering on the server', () => {
		function Probe() {
			return <span>{useOnline() ? 'online' : 'offline'}</span>
		}
		expect(renderToString(<Probe />)).toContain('online')
	})
})
