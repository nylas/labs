import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
	applyCalendarEffect,
	applyCalendarResourceEffect,
	type CalendarRouteData,
	calendarKeys,
	calendarStateTestApi,
	resetCalendarConfirmedEffects,
	useHiddenCalendarIdsForRequest,
} from './calendar-state.js'

const event = {
	id: 'event-1',
	calendar_id: 'calendar-1',
	title: 'Planning',
	when: { object: 'timespan', start_time: 1_800_000_000, end_time: 1_800_003_600 },
	participants: [{ email: 'ada@example.com', status: 'noreply' }],
} as Event

// Two overlapping cached ranges (Unix seconds) that both contain `event`.
const WEEK_A = [1_799_900_000, 1_800_100_000] as const
const WEEK_B = [1_799_950_000, 1_800_150_000] as const
// A later, prefetched range that does not contain `event` until it is moved there.
const NEXT_WEEK = [1_800_500_000, 1_801_100_000] as const

function rescheduled(startTime: number): Event {
	return {
		...event,
		when: { object: 'timespan', start_time: startTime, end_time: startTime + 3600 },
	} as Event
}

function data(events: Event[]): CalendarRouteData {
	const calendar = { id: 'calendar-1', name: 'Primary' } as Calendar
	return {
		events,
		calendar,
		calendars: [calendar],
		info: { email: 'ada@example.com', appName: 'OwnMail' },
		anchorIso: '2027-01-15',
		truncated: false,
		hiddenCalendarIds: [],
	}
}

describe('hidden calendars in the range cache', () => {
	it('keys a range by its hidden calendars, because their events were never fetched into it', () => {
		const everything = calendarKeys.range(...WEEK_A)
		const withoutWork = calendarKeys.range(...WEEK_A, ['work'])
		// The account comes first, then the range and the calendars left out of it.
		expect(everything).toEqual([...calendarKeys.all, 'range', WEEK_A[0], WEEK_A[1], ''])
		expect(withoutWork).not.toEqual(everything)
		// Showing the calendar again must miss the entry that was fetched without it.
		const queryClient = new QueryClient()
		queryClient.setQueryData(withoutWork, data([]))
		expect(queryClient.getQueryData(everything)).toBeUndefined()
		expect(calendarKeys.range(...WEEK_A, ['a', 'b'])).not.toEqual(calendarKeys.range(...WEEK_A, ['ab']))
	})

	it('repeats the loader hidden calendars while rendering on the server, where no preference is stored', () => {
		const Probe = () =>
			createElement('p', null, useHiddenCalendarIdsForRequest('ada@example.com', ['b', 'a']).join('|'))
		expect(renderToString(createElement(Probe))).toBe('<p>b|a</p>')
		const Empty = () =>
			createElement('p', null, String(useHiddenCalendarIdsForRequest('ada@example.com', []).length))
		expect(renderToString(createElement(Empty))).toBe('<p>0</p>')
	})
})

describe('calendar cache effects', () => {
	it('creates and updates calendar resources across cached ranges', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([event]))
		const added = { id: 'calendar-2', name: 'Projects' } as Calendar

		applyCalendarResourceEffect(queryClient, { type: 'created', calendar: added })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.calendars).toEqual([
			{ id: 'calendar-1', name: 'Primary' },
			added,
		])

		const renamed = { ...added, name: 'Roadmap' }
		applyCalendarResourceEffect(queryClient, { type: 'updated', calendar: renamed })
		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))
		expect(cached?.calendars[1]).toEqual(renamed)
		expect(cached?.calendar.name).toBe('Primary')

		const primary = { id: 'calendar-1', name: 'Personal', is_primary: true } as Calendar
		applyCalendarResourceEffect(queryClient, { type: 'updated', calendar: primary })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.calendar).toEqual(
			primary,
		)
	})

	it('deletes calendars and their events while keeping a viable active calendar', () => {
		const queryClient = new QueryClient()
		const primary = { id: 'calendar-1', name: 'Primary', is_primary: true } as Calendar
		const secondary = { id: 'calendar-2', name: 'Projects' } as Calendar
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), {
			...data([event, { ...event, id: 'event-2', calendar_id: secondary.id }]),
			calendar: primary,
			calendars: [primary, secondary],
		})

		applyCalendarResourceEffect(queryClient, { type: 'deleted', calendarId: secondary.id })
		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))
		expect(cached?.calendars).toEqual([primary])
		expect(cached?.calendar).toEqual(primary)
		expect(cached?.events.map((candidate) => candidate.id)).toEqual([event.id])

		applyCalendarResourceEffect(queryClient, { type: 'deleted', calendarId: primary.id })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))).toEqual(cached)
	})

	it('falls back to the first calendar and leaves empty cache slots untouched', () => {
		const queryClient = new QueryClient()
		const primary = { id: 'calendar-1', name: 'Primary', is_primary: true } as Calendar
		const secondary = { id: 'calendar-2', name: 'Projects' } as Calendar
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), {
			...data([]),
			calendar: primary,
			calendars: [primary, secondary],
		})
		queryClient.getQueryCache().build(queryClient, { queryKey: calendarKeys.range(...WEEK_B) })

		applyCalendarResourceEffect(queryClient, { type: 'deleted', calendarId: primary.id })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.calendar).toEqual(
			secondary,
		)
		expect(queryClient.getQueryData(calendarKeys.range(...WEEK_B))).toBeUndefined()
	})

	it('updates the event in every cached visible range', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([event]))
		queryClient.setQueryData(calendarKeys.range(...WEEK_B), data([event]))
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
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([other]))
		applyCalendarEffect(queryClient, { type: 'created', event })
		expect(calendarStateTestApi.findCachedEvent(queryClient, event.id)).toEqual(event)

		const canonical = { ...event, title: 'Canonical planning' }
		applyCalendarEffect(queryClient, { type: 'created', event: canonical })
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.events).toEqual([
			other,
			canonical,
		])
		expect(calendarStateTestApi.findCachedEvent(queryClient, 'missing')).toBeUndefined()
	})

	it('leaves an empty query-cache slot empty while applying effects', () => {
		const queryClient = new QueryClient()
		queryClient.getQueryCache().build(queryClient, { queryKey: calendarKeys.range(...WEEK_A) })
		applyCalendarEffect(queryClient, { type: 'updated', event })
		expect(queryClient.getQueryData(calendarKeys.range(...WEEK_A))).toBeUndefined()
	})

	it('removes deleted events from all ranges', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([event]))
		queryClient.setQueryData(calendarKeys.range(...WEEK_B), data([event]))

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
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([event, other]))

		applyCalendarEffect(queryClient, {
			type: 'rsvped',
			eventId: event.id,
			status: 'yes',
			email: 'ada@example.com',
		})

		const cached = queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))
		expect(cached?.events[0]?.participants?.[0]?.status).toBe('yes')
		expect(cached?.events[1]).toEqual(other)
		applyCalendarEffect(queryClient, {
			type: 'rsvped',
			eventId: other.id,
			status: 'no',
			email: 'ada@example.com',
		})
		expect(
			queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.events[1]?.participants,
		).toBeUndefined()
	})

	it('records an RSVP on the signed-in user own entry, because they are rarely the first guest', () => {
		// The grid styles an event from the user's own participant status. Updating the
		// first guest instead would leave the chip unchanged and misreport someone else.
		const invited = {
			...event,
			participants: [
				{ email: 'organizer@example.com', status: 'yes' },
				{ email: ' Ada@Example.com', status: 'noreply' },
				{ email: 'grace@example.com', status: 'noreply' },
			],
		} as Event
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([invited]))

		applyCalendarEffect(queryClient, {
			type: 'rsvped',
			eventId: invited.id,
			status: 'no',
			email: 'ada@example.com',
		})

		const statuses = () =>
			queryClient
				.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))
				?.events[0]?.participants?.map((participant) => participant.status)
		expect(statuses()).toEqual(['yes', 'no', 'noreply'])

		// An unknown mailbox changes nobody; the provider read settles the event instead.
		applyCalendarEffect(queryClient, { type: 'rsvped', eventId: invited.id, status: 'yes', email: '' })
		expect(statuses()).toEqual(['yes', 'no', 'noreply'])
	})

	it('does not resurrect a confirmed deletion when a provider range read is stale', () => {
		const queryClient = new QueryClient()
		calendarStateTestApi.rememberConfirmedCalendarEffect(queryClient, {
			type: 'deleted',
			eventId: event.id,
		})

		const reconciled = calendarStateTestApi.reconcileCalendarData(queryClient, data([event]), {
			start: WEEK_A[0],
			end: WEEK_A[1],
		})

		expect(reconciled.events).toEqual([])
	})

	it('forgets confirmed receipts once the cache is reset for another inbox', () => {
		const queryClient = new QueryClient()
		calendarStateTestApi.rememberConfirmedCalendarEffect(queryClient, {
			type: 'deleted',
			eventId: event.id,
		})

		resetCalendarConfirmedEffects(queryClient)

		expect(calendarStateTestApi.reconcileCalendarData(queryClient, data([event])).events).toEqual([event])
	})

	it('moves a rescheduled event into an already-cached range and out of the old one', () => {
		// Prefetching Next means the destination week is often cached before the
		// event is moved into it; replacing by id alone would leave it missing there.
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([event]))
		queryClient.setQueryData(calendarKeys.range(...NEXT_WEEK), data([]))
		const moved = rescheduled(1_800_600_000)

		applyCalendarEffect(queryClient, { type: 'updated', event: moved })

		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.events).toEqual([])
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...NEXT_WEEK))?.events).toEqual([
			moved,
		])
	})

	it('only adds a created event to ranges it overlaps', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([]))
		queryClient.setQueryData(calendarKeys.range(...NEXT_WEEK), data([]))

		applyCalendarEffect(queryClient, { type: 'created', event })

		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.events).toEqual([
			event,
		])
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...NEXT_WEEK))?.events).toEqual([])
	})

	it('keeps an event without parseable times where the provider placed it', () => {
		// Without times there is no basis for moving it, so it is replaced in place
		// but never copied into ranges that did not already contain it.
		const queryClient = new QueryClient()
		queryClient.setQueryData(calendarKeys.range(...WEEK_A), data([event]))
		queryClient.setQueryData(calendarKeys.range(...NEXT_WEEK), data([]))
		const untimed = { ...event, title: 'Untimed', when: {} } as Event

		applyCalendarEffect(queryClient, { type: 'updated', event: untimed })

		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...WEEK_A))?.events).toEqual([
			untimed,
		])
		expect(queryClient.getQueryData<CalendarRouteData>(calendarKeys.range(...NEXT_WEEK))?.events).toEqual([])
	})

	it('ignores calendar range entries whose key carries no numeric range', () => {
		const queryClient = new QueryClient()
		const malformed = [...calendarKeys.ranges(), 'start', 'end']
		queryClient.setQueryData(malformed, data([event]))

		applyCalendarEffect(queryClient, { type: 'updated', event: rescheduled(1_800_600_000) })

		expect(queryClient.getQueryData<CalendarRouteData>(malformed)?.events).toEqual([event])
	})

	it('re-applies a confirmed reschedule to a stale provider read of either range', () => {
		const queryClient = new QueryClient()
		const moved = rescheduled(1_800_600_000)
		calendarStateTestApi.rememberConfirmedCalendarEffect(queryClient, { type: 'updated', event: moved })

		const oldWeek = calendarStateTestApi.reconcileCalendarData(queryClient, data([event]), {
			start: WEEK_A[0],
			end: WEEK_A[1],
		})
		const nextWeek = calendarStateTestApi.reconcileCalendarData(queryClient, data([]), {
			start: NEXT_WEEK[0],
			end: NEXT_WEEK[1],
		})

		expect(oldWeek.events).toEqual([])
		expect(nextWeek.events).toEqual([moved])
	})
})
