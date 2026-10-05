import { calendarSlotOccurrences, ymd } from './calendar.js'

/** Date inputs are checked before reaching the timezone resolver. */
export function validEditorDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00`)
	return !Number.isNaN(date.getTime()) && date.getFullYear() >= 100 && ymd(date) === value
}

export function editorDateOffset(date: string, days: number): string {
	if (!validEditorDate(date) || !Number.isInteger(days) || Math.abs(days) > 3660) return ''
	const value = new Date(`${date}T00:00:00`)
	value.setDate(value.getDate() + days)
	return ymd(value)
}

export function editorDayDifference(start: string, end: string): number | null {
	if (!validEditorDate(start) || !validEditorDate(end)) return null
	return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
}

export function editorOccurrences(date: string, hour: number, timeZone: string): Date[] {
	if (!validEditorDate(date) || !Number.isFinite(hour) || hour < 0 || hour > 24 * 3660) return []
	return calendarSlotOccurrences(new Date(`${date}T00:00:00`), hour, timeZone)
}

export function selectedOccurrence(candidates: Date[], choice: number | null): Date | null {
	if (candidates.length === 1) return candidates[0] as Date
	return candidates.find((candidate) => candidate.getTime() === choice) ?? null
}

export function occurrenceLabel(instant: Date, index: number, timeZone: string): string {
	const time = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'longOffset',
	})
		.format(instant)
		.replace('GMT', 'UTC')
	return `${index === 0 ? 'First' : 'Second'} ${time}`
}

export function editorTimeZoneLabel(timeZone: string, date: Date): string {
	const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' })
		.formatToParts(date)
		.filter((part) => part.type === 'timeZoneName')
		.map((part) => part.value)
		.join('')
	return `Times shown in ${timeZone} · ${name}`
}
