// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScrollArea } from './scroll-area.js'

afterEach(cleanup)

describe('ScrollArea', () => {
	it('labels the scrollable region and provides an accessible instruction', () => {
		render(
			<ScrollArea aria-label="Thread conversation" className="h-24">
				<div>Message content</div>
			</ScrollArea>,
		)

		expect(screen.getByLabelText('Thread conversation')).toHaveAttribute('data-slot', 'scroll-area')
		expect(screen.getByText(/Scrollable content/)).toHaveClass('sr-only')
	})
})
