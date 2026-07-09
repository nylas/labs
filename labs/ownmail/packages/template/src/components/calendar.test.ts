import type { Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import {
	addDays,
	allDayEventSegments,
	DEFAULT_CALENDAR_VIEW,
	dateWithHour,
	eventsOnDay,
	filterEventsByCalendars,
	isCalView,
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
