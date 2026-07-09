// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js'

// Radix positions the tooltip with a Popper that observes size; jsdom lacks it.
beforeAll(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
})

afterEach(cleanup)

describe('Tooltip', () => {
	it('reveals its content when the trigger is focused', async () => {
		render(
			<Tooltip>
				<TooltipTrigger aria-label="Previous" />
				<TooltipContent>Previous period</TooltipContent>
			</Tooltip>,
		)
		const trigger = screen.getByRole('button', { name: 'Previous' })
		expect(trigger).toHaveAttribute('data-slot', 'tooltip-trigger')

		// Keyboard focus opens the tooltip immediately (no hover delay).
		fireEvent.focus(trigger)
		await waitFor(() => {
			const content = document.querySelector('[data-slot="tooltip-content"]')
			expect(content).toBeTruthy()
			expect(content).toHaveTextContent('Previous period')
		})
	})
})
