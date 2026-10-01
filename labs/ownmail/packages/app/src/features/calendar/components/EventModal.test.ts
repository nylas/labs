import { describe, expect, it } from 'vitest'
import {
	EVENT_COMPOSER_PANEL_CLASS,
	EVENT_DIALOG_PANEL_CLASS,
	eventCalendarChoiceClass,
	eventComposerMaxHeight,
	eventHours,
	eventInitialHours,
	NEW_EVENT_HOURS,
} from './EventModal.js'

describe('EventModal helpers', () => {
	it('matches the reference default time for newly created events', () => {
		expect(NEW_EVENT_HOURS).toEqual({ startHour: 9, endHour: 10 })
		expect(eventInitialHours(new Date('2026-07-08T00:00:00'))).toEqual(NEW_EVENT_HOURS)
	})

	it('rounds event start times onto the 15-minute options the grid snaps to', () => {
		expect(eventInitialHours(new Date('2026-07-08T14:10:00'))).toEqual({
			startHour: 14.25,
			endHour: 15.25,
		})
		expect(eventInitialHours(new Date('2026-07-08T14:04:00'))).toEqual({
			startHour: 14,
			endHour: 15,
		})
	})

	it('prefills a dragged-out range with its own length instead of the one-hour default', () => {
		expect(eventInitialHours(new Date('2026-07-08T14:15:00'), true, undefined, 0.75)).toEqual({
			startHour: 14.25,
			endHour: 15,
		})
		// A range that reaches the end of the day stops at midnight.
		expect(eventInitialHours(new Date('2026-07-08T23:00:00'), true, undefined, 2)).toEqual({
			startHour: 23,
			endHour: 24,
		})
	})

	it("opens the editor on an event's real length, so saving an edit never resizes it", () => {
		const at = (time: string) => new Date(`2026-07-08T${time}:00`)
		// A resized two-and-a-quarter-hour event keeps its end.
		expect(eventHours({ start: at('09:15'), end: at('11:30') })).toEqual({ startHour: 9.25, endHour: 11.5 })
		// Off-grid provider times land on the nearest 15-minute option, never a zero length.
		expect(eventHours({ start: at('09:07'), end: at('09:10') })).toEqual({ startHour: 9, endHour: 9.25 })
		// An event running past midnight is shown to the end of its start day.
		expect(eventHours({ start: at('23:00'), end: new Date('2026-07-09T01:00:00') })).toEqual({
			startHour: 23,
			endHour: 24,
		})
		expect(
			eventHours(
				{ start: new Date('2026-07-08T13:00:00Z'), end: new Date('2026-07-08T15:00:00Z') },
				'America/Toronto',
			),
		).toEqual({ startHour: 9, endHour: 11 })
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

	it('derives modal hours in the selected calendar timezone and keeps late starts selectable', () => {
		expect(eventInitialHours(new Date('2026-07-08T13:00:00Z'), true, 'America/Toronto')).toEqual({
			startHour: 9,
			endHour: 10,
		})
		expect(eventInitialHours(new Date('2026-07-08T23:45:00'), true)).toEqual({
			startHour: 23.75,
			endHour: 24,
		})
		// The last selectable start leaves room for a 15-minute event.
		expect(eventInitialHours(new Date('2026-07-08T23:58:00'), true)).toEqual({
			startHour: 23.75,
			endHour: 24,
		})
	})

	it('marks the selected calendar choice with that calendar tinted chip, and leaves the others neutral', () => {
		// `.event-chip` reads the calendar colour set inline, so the selection is the same
		// tinted fill and uniform border the grid uses for that calendar's events.
		expect(eventCalendarChoiceClass(true).split(' ')).toEqual(
			expect.arrayContaining(['event-color', 'event-chip']),
		)
		expect(eventCalendarChoiceClass(false)).toContain('border-border')
		expect(eventCalendarChoiceClass(false)).not.toContain('event-chip')
	})

	it('uses the adaptive, scrollable event detail shell', () => {
		expect(EVENT_DIALOG_PANEL_CLASS).toBe(
			'w-full overflow-y-auto overscroll-contain bg-card sm:max-h-[85vh] sm:max-w-md',
		)
		expect(EVENT_DIALOG_PANEL_CLASS).not.toContain('relative')
	})

	it('delegates mobile and desktop composer bounds to the adaptive panel contract', () => {
		expect(EVENT_COMPOSER_PANEL_CLASS).toContain('event-composer-panel')
		expect(eventComposerMaxHeight(100)).toBe('calc(100dvh - 108px)')
		expect(eventComposerMaxHeight(-20)).toBe('calc(100dvh - 8px)')
	})
})
