// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))

const { ThreadLoadError } = await import('./ThreadLoadError.js')

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	invalidate.mockReset()
})

describe('ThreadLoadError', () => {
	it('keeps the reader and retries the thread in place', async () => {
		const reset = vi.fn()
		render(<ThreadLoadError error={new Error('boom')} reset={reset} />)
		expect(screen.getByRole('note')).toHaveTextContent('Couldn’t load this conversation.')
		await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
		expect(reset).toHaveBeenCalledOnce()
		expect(invalidate).toHaveBeenCalledOnce()
	})

	it('says it was offline and that mail refreshes once back online', () => {
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
		render(<ThreadLoadError error={new Error('offline')} reset={() => {}} />)
		expect(screen.getByRole('note')).toHaveTextContent('Couldn’t load this conversation while offline.')
		expect(screen.getByText('Mail refreshes when you’re back online.')).toBeInTheDocument()
	})

	it('loads the conversation again in place when the connection comes back', () => {
		const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
		const reset = vi.fn()
		const { unmount } = render(<ThreadLoadError error={new Error('offline')} reset={reset} />)
		expect(reset).not.toHaveBeenCalled()
		onLine.mockReturnValue(true)
		act(() => {
			window.dispatchEvent(new Event('online'))
		})
		expect(reset).toHaveBeenCalledOnce()
		expect(invalidate).toHaveBeenCalledOnce()
		// Once it is gone, a later reconnect is not its to answer.
		unmount()
		window.dispatchEvent(new Event('online'))
		expect(reset).toHaveBeenCalledOnce()
	})
})
