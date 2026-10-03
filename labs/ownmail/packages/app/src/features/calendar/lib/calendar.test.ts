import type { Event } from '@nylas-labs/cli-kit/v3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALENDAR_HOME_PATH } from '#app/config/route-paths'
import {
	ALL_DAY_COLLAPSED_ROWS,
	addDays,
	allDayBand,
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
	hiddenCalendarIdsForRequest,
	initialTimeGridScrollHour,
	isCalView,
	isOutsideWorkingHours,
	isPastEvent,
	isRenderableCalendarEvent,
	MAX_HIDDEN_CALENDAR_IDS_PER_REQUEST,
	moveCalendarDay,
	NOW_BADGE_HEIGHT,
	nowBadgeCoversLabel,
	shiftAnchor,
	startOfWeek,
	TIMED_CHIP_TITLE_ONLY_MAX_MINUTES,
	TIMED_CHIP_TWO_LINE_MIN_HEIGHT,
	timedChipLines,
	timedChipShowsTime,
	timedDayLayout,
	timedEventLayout,
	timedEventsOnDay,
	timeZoneDayChange,
	timeZoneOffsetLabel,
	timeZoneShortName,
	timezoneCity,
	upcomingAgenda,
	viewRange,
	ymd,
} from './calendar.js'

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

describe('upcomingAgenda', () => {
	const now = new Date('2024-06-15T10:30:00')

	it('drops meetings that already ended so "Up next" only lists what is still ahead', () => {
		const events = [
			timedEvent('ended', 'cal', '2024-06-15T09:00:00', '2024-06-15T10:00:00'),
			timedEvent('later', 'cal', '2024-06-15T14:00:00', '2024-06-15T15:00:00'),
			timedEvent('endsNow', 'cal', '2024-06-15T10:00:00', '2024-06-15T10:30:00'),
		]
		expect(upcomingAgenda(events, now).map((entry) => entry.event.id)).toEqual(['later'])
	})

	it('keeps an in-progress meeting first and flags it so it can read as "Now"', () => {
		const events = [
			timedEvent('later', 'cal', '2024-06-15T14:00:00', '2024-06-15T15:00:00'),
			timedEvent('current', 'cal', '2024-06-15T10:00:00', '2024-06-15T11:00:00'),
		]
		expect(upcomingAgenda(events, now).map(({ event, inProgress }) => [event.id, inProgress])).toEqual([
			['current', true],
			['later', false],
		])
	})

	it('ignores all-day events, other days, the unsaved preview, and respects the limit', () => {
		const events = [
			allDayEvent('allday', 'cal', '2024-06-15'),
			timedEvent('tomorrow', 'cal', '2024-06-16T09:00:00', '2024-06-16T10:00:00'),
			{
				...timedEvent('preview', 'cal', '2024-06-15T12:00:00', '2024-06-15T13:00:00'),
				id: '__new-event-preview__',
			},
			timedEvent('a', 'cal', '2024-06-15T12:00:00', '2024-06-15T13:00:00'),
			timedEvent('b', 'cal', '2024-06-15T13:00:00', '2024-06-15T14:00:00'),
		]
		expect(upcomingAgenda(events, now, undefined, 1).map((entry) => entry.event.id)).toEqual(['a'])
	})

	it('decides which day is "today" in the display timezone, not the device timezone', () => {
		// 23:30 UTC on the 15th is already the 16th in Tokyo.
		const lateUtc = new Date('2024-06-15T23:30:00Z')
		const tokyoMorning = timedEvent('tokyo', 'cal', '2024-06-16T00:00:00Z', '2024-06-16T01:00:00Z')
		expect(upcomingAgenda([tokyoMorning], lateUtc, 'Asia/Tokyo').map((entry) => entry.event.id)).toEqual([
			'tokyo',
		])
	})
})

describe('initialTimeGridScrollHour', () => {
	it('opens an hour before now when today is on screen so the current time is visible', () => {
		expect(initialTimeGridScrollHour(['2024-06-14', '2024-06-15'], '2024-06-15', 15.5)).toBe(14)
	})

	it('clamps to the first and last hour of the grid', () => {
		expect(initialTimeGridScrollHour(['2024-06-15'], '2024-06-15', 0.25)).toBe(0)
		expect(initialTimeGridScrollHour(['2024-06-15'], '2024-06-15', 26)).toBe(23)
	})

	it('keeps the 8am working-day default for ranges that do not include today', () => {
		expect(initialTimeGridScrollHour(['2024-06-20'], '2024-06-15', 15)).toBe(8)
	})
})

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

	it('chooses the earliest instant for an ambiguous fall-back wall-clock slot', () => {
		const instant = calendarSlotTime(new Date(2026, 10, 1), 1.5, 'America/New_York')

		expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z')
		expect(calendarWallClockHour(instant, 'America/New_York')).toBe(1.5)
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

	it('reuses an all-day row when event spans do not overlap', () => {
		const weekStart = startOfWeek(new Date('2026-07-08T12:00:00'))
		const columns = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
		const segments = allDayEventSegments(
			[allDayEvent('sunday', 'primary', '2026-07-05'), allDayEvent('tuesday', 'primary', '2026-07-07')],
			columns,
		)

		expect(segments.map(({ event, row }) => ({ id: event.id, row }))).toEqual([
			{ id: 'sunday', row: 0 },
			{ id: 'tuesday', row: 0 },
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

describe('side-by-side layout for concurrent events', () => {
	const GRID = { startHour: 0, endHour: 24, hourHeight: 60, timeZone: 'UTC' }
	const day = new Date(2026, 6, 8)
	const at = (id: string, start: string, end: string) =>
		timedEvent(id, 'work', `2026-07-08T${start}:00Z`, `2026-07-08T${end}:00Z`)
	const layout = (events: Event[], options = GRID, on = day) =>
		Object.fromEntries(
			timedDayLayout(events, on, options).map(({ event, left, width }) => [
				event.id,
				{ left: Number(left.toFixed(4)), width: Number(width.toFixed(4)) },
			]),
		)
	/** True when two boxes share both vertical and horizontal space, i.e. one covers the other. */
	const covers = (events: Event[], options = GRID, on = day) => {
		const boxes = timedDayLayout(events, on, options)
		return boxes.some((a, index) =>
			boxes.slice(index + 1).some((b) => {
				const horizontal = a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9
				const aEnd = a.top + a.height
				const bEnd = b.top + b.height
				return horizontal && a.top < bEnd && b.top < aEnd
			}),
		)
	}

	it('gives a lone event the whole column', () => {
		expect(layout([at('solo', '09:00', '10:00')])).toEqual({ solo: { left: 0, width: 1 } })
	})

	it('splits the column between two events at the same time so neither hides the other', () => {
		const events = [at('a', '09:00', '10:00'), at('b', '09:30', '10:30')]
		expect(layout(events)).toEqual({ a: { left: 0, width: 0.5 }, b: { left: 0.5, width: 0.5 } })
		expect(covers(events)).toBe(false)
	})

	it('does not treat back-to-back events as overlapping: each keeps the full width', () => {
		expect(layout([at('first', '09:00', '10:00'), at('second', '10:00', '11:00')])).toEqual({
			first: { left: 0, width: 1 },
			second: { left: 0, width: 1 },
		})
	})

	it('handles nested overlaps and lets a later event widen into columns that are free for it', () => {
		const events = [
			at('outer', '09:00', '12:00'),
			at('inner', '09:30', '10:00'),
			at('innermost', '09:45', '10:15'),
			at('later', '11:00', '11:30'),
		]
		expect(layout(events)).toEqual({
			outer: { left: 0, width: 0.3333 },
			inner: { left: 0.3333, width: 0.3333 },
			innermost: { left: 0.6667, width: 0.3333 },
			// Only `outer` is still running at 11:00, so `later` takes both free columns.
			later: { left: 0.3333, width: 0.6667 },
		})
		expect(covers(events)).toBe(false)
	})

	it('keeps a long event beside several short ones in two columns', () => {
		const events = [
			at('offsite', '12:00', '17:00'),
			at('one', '12:15', '12:45'),
			at('two', '13:00', '14:00'),
			at('three', '15:00', '16:00'),
		]
		expect(layout(events)).toEqual({
			offsite: { left: 0, width: 0.5 },
			one: { left: 0.5, width: 0.5 },
			two: { left: 0.5, width: 0.5 },
			three: { left: 0.5, width: 0.5 },
		})
		expect(covers(events)).toBe(false)
	})

	it('clusters a chain of overlaps together even though its first and last events never meet', () => {
		const events = [at('a', '09:00', '10:30'), at('b', '10:00', '11:30'), at('c', '11:00', '12:00')]
		expect(layout(events)).toEqual({
			a: { left: 0, width: 0.5 },
			b: { left: 0.5, width: 0.5 },
			// `c` reuses the first column once `a` has ended.
			c: { left: 0, width: 0.5 },
		})
		expect(covers(events)).toBe(false)
	})

	it('sizes each cluster on its own, so a busy morning does not narrow a quiet afternoon', () => {
		expect(
			layout([
				at('m1', '09:00', '10:00'),
				at('m2', '09:00', '10:00'),
				at('m3', '09:00', '10:00'),
				at('pm', '14:00', '15:00'),
			]),
		).toEqual({
			m1: { left: 0, width: 0.3333 },
			m2: { left: 0.3333, width: 0.3333 },
			m3: { left: 0.6667, width: 0.3333 },
			pm: { left: 0, width: 1 },
		})
	})

	it('puts the longer of two events that start together in the first column, whatever order they arrive in', () => {
		const expected = { long: { left: 0, width: 0.5 }, short: { left: 0.5, width: 0.5 } }
		expect(layout([at('short', '09:00', '09:30'), at('long', '09:00', '11:00')])).toEqual(expected)
		expect(layout([at('long', '09:00', '11:00'), at('short', '09:00', '09:30')])).toEqual(expected)
	})

	it('keeps the vertical position identical to the single-event layout', () => {
		const event = at('standup', '09:30', '11:00')
		const [box] = timedDayLayout([event, at('other', '10:00', '10:30')], day, GRID)
		expect({ top: box?.top, height: box?.height }).toEqual(timedEventLayout(event, day, GRID))
	})

	it('ignores all-day events and events that are not drawn on the day', () => {
		expect(
			timedDayLayout(
				[
					allDayEvent('holiday', 'work', '2026-07-08'),
					timedEvent('tomorrow', 'work', '2026-07-09T09:00:00Z', '2026-07-09T10:00:00Z'),
					at('today', '09:00', '10:00'),
				],
				day,
				GRID,
			).map((box) => box.event.id),
		).toEqual(['today'])
		expect(timedDayLayout([], day, GRID)).toEqual([])
	})

	it('lays out by local wall-clock time when no display timezone is chosen', () => {
		const events = [
			timedEvent('a', 'work', '2026-07-08T09:00:00', '2026-07-08T10:00:00'),
			timedEvent('b', 'work', '2026-07-08T09:30:00', '2026-07-08T10:30:00'),
		]
		const options = { startHour: 0, endHour: 24, hourHeight: 60 }
		expect(layout(events, options)).toEqual({ a: { left: 0, width: 0.5 }, b: { left: 0.5, width: 0.5 } })
	})

	it('separates the two passes of the repeated hour when daylight saving time ends', () => {
		// 2026-11-01 in New York: 1:00-1:30 happens twice, an hour apart in real time.
		// Both are drawn at 1 AM, so they must sit side by side rather than on top of each other.
		const newYork = { ...GRID, timeZone: 'America/New_York' }
		const fallBack = new Date(2026, 10, 1)
		const events = [
			timedEvent('edt', 'work', '2026-11-01T05:00:00Z', '2026-11-01T05:30:00Z'),
			timedEvent('est', 'work', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z'),
		]
		const boxes = timedDayLayout(events, fallBack, newYork)
		expect(boxes.map((box) => box.top)).toEqual([60, 60])
		expect(layout(events, newYork, fallBack)).toEqual({
			edt: { left: 0, width: 0.5 },
			est: { left: 0.5, width: 0.5 },
		})
		expect(covers(events, newYork, fallBack)).toBe(false)
	})

	it('lays out across the skipped hour when daylight saving time begins', () => {
		// 2026-03-08 in New York: 2 AM does not exist. An event from 1:30 EST to 3:30 EDT is
		// drawn from 1:30 to 3:30 on the grid and overlaps one that starts at 3:00 EDT.
		const newYork = { ...GRID, timeZone: 'America/New_York' }
		const springForward = new Date(2026, 2, 8)
		const events = [
			timedEvent('across', 'work', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z'),
			timedEvent('after', 'work', '2026-03-08T07:00:00Z', '2026-03-08T08:00:00Z'),
			timedEvent('clear', 'work', '2026-03-08T08:00:00Z', '2026-03-08T09:00:00Z'),
		]
		const boxes = timedDayLayout(events, springForward, newYork)
		expect(boxes.map(({ event, top, height }) => [event.id, top, height])).toEqual([
			['across', 90, 118],
			['after', 180, 58],
			['clear', 240, 58],
		])
		expect(layout(events, newYork, springForward)).toEqual({
			across: { left: 0, width: 0.5 },
			after: { left: 0.5, width: 0.5 },
			clear: { left: 0, width: 1 },
		})
	})
})

describe('past events', () => {
	const event = timedEvent('standup', 'work', '2026-07-08T09:00:00Z', '2026-07-08T10:00:00Z')

	it('counts an event as past only once it has ended, so a meeting in progress stays prominent', () => {
		expect(isPastEvent(event, new Date('2026-07-08T08:00:00Z'))).toBe(false)
		expect(isPastEvent(event, new Date('2026-07-08T09:30:00Z'))).toBe(false)
		expect(isPastEvent(event, new Date('2026-07-08T10:00:00Z'))).toBe(true)
		expect(isPastEvent(event, new Date('2026-07-09T00:00:00Z'))).toBe(true)
	})

	describe('all-day events end with the display timezone date, not the browser timezone', () => {
		const original = process.env.TZ
		afterEach(() => {
			process.env.TZ = original
		})
		const losAngeles = 'America/Los_Angeles'
		const oct1 = () => allDayEvent('offsite', 'work', '2026-10-01')

		it('keeps an Oct 1 all-day event current all day in Los Angeles when the browser runs in UTC', () => {
			// Browser midnight (UTC) is 5 PM the previous day in Los Angeles. Comparing the
			// browser-local end with `now` faded the event at 5 PM on Oct 1, seven hours early.
			process.env.TZ = 'UTC'
			// 5:30 PM PDT on Oct 1: already Oct 2 in UTC.
			expect(isPastEvent(oct1(), new Date('2026-10-02T00:30:00Z'), losAngeles)).toBe(false)
			// 11:59 PM PDT on Oct 1.
			expect(isPastEvent(oct1(), new Date('2026-10-02T06:59:00Z'), losAngeles)).toBe(false)
			// Midnight PDT: Oct 2 has begun for the viewer.
			expect(isPastEvent(oct1(), new Date('2026-10-02T07:00:00Z'), losAngeles)).toBe(true)
		})

		it('does not keep the event past its day when the browser is west of the display timezone', () => {
			// Browser in Los Angeles showing Tokyo: Oct 2 starts in Tokyo while it is still
			// 8 AM on Oct 1 for the browser.
			process.env.TZ = losAngeles
			expect(isPastEvent(oct1(), new Date('2026-10-01T14:59:00Z'), 'Asia/Tokyo')).toBe(false)
			expect(isPastEvent(oct1(), new Date('2026-10-01T15:00:00Z'), 'Asia/Tokyo')).toBe(true)
		})

		it('ends a multi-day event after its last day, and never before it starts', () => {
			process.env.TZ = 'UTC'
			const trip = allDaySpanEvent('trip', 'work', '2026-10-01', '2026-10-03')
			expect(isPastEvent(trip, new Date('2026-09-30T12:00:00Z'), losAngeles)).toBe(false)
			// 11 PM PDT on Oct 2, the last day.
			expect(isPastEvent(trip, new Date('2026-10-03T06:00:00Z'), losAngeles)).toBe(false)
			expect(isPastEvent(trip, new Date('2026-10-03T07:00:00Z'), losAngeles)).toBe(true)
		})

		it('ends at local midnight on the 25-hour day when daylight saving time ends', () => {
			// Nov 1, 2026 in Los Angeles runs from 07:00Z to 08:00Z the next day.
			process.env.TZ = 'UTC'
			const fallBack = allDayEvent('fall-back', 'work', '2026-11-01')
			expect(isPastEvent(fallBack, new Date('2026-11-01T07:00:00Z'), losAngeles)).toBe(false)
			// 24 hours after it began it is only 11 PM: still Nov 1.
			expect(isPastEvent(fallBack, new Date('2026-11-02T07:00:00Z'), losAngeles)).toBe(false)
			expect(isPastEvent(fallBack, new Date('2026-11-02T08:00:00Z'), losAngeles)).toBe(true)
		})

		it('ends at local midnight on the 23-hour day when daylight saving time begins', () => {
			// Mar 8, 2026 in Los Angeles runs from 08:00Z to 07:00Z the next day.
			process.env.TZ = 'UTC'
			const springForward = allDayEvent('spring-forward', 'work', '2026-03-08')
			expect(isPastEvent(springForward, new Date('2026-03-09T06:59:00Z'), losAngeles)).toBe(false)
			expect(isPastEvent(springForward, new Date('2026-03-09T07:00:00Z'), losAngeles)).toBe(true)
		})

		it('uses the browser date when no display timezone is chosen', () => {
			process.env.TZ = 'UTC'
			expect(isPastEvent(oct1(), new Date('2026-10-01T23:59:00Z'))).toBe(false)
			expect(isPastEvent(oct1(), new Date('2026-10-02T00:00:00Z'))).toBe(true)
		})
	})

	it('judges a timed event by its instant, so the display timezone cannot change the answer', () => {
		for (const zone of [undefined, 'America/Los_Angeles', 'Asia/Tokyo']) {
			expect(isPastEvent(event, new Date('2026-07-08T09:59:00Z'), zone)).toBe(false)
			expect(isPastEvent(event, new Date('2026-07-08T10:00:00Z'), zone)).toBe(true)
		}
	})

	it('never dims an event whose time cannot be read', () => {
		expect(
			isPastEvent({ id: 'broken', calendar_id: 'work', when: null } as unknown as Event, new Date()),
		).toBe(false)
	})
})

describe('time gutter zone label', () => {
	it('uses the short zone name for the instant shown, following daylight saving time', () => {
		expect(timeZoneShortName('America/New_York', new Date('2026-09-30T12:00:00Z'), 'en-US')).toBe('EDT')
		expect(timeZoneShortName('America/New_York', new Date('2026-01-15T12:00:00Z'), 'en-US')).toBe('EST')
		expect(timeZoneShortName('America/Los_Angeles', new Date('2026-09-30T12:00:00Z'), 'en-US')).toBe('PDT')
		expect(timeZoneShortName('UTC', new Date('2026-09-30T12:00:00Z'), 'en-US')).toBe('UTC')
	})

	it('never shows part of a city name', () => {
		expect(timeZoneShortName('America/New_York', new Date('2026-09-30T12:00:00Z'))).not.toMatch(/New/)
	})
})

describe('second time zone ruler', () => {
	const summer = new Date('2026-07-15T12:00:00Z')

	it('heads each ruler with a whole city name, not an id fragment', () => {
		expect(timezoneCity('Europe/Lisbon')).toBe('Lisbon')
		expect(timezoneCity('America/New_York')).toBe('New York')
		expect(timezoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
		expect(timezoneCity('UTC')).toBe('UTC')
	})

	it('says how far the second clock is from the first, ahead or behind, so a reader can convert at a glance', () => {
		expect(timeZoneOffsetLabel('America/Toronto', 'Europe/Lisbon', summer)).toBe('+5h')
		// A true minus sign, so the offset is not read as a dash.
		expect(timeZoneOffsetLabel('America/Toronto', 'America/Vancouver', summer)).toBe('−3h')
		expect(timeZoneOffsetLabel('Europe/London', 'Asia/Kolkata', summer)).toBe('+4.5h')
		expect(timeZoneOffsetLabel('Asia/Kolkata', 'Asia/Kathmandu', summer)).toBe('+0.25h')
		expect(timeZoneOffsetLabel('America/Toronto', 'America/New_York', summer)).toBe('Same time')
	})

	it('follows the instant, so the offset changes when only one zone observes daylight saving time', () => {
		// Toronto moves to EDT on 8 March 2026; Lisbon waits until 29 March.
		expect(timeZoneOffsetLabel('America/Toronto', 'Europe/Lisbon', new Date('2026-03-20T12:00:00Z'))).toBe(
			'+4h',
		)
		expect(timeZoneOffsetLabel('America/Toronto', 'Europe/Lisbon', new Date('2026-01-15T12:00:00Z'))).toBe(
			'+5h',
		)
	})

	it('shades hours before 7 AM and from 10 PM in that zone, when someone there is unlikely to be working', () => {
		const lisbon = (time: string) =>
			isOutsideWorkingHours(new Date(`2026-07-15T${time}:00+01:00`), 'Europe/Lisbon')
		expect(lisbon('06:59')).toBe(true)
		expect(lisbon('07:00')).toBe(false)
		expect(lisbon('21:59')).toBe(false)
		expect(lisbon('22:00')).toBe(true)
		expect(lisbon('00:00')).toBe(true)
	})

	it('names the day a second zone moves into when it crosses midnight, and nothing otherwise', () => {
		// 6 PM and 7 PM on Friday in Toronto are 11 PM Friday and midnight Saturday in Lisbon.
		const sixPm = new Date('2026-07-17T22:00:00Z')
		const sevenPm = new Date('2026-07-17T23:00:00Z')
		expect(timeZoneDayChange(sixPm, sevenPm, 'America/Toronto', 'Europe/Lisbon', 1)).toMatch(/^Sat/)
		expect(timeZoneDayChange(sixPm, sevenPm, 'America/Toronto', 'America/New_York', 1)).toBeNull()
	})

	it('says how the date relates to the column when one ruler serves a whole week, since a weekday fits one column only', () => {
		const sixPm = new Date('2026-07-17T22:00:00Z')
		const sevenPm = new Date('2026-07-17T23:00:00Z')
		expect(timeZoneDayChange(sixPm, sevenPm, 'America/Toronto', 'Europe/Lisbon', 7)).toBe('Next day')
		// 2 AM and 3 AM on Friday in Toronto are 11 PM Thursday and midnight Friday in Vancouver.
		const twoAm = new Date('2026-07-17T06:00:00Z')
		const threeAm = new Date('2026-07-17T07:00:00Z')
		expect(timeZoneDayChange(twoAm, threeAm, 'America/Toronto', 'America/Vancouver', 7)).toBe('Same day')
		// 11 PM and midnight in Toronto are 8 PM and 9 PM in Los Angeles: no crossing, no mark.
		const elevenPm = new Date('2026-07-17T03:00:00Z')
		const midnight = new Date('2026-07-17T04:00:00Z')
		expect(timeZoneDayChange(elevenPm, midnight, 'America/Toronto', 'America/Los_Angeles', 7)).toBeNull()
		// 25 hours apart: Pago Pago reaches Friday when Kiritimati is already on Saturday.
		const before = new Date('2026-07-17T10:00:00Z')
		const after = new Date('2026-07-17T11:00:00Z')
		expect(timeZoneDayChange(before, after, 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 7)).toBe('Prev day')
	})
})

describe('all-day band', () => {
	const weekStart = startOfWeek(new Date('2026-07-08T12:00:00'))
	const columns = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
	const edges = (events: Event[], cols = columns) =>
		Object.fromEntries(
			allDayEventSegments(events, cols).map((segment) => [
				segment.event.id,
				[segment.continuesBefore, segment.continuesAfter],
			]),
		)

	it('marks which edge of a segment continues beyond the visible week', () => {
		// The week is Sun Jul 5 to Sat Jul 11; an end date is exclusive.
		expect(
			edges([
				allDaySpanEvent('started-earlier', 'work', '2026-07-03', '2026-07-07'),
				allDaySpanEvent('runs-later', 'work', '2026-07-10', '2026-07-14'),
				allDaySpanEvent('both', 'work', '2026-07-01', '2026-07-20'),
				allDaySpanEvent('inside', 'work', '2026-07-06', '2026-07-09'),
				allDayEvent('single', 'work', '2026-07-08'),
			]),
		).toEqual({
			'started-earlier': [true, false],
			'runs-later': [false, true],
			both: [true, true],
			inside: [false, false],
			single: [false, false],
		})
	})

	it('does not mark an event that ends exactly on the last visible day or starts on the first', () => {
		expect(
			edges([
				allDaySpanEvent('to-saturday', 'work', '2026-07-09', '2026-07-12'),
				allDaySpanEvent('from-sunday', 'work', '2026-07-05', '2026-07-07'),
			]),
		).toEqual({ 'to-saturday': [false, false], 'from-sunday': [false, false] })
	})

	it('judges the edges against the visible columns, so a day view marks both sides of a long event', () => {
		expect(
			edges([allDaySpanEvent('trip', 'work', '2026-07-07', '2026-07-10')], [new Date('2026-07-08T00:00:00')]),
		).toEqual({ trip: [true, true] })
		expect(allDayEventSegments([allDayEvent('single', 'work', '2026-07-08')], [])).toEqual([])
	})

	const stacked = (count: number) =>
		allDayEventSegments(
			Array.from({ length: count }, (_, index) => allDayEvent(`event-${index}`, 'work', '2026-07-08')),
			columns,
		)

	it('shows at most three rows while collapsed and counts the events it leaves out', () => {
		const band = allDayBand(stacked(5), false)
		expect(ALL_DAY_COLLAPSED_ROWS).toBe(3)
		expect(band.rowCount).toBe(3)
		expect(band.segments.map((segment) => segment.event.id)).toEqual(['event-0', 'event-1', 'event-2'])
		expect(band.hiddenCount).toBe(2)
	})

	it('counts hidden events, not hidden rows, so "N more" never understates what is missing', () => {
		const segments = allDayEventSegments(
			[
				...Array.from({ length: 3 }, (_, index) =>
					allDaySpanEvent(`wide-${index}`, 'work', '2026-07-05', '2026-07-12'),
				),
				allDayEvent('monday', 'work', '2026-07-06'),
				allDayEvent('friday', 'work', '2026-07-10'),
			],
			columns,
		)
		expect(new Set(segments.map((segment) => segment.row)).size).toBe(4)
		expect(allDayBand(segments, false).hiddenCount).toBe(2)
	})

	it('shows every row once expanded', () => {
		const band = allDayBand(stacked(5), true)
		expect(band.rowCount).toBe(5)
		expect(band.segments).toHaveLength(5)
		expect(band.hiddenCount).toBe(0)
	})

	it('leaves a band of three rows or fewer untouched, with nothing to expand', () => {
		expect(allDayBand(stacked(3), false)).toEqual({ segments: stacked(3), rowCount: 3, hiddenCount: 0 })
		expect(allDayBand([], false)).toEqual({ segments: [], rowCount: 0, hiddenCount: 0 })
	})
})

describe('hidden calendars sent with an event request', () => {
	it('is canonical, so the same choice in any order shares one cached range', () => {
		expect(hiddenCalendarIdsForRequest(['b', 'a', 'b'])).toEqual(['a', 'b'])
		expect(hiddenCalendarIdsForRequest([])).toEqual([])
	})

	it('caps the list so the request stays small; the rest are still filtered on the client', () => {
		const many = Array.from({ length: 80 }, (_, index) => `calendar-${String(index).padStart(2, '0')}`)
		const ids = hiddenCalendarIdsForRequest(many)
		expect(ids).toHaveLength(MAX_HIDDEN_CALENDAR_IDS_PER_REQUEST)
		expect(ids[0]).toBe('calendar-00')
	})
})

describe('timed chip text fit', () => {
	const GRID = { startHour: 0, endHour: 24, hourHeight: 52, timeZone: 'UTC' }
	const heightOf = (minutes: number) =>
		timedEventLayout(
			timedEvent(
				'e',
				'work',
				'2026-07-08T09:00:00Z',
				new Date(Date.UTC(2026, 6, 8, 9, minutes)).toISOString(),
			),
			new Date(2026, 6, 8),
			GRID,
		)?.height as number

	it('uses one line for any chip too short to hold a title line above a time line without clipping', () => {
		// Two lines need 2px of border, 8px of padding, a 15px title and a 14px time line.
		expect(TIMED_CHIP_TWO_LINE_MIN_HEIGHT).toBeGreaterThanOrEqual(2 + 8 + 15 + 14)
		// 15 minutes is the 20px minimum chip; 30 and 45 minutes are still too short for two lines.
		expect([15, 30, 45].map((minutes) => timedChipLines(heightOf(minutes)))).toEqual([1, 1, 1])
		expect(timedChipLines(TIMED_CHIP_TWO_LINE_MIN_HEIGHT - 1)).toBe(1)
	})

	it('drops the time from events of 30 minutes or less, whose chip has room only for the title', () => {
		const lasting = (minutes: number) => ({
			start: new Date('2026-07-15T09:00:00Z'),
			end: new Date(Date.parse('2026-07-15T09:00:00Z') + minutes * 60_000),
		})
		expect(TIMED_CHIP_TITLE_ONLY_MAX_MINUTES).toBe(30)
		expect([5, 15, 30].map((minutes) => timedChipShowsTime(lasting(minutes)))).toEqual([false, false, false])
		expect([31, 45, 60].map((minutes) => timedChipShowsTime(lasting(minutes)))).toEqual([true, true, true])
	})

	it('stacks the title over the time range from an hour-long event upwards', () => {
		expect(timedChipLines(TIMED_CHIP_TWO_LINE_MIN_HEIGHT)).toBe(2)
		expect([60, 90, 240].map((minutes) => timedChipLines(heightOf(minutes)))).toEqual([2, 2, 2])
	})

	it('leaves room for one 16px text line inside the minimum chip, so short events are readable', () => {
		const borders = 2
		expect(heightOf(5)).toBe(20)
		expect(heightOf(5) - borders).toBeGreaterThanOrEqual(16)
	})
})

describe('now badge and gutter hour labels', () => {
	// An hour label is 16px tall and centred on its hour line; the grid is 52px per hour.
	const hourLabel = (hour: number) => [hour * 52, 16] as const
	const nowAt = (hour: number, minute: number) => (hour + minute / 60) * 52

	it('hides the hour label the badge would be drawn over, so two times are never stacked', () => {
		// 5:46 AM: the badge sits 12px above the 6 AM line and overlaps its label.
		expect(nowBadgeCoversLabel(nowAt(5, 46), ...hourLabel(6))).toBe(true)
		expect(nowBadgeCoversLabel(nowAt(6, 0), ...hourLabel(6))).toBe(true)
		expect(nowBadgeCoversLabel(nowAt(6, 17), ...hourLabel(6))).toBe(true)
	})

	it('keeps every label the badge does not touch', () => {
		expect(nowBadgeCoversLabel(nowAt(5, 46), ...hourLabel(5))).toBe(false)
		expect(nowBadgeCoversLabel(nowAt(6, 30), ...hourLabel(6))).toBe(false)
		expect(nowBadgeCoversLabel(nowAt(6, 30), ...hourLabel(7))).toBe(false)
	})

	it('hides a label exactly when the two boxes intersect, not merely when they are close', () => {
		const [centre, height] = hourLabel(6)
		const touching = (NOW_BADGE_HEIGHT + height) / 2
		expect(nowBadgeCoversLabel(centre + touching - 0.5, centre, height)).toBe(true)
		expect(nowBadgeCoversLabel(centre + touching, centre, height)).toBe(false)
		expect(nowBadgeCoversLabel(centre - touching, centre, height)).toBe(false)
	})

	it('at most one hour label is hidden at any minute of the day', () => {
		for (let minute = 0; minute < 24 * 60; minute += 1) {
			const hidden = Array.from({ length: 25 }, (_, hour) => hour).filter((hour) =>
				nowBadgeCoversLabel((minute / 60) * 52, ...hourLabel(hour)),
			)
			expect(hidden.length).toBeLessThanOrEqual(1)
		}
	})
})

describe('time-zone conversion cost', () => {
	// A week view converts thousands of instants per render. Building an ICU
	// formatter per conversion made opening the calendar block input for
	// hundreds of milliseconds, so a time zone's formatter must be built once.
	it('reuses one formatter per time zone across conversions', () => {
		const construct = vi.spyOn(Intl, 'DateTimeFormat')
		try {
			for (let hour = 0; hour < 50; hour++) {
				calendarDateInTimeZone(new Date(Date.UTC(2024, 5, 15, hour)), 'Asia/Kolkata')
			}
			expect(construct.mock.calls.length).toBeLessThanOrEqual(1)
			expect(calendarDateInTimeZone(new Date(Date.UTC(2024, 5, 15, 20)), 'Asia/Kolkata')).toEqual(
				new Date(2024, 5, 16),
			)
		} finally {
			construct.mockRestore()
		}
	})
})
