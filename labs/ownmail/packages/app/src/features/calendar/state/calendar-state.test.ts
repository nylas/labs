import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
	applyCalendarEffect,
	applyCalendarResourceEffect,
	type CalendarRouteData,
	calendarKeys,
	calendarStateTestApi,
} from './calendar-state.js'

const event = {
	id: 'event-1',
	calendar_id: 'calendar-1',
	title: 'Planning',
	when: { object: 'timespan', start_time: 1_800_000_000, end_time: 1_800_003_600 },
	participants: [{ email: 'ada@example.com', status: 'noreply' }],
} as Event

function data(events: Event[]): CalendarRouteData {
	const calendar = { id: 'calendar-1', name: 'Primary' } as Calendar
	return {
		events,
		calendar,
		calendars: [calendar],
		info: { email: 'ada@example.com', appName: 'OwnMail' },
		anchorIso: '2027-01-15',
	}
}

describe('calendar cache effects', () => {
	it('creates and updates calendar resources across cached ranges', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(1, 2), data([event]))
		const added = { id: 'calendar-2', name: 'Projects' } as Calendar

		applyCalendarResourceEffect(queryClient, { type: 'created', calendar: added })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.calendars).toEqual([
			{ id: 'calendar-1', name: 'Primary' },
			added,
		])

		const renamed = { ...added, name: 'Roadmap' }
		applyCalendarResourceEffect(queryClient, { type: 'updated', calendar: renamed })
		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))
		expect(cached?.calendars[1]).toEqual(renamed)
		expect(cached?.calendar.name).toBe('Primary')

		const primary = { id: 'calendar-1', name: 'Personal', is_primary: true } as Calendar
		applyCalendarResourceEffect(queryClient, { type: 'updated', calendar: primary })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.calendar).toEqual(primary)
	})

	it('deletes calendars and their events while keeping a viable active calendar', () => {
		const queryClient = new QueryClient()
		const primary = { id: 'calendar-1', name: 'Primary', is_primary: true } as Calendar
		const secondary = { id: 'calendar-2', name: 'Projects' } as Calendar
		queryClient.setQueryData(calendarKeys.range(1, 2), {
			...data([event, { ...event, id: 'event-2', calendar_id: secondary.id }]),
			calendar: primary,
			calendars: [primary, secondary],
		})

		applyCalendarResourceEffect(queryClient, { type: 'deleted', calendarId: secondary.id })
		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))
		expect(cached?.calendars).toEqual([primary])
		expect(cached?.calendar).toEqual(primary)
		expect(cached?.events.map((candidate) => candidate.id)).toEqual([event.id])

		applyCalendarResourceEffect(queryClient, { type: 'deleted', calendarId: primary.id })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))).toEqual(cached)
	})

	it('falls back to the first calendar and leaves empty cache slots untouched', () => {
		const queryClient = new QueryClient()
		const primary = { id: 'calendar-1', name: 'Primary', is_primary: true } as Calendar
		const secondary = { id: 'calendar-2', name: 'Projects' } as Calendar
		queryClient.setQueryData(calendarKeys.range(1, 2), {
			...data([]),
			calendar: primary,
			calendars: [primary, secondary],
		})
		queryClient.getQueryCache().build(queryClient, { queryKey: calendarKeys.range(2, 3) })

		applyCalendarResourceEffect(queryClient, { type: 'deleted', calendarId: primary.id })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.calendar).toEqual(secondary)
		expect(queryClient.getQueryData(calendarKeys.range(2, 3))).toBeUndefined()
	})

	it('updates the event in every cached visible range', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(1, 2), data([event]))
		queryClient.setQueryData(calendarKeys.range(2, 3), data([event]))
		const updated = { ...event, title: 'Launch planning' }

		applyCalendarEffect(queryClient, { type: 'updated', event: updated })

		for (const [, cached] of queryClient.getQueriesData<CalendarRouteData>({
			queryKey: calendarKeys.all,
		})) {
			expect(cached?.events).toEqual([updated])
		}
	})

	it('creates new events and replaces an existing optimistic copy', () => {
		const queryClient = new QueryClient()
		const other = { ...event, id: 'event-other' }
		queryClient.setQueryData(calendarKeys.range(1, 2), data([other]))
		applyCalendarEffect(queryClient, { type: 'created', event })
		expect(calendarStateTestApi.findCachedEvent(queryClient, event.id)).toEqual(event)

		const canonical = { ...event, title: 'Canonical planning' }
		applyCalendarEffect(queryClient, { type: 'created', event: canonical })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events).toEqual([
			other,
			canonical,
		])
		expect(calendarStateTestApi.findCachedEvent(queryClient, 'missing')).toBeUndefined()
	})

	it('leaves an empty query-cache slot empty while applying effects', () => {
		const queryClient = new QueryClient()
		queryClient.getQueryCache().build(queryClient, { queryKey: calendarKeys.range(1, 2) })
		applyCalendarEffect(queryClient, { type: 'updated', event })
		expect(queryClient.getQueryData(calendarKeys.range(1, 2))).toBeUndefined()
	})

	it('removes deleted events from all ranges', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(1, 2), data([event]))
		queryClient.setQueryData(calendarKeys.range(2, 3), data([event]))

		applyCalendarEffect(queryClient, { type: 'deleted', eventId: event.id })

		for (const [, cached] of queryClient.getQueriesData<CalendarRouteData>({
			queryKey: calendarKeys.all,
		})) {
			expect(cached?.events).toEqual([])
		}
	})

	it('propagates RSVP state to every cached copy', () => {
		const queryClient = new QueryClient()
		const other = { ...event, id: 'event-2', participants: undefined }
		queryClient.setQueryData(calendarKeys.range(1, 2), data([event, other]))

		applyCalendarEffect(queryClient, { type: 'rsvped', eventId: event.id, status: 'yes' })

		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))
		expect(cached?.events[0]?.participants?.[0]?.status).toBe('yes')
		expect(cached?.events[1]).toEqual(other)
		applyCalendarEffect(queryClient, { type: 'rsvped', eventId: other.id, status: 'no' })
		expect(
			queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(1, 2))?.events[1]?.participants,
		).toBeUndefined()
	})

	it('does not resurrect a confirmed deletion when a provider range read is stale', () => {
		const queryClient = new QueryClient()
		calendarStateTestApi.rememberConfirmedCalendarEffect(queryClient, {
			type: 'deleted',
			eventId: event.id,
		})

		const reconciled = calendarStateTestApi.reconcileCalendarData(queryClient, data([event]))

		expect(reconciled.events).toEqual([])
	})
})
