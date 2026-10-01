// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	useRouterState: (options: any) => options.select({ matches: [] }),
	Outlet: () => <div data-testid="calendar-outlet" />,
}))

import { Route } from './calendar.js'

describe('/calendar layout route', () => {
	it('renders only an outlet so nested calendar views own their own chrome', () => {
		const Layout = Route.options.component
		const { container } = render(<Layout />)

		expect(screen.getByTestId('calendar-outlet')).toBeInTheDocument()
		expect(container.children).toHaveLength(1)
	})
})
