import { describe, expect, it } from 'vitest'
import { eventInitialHours, NEW_EVENT_HOURS } from './EventModal.js'

describe('EventModal helpers', () => {
	it('matches the reference default time for newly created events', () => {
		expect(NEW_EVENT_HOURS).toEqual({ startHour: 9, endHour: 10 })
	})

	it('rounds existing event start times onto reference half-hour options', () => {
		expect(eventInitialHours(new Date('2026-07-08T14:10:00'))).toEqual({
			startHour: 14,
			endHour: 15,
		})
	})
})
