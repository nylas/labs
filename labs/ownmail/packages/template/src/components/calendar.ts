import type { Event } from '@nylas-labs/cli-kit/v3'

export type CalView = 'month' | 'week' | 'day'
export const CALENDAR_HOME_PATH = '/calendar'
export const DEFAULT_CALENDAR_VIEW: CalView = 'week'

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
]
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function isCalView(value: string): value is CalView {
	return value === 'month' || value === 'week' || value === 'day'
}

/** [start, end) of the visible range for a view, in local time. */
export function viewRange(view: CalView, anchor: Date): { start: Date; end: Date } {
	if (view === 'day') {
		const start = startOfDay(anchor)
		return { start, end: addDays(start, 1) }
	}
	if (view === 'week') {
		const start = startOfWeek(anchor)
		return { start, end: addDays(start, 7) }
	}
	// Reference month grid is always 6x7, starting with the week containing the 1st.
	const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
	const start = startOfWeek(first)
	return { start, end: addDays(start, 42) }
}

export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Sunday-based week start. */
export function startOfWeek(d: Date): Date {
	const day = startOfDay(d)
	day.setDate(day.getDate() - day.getDay())
	return day
}

export function addDays(d: Date, days: number): Date {
	const next = new Date(d)
	next.setDate(next.getDate() + days)
	return next
}

export function shiftAnchor(view: CalView, anchor: Date, direction: 1 | -1): Date {
	if (view === 'day') return addDays(anchor, direction)
	if (view === 'week') return addDays(anchor, 7 * direction)
	return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
}

export function eventTimes(event: Event): { start: Date; end: Date; allDay: boolean } {
	const when = event.when
	if ('start_time' in when) {
		return { start: new Date(when.start_time * 1000), end: new Date(when.end_time * 1000), allDay: false }
	}
	if ('date' in when) {
		const start = new Date(`${when.date}T00:00:00`)
		return { start, end: addDays(start, 1), allDay: true }
	}
	return {
		start: new Date(`${when.start_date}T00:00:00`),
		end: addDays(new Date(`${when.end_date}T00:00:00`), 1),
		allDay: true,
	}
}

export function eventsOnDay(events: Event[], day: Date): Event[] {
	const dayStart = startOfDay(day).getTime()
	const dayEnd = dayStart + 24 * 60 * 60 * 1000
	return events
		.filter((e) => {
			const { start, end } = eventTimes(e)
			return start.getTime() < dayEnd && end.getTime() > dayStart
		})
		.sort((a, b) => eventTimes(a).start.getTime() - eventTimes(b).start.getTime())
}

export function filterEventsByCalendars(events: Event[], hiddenCalendarIds: ReadonlySet<string>): Event[] {
	if (hiddenCalendarIds.size === 0) return events
	return events.filter((event) => !event.calendar_id || !hiddenCalendarIds.has(event.calendar_id))
}

export function timedEventsOnDay(events: Event[], day: Date): Event[] {
	return eventsOnDay(events, day).filter((event) => !eventTimes(event).allDay)
}

export function fmtTime(d: Date): string {
	return fmtCompactTime(d)
}

export function fmtAgendaTime(d: Date): string {
	return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtCompactTime(d: Date): string {
	const hour = d.getHours()
	const minute = d.getMinutes()
	const period = hour >= 12 ? 'PM' : 'AM'
	const displayHour = hour % 12 === 0 ? 12 : hour % 12
	return minute === 0
		? `${displayHour} ${period}`
		: `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

export function dateWithHour(day: Date, hour: number): Date {
	const next = new Date(day)
	const wholeHour = Math.floor(hour)
	next.setHours(wholeHour, Math.round((hour - wholeHour) * 60), 0, 0)
	return next
}

export function formatFullDate(d: Date, withYear = false): string {
	const base = `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
	return withYear ? `${base}, ${d.getFullYear()}` : base
}

export function ymd(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
