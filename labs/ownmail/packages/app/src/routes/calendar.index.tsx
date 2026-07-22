import { createFileRoute, redirect } from '@tanstack/react-router'
import { DEFAULT_CALENDAR_VIEW, isCalendarDate } from '#features/calendar/lib/calendar'

export const Route = createFileRoute('/calendar/')({
	validateSearch: (search): { date?: string } => (isCalendarDate(search.date) ? { date: search.date } : {}),
	beforeLoad: ({ search }) => {
		// Replace (not push) so Back skips the transient /calendar landing instead of
		// re-triggering this redirect and trapping the user on the calendar view.
		throw redirect({ to: '/calendar/$view', params: { view: DEFAULT_CALENDAR_VIEW }, search, replace: true })
	},
})
