import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import {
	addDays,
	calendarDateInTimeZone,
	calendarSlotTime,
	calendarWallClockHour,
	eventTimes,
	fmtTime,
	NEW_EVENT_PREVIEW_ID,
	ymd,
} from './calendar.js'

/** Every dragged or nudged time lands on this step. */
export const DRAG_SNAP_MINUTES = 15
const SNAP_SECONDS = DRAG_SNAP_MINUTES * 60
const DAY_MINUTES = 24 * 60

/** Pointer travel, in pixels, before a press becomes a drag. Below it the press stays a click. */
export const DRAG_THRESHOLD_PX = 4

/** Optimistic events have no provider id yet, so they cannot be updated. */
const OPTIMISTIC_EVENT_ID_PREFIX = 'optimistic-event-'

export type DragKind = 'create' | 'move' | 'resize-start' | 'resize-end'

/** A position in the time grid: a day column and unsnapped minutes from that day's midnight. */
export type GridSlot = { day: number; minutes: number }

/** A start and end in Unix seconds. */
export type TimeRange = { start: number; end: number }

export type GridRect = { left: number; right: number; top: number; bottom: number }

/** Where the day columns are on screen, and the part of the grid that is actually visible. */
export type GridGeometry = { columns: GridRect[]; visible: GridRect }

export type DragContext = { columns: readonly Date[]; timeZone: string }

/** What is being shown in place of the stored times while a drag or keyboard adjustment is open. */
export type DragPreview = { eventId: string | null; range: TimeRange }

export function snapMinutes(minutes: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
	return Math[mode](minutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES
}

/**
 * The grid slot under a pointer, or null when the pointer is outside the grid:
 * beyond the visible body (over the sticky header, the sidebar, the page) or in
 * the time gutter. A drag released on null is cancelled.
 */
export function pointToSlot(
	point: { x: number; y: number },
	geometry: GridGeometry,
	hourHeight: number,
): GridSlot | null {
	const { visible } = geometry
	if (point.x < visible.left || point.x > visible.right || point.y < visible.top || point.y > visible.bottom)
		return null
	const day = geometry.columns.findIndex((column) => point.x >= column.left && point.x < column.right)
	const column = geometry.columns[day]
	if (!column) return null
	const minutes = ((point.y - column.top) / hourHeight) * 60
	return { day, minutes: Math.min(DAY_MINUTES, Math.max(0, minutes)) }
}

function slotSeconds(day: Date, minutes: number, timeZone: string): number {
	return Math.floor(calendarSlotTime(day, minutes / 60, timeZone).getTime() / 1000)
}

function wallClock(seconds: number, timeZone: string): { day: Date; minutes: number } {
	const date = new Date(seconds * 1000)
	return {
		day: calendarDateInTimeZone(date, timeZone),
		minutes: Math.round(calendarWallClockHour(date, timeZone) * 60),
	}
}

/** The range a new event covers when dragged out from `origin` to `current` in one day column. */
export function createRange(origin: GridSlot, current: GridSlot, context: DragContext): TimeRange {
	const day = context.columns[origin.day] as Date
	const anchor = Math.min(snapMinutes(origin.minutes, 'floor'), DAY_MINUTES - DRAG_SNAP_MINUTES)
	const start = Math.min(anchor, snapMinutes(current.minutes, 'floor'))
	const end = Math.max(anchor + DRAG_SNAP_MINUTES, snapMinutes(current.minutes, 'ceil'))
	return {
		start: slotSeconds(day, start, context.timeZone),
		end: slotSeconds(day, end, context.timeZone),
	}
}

/**
 * The times an existing event takes when dragged from `origin` to `current`.
 * A move keeps the event's length and its wall-clock time across days (so a
 * daylight saving change does not shift it); a resize changes one edge within
 * the column it was grabbed in and never makes the event shorter than one step.
 */
export function dragRange(
	kind: Exclude<DragKind, 'create'>,
	original: TimeRange,
	origin: GridSlot,
	current: GridSlot,
	context: DragContext,
): TimeRange {
	if (kind === 'move') {
		const from = wallClock(original.start, context.timeZone)
		const minutes = Math.min(
			DAY_MINUTES - DRAG_SNAP_MINUTES,
			Math.max(0, snapMinutes(from.minutes + current.minutes - origin.minutes)),
		)
		const start = slotSeconds(addDays(from.day, current.day - origin.day), minutes, context.timeZone)
		return { start, end: start + (original.end - original.start) }
	}
	const edge = slotSeconds(
		context.columns[origin.day] as Date,
		snapMinutes(current.minutes),
		context.timeZone,
	)
	return kind === 'resize-start'
		? { start: Math.min(edge, original.end - SNAP_SECONDS), end: original.end }
		: { start: original.start, end: Math.max(edge, original.start + SNAP_SECONDS) }
}

/** The keyboard equivalent of a drag: one step earlier or later, one day either way, or a longer or shorter end. */
export type NudgeAction = 'earlier' | 'later' | 'previous-day' | 'next-day' | 'shorter' | 'longer'

/**
 * Alt with an arrow key moves an event; adding Shift changes its end. Plain
 * arrows are left alone because they already move between hour slots and page
 * the calendar.
 */
export function dragKeyAction(event: {
	key: string
	altKey: boolean
	shiftKey: boolean
}): NudgeAction | null {
	if (!event.altKey) return null
	if (event.shiftKey) {
		if (event.key === 'ArrowUp') return 'shorter'
		if (event.key === 'ArrowDown') return 'longer'
		return null
	}
	if (event.key === 'ArrowUp') return 'earlier'
	if (event.key === 'ArrowDown') return 'later'
	if (event.key === 'ArrowLeft') return 'previous-day'
	if (event.key === 'ArrowRight') return 'next-day'
	return null
}

export function nudgeRange(range: TimeRange, action: NudgeAction, timeZone: string): TimeRange {
	switch (action) {
		case 'earlier':
			return { start: range.start - SNAP_SECONDS, end: range.end - SNAP_SECONDS }
		case 'later':
			return { start: range.start + SNAP_SECONDS, end: range.end + SNAP_SECONDS }
		case 'shorter':
			return { start: range.start, end: Math.max(range.start + SNAP_SECONDS, range.end - SNAP_SECONDS) }
		case 'longer':
			return { start: range.start, end: range.end + SNAP_SECONDS }
		default: {
			// A day move keeps the wall-clock time, like a pointer move across columns.
			const from = wallClock(range.start, timeZone)
			const start = slotSeconds(addDays(from.day, action === 'next-day' ? 1 : -1), from.minutes, timeZone)
			return { start, end: start + (range.end - range.start) }
		}
	}
}

/** True when a range starts on one of the visible days, so its box stays on screen. */
export function rangeStartsInColumns(range: TimeRange, context: DragContext): boolean {
	const startIso = ymd(wallClock(range.start, context.timeZone).day)
	return context.columns.some((column) => ymd(column) === startIso)
}

/** The stored times of a timed event, or null for all-day and unparseable events. */
export function eventRange(event: Event): TimeRange | null {
	const times = eventTimes(event)
	if (!times || times.allDay) return null
	return { start: Math.floor(times.start.getTime() / 1000), end: Math.floor(times.end.getTime() / 1000) }
}

/**
 * Which of a timed event's edges fall on `day`. An event that runs past
 * midnight is drawn on two days, and only the box holding an edge resizes it.
 */
export function eventEdgesOnDay(event: Event, day: Date, timeZone: string): { start: boolean; end: boolean } {
	const range = eventRange(event)
	if (!range) return { start: false, end: false }
	const dayIso = ymd(day)
	return {
		start: ymd(wallClock(range.start, timeZone).day) === dayIso,
		// The end is exclusive: an event ending at midnight ends on the day before.
		end: ymd(wallClock(range.end - 1, timeZone).day) === dayIso,
	}
}

/** An expanded occurrence of a repeating event: it has its own id and names its series. */
export function isRecurringOccurrence(event: Event): boolean {
	// Provider data: the field is typed, but its value is still checked before it is trusted.
	const master: unknown = event.master_event_id
	return typeof master === 'string' && master.length > 0
}

/** Why an event cannot be dragged or nudged, or null when it can. */
export type DragBlock = 'read-only' | 'all-day' | 'recurring-series' | 'pending'

export function eventDragBlock(event: Event, calendars: readonly Calendar[]): DragBlock | null {
	if (event.id === NEW_EVENT_PREVIEW_ID || event.id.startsWith(OPTIMISTIC_EVENT_ID_PREFIX)) return 'pending'
	if (
		event.read_only ||
		calendars.some((calendar) => calendar.id === event.calendar_id && calendar.read_only)
	)
		return 'read-only'
	if (!eventRange(event)) return 'all-day'
	// A series shown as one unexpanded event has no occurrence to move on its own:
	// changing its times would move every occurrence.
	if (event.recurrence?.length && !isRecurringOccurrence(event)) return 'recurring-series'
	return null
}

/** Which keyboard and drag description an event chip points at with `aria-describedby`. */
export type DragHint = 'movable' | 'occurrence' | 'read-only' | 'recurring-series'

export const DRAG_HINTS: Record<DragHint, string> = {
	movable:
		'Drag to move, or drag the top or bottom edge to resize. With the keyboard: Alt plus an arrow key moves this event, Shift plus Alt plus Up or Down changes when it ends, Enter saves and Escape cancels.',
	occurrence:
		'Repeating event. Moving or resizing changes only this occurrence. With the keyboard: Alt plus an arrow key moves it, Shift plus Alt plus Up or Down changes when it ends, Enter saves and Escape cancels.',
	'read-only': 'Read-only event. It cannot be moved or resized.',
	'recurring-series':
		'Repeating event. It cannot be moved or resized from the grid, because the change would apply to every occurrence. Open it to edit.',
}

export function dragHintId(hint: DragHint): string {
	return `calendar-drag-hint-${hint}`
}

export function eventDragHint(event: Event, calendars: readonly Calendar[]): DragHint | null {
	const block = eventDragBlock(event, calendars)
	if (block === 'read-only' || block === 'recurring-series') return block
	if (block) return null
	return isRecurringOccurrence(event) ? 'occurrence' : 'movable'
}

/** Draws the open drag or keyboard adjustment in place of the stored times. */
export function applyDragPreview(events: Event[], preview: DragPreview | null, calendarId: string): Event[] {
	if (!preview) return events
	const when = { object: 'timespan' as const, start_time: preview.range.start, end_time: preview.range.end }
	if (preview.eventId === null) {
		// An open composer already draws a draft; the dragged range replaces it rather than doubling it.
		return [
			...events.filter((event) => event.id !== NEW_EVENT_PREVIEW_ID),
			{ id: NEW_EVENT_PREVIEW_ID, calendar_id: calendarId, title: 'New event', when },
		]
	}
	return events.map((event) => (event.id === preview.eventId ? { ...event, when } : event))
}

/** "Sat, Jun 15, 9:15 AM – 10:15 AM", for announcing where an event now sits. */
export function describeRange(range: TimeRange, timeZone: string): string {
	const start = new Date(range.start * 1000)
	const day = start.toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		timeZone,
	})
	return `${day}, ${fmtTime(start, timeZone)} – ${fmtTime(new Date(range.end * 1000), timeZone)}`
}
