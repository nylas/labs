// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileTabBar } from './MobileTabBar.js'

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}))

afterEach(cleanup)

describe('MobileTabBar', () => {
	it('exposes four persistent primary destinations with touch-sized, single-line labels', () => {
		render(<MobileTabBar active="calendar" />)
		const nav = screen.getByRole('navigation', { name: 'Primary mobile' })
		expect(nav).toHaveClass('mobile-tab-bar', 'md:hidden')
		const links = screen.getAllByRole('link')
		expect(links).toHaveLength(4)
		for (const link of links) expect(link).toHaveClass('mobile-tab')
		expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: 'Mail' })).not.toHaveAttribute('aria-current')
	})

	it('links every tab to its canonical top-level route', () => {
		render(<MobileTabBar active="mail" />)
		expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute('href', '/')
		expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar')
		expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/contacts')
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
	})
})
