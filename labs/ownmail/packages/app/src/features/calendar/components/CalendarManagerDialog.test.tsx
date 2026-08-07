// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
	managerProps: undefined as any,
	createCalendar: vi.fn(),
	updateCalendar: vi.fn(),
	deleteCalendar: vi.fn(),
}))

vi.mock('#shared/components/ResourceManagerDialog', () => ({
	ResourceManagerDialog: (props: any) => {
		h.managerProps = props
		return <div data-testid="calendar-manager" />
	},
}))

vi.mock('../server/calendar-fns.js', () => ({
	createCalendar: (input: unknown) => h.createCalendar(input),
	updateCalendar: (input: unknown) => h.updateCalendar(input),
	deleteCalendar: (input: unknown) => h.deleteCalendar(input),
}))

import { type CalendarRouteData, calendarKeys } from '../state/calendar-state.js'
import { CalendarManagerDialog } from './CalendarManagerDialog.js'

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

const primary = { id: 'primary', name: 'Personal', is_primary: true } as Calendar
const work = { id: 'work', name: 'Work' } as Calendar
const shared = { id: 'shared', name: 'Shared', read_only: true } as Calendar
const unnamed = { id: 'unnamed', name: '' } as Calendar
const event = {
	id: 'event-work',
	calendar_id: 'work',
	when: { start_time: 1_800_000_000, end_time: 1_800_003_600 },
} as Event

function setup(onDeleted?: (calendarId: string) => void) {
	const queryClient = new QueryClient()
	queryClient.setQueryData<CalendarRouteData>(calendarKeys.range(1, 2), {
		calendar: primary,
		calendars: [primary, work, shared, unnamed],
		events: [event],
		info: { email: 'ada@example.com', appName: 'OwnMail' },
		anchorIso: '2027-01-15',
	})
	render(
		<QueryClientProvider client={queryClient}>
			<CalendarManagerDialog
				calendars={[primary, work, shared, unnamed]}
				onClose={vi.fn()}
				onDeleted={onDeleted}
			/>
		</QueryClientProvider>,
	)
	return queryClient
}

describe('CalendarManagerDialog', () => {
	it('maps primary and read-only capabilities and applies create and update receipts', async () => {
		const queryClient = setup()
		expect(h.managerProps.items).toEqual([
			{
				id: 'primary',
				name: 'Personal',
				detail: 'Primary calendar',
				canEdit: true,
				canDelete: false,
			},
			{ id: 'work', name: 'Work', detail: undefined, canEdit: true, canDelete: true },
			{ id: 'shared', name: 'Shared', detail: 'Read only', canEdit: false, canDelete: false },
			{ id: 'unnamed', name: 'Calendar', detail: undefined, canEdit: true, canDelete: true },
		])

		const projects = { id: 'projects', name: 'Projects' } as Calendar
		h.createCalendar.mockResolvedValue({ calendar: projects })
		await h.managerProps.onCreate('Projects')
		expect(h.createCalendar).toHaveBeenCalledWith({ data: { name: 'Projects' } })
		expect(
			queryClient
				.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))
				?.calendars.some((calendar) => calendar.id === 'projects'),
		).toBe(true)

		h.updateCalendar.mockResolvedValue({ calendar: { ...work, name: 'Roadmap' } })
		await h.managerProps.onUpdate('work', 'Roadmap')
		expect(h.updateCalendar).toHaveBeenCalledWith({ data: { calendarId: 'work', name: 'Roadmap' } })
		expect(
			queryClient
				.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))
				?.calendars.find((calendar) => calendar.id === 'work')?.name,
		).toBe('Roadmap')

		h.deleteCalendar.mockResolvedValue({ removedCalendarId: 'unnamed' })
		await h.managerProps.onDelete('unnamed')
	})

	it('removes a deleted calendar and reports it to hidden-calendar cleanup', async () => {
		const onDeleted = vi.fn()
		const queryClient = setup(onDeleted)
		h.deleteCalendar.mockResolvedValue({ removedCalendarId: 'work' })

		await h.managerProps.onDelete('work')

		expect(h.deleteCalendar).toHaveBeenCalledWith({ data: { calendarId: 'work' } })
		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))
		expect(cached?.calendars.some((calendar) => calendar.id === 'work')).toBe(false)
		expect(cached?.events).toEqual([])
		expect(onDeleted).toHaveBeenCalledWith('work')
	})
})
