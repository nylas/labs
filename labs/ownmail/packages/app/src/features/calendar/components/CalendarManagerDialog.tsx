import type { Calendar } from '@nylas-labs/cli-kit/v3'
import { useQueryClient } from '@tanstack/react-query'
import { ResourceManagerDialog } from '#shared/components/ResourceManagerDialog'
import { createCalendar, deleteCalendar, updateCalendar } from '../server/calendar-fns.js'
import { applyCalendarResourceEffect } from '../state/calendar-state.js'

export function CalendarManagerDialog({
	calendars,
	onClose,
	onDeleted,
}: {
	calendars: Calendar[]
	onClose: () => void
	onDeleted?: (calendarId: string) => void
}) {
	const queryClient = useQueryClient()

	function refresh() {
		void queryClient.invalidateQueries({ queryKey: ['calendar'], refetchType: 'active' }).catch(
			/* v8 ignore next -- background reconciliation cannot change a confirmed mutation result -- @preserve */
			() => {},
		)
	}

	return (
		<ResourceManagerDialog
			title="Manage calendars"
			noun="calendar"
			items={calendars.map((calendar) => ({
				id: calendar.id,
				name: calendar.name || 'Calendar',
				detail: calendar.is_primary ? 'Primary calendar' : calendar.read_only ? 'Read only' : undefined,
				canEdit: !calendar.read_only,
				canDelete: !calendar.read_only && !calendar.is_primary,
			}))}
			onClose={onClose}
			onCreate={async (name) => {
				const receipt = await createCalendar({ data: { name } })
				applyCalendarResourceEffect(queryClient, { type: 'created', calendar: receipt.calendar })
				refresh()
			}}
			onUpdate={async (calendarId, name) => {
				const receipt = await updateCalendar({ data: { calendarId, name } })
				applyCalendarResourceEffect(queryClient, { type: 'updated', calendar: receipt.calendar })
				refresh()
			}}
			onDelete={async (calendarId) => {
				const receipt = await deleteCalendar({ data: { calendarId } })
				applyCalendarResourceEffect(queryClient, {
					type: 'deleted',
					calendarId: receipt.removedCalendarId,
				})
				onDeleted?.(receipt.removedCalendarId)
				refresh()
			}}
		/>
	)
}
