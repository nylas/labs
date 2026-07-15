import type { Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import {
	addDays,
	allDayEventSegments,
	calendarDateInTimeZone,
	calendarKeyAction,
	calendarSlotTime,
	calendarWallClockHour,
	DEFAULT_CALENDAR_VIEW,
	dateWithHour,
	eventsOnDay,
	eventTimes,
	filterEventsByCalendars,
	fmtAgendaTime,
	fmtTime,
	isCalView,
	isRenderableCalendarEvent,
	moveCalendarDay,
	shiftAnchor,
	startOfWeek,
	timedEventLayout,
	timedEventsOnDay,
	viewRange,
	ymd,
} from './calendar.js'
import { CALENDAR_HOME_PATH } from './route-paths.js'

function timedEvent(id: string, calendarId: string, start: string, end: string): Event {
	return {
		id,
		calendar_id: calendarId,
		grant_id: 'grant-dev',
		title: id,
		when: {
			object: 'timespan',
			start_time: Math.floor(new Date(start).getTime() / 1000),
			end_time: Math.floor(new Date(end).getTime() / 1000),
		},
		busy: true,
	}
}

function allDayEvent(id: string, calendarId: string, date: string): Event {
	return {
		id,
		calendar_id: calendarId,
		grant_id: 'grant-dev',
		title: id,
		when: { object: 'date', date },
		busy: false,
	}
}

function allDaySpanEvent(id: string, calendarId: string, startDate: string, endDate: string): Event {
	return {
		id,
		calendar_id: calendarId,
		grant_id: 'grant-dev',
		title: id,
		when: { object: 'datespan', start_date: startDate, end_date: endDate },
		busy: false,
	}
}

describe('calendarKeyAction', () => {
	it('maps m / w / d to view switches, case-insensitively', () => {
		expect(calendarKeyAction('m')).toEqual({ kind: 'view', view: 'month' })
		expect(calendarKeyAction('W')).toEqual({ kind: 'view', view: 'week' })
		expect(calendarKeyAction('d')).toEqual({ kind: 'view', view: 'day' })
	})

	it('maps t to today and n to a new event', () => {
		expect(calendarKeyAction('t')).toEqual({ kind: 'today' })
		expect(calendarKeyAction('n')).toEqual({ kind: 'new' })
	})

	it('pages backward with ArrowLeft or [ and forward with ArrowRight or ]', () => {
		expect(calendarKeyAction('ArrowLeft')).toEqual({ kind: 'shift', direction: -1 })
		expect(calendarKeyAction('[')).toEqual({ kind: 'shift', direction: -1 })
		expect(calendarKeyAction('ArrowRight')).toEqual({ kind: 'shift', direction: 1 })
		expect(calendarKeyAction(']')).toEqual({ kind: 'shift', direction: 1 })
	})

	it('returns null for unbound keys so the caller leaves the event alone', () => {
		expect(calendarKeyAction('x')).toBeNull()
		expect(calendarKeyAction('Enter')).toBeNull()
	})
})

describe('moveCalendarDay', () => {
	it('uses arrows, Home/End, and page keys without changing calendar view', () => {
		const wednesday = new Date('2026-07-08T12:00:00')
		expect(ymd(moveCalendarDay(wednesday, 'ArrowLeft') as Date)).toBe('2026-07-07')
		expect(ymd(moveCalendarDay(wednesday, 'ArrowRight') as Date)).toBe('2026-07-09')
		expect(ymd(moveCalendarDay(wednesday, 'ArrowUp') as Date)).toBe('2026-07-01')
		expect(ymd(moveCalendarDay(wednesday, 'ArrowDown') as Date)).toBe('2026-07-15')
		expect(ymd(moveCalendarDay(wednesday, 'Home') as Date)).toBe('2026-07-05')
		expect(ymd(moveCalendarDay(wednesday, 'End') as Date)).toBe('2026-07-11')
		expect(ymd(moveCalendarDay(wednesday, 'PageUp') as Date)).toBe('2026-06-08')
		expect(ymd(moveCalendarDay(wednesday, 'PageDown') as Date)).toBe('2026-08-08')
		expect(moveCalendarDay(wednesday, 'Enter')).toBeNull()
	})
})

describe('calendar view helpers', () => {
	it('links calendar navigation to the reference calendar entry route', () => {
		expect(CALENDAR_HOME_PATH).toBe('/calendar')
	})

	it('defaults calendar entry navigation to the reference week view', () => {
		expect(DEFAULT_CALENDAR_VIEW).toBe('week')
	})

	it('builds the reference six-week month range', () => {
		const { start, end } = viewRange('month', new Date('2026-07-08T12:00:00'))

		expect(ymd(start)).toBe('2026-06-28')
		expect(ymd(end)).toBe('2026-08-09')
		expect((end.getTime() - start.getTime()) / 86_400_000).toBe(42)
	})

	it('filters out events from hidden calendars', () => {
		const events = [
			timedEvent('work-review', 'work', '2026-07-08T10:00:00', '2026-07-08T11:00:00'),
			timedEvent('focus-block', 'focus', '2026-07-08T08:00:00', '2026-07-08T09:30:00'),
		]

		expect(filterEventsByCalendars(events, new Set(['focus'])).map((event) => event.id)).toEqual([
			'work-review',
		])
	})

	it('returns the events untouched when no calendars are hidden', () => {
		const events = [timedEvent('work-review', 'work', '2026-07-08T10:00:00', '2026-07-08T11:00:00')]

		// Empty hidden set is the common case (all calendars visible); it must not filter anything.
		expect(filterEventsByCalendars(events, new Set())).toBe(events)
	})

	it('rejects malformed external events without disrupting valid calendar projections', () => {
		const timed = timedEvent('valid-timed', 'work', '2026-07-08T10:00:00', '2026-07-08T11:00:00')
		const allDay = allDayEvent('valid-all-day', 'work', '2026-07-08')
		const malformed = [
			null,
			{ id: 'null-when', calendar_id: 'work', when: null },
			{ id: 'missing-when', calendar_id: 'work' },
			{ id: 'bad-timespan', calendar_id: 'work', when: { start_time: 10, end_time: 10 } },
			{ id: 'bad-date', calendar_id: 'work', when: { date: '2026-02-30' } },
			{ id: 'bad-datespan', calendar_id: 'work', when: { start_date: '2026-07-09', end_date: '2026-07-08' } },
		] as unknown as Event[]
		const events = [timed, allDay, ...malformed] as Event[]

		expect(eventTimes(null)).toBeNull()
		expect(isRenderableCalendarEvent(malformed[0])).toBe(false)
		expect(filterEventsByCalendars(events, new Set()).map((event) => event.id)).toEqual([
			'valid-timed',
			'valid-all-day',
		])
		expect(eventsOnDay(events, new Date('2026-07-08T12:00:00')).map((event) => event.id)).toEqual([
			'valid-all-day',
			'valid-timed',
		])
		expect(timedEventsOnDay(events, new Date('2026-07-08T12:00:00')).map((event) => event.id)).toEqual([
			'valid-timed',
		])
		expect(
			allDayEventSegments(events, [new Date('2026-07-08T12:00:00')]).map((segment) => segment.event.id),
		).toEqual(['valid-all-day'])
	})

	it('supports Nylas single-point `time` event values', () => {
		const event = {
			id: 'reminder',
			calendar_id: 'work',
			when: { object: 'time', time: Math.floor(new Date('2026-07-08T10:00:00').getTime() / 1000) },
		} satisfies Event

		expect(eventTimes(event)).toMatchObject({ allDay: false, start: new Date('2026-07-08T10:00:00') })
		expect(eventsOnDay([event], new Date('2026-07-08T12:00:00')).map(({ id }) => id)).toEqual(['reminder'])
	})

	it('keeps events with no calendar id even when other calendars are hidden', () => {
		const orphan = timedEvent('orphan', 'work', '2026-07-08T10:00:00', '2026-07-08T11:00:00')
		orphan.calendar_id = undefined
		const events = [orphan, timedEvent('focus-block', 'focus', '2026-07-08T08:00:00', '2026-07-08T09:30:00')]

		// An event without a calendar_id can't be attributed to a hidden calendar, so it stays visible.
		expect(filterEventsByCalendars(events, new Set(['focus'])).map((event) => event.id)).toEqual(['orphan'])
	})

	it('returns only timed events on the requested day', () => {
		const events = [
			timedEvent('today', 'work', '2026-07-08T10:00:00', '2026-07-08T11:00:00'),
			timedEvent('tomorrow', 'work', '2026-07-09T10:00:00', '2026-07-09T11:00:00'),
			allDayEvent('all-day', 'primary', '2026-07-08'),
		]

		expect(timedEventsOnDay(events, new Date('2026-07-08T12:00:00')).map((event) => event.id)).toEqual([
			'today',
		])
	})

	it('orders all-day events before timed events like the reference month grid', () => {
		const events = [
			timedEvent('midnight-release', 'work', '2026-07-08T00:00:00', '2026-07-08T01:00:00'),
			allDayEvent('ooo', 'primary', '2026-07-08'),
			timedEvent('standup', 'work', '2026-07-08T09:00:00', '2026-07-08T09:30:00'),
		]

		expect(eventsOnDay(events, new Date('2026-07-08T12:00:00')).map((event) => event.id)).toEqual([
			'ooo',
			'midnight-release',
			'standup',
		])
	})

	it('treats Nylas all-day end_date as the exclusive end of the visible span', () => {
		const events = [allDaySpanEvent('conference', 'work', '2026-07-08', '2026-07-10')]

		expect(eventsOnDay(events, new Date('2026-07-08T12:00:00')).map((event) => event.id)).toEqual([
			'conference',
		])
		expect(eventsOnDay(events, new Date('2026-07-09T12:00:00')).map((event) => event.id)).toEqual([
			'conference',
		])
		expect(eventsOnDay(events, new Date('2026-07-10T12:00:00')).map((event) => event.id)).toEqual([])
	})

	it('renders one all-day segment across each visible spanned day', () => {
		const weekStart = startOfWeek(new Date('2026-07-08T12:00:00'))
		const columns = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
		const segments = allDayEventSegments(
			[
				allDaySpanEvent('conference', 'work', '2026-07-08', '2026-07-11'),
				allDayEvent('rent', 'primary', '2026-07-10'),
			],
			columns,
		)

		expect(
			segments.map((segment) => ({
				id: segment.event.id,
				startColumn: segment.startColumn,
				span: segment.span,
				row: segment.row,
			})),
		).toEqual([
			{ id: 'conference', startColumn: 4, span: 3, row: 0 },
			{ id: 'rent', startColumn: 6, span: 1, row: 1 },
		])
	})

	it('builds a create-event slot date without changing the selected day', () => {
		const slot = dateWithHour(new Date('2026-07-08T00:00:00'), 14.5)

		expect(ymd(slot)).toBe('2026-07-08')
		expect(slot.getHours()).toBe(14)
		expect(slot.getMinutes()).toBe(30)
		expect(slot.getSeconds()).toBe(0)
	})

	it('keeps reference time-grid layout for same-day timed events', () => {
		const event = timedEvent('standup', 'work', '2026-07-08T09:30:00', '2026-07-08T11:00:00')

		expect(
			timedEventLayout(event, new Date('2026-07-08T12:00:00'), {
				startHour: 7,
				endHour: 23,
				hourHeight: 52,
			}),
		).toEqual({ top: 130, height: 76 })
	})

	it('uses the selected timezone consistently for days, times, and grid placement', () => {
		const event = timedEvent('late-toronto', 'work', '2026-07-09T02:30:00Z', '2026-07-09T03:30:00Z')
		const toronto = 'America/Toronto'
		const previousDay = new Date('2026-07-08T12:00:00')
		expect(calendarDateInTimeZone(previousDay)).toEqual(new Date('2026-07-08T00:00:00'))
		expect(calendarDateInTimeZone(new Date('2026-07-09T02:30:00Z'), toronto)).toEqual(
			new Date('2026-07-08T00:00:00'),
		)
		expect(eventsOnDay([event], previousDay, toronto).map(({ id }) => id)).toEqual(['late-toronto'])
		expect(fmtTime(new Date('2026-07-09T02:30:00Z'), toronto)).toBe('10:30 PM')
		expect(fmtAgendaTime(new Date('2026-07-09T02:30:00Z'), toronto)).toBe('22:30')
		expect(
			timedEventLayout(event, previousDay, { startHour: 7, endHour: 25, hourHeight: 52, timeZone: toronto }),
		).toEqual({ top: 806, height: 50 })
		expect(fmtTime(calendarSlotTime(previousDay, 9, toronto), 'Europe/London')).toBe('2 PM')
	})

	it('converts fractional wall-clock slots and current hours in the selected timezone', () => {
		const toronto = 'America/Toronto'
		const instant = calendarSlotTime(new Date('2026-07-08T00:00:00'), 9.5, toronto)
		expect(instant.toISOString()).toBe('2026-07-08T13:30:00.000Z')
		expect(calendarWallClockHour(instant, toronto)).toBe(9.5)
	})

	it('normalizes a nonexistent spring-forward slot to the first valid local time', () => {
		const newYork = 'America/New_York'
		const instant = calendarSlotTime(new Date(2026, 2, 8), 2, newYork)
		const laterGapSlot = calendarSlotTime(new Date(2026, 2, 8), 2.5, newYork)

		expect(instant.toISOString()).toBe('2026-03-08T07:00:00.000Z')
		expect(calendarWallClockHour(instant, newYork)).toBe(3)
		expect(laterGapSlot.toISOString()).toBe('2026-03-08T07:00:00.000Z')
	})

	it('excludes an event at its exact selected-timezone end boundary', () => {
		const midnight = timedEvent('midnight', 'work', '2026-07-08T23:30:00Z', '2026-07-09T00:00:00Z')
		const thirtyPast = timedEvent('thirty-past', 'work', '2026-07-08T23:30:00Z', '2026-07-09T00:30:00Z')
		const nextDay = new Date('2026-07-09T12:00:00')
		expect(eventsOnDay([midnight, thirtyPast], nextDay, 'UTC').map(({ id }) => id)).toEqual(['thirty-past'])
		expect(
			timedEventLayout(midnight, nextDay, { startHour: 0, endHour: 24, hourHeight: 52, timeZone: 'UTC' }),
		).toBeNull()
	})

	it('lays out early-morning events when the time grid starts at midnight', () => {
		const early = timedEvent('early', 'work', '2026-07-08T06:00:00Z', '2026-07-08T07:00:00Z')
		expect(
			timedEventLayout(early, new Date('2026-07-08T00:00:00'), {
				startHour: 0,
				endHour: 25,
				hourHeight: 52,
				timeZone: 'America/Toronto',
			}),
		).toEqual({ top: 104, height: 50 })
	})

	it('omits an event when its selected-timezone range is fully clipped', () => {
		const late = timedEvent('late', 'work', '2026-07-08T23:30:00Z', '2026-07-09T00:00:00Z')
		expect(
			timedEventLayout(late, new Date('2026-07-08T00:00:00'), {
				startHour: 0,
				endHour: 23,
				hourHeight: 52,
				timeZone: 'UTC',
			}),
		).toBeNull()
	})

	it('clamps overnight Nylas events to the visible part of the rendered day', () => {
		const event = timedEvent('deploy', 'work', '2026-07-08T22:30:00', '2026-07-09T01:00:00')

		expect(
			timedEventLayout(event, new Date('2026-07-08T12:00:00'), {
				startHour: 7,
				endHour: 23,
				hourHeight: 52,
			}),
		).toEqual({ top: 806, height: 24 })
		expect(
			timedEventLayout(event, new Date('2026-07-09T12:00:00'), {
				startHour: 7,
				endHour: 23,
				hourHeight: 52,
			}),
		).toBeNull()
	})

	it('lays out an event ending at midnight in the late-night calendar rows', () => {
		const event = timedEvent('late', 'work', '2026-07-08T23:00:00', '2026-07-09T00:00:00')

		expect(
			timedEventLayout(event, new Date('2026-07-08T12:00:00'), {
				startHour: 7,
				endHour: 25,
				hourHeight: 52,
			}),
		).toEqual({ top: 832, height: 50 })
	})

	it('has no time-grid layout for all-day events', () => {
		// All-day events render in the all-day rail, never the timed grid, so layout is null.
		expect(
			timedEventLayout(allDayEvent('ooo', 'primary', '2026-07-08'), new Date('2026-07-08T12:00:00'), {
				startHour: 7,
				endHour: 23,
				hourHeight: 52,
			}),
		).toBeNull()
	})

	it('validates the calendar view slug from the route param', () => {
		expect(isCalView('day')).toBe(true)
		expect(isCalView('week')).toBe(true)
		expect(isCalView('month')).toBe(true)
		expect(isCalView('year')).toBe(false)
		expect(isCalView('')).toBe(false)
	})

	it('builds a single-day range for the day view', () => {
		const { start, end } = viewRange('day', new Date('2026-07-08T12:00:00'))

		expect(ymd(start)).toBe('2026-07-08')
		expect(ymd(end)).toBe('2026-07-09')
	})

	it('builds a Sunday-anchored week range for the week view', () => {
		const { start, end } = viewRange('week', new Date('2026-07-08T12:00:00'))

		expect(ymd(start)).toBe('2026-07-05')
		expect(ymd(end)).toBe('2026-07-12')
	})

	it('shifts the anchor by the granularity of the active view for prev/next navigation', () => {
		const anchor = new Date('2026-07-08T12:00:00')

		expect(ymd(shiftAnchor('day', anchor, 1))).toBe('2026-07-09')
		expect(ymd(shiftAnchor('day', anchor, -1))).toBe('2026-07-07')
		expect(ymd(shiftAnchor('week', anchor, 1))).toBe('2026-07-15')
		expect(ymd(shiftAnchor('week', anchor, -1))).toBe('2026-07-01')
		expect(ymd(shiftAnchor('month', anchor, 1))).toBe('2026-08-01')
		expect(ymd(shiftAnchor('month', anchor, -1))).toBe('2026-06-01')
	})

	it('breaks all-day segment ties by span then start then title so the grid layout is stable', () => {
		const weekStart = startOfWeek(new Date('2026-07-08T12:00:00'))
		const columns = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
		const segments = allDayEventSegments(
			[
				allDayEvent('bbb', 'primary', '2026-07-05'),
				allDayEvent('aaa', 'primary', '2026-07-05'),
				allDaySpanEvent('ccc', 'work', '2026-07-05', '2026-07-07'),
			],
			columns,
		)

		expect(
			segments.map((segment) => ({
				id: segment.event.id,
				startColumn: segment.startColumn,
				span: segment.span,
				row: segment.row,
			})),
		).toEqual([
			{ id: 'ccc', startColumn: 1, span: 2, row: 0 },
			{ id: 'aaa', startColumn: 1, span: 1, row: 1 },
			{ id: 'bbb', startColumn: 1, span: 1, row: 2 },
		])
	})

	it('coerces missing all-day event titles to an empty string in the tiebreak comparator', () => {
		// When two all-day segments share start column, span, and start time, the comparator
		// falls through to a localeCompare on their titles. A Nylas event may have no title, so
		// the comparator must treat an undefined title as '' rather than throwing on localeCompare.
		const weekStart = startOfWeek(new Date('2026-07-08T12:00:00'))
		const columns = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
		const untitledAllDay = (id: string): Event => ({
			id,
			calendar_id: 'primary',
			grant_id: 'grant-dev',
			title: undefined,
			when: { object: 'date', date: '2026-07-05' },
			busy: false,
		})
		const segments = allDayEventSegments([untitledAllDay('one'), untitledAllDay('two')], columns)

		// Both segments land on the same single day with identical layout; neither title throws
		// and both stay on their own row because their columns overlap.
		expect(
			segments.map((segment) => ({
				id: segment.event.id,
				startColumn: segment.startColumn,
				row: segment.row,
			})),
		).toEqual([
			{ id: 'one', startColumn: 1, row: 0 },
			{ id: 'two', startColumn: 1, row: 1 },
		])
	})
})
