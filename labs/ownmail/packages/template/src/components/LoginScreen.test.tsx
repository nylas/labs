// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginScreen } from './LoginScreen.js'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

// jsdom's window.location.assign isn't configurable/spy-able; stub the global
// location with just the surface the component touches.
function stubAssign() {
	const assign = vi.fn()
	vi.stubGlobal('location', { assign })
	return assign
}

describe('LoginScreen', () => {
	it('offers the sign-in call to action and lists the product highlights', () => {
		render(<LoginScreen signInHref="/auth/start" />)
		expect(screen.getByRole('button', { name: /sign in to continue/i })).toBeEnabled()
		expect(screen.getByText('Unified mail with fast search')).toBeInTheDocument()
		expect(screen.getByText('Calendar and events, side by side')).toBeInTheDocument()
		expect(screen.getByText('Secure sign-in through your provider')).toBeInTheDocument()
	})

	it('shows a connecting state and redirects to the provider after the delay', () => {
		vi.useFakeTimers()
		const assign = stubAssign()
		render(<LoginScreen signInHref="/auth/start" />)

		fireEvent.click(screen.getByRole('button', { name: /sign in to continue/i }))

		// Button flips to a disabled "connecting" state so the user can't double-submit.
		const connecting = screen.getByRole('button', { name: /connecting to your provider/i })
		expect(connecting).toBeDisabled()
		expect(assign).not.toHaveBeenCalled()

		vi.advanceTimersByTime(900)
		expect(assign).toHaveBeenCalledWith('/auth/start')
	})

	it('ignores repeat clicks while a redirect is already in flight', () => {
		vi.useFakeTimers()
		const assign = stubAssign()
		render(<LoginScreen signInHref="/auth/start" />)

		const button = screen.getByRole('button', { name: /sign in to continue/i })
		fireEvent.click(button)
		fireEvent.click(screen.getByRole('button', { name: /connecting to your provider/i }))

		vi.advanceTimersByTime(900)
		// Only the first click armed a redirect.
		expect(assign).toHaveBeenCalledTimes(1)
	})
})
