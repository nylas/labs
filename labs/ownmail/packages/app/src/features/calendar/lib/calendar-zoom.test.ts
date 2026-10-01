import { describe, expect, it } from 'vitest'
import { CALENDAR_HOUR_HEIGHTS } from '#app/preferences/user-preferences'
import { hourHeightLabel, rescaledScrollTop, stepHourHeight } from './calendar-zoom.js'

describe('grid zoom steps', () => {
	it('moves one step at a time so zoom never skips a size', () => {
		expect(stepHourHeight(52, 1)).toBe(64)
		expect(stepHourHeight(52, -1)).toBe(40)
	})

	it('stops at both ends of the scale instead of wrapping around', () => {
		expect(stepHourHeight(40, -1)).toBeNull()
		expect(stepHourHeight(80, 1)).toBeNull()
	})

	it('names every step, so the level is never conveyed by size alone', () => {
		expect(CALENDAR_HOUR_HEIGHTS.map(hourHeightLabel)).toEqual(['Compact', 'Default', 'Roomy', 'Spacious'])
	})

	it('keeps the hour at the top of the viewport in place when the grid is rescaled', () => {
		// 9 AM at 52px per hour is 468px down; at 80px per hour it is 720px down.
		expect(rescaledScrollTop(9 * 52, 52, 80)).toBe(9 * 80)
		expect(rescaledScrollTop(0, 52, 40)).toBe(0)
	})
})
