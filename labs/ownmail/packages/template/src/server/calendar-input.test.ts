import { describe, expect, it } from 'vitest'
import {
	normalizeCreateEventInput,
	normalizeEventIdInput,
	normalizeEventRangeInput,
	normalizeRsvpEventInput,
	normalizeUpdateEventInput,
} from './calendar-input.js'

describe('calendar input validation', () => {
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
