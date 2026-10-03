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
export const NEW_EVENT_PREVIEW_ID = '__new-event-preview__'

export function isNewEventPreview(event: Event): boolean {
	return event.id === NEW_EVENT_PREVIEW_ID
}

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

// Building a formatter resolves locale and time-zone data through ICU and costs
// far more than formatting with one; a week view converts thousands of instants
// per render, so each time zone's formatter is built once and reused.
const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = zonedFormatters.get(timeZone)
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		})
		zonedFormatters.set(timeZone, formatter)
	}
	return formatter
}

function zonedDateTime(date: Date, timeZone: string): ZonedDateTime {
	const values = zonedFormatter(timeZone).formatToParts(date)
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

/** Returns the wall-clock hour (including minutes) for an instant in the selected timezone. */
export function calendarWallClockHour(date: Date, timeZone?: CalendarTimeZone): number {
	if (!timeZone) return date.getHours() + date.getMinutes() / 60
	const zoned = zonedDateTime(date, timeZone)
	return zoned.hour + zoned.minute / 60
}

function zonedTimeValue(date: Date, timeZone: string): number {
	const zoned = zonedDateTime(date, timeZone)
	return Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute)
}

/**
 * Finds the transition boundary following a nonexistent wall-clock time.
 *
 * Local time increases monotonically across a spring-forward transition, but
 * jumps over the missing interval. `before` and `after` bracket that jump,
 * so a minute-precision binary search finds the first valid local minute.
 */
function firstValidTimeAfterGap(target: number, timeZone: string, before: number, after: number): Date {
	let lower = before
	let upper = after
	while (upper - lower > 60_000) {
		const middle = lower + Math.floor((upper - lower) / 120_000) * 60_000
		if (zonedTimeValue(new Date(middle), timeZone) > target) upper = middle
		else lower = middle
	}
	return new Date(upper)
}

/** Converts a display-zone wall-clock slot into an instant for timezone reference labels. */
export function calendarSlotTime(day: Date, hour: number, timeZone: string): Date {
	const wholeHour = Math.floor(hour)
	const minute = Math.round((hour - wholeHour) * 60)
	const target = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), wholeHour, minute)

	// The offset immediately before and after a DST transition can differ. Try
	// each nearby offset so normal times and both sides of a fall-back overlap
	// map exactly, without relying on a fixed-point adjustment that oscillates
	// for spring-forward gaps.
	const offsets = new Set<number>()
	for (const daysFromTarget of [-2, -1, 0, 1, 2]) {
		const sample = target + daysFromTarget * 24 * 60 * 60 * 1000
		offsets.add(zonedTimeValue(new Date(sample), timeZone) - sample)
	}
	const candidates = [...offsets].map((offset) => target - offset)
	const resolved = candidates.map((instant) => ({
		instant,
		localTime: zonedTimeValue(new Date(instant), timeZone),
	}))
	const exact = resolved
		.filter(({ localTime }) => localTime === target)
		.sort((a, b) => a.instant - b.instant)[0]
	if (exact) return new Date(exact.instant)

	// A nonexistent local time lies between the old-offset candidate (before the
	// requested wall time) and new-offset candidate (after it). Normalize it to
	// the first valid local minute after the gap instead of returning either side.
	const gaps = resolved.flatMap((lower) =>
		resolved
			.filter(
				(upper) => lower.localTime < target && upper.localTime > target && lower.instant < upper.instant,
			)
			.map((upper) => ({ before: lower.instant, after: upper.instant })),
	)
	// With no exact candidate, the before/after samples above bound a gap in the
	// current IANA timezone rules.
	const gap = gaps.sort(
		/* v8 ignore next -- @preserve current IANA transitions yield one bounded gap; sorting keeps historical multi-offset data deterministic */
		(a, b) => a.after - a.before - (b.after - b.before),
	)[0] as (typeof gaps)[number]
	return firstValidTimeAfterGap(target, timeZone, gap.before, gap.after)
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
			/* v8 ignore next -- this sort runs only after the preceding filter retained both valid events -- @preserve */
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
	/** The event began before the first visible column. */
	continuesBefore: boolean
	/** The event runs past the last visible column. */
	continuesAfter: boolean
}

export function allDayEventSegments(events: Event[], columns: Date[]): AllDayEventSegment[] {
	const firstColumn = columns[0]
	const lastColumn = columns[columns.length - 1]
	const segments = events
		.map((event, index) => {
			const times = eventTimes(event)
			if (!times?.allDay) return null

			let firstDay = -1
			let lastDay = -1
			for (let dayIndex = 0; dayIndex < columns.length; dayIndex += 1) {
				const column = columns[dayIndex]
				if (!column || !eventsOnDay([event], column).length) continue
				if (firstDay === -1) firstDay = dayIndex
				lastDay = dayIndex
			}
			// A matched column proves `columns` is non-empty, so both edges exist.
			if (firstDay === -1 || !firstColumn || !lastColumn) return null

			return {
				event,
				index,
				startColumn: firstDay + 1,
				span: lastDay - firstDay + 1,
				continuesBefore: times.start.getTime() < startOfDay(firstColumn).getTime(),
				continuesAfter: times.end.getTime() > addDays(startOfDay(lastColumn), 1).getTime(),
			}
		})
		.filter((segment): segment is Omit<AllDayEventSegment, 'row'> => segment !== null)
		.sort((a, b) => {
			const aTimes = eventTimes(a.event)
			const bTimes = eventTimes(b.event)
			/* v8 ignore next -- segments are created only for events with parsed all-day times -- @preserve */
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

/** Rows of all-day events shown before the band offers an expand control. */
export const ALL_DAY_COLLAPSED_ROWS = 3

/**
 * The all-day band as drawn: every row when expanded, otherwise only the first
 * rows plus a count of the events left out, so a busy week cannot push the
 * time grid off screen and nothing disappears without a visible "N more".
 */
export function allDayBand(
	segments: AllDayEventSegment[],
	expanded: boolean,
	maxRows = ALL_DAY_COLLAPSED_ROWS,
): { segments: AllDayEventSegment[]; rowCount: number; hiddenCount: number } {
	const totalRows = segments.reduce((rows, segment) => Math.max(rows, segment.row + 1), 0)
	if (expanded || totalRows <= maxRows) return { segments, rowCount: totalRows, hiddenCount: 0 }
	const visible = segments.filter((segment) => segment.row < maxRows)
	return { segments: visible, rowCount: maxRows, hiddenCount: segments.length - visible.length }
}

/** Most hidden calendar ids one event request carries; the rest are still filtered on the client. */
export const MAX_HIDDEN_CALENDAR_IDS_PER_REQUEST = 25

/** Canonical (unique, sorted, capped) hidden-calendar list, so equal choices share one cache entry. */
export function hiddenCalendarIdsForRequest(ids: readonly string[]): string[] {
	return [...new Set(ids)].sort().slice(0, MAX_HIDDEN_CALENDAR_IDS_PER_REQUEST)
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

type TimedLayoutOptions = {
	startHour: number
	endHour: number
	hourHeight: number
	timeZone?: CalendarTimeZone
}

/** Wall-clock hours an event occupies on `day`, clipped to the visible hours; null when it is not drawn. */
function timedEventHours(
	event: Event,
	day: Date,
	options: TimedLayoutOptions,
): { start: number; end: number } | null {
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
		return { start: startDecimal, end: endDecimal }
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
	return { start: relativeDecimalHour(start), end: relativeDecimalHour(end) }
}

function verticalBox(hours: { start: number; end: number }, options: TimedLayoutOptions) {
	return {
		top: (hours.start - options.startHour) * options.hourHeight,
		height: Math.max((hours.end - hours.start) * options.hourHeight - 2, 20),
	}
}

export function timedEventLayout(
	event: Event,
	day: Date,
	options: TimedLayoutOptions,
): { top: number; height: number } | null {
	const hours = timedEventHours(event, day, options)
	return hours ? verticalBox(hours, options) : null
}

/** One timed event as drawn in a day column. `left` and `width` are fractions of the column. */
export type TimedEventBox = { event: Event; top: number; height: number; left: number; width: number }

/**
 * Lays out a day's timed events so concurrent ones sit side by side instead of
 * covering each other. Events that overlap, directly or through a chain of
 * others, form a cluster; each takes the first column free at its start, the
 * cluster's column count sets the width, and an event widens into columns to
 * its right that stay empty for its whole duration. Overlap is judged on the
 * wall-clock position that is drawn, so both passes of a repeated daylight
 * saving hour are separated, and back-to-back events never share a cluster.
 */
export function timedDayLayout(events: Event[], day: Date, options: TimedLayoutOptions): TimedEventBox[] {
	type Placed = { event: Event; start: number; end: number; column: number }
	const placed = events
		.flatMap((event) => {
			const hours = timedEventHours(event, day, options)
			return hours ? [{ event, ...hours, column: 0 }] : []
		})
		.sort((a, b) => a.start - b.start || b.end - a.end)

	const boxes: TimedEventBox[] = []
	let cluster: Placed[] = []
	let columnEnds: number[] = []
	const flush = () => {
		const columns = columnEnds.length
		for (const item of cluster) {
			let span = 1
			while (
				item.column + span < columns &&
				!cluster.some(
					(other) => other.column === item.column + span && other.start < item.end && other.end > item.start,
				)
			)
				span += 1
			boxes.push({
				event: item.event,
				...verticalBox(item, options),
				left: item.column / columns,
				width: span / columns,
			})
		}
		cluster = []
		columnEnds = []
	}
	for (const item of placed) {
		if (columnEnds.every((columnEnd) => columnEnd <= item.start)) flush()
		const free = columnEnds.findIndex((columnEnd) => columnEnd <= item.start)
		item.column = free === -1 ? columnEnds.length : free
		columnEnds[item.column] = item.end
		cluster.push(item)
	}
	flush()
	return boxes
}

/**
 * Shortest chip that still fits a title line above a time line: two borders
 * (2px), block padding (8px), a 15px title line and a 14px time line. Anything
 * shorter is drawn as one centred line, down to the 20px minimum chip, whose
 * 18px inner height holds one 16px line with nothing clipped.
 */
export const TIMED_CHIP_TWO_LINE_MIN_HEIGHT = 40

/** Whether a timed chip of this height shows the title over the time range, or one compact line. */
export function timedChipLines(height: number): 1 | 2 {
	return height >= TIMED_CHIP_TWO_LINE_MIN_HEIGHT ? 2 : 1
}

/** Events this long or shorter show only their title; the time stays in the accessible name. */
export const TIMED_CHIP_TITLE_ONLY_MAX_MINUTES = 30

/** Whether a timed chip draws its time: a short event has no room to spare, so it shows the title alone. */
export function timedChipShowsTime(times: { start: Date; end: Date }): boolean {
	return times.end.getTime() - times.start.getTime() > TIMED_CHIP_TITLE_ONLY_MAX_MINUTES * 60_000
}

/** Height of the now-line time badge in the gutter, in pixels. */
export const NOW_BADGE_HEIGHT = 16

/**
 * True when the now-line time badge would be drawn over a gutter label, so the
 * label is hidden rather than leaving two half-readable times on top of each
 * other. Offsets are pixels from the top of the grid; the badge is centred on
 * the now line.
 */
export function nowBadgeCoversLabel(nowOffset: number, labelCentre: number, labelHeight: number): boolean {
	return Math.abs(nowOffset - labelCentre) < (NOW_BADGE_HEIGHT + labelHeight) / 2
}

/**
 * True once an event has ended, so finished meetings can recede. Unparseable
 * events are never past. A timed event ends at an instant, which is the same
 * everywhere. An all-day event has no instant: it covers whole calendar dates,
 * so it ends when the date in the display timezone reaches its (exclusive) end
 * date, whatever timezone the browser itself is in.
 */
export function isPastEvent(event: Event, now: Date, timeZone?: CalendarTimeZone): boolean {
	const times = eventTimes(event)
	if (!times) return false
	if (!times.allDay) return times.end.getTime() <= now.getTime()
	return compareYmd(ymd(times.end), ymd(calendarDateInTimeZone(now, timeZone))) <= 0
}

/**
 * The short zone name for the time gutter, e.g. "EDT". It follows the instant,
 * so the label switches with daylight saving time.
 */
export function timeZoneShortName(timeZone: string, at: Date, locale?: string): string {
	return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', timeZoneName: 'short' })
		.formatToParts(at)
		.filter((part) => part.type === 'timeZoneName')
		.map((part) => part.value)
		.join('')
}

/** The city part of an IANA zone id, for people to read: "America/New_York" is "New York". */
export function timezoneCity(timeZone: string): string {
	return timeZone.replace(/^.*\//, '').replaceAll('_', ' ')
}

/** Minutes the zone's wall clock is ahead of UTC at an instant. */
function timeZoneOffsetMinutes(timeZone: string, at: Date): number {
	const wholeMinute = Math.floor(at.getTime() / 60_000) * 60_000
	return Math.round((zonedTimeValue(new Date(wholeMinute), timeZone) - wholeMinute) / 60_000)
}

/**
 * How far the second zone's clock is from the first's at an instant: "+5h",
 * "−3h", "+5.5h", or "Same time". It follows the instant, so it changes when
 * only one of the two zones moves to or from daylight saving time.
 */
export function timeZoneOffsetLabel(primaryTimezone: string, timeZone: string, at: Date): string {
	const minutes = timeZoneOffsetMinutes(timeZone, at) - timeZoneOffsetMinutes(primaryTimezone, at)
	if (minutes === 0) return 'Same time'
	// A true minus sign, so "−3h" reads as a negative offset and not a hyphen.
	return `${minutes > 0 ? '+' : '−'}${Number((Math.abs(minutes) / 60).toFixed(2))}h`
}

/** Working hours in a second zone run from 7 AM until 10 PM there; anything else is shaded. */
export const WORKING_HOURS = { start: 7, end: 22 }

/** True when an instant falls before 7 AM or from 10 PM in the zone, when someone there is unlikely to be working. */
export function isOutsideWorkingHours(at: Date, timeZone: string): boolean {
	const hour = zonedDateTime(at, timeZone).hour
	return hour < WORKING_HOURS.start || hour >= WORKING_HOURS.end
}

/**
 * The mark on the second ruler's hour label where that zone crosses midnight
 * between two instants, so its times are not read as the column's day; null
 * when it is the same date there. One day shown: the weekday it moves into
 * ("Sat"). Several days share one ruler, so a weekday would be right for one
 * column only; the mark then says how that date relates to the column's own.
 */
export function timeZoneDayChange(
	previous: Date,
	at: Date,
	primaryTimezone: string,
	timeZone: string,
	days: number,
): string | null {
	if (zonedYmd(previous, timeZone) === zonedYmd(at, timeZone)) return null
	if (days === 1) return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short' }).format(at)
	const offset = dayOffset(zonedYmd(at, primaryTimezone), zonedYmd(at, timeZone))
	if (offset === 0) return 'Same day'
	return offset > 0 ? 'Next day' : 'Prev day'
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

export type AgendaEntry = { event: Event; start: Date; inProgress: boolean }

/**
 * Today's timed events that still matter at `now`, ordered by start time. Ended
 * events are excluded so "Up next" never lists a meeting that is already over;
 * an event that has started but not ended is flagged as in progress.
 */
export function upcomingAgenda(
	events: Event[],
	now: Date,
	timeZone?: CalendarTimeZone,
	limit = 5,
): AgendaEntry[] {
	const nowMs = now.getTime()
	return timedEventsOnDay(events, calendarDateInTimeZone(now, timeZone), timeZone)
		.filter((event) => !isNewEventPreview(event))
		.flatMap((event) => {
			// timedEventsOnDay only returns events with parsed, timed values.
			const times = eventTimes(event) as EventTimes
			if (times.end.getTime() <= nowMs) return []
			return [{ event, start: times.start, inProgress: times.start.getTime() <= nowMs }]
		})
		.sort((a, b) => a.start.getTime() - b.start.getTime())
		.slice(0, limit)
}

/** First visible hour of the time grid: an hour before now when today is shown, otherwise 8am. */
export function initialTimeGridScrollHour(
	columnIsos: readonly string[],
	todayIso: string,
	nowHour: number,
): number {
	if (!columnIsos.includes(todayIso)) return 8
	return Math.min(Math.max(0, Math.floor(nowHour) - 1), 23)
}
