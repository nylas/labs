import type { Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import { filterEventsByCalendars, timedEventsOnDay } from './calendar.js'

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
})
