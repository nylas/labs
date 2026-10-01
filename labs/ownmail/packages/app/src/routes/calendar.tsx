import { createFileRoute } from '@tanstack/react-router'
import { ContentReadyOutlet } from '#app/components/ContentReadyOutlet'

export const Route = createFileRoute('/calendar')({
	component: CalendarOutlet,
})

function CalendarOutlet() {
	return <ContentReadyOutlet parentRouteId="/calendar" />
}
