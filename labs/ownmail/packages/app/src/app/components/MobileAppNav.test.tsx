// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileAppNav } from './MobileAppNav.js'

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to, ...props }: any) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))

describe('MobileAppNav', () => {
	it('exposes every primary destination and marks the active page', () => {
		render(<MobileAppNav active="calendar" />)

		expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Mail' })).not.toHaveAttribute('aria-current')
		expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: 'Contacts' })).not.toHaveAttribute('aria-current')
		expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current')
	})
})
