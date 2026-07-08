import { createFileRoute } from '@tanstack/react-router'
import { CALENDAR_ENTRY_EVENT_RANGE_VIEW, DEFAULT_CALENDAR_VIEW } from '../components/calendar.js'
import { resetDevMocksForServerRender } from '../server/dev-mock-reset.js'
import { CalendarRouteScreen, loadCalendarRouteData } from './calendar.$view.js'

export const Route = createFileRoute('/calendar/')({
	validateSearch: (search): { date?: string } =>
		typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? { date: search.date } : {},
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ deps }) => {
		if (typeof document === 'undefined') await resetDevMocksForServerRender()
		return loadCalendarRouteData(CALENDAR_ENTRY_EVENT_RANGE_VIEW, deps.date)
	},
	component: CalendarIndexPage,
})

function CalendarIndexPage() {
	const data = Route.useLoaderData()

	return <CalendarRouteScreen view={DEFAULT_CALENDAR_VIEW} data={data} navigationMode="local" />
}
