import { createFileRoute, redirect } from '@tanstack/react-router'
import { DEFAULT_CALENDAR_VIEW } from '../components/calendar.js'

export const Route = createFileRoute('/calendar/')({
	validateSearch: (search): { date?: string } =>
		typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? { date: search.date } : {},
	beforeLoad: ({ search }) => {
		throw redirect({ to: '/calendar/$view', params: { view: DEFAULT_CALENDAR_VIEW }, search })
	},
})
