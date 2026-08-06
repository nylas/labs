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
		render(<LoginScreen signInHref="/auth/start" siteName="Acme Mail" />)
		expect(screen.getByRole('heading', { name: 'Welcome to Acme Mail' })).toBeInTheDocument()
		expect(screen.getByText('a')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /sign in to continue/i })).toHaveAttribute(
			'aria-disabled',
			'false',
		)
		expect(screen.getByText('Unified mail with fast search')).toBeInTheDocument()
		expect(screen.getByText('Calendar and events, side by side')).toBeInTheDocument()
		expect(screen.getByText('Secure sign-in through your provider')).toBeInTheDocument()
	})

	it('shows a focus-safe connecting state and redirects on the next task', () => {
		vi.useFakeTimers()
		const assign = stubAssign()
		render(<LoginScreen signInHref="/auth/start" siteName="ownmail" />)

		const button = screen.getByRole('button', { name: /sign in to continue/i })
		button.focus()
		fireEvent.click(button)

		const connecting = screen.getByRole('button', { name: /connecting to your provider/i })
		expect(connecting).toBe(button)
		expect(connecting).toHaveFocus()
		expect(connecting).toHaveAttribute('aria-disabled', 'true')
		expect(connecting).toHaveAttribute('aria-busy', 'true')
		expect(connecting).toHaveClass('min-h-11')
		expect(assign).not.toHaveBeenCalled()

		vi.advanceTimersByTime(0)
		expect(assign).toHaveBeenCalledWith('/auth/start')
	})

	it('ignores repeat clicks while a redirect is already in flight', () => {
		vi.useFakeTimers()
		const assign = stubAssign()
		render(<LoginScreen signInHref="/auth/start" siteName="ownmail" />)

		const button = screen.getByRole('button', { name: /sign in to continue/i })
		fireEvent.click(button)
		fireEvent.click(button)

		expect(vi.getTimerCount()).toBe(1)
		vi.runOnlyPendingTimers()
		expect(assign).toHaveBeenCalledTimes(1)
	})
})
