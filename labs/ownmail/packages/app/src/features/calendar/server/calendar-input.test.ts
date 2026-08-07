import { describe, expect, it } from 'vitest'
import {
	normalizeCalendarIdInput,
	normalizeCalendarNameInput,
	normalizeCreateEventInput,
	normalizeEventIdInput,
	normalizeEventRangeInput,
	normalizeRsvpEventInput,
	normalizeUpdateCalendarInput,
	normalizeUpdateEventInput,
} from './calendar-input.js'

describe('calendar input validation', () => {
	it('normalizes calendar management names and ids', () => {
		expect(normalizeCalendarNameInput({ name: '  Projects  ' })).toEqual({ name: 'Projects' })
		expect(normalizeUpdateCalendarInput({ calendarId: 'calendar-1', name: ' Roadmap ' })).toEqual({
			calendarId: 'calendar-1',
			name: 'Roadmap',
		})
		expect(normalizeCalendarIdInput({ calendarId: 'calendar-1' })).toEqual({ calendarId: 'calendar-1' })
	})

	it.each([
		[null, 'missing input'],
		[{ name: 3 }, 'non-string'],
		[{ name: '   ' }, 'blank'],
		[{ name: 'bad\nname' }, 'control character'],
		[{ name: 'x'.repeat(201) }, 'too long'],
	])('rejects invalid calendar names: %s', (input) => {
		expect(() => normalizeCalendarNameInput(input as never)).toThrow('Invalid calendar name')
	})

	it('rejects invalid calendar ids for update and delete', () => {
		expect(() => normalizeUpdateCalendarInput({ calendarId: '', name: 'Projects' })).toThrow(
			'Invalid calendar',
		)
		expect(() => normalizeCalendarIdInput({ calendarId: 'bad\nid' })).toThrow('Invalid calendar')
	})

	it('normalizes event list ranges for Nylas epoch-second filters', () => {
		expect(normalizeEventRangeInput({ start: 1_800_000_000, end: 1_800_003_600 })).toEqual({
			start: 1_800_000_000,
			end: 1_800_003_600,
		})
	})

	it('rejects malformed event list ranges before calling Nylas', () => {
		expect(() => normalizeEventRangeInput({ start: '1' as unknown as number, end: 1_800_003_600 })).toThrow(
			'Invalid start',
		)
		expect(() => normalizeEventRangeInput({ start: 1_800_003_600, end: 1_800_000_000 })).toThrow(
			'End must be after start',
		)
		expect(() => normalizeEventRangeInput({ start: 1_800_000_000, end: 1_805_443_201 })).toThrow(
			'Range too large',
		)
	})

	it('normalizes create event input', () => {
		expect(
			normalizeCreateEventInput({
				title: ' Planning ',
				description: '',
				location: 'HQ',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				participants: [' ada@example.com '],
				calendarId: 'primary',
			}),
		).toEqual({
			title: 'Planning',
			description: '',
			location: 'HQ',
			startTime: 1_800_000_000,
			endTime: 1_800_003_600,
			participants: ['ada@example.com'],
			calendarId: 'primary',
		})
	})

	it('rejects create event inputs that do not match the API body shape', () => {
		expect(() =>
			normalizeCreateEventInput({
				title: '',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
			}),
		).toThrow('Title is required')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: Number.NaN,
			}),
		).toThrow('Invalid end time')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				participants: ['bad-email'],
			}),
		).toThrow('Invalid participant: bad-email')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				calendarId: 'bad\ncalendar',
			}),
		).toThrow('Invalid calendar')
	})

	it('omits the calendar id from the create body when the caller does not target one', () => {
		expect(
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
			}),
		).toEqual({
			title: 'Planning',
			startTime: 1_800_000_000,
			endTime: 1_800_003_600,
		})
	})

	it('normalizes valid all-day and recurring create inputs', () => {
		expect(normalizeCreateEventInput({ title: 'Holiday', allDayDate: '2027-12-25' })).toEqual({
			title: 'Holiday',
			allDayDate: '2027-12-25',
		})
		expect(
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				timezone: 'America/Toronto',
				recurrence: { frequency: 'weekly', interval: 2, weekdays: ['FR', 'MO'] },
			}),
		).toMatchObject({
			timezone: 'America/Toronto',
			recurrence: { frequency: 'weekly', interval: 2, weekdays: ['MO', 'FR'] },
		})
		expect(
			normalizeCreateEventInput({
				title: 'Birthday',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				timezone: 'UTC',
				recurrence: { frequency: 'yearly', interval: 1 },
			}),
		).toMatchObject({ recurrence: { frequency: 'yearly', interval: 1 } })
	})

	it('normalizes update event input with only bounded text fields', () => {
		expect(
			normalizeUpdateEventInput({
				eventId: 'event#abc',
				description: 'Longer notes',
				location: 'HQ',
			}),
		).toEqual({
			eventId: 'event#abc',
			description: 'Longer notes',
			location: 'HQ',
		})
	})

	it('normalizes update event input with paired time fields', () => {
		expect(
			normalizeUpdateEventInput({
				eventId: 'event#abc',
				title: ' Updated ',
				startTime: 0,
				endTime: 1,
			}),
		).toEqual({
			eventId: 'event#abc',
			title: 'Updated',
			startTime: 0,
			endTime: 1,
		})
	})

	it('rejects create inputs that exceed field bounds or carry malformed participants', () => {
		expect(() =>
			normalizeCreateEventInput({
				title: 'a'.repeat(501),
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
			}),
		).toThrow('Invalid title')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				participants: 'grace@vercel.com' as unknown as string[],
			}),
		).toThrow('Invalid participants')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				participants: [42 as unknown as string],
			}),
		).toThrow('Invalid participant')
	})

	it('rejects malformed all-day dates, timezones, and recurrence rules', () => {
		expect(() => normalizeCreateEventInput({ title: 'Holiday', allDayDate: 42 as never })).toThrow(
			'Invalid all-day date',
		)
		expect(() => normalizeCreateEventInput({ title: 'Holiday', allDayDate: '2027-02-30' })).toThrow(
			'Invalid all-day date',
		)
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				timezone: 'Not/A-Timezone',
			}),
		).toThrow('Invalid timezone')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				timezone: '',
			}),
		).toThrow('Invalid timezone')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				recurrence: { frequency: 'weekly', interval: 1, weekdays: ['MO'] },
			}),
		).toThrow('Timezone is required for recurring events')
		expect(() =>
			normalizeCreateEventInput({
				title: 'Planning',
				startTime: 1_800_000_000,
				endTime: 1_800_003_600,
				timezone: 'UTC',
				recurrence: { frequency: 'weekly', interval: 1, weekdays: ['MO', 'MO'] },
			}),
		).toThrow('Invalid recurrence')
	})

	it('requires one complete time representation', () => {
		expect(() =>
			normalizeCreateEventInput({
				title: 'Holiday',
				allDayDate: '2027-12-25',
				startTime: 1_800_000_000,
			}),
		).toThrow('Choose either an all-day date or a time range')
		expect(() => normalizeCreateEventInput({ title: 'Planning', startTime: 1_800_000_000 })).toThrow(
			'Start and end time are required',
		)
		expect(() => normalizeCreateEventInput({ title: 'Planning', endTime: 1_800_003_600 })).toThrow(
			'Start and end time are required',
		)
	})

	it('rejects every invalid recurrence shape before sending it to the provider', () => {
		const timedInput = (recurrence: unknown) => ({
			title: 'Planning',
			startTime: 1_800_000_000,
			endTime: 1_800_003_600,
			timezone: 'UTC',
			recurrence: recurrence as never,
		})

		for (const recurrence of [
			null,
			[],
			{ frequency: 'monthly', interval: 1, weekdays: ['MO'] },
			{ frequency: 'weekly', interval: 3, weekdays: ['MO'] },
			{ frequency: 'yearly', interval: 2 },
			{ frequency: 'yearly', interval: 1, weekdays: ['MO'] },
			{ frequency: 'weekly', interval: 1, weekdays: [] },
			{ frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU', 'MO'] },
			{ frequency: 'weekly', interval: 1, weekdays: ['XX'] },
		]) {
			expect(() => normalizeCreateEventInput(timedInput(recurrence))).toThrow('Invalid recurrence')
		}
	})

	it('rejects an update whose title is only whitespace', () => {
		expect(() => normalizeUpdateEventInput({ eventId: 'event#abc', title: '   ' })).toThrow(
			'Title is required',
		)
	})

	it('rejects unsafe or ambiguous update event inputs', () => {
		expect(() => normalizeUpdateEventInput({ eventId: 'event#abc' })).toThrow('No event updates provided')
		expect(() => normalizeUpdateEventInput({ eventId: 'event#abc', startTime: 0 })).toThrow(
			'Start and end time are required together',
		)
		expect(() =>
			normalizeUpdateEventInput({ eventId: 'event#abc', title: 'Rename', calendarId: '' }),
		).toThrow('Invalid calendar')
		expect(() => normalizeUpdateEventInput({ eventId: '', title: 'Rename' })).toThrow('Invalid event')
	})

	it('normalizes event id and rsvp inputs', () => {
		expect(normalizeEventIdInput({ eventId: 'event#abc', calendarId: 'primary' })).toEqual({
			eventId: 'event#abc',
			calendarId: 'primary',
		})
		expect(normalizeRsvpEventInput({ eventId: 'event#abc', status: 'maybe' })).toEqual({
			eventId: 'event#abc',
			status: 'maybe',
		})
	})

	it('rejects invalid rsvp states', () => {
		expect(() =>
			normalizeRsvpEventInput({ eventId: 'event#abc', status: 'accepted' as unknown as 'yes' }),
		).toThrow('Invalid RSVP')
	})
})
