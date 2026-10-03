// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SwapIcon } from './SwapIcon.js'

afterEach(cleanup)

describe('SwapIcon', () => {
	it('rotates a new icon in only when the state it shows changes, never on first paint', () => {
		const view = render(<SwapIcon swapKey="moon">moon</SwapIcon>)
		expect(screen.getByText('moon')).not.toHaveClass('icon-swap')

		view.rerender(<SwapIcon swapKey="sun">sun</SwapIcon>)
		expect(screen.getByText('sun')).toHaveClass('icon-swap')

		// A re-render in the same state does not replay the swap.
		view.rerender(<SwapIcon swapKey="sun">sun</SwapIcon>)
		expect(screen.getByText('sun')).not.toHaveClass('icon-swap')
	})
})
