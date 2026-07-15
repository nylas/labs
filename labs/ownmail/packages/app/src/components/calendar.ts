import type { Event } from '@nylas-labs/cli-kit/v3'

export type CalView = 'month' | 'week' | 'day'
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

/** True only for a real local calendar date in `YYYY-MM-DD` form. */
export function isCalendarDate(value: unknown): value is string {
	return localDate(value) !== null
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

/** What a keyboard shortcut asks the calendar to do, or null when the key is unbound. */
export type CalendarKeyAction =
	| { kind: 'view'; view: CalView }
	| { kind: 'shift'; direction: 1 | -1 }
	| { kind: 'today' }
	| { kind: 'new' }

/**
 * Map a keyboard key to a calendar action. `m`/`w`/`d` switch views, `[`/`]`
 * and the left/right arrows page the visible range, `t` jumps to today, and
 * `n` opens a blank event editor. Letters are case-insensitive.
 */
export function calendarKeyAction(key: string): CalendarKeyAction | null {
	const lower = key.toLowerCase()
	if (lower === 'm') return { kind: 'view', view: 'month' }
	if (lower === 'w') return { kind: 'view', view: 'week' }
	if (lower === 'd') return { kind: 'view', view: 'day' }
	if (lower === 't') return { kind: 'today' }
	if (lower === 'n') return { kind: 'new' }
	if (key === 'ArrowLeft' || key === '[') return { kind: 'shift', direction: -1 }
	if (key === 'ArrowRight' || key === ']') return { kind: 'shift', direction: 1 }
	return null
}

/**
 * Move a focused calendar day using the conventional grid keys. This is kept
 * separate from view paging so arrow keys inside a calendar grid never page
 * the whole calendar unexpectedly.
 */
export function moveCalendarDay(current: Date, key: string): Date | null {
	if (key === 'ArrowLeft') return addDays(current, -1)
	if (key === 'ArrowRight') return addDays(current, 1)
	if (key === 'ArrowUp') return addDays(current, -7)
	if (key === 'ArrowDown') return addDays(current, 7)
	if (key === 'Home') return addDays(current, -current.getDay())
	if (key === 'End') return addDays(current, 6 - current.getDay())
	if (key === 'PageUp') return new Date(current.getFullYear(), current.getMonth() - 1, current.getDate())
	if (key === 'PageDown') return new Date(current.getFullYear(), current.getMonth() + 1, current.getDate())
	return null
}

export type EventTimes = { start: Date; end: Date; allDay: boolean }
export type CalendarTimeZone = string | undefined

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUnixTimestamp(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function localDate(value: unknown): Date | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
	const date = new Date(`${value}T00:00:00`)
	return Number.isNaN(date.getTime()) || ymd(date) !== value ? null : date
}

/** Returns parsed display times only for a complete, supported Nylas `when` value. */
export function eventTimes(event: unknown): EventTimes | null {
	if (!isRecord(event) || !isRecord(event.when)) return null
	const when = event.when

	if (isUnixTimestamp(when.start_time) && isUnixTimestamp(when.end_time) && when.end_time > when.start_time) {
		return {
			start: new Date(when.start_time * 1000),
			end: new Date(when.end_time * 1000),
			allDay: false,
		}
	}
	if (isUnixTimestamp(when.time)) {
		const start = new Date(when.time * 1000)
		return { start, end: new Date(start.getTime() + 60_000), allDay: false }
	}
	const date = localDate(when.date)
	if (date) return { start: date, end: addDays(date, 1), allDay: true }

	const start = localDate(when.start_date)
	const end = localDate(when.end_date)
	if (start && end && end > start) return { start, end, allDay: true }
	return null
}

/** Runtime boundary guard for calendar data returned by external APIs. */
export function isRenderableCalendarEvent(value: unknown): value is Event {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		!value.id ||
		(value.calendar_id !== undefined && typeof value.calendar_id !== 'string')
	)
		return false
	return eventTimes(value) !== null
}

type ZonedDateTime = { year: number; month: number; day: number; hour: number; minute: number }

function zonedDateTime(date: Date, timeZone: string): ZonedDateTime {
	const values = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(date)
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(values.find((value) => value.type === type)?.value)
	return {
		year: part('year'),
		month: part('month'),
		day: part('day'),
		hour: part('hour'),
		minute: part('minute'),
	}
}

function zonedYmd(date: Date, timeZone: string): string {
	const zoned = zonedDateTime(date, timeZone)
	return `${zoned.year}-${String(zoned.month).padStart(2, '0')}-${String(zoned.day).padStart(2, '0')}`
}

/** A plain calendar date for an instant in the selected display timezone. */
export function calendarDateInTimeZone(date: Date, timeZone?: CalendarTimeZone): Date {
	if (!timeZone) return startOfDay(date)
	const zoned = zonedDateTime(date, timeZone)
	return new Date(zoned.year, zoned.month - 1, zoned.day)
}

/** Converts a display-zone wall-clock slot into an instant for timezone reference labels. */
export function calendarSlotTime(day: Date, hour: number, timeZone: string): Date {
	const target = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour)
	let instant = target
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const actual = zonedDateTime(new Date(instant), timeZone)
		const actualTime = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
		instant += target - actualTime
	}
	return new Date(instant)
}

function compareYmd(a: string, b: string): number {
	return a.localeCompare(b)
}

function dayOffset(from: string, to: string): number {
	const [fromYear = 0, fromMonth = 0, fromDay = 0] = from.split('-').map(Number)
	const [toYear = 0, toMonth = 0, toDay = 0] = to.split('-').map(Number)
	return (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000
}

function timedEventOnDay(times: EventTimes, day: Date, timeZone: string): boolean {
	const dayIso = ymd(day)
	const end = zonedDateTime(times.end, timeZone)
	const startIso = zonedYmd(times.start, timeZone)
	const endIso = zonedYmd(times.end, timeZone)
	return (
		compareYmd(startIso, dayIso) <= 0 &&
		(compareYmd(endIso, dayIso) > 0 || (endIso === dayIso && (end.hour > 0 || end.minute > 0)))
	)
}

export function eventsOnDay(events: Event[], day: Date, timeZone?: CalendarTimeZone): Event[] {
	const dayStart = startOfDay(day).getTime()
	const dayEnd = dayStart + 24 * 60 * 60 * 1000
	return events
		.filter((e) => {
			const times = eventTimes(e)
			if (!times) return false
			const { start, end } = times
			if (timeZone && !times.allDay) return timedEventOnDay(times, day, timeZone)
			return start.getTime() < dayEnd && end.getTime() > dayStart
		})
		.sort((a, b) => {
			const aTimes = eventTimes(a)
			const bTimes = eventTimes(b)
			/* v8 ignore next -- this sort runs only after the preceding filter retained both valid events */
			if (!aTimes || !bTimes) return 0
			return Number(bTimes.allDay) - Number(aTimes.allDay) || aTimes.start.getTime() - bTimes.start.getTime()
		})
}

export type AllDayEventSegment = {
	event: Event
	index: number
	row: number
	startColumn: number
	span: number
}

export function allDayEventSegments(events: Event[], columns: Date[]): AllDayEventSegment[] {
	const segments = events
		.map((event, index) => {
			if (!eventTimes(event)?.allDay) return null

			let firstDay = -1
			let lastDay = -1
			for (let dayIndex = 0; dayIndex < columns.length; dayIndex += 1) {
				const column = columns[dayIndex]
				if (!column || !eventsOnDay([event], column).length) continue
				if (firstDay === -1) firstDay = dayIndex
				lastDay = dayIndex
			}
			if (firstDay === -1) return null

			return {
				event,
				index,
				startColumn: firstDay + 1,
				span: lastDay - firstDay + 1,
			}
		})
		.filter((segment): segment is Omit<AllDayEventSegment, 'row'> => segment !== null)
		.sort((a, b) => {
			const aTimes = eventTimes(a.event)
			const bTimes = eventTimes(b.event)
			/* v8 ignore next -- segments are created only for events with parsed all-day times */
			if (!aTimes || !bTimes) return 0
			return (
				a.startColumn - b.startColumn ||
				b.span - a.span ||
				aTimes.start.getTime() - bTimes.start.getTime() ||
				(a.event.title ?? '').localeCompare(b.event.title ?? '')
			)
		})

	const rowEnds: number[] = []
	return segments.map((segment) => {
		const endColumn = segment.startColumn + segment.span - 1
		let row = rowEnds.findIndex((rowEnd) => segment.startColumn > rowEnd)
		if (row === -1) row = rowEnds.length
		rowEnds[row] = endColumn
		return { ...segment, row }
	})
}

export function filterEventsByCalendars(events: Event[], hiddenCalendarIds: ReadonlySet<string>): Event[] {
	if (hiddenCalendarIds.size === 0 && events.every(isRenderableCalendarEvent)) return events
	return events.filter(
		(event) =>
			isRenderableCalendarEvent(event) &&
			(hiddenCalendarIds.size === 0 || !event.calendar_id || !hiddenCalendarIds.has(event.calendar_id)),
	)
}

export function timedEventsOnDay(events: Event[], day: Date, timeZone?: CalendarTimeZone): Event[] {
	return eventsOnDay(events, day, timeZone).filter((event) => eventTimes(event)?.allDay === false)
}

export function timedEventLayout(
	event: Event,
	day: Date,
	options: { startHour: number; endHour: number; hourHeight: number; timeZone?: CalendarTimeZone },
): { top: number; height: number } | null {
	const times = eventTimes(event)
	if (!times || times.allDay) return null
	if (options.timeZone) {
		if (!timedEventOnDay(times, day, options.timeZone)) return null
		const dayIso = ymd(day)
		const relativeDecimalHour = (date: Date) => {
			const zoned = zonedDateTime(date, options.timeZone as string)
			return (
				dayOffset(dayIso, zonedYmd(date, options.timeZone as string)) * 24 + zoned.hour + zoned.minute / 60
			)
		}
		const startDecimal = Math.max(relativeDecimalHour(times.start), options.startHour)
		const endDecimal = Math.min(relativeDecimalHour(times.end), options.endHour)
		if (endDecimal <= startDecimal) return null
		return {
			top: (startDecimal - options.startHour) * options.hourHeight,
			height: Math.max((endDecimal - startDecimal) * options.hourHeight - 2, 20),
		}
	}

	const visibleStart = dateWithHour(startOfDay(day), options.startHour)
	const visibleEnd = dateWithHour(startOfDay(day), options.endHour)
	const start = new Date(Math.max(times.start.getTime(), visibleStart.getTime()))
	const end = new Date(Math.min(times.end.getTime(), visibleEnd.getTime()))
	if (end <= start) return null

	const dayStart = startOfDay(day)
	const relativeDecimalHour = (date: Date) => {
		const calendarDayOffset = Math.round(
			(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
				Date.UTC(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate())) /
				86_400_000,
		)
		return calendarDayOffset * 24 + date.getHours() + date.getMinutes() / 60
	}
	const startDecimal = relativeDecimalHour(start)
	const endDecimal = relativeDecimalHour(end)
	return {
		top: (startDecimal - options.startHour) * options.hourHeight,
		height: Math.max((endDecimal - startDecimal) * options.hourHeight - 2, 20),
	}
}

export function fmtTime(d: Date, timeZone?: CalendarTimeZone): string {
	return fmtCompactTime(d, timeZone)
}

export function fmtAgendaTime(d: Date, timeZone?: CalendarTimeZone): string {
	if (timeZone) {
		const zoned = zonedDateTime(d, timeZone)
		return `${zoned.hour}:${String(zoned.minute).padStart(2, '0')}`
	}
	return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtCompactTime(d: Date, timeZone?: CalendarTimeZone): string {
	const zoned = timeZone ? zonedDateTime(d, timeZone) : null
	const hour = zoned?.hour ?? d.getHours()
	const minute = zoned?.minute ?? d.getMinutes()
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
