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
	it('exposes four accessible icon-only primary destinations', () => {
		render(<MobileTabBar active="calendar" />)
		const nav = screen.getByRole('navigation', { name: 'Primary mobile' })
		expect(nav.parentElement).toHaveClass('mobile-tab-bar', 'md:hidden')
		const links = screen.getAllByRole('link')
		expect(links).toHaveLength(4)
		for (const link of links) {
			expect(link).toHaveClass('mobile-tab')
			expect(link).toHaveAttribute('title', link.getAttribute('aria-label'))
			expect(link).toHaveTextContent('')
		}
		expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: 'Mail' })).not.toHaveAttribute('aria-current')
	})

	it('reuses the bottom surface as an empty thread toolbar slot', () => {
		render(<MobileTabBar active="mail" context="thread" />)

		const toolbar = screen.getByRole('toolbar', { name: 'Thread actions' })
		expect(toolbar.parentElement).toHaveClass('mobile-tab-bar')
		expect(toolbar).toHaveClass('mobile-thread-tabs')
		expect(screen.queryByRole('navigation', { name: 'Primary mobile' })).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('links every tab to its canonical top-level route', () => {
		render(<MobileTabBar active="mail" />)
		expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute('href', '/')
		expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar')
		expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/contacts')
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
	})
})
