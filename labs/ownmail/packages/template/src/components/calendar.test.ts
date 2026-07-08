import type { Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import {
	CALENDAR_HOME_PATH,
	DEFAULT_CALENDAR_VIEW,
	dateWithHour,
	filterEventsByCalendars,
	timedEventsOnDay,
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

	it('builds a create-event slot date without changing the selected day', () => {
		const slot = dateWithHour(new Date('2026-07-08T00:00:00'), 14.5)

		expect(ymd(slot)).toBe('2026-07-08')
		expect(slot.getHours()).toBe(14)
		expect(slot.getMinutes()).toBe(30)
		expect(slot.getSeconds()).toBe(0)
	})
})
