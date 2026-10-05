import { describe, expect, it } from 'vitest'
import {
	editorDateOffset,
	editorDayDifference,
	editorOccurrences,
	editorTimeZoneLabel,
	occurrenceLabel,
	selectedOccurrence,
	validEditorDate,
} from './event-editor-time.js'

describe('event editor dates and exact timezone occurrences', () => {
	it('validates date inputs and bounds offset arithmetic', () => {
		for (const date of ['', '2026-02-30', '2026-1-01', '0000-01-01'])
			expect(validEditorDate(date)).toBe(false)
		expect(validEditorDate('2028-02-29')).toBe(true)
		expect(editorDateOffset('2026-12-31', 1)).toBe('2027-01-01')
		for (const offset of [NaN, 0.5, 3661]) expect(editorDateOffset('2026-01-01', offset)).toBe('')
		expect(editorDateOffset('', 1)).toBe('')
		expect(editorDayDifference('2026-03-07', '2026-03-09')).toBe(2)
		expect(editorDayDifference('', '2026-01-01')).toBeNull()
		expect(editorDayDifference('2026-01-01', '')).toBeNull()
	})

	it('fails closed for gaps and returns every occurrence during a repeated hour', () => {
		expect(editorOccurrences('2026-03-08', 2.5, 'America/Toronto')).toEqual([])
		const repeated = editorOccurrences('2026-11-01', 1.5, 'America/Toronto')
		expect(repeated.map((date) => date.toISOString())).toEqual([
			'2026-11-01T05:30:00.000Z',
			'2026-11-01T06:30:00.000Z',
		])
		expect(selectedOccurrence(repeated, null)).toBeNull()
		expect(selectedOccurrence(repeated, (repeated[1] as Date).getTime())).toEqual(repeated[1])
		expect(
			selectedOccurrence(editorOccurrences('2026-07-08', 9, 'America/Toronto'), null)?.toISOString(),
		).toBe('2026-07-08T13:00:00.000Z')
		expect(selectedOccurrence([], null)).toBeNull()
	})

	it('rejects invalid date and hour boundaries before timezone resolution', () => {
		expect(editorOccurrences('', 9, 'UTC')).toEqual([])
		for (const hour of [NaN, -1, 24 * 3660 + 1])
			expect(editorOccurrences('2026-07-08', hour, 'UTC')).toEqual([])
	})

	it('labels the city timezone and distinguishes repeated offsets', () => {
		const occurrences = editorOccurrences('2026-11-01', 1.5, 'America/Toronto')
		expect(occurrenceLabel(occurrences[0] as Date, 0, 'America/Toronto')).toBe('First 1:30 AM UTC-04:00')
		expect(occurrenceLabel(occurrences[1] as Date, 1, 'America/Toronto')).toBe('Second 1:30 AM UTC-05:00')
		expect(editorTimeZoneLabel('America/Toronto', new Date('2026-07-08T13:00:00Z'))).toBe(
			'Times shown in America/Toronto · Eastern Time',
		)
	})
})
