import { describe, expect, it } from 'vitest'
import {
	EVENT_DIALOG_PANEL_CLASS,
	eventCalendarChoiceClass,
	eventInitialHours,
	NEW_EVENT_HOURS,
} from './EventModal.js'

describe('EventModal helpers', () => {
	it('matches the reference default time for newly created events', () => {
		expect(NEW_EVENT_HOURS).toEqual({ startHour: 9, endHour: 10 })
		expect(eventInitialHours(new Date('2026-07-08T00:00:00'))).toEqual(NEW_EVENT_HOURS)
	})

	it('rounds event start times onto reference half-hour options', () => {
		expect(eventInitialHours(new Date('2026-07-08T14:10:00'))).toEqual({
			startHour: 14,
			endHour: 15,
		})
	})

	it('prefills newly created events from the clicked calendar slot hour', () => {
		expect(eventInitialHours(new Date('2026-07-08T14:30:00'))).toEqual({
			startHour: 14.5,
			endHour: 15.5,
		})
	})

	it('keeps an 11 PM slot and offers midnight as its end boundary', () => {
		expect(eventInitialHours(new Date('2026-07-08T23:00:00'))).toEqual({ startHour: 23, endHour: 24 })
	})

	it('keeps a midnight slot instead of replacing it with the daytime default', () => {
		expect(eventInitialHours(new Date('2026-07-08T00:00:00'), true)).toEqual({ startHour: 0, endHour: 1 })
	})

	it('keeps the reference event-colored outline on the selected calendar choice', () => {
		const className = eventCalendarChoiceClass(true, 'teal')

		expect(className).toContain('border-[var(--event-teal)]')
		expect(className).not.toContain('border-transparent')
	})

	it('matches the reference dialog panel shell', () => {
		expect(EVENT_DIALOG_PANEL_CLASS).toBe(
			'w-full max-w-md overflow-hidden rounded-sm border border-border bg-card shadow-2xl',
		)
		expect(EVENT_DIALOG_PANEL_CLASS).not.toContain('relative')
	})
})
