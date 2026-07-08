import { createFileRoute, redirect } from '@tanstack/react-router'
import { DEFAULT_CALENDAR_VIEW } from '../components/calendar.js'

export const Route = createFileRoute('/calendar/')({
	beforeLoad: () => {
		throw redirect({ to: '/calendar/$view', params: { view: DEFAULT_CALENDAR_VIEW } })
	},
})
