// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Badge } from './badge.js'

afterEach(cleanup)

describe('Badge', () => {
	it('renders a span with the default variant and data-slot', () => {
		render(<Badge>New</Badge>)
		const badge = screen.getByText('New')
		expect(badge.tagName).toBe('SPAN')
		expect(badge).toHaveAttribute('data-slot', 'badge')
		expect(badge.className).toContain('bg-primary')
	})

	it('supports variants and rendering as a child element', () => {
		render(
			<Badge variant="outline" asChild>
				<a href="/t">Tag</a>
			</Badge>,
		)
		const link = screen.getByRole('link', { name: 'Tag' })
		expect(link).toHaveAttribute('data-slot', 'badge')
		expect(link.className).toContain('text-foreground')
	})
})
