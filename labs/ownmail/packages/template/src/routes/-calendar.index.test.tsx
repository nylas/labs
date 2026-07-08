// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const loadCalendarRouteData = vi.fn()
vi.mock('./calendar.$view.js', () => ({
	loadCalendarRouteData: (view: string, date?: string) => loadCalendarRouteData(view, date),
	CalendarRouteScreen: (props: any) => (
		<div data-testid="calendar-screen" data-view={props.view} data-nav={props.navigationMode}>
			{JSON.stringify(props.data)}
		</div>
	),
}))

import { Route } from './calendar.index.js'

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
})

describe('/calendar index search + loader', () => {
	it('accepts a well-formed ISO date so deep links to a day survive validation', () => {
		expect(Route.options.validateSearch({ date: '2024-01-02' })).toEqual({ date: '2024-01-02' })
	})

	it('drops a malformed date string rather than trusting arbitrary search input', () => {
		expect(Route.options.validateSearch({ date: '01/02/2024' })).toEqual({})
	})

	it('drops a non-string date value', () => {
		expect(Route.options.validateSearch({ date: 20240102 })).toEqual({})
	})

	it('threads the validated date into loader deps for cache-correct refetches', () => {
		expect(Route.options.loaderDeps({ search: { date: '2024-01-02' } })).toEqual({ date: '2024-01-02' })
	})

	it('loads the month event range for the entry view, honoring the requested date', async () => {
		loadCalendarRouteData.mockResolvedValue({ events: [] })
		const result = await Route.options.loader({ deps: { date: '2024-01-02' } })
		expect(loadCalendarRouteData).toHaveBeenCalledWith('month', '2024-01-02')
		expect(result).toEqual({ events: [] })
	})

	it('renders the calendar in the default week view with local navigation', () => {
		Route.useLoaderData = vi.fn(() => ({ events: [{ id: '1' }] }))
		const Page = Route.options.component
		render(<Page />)
		const el = screen.getByTestId('calendar-screen')
		expect(el.dataset.view).toBe('week')
		expect(el.dataset.nav).toBe('local')
	})
})
