import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import { NEW_EVENT_PREVIEW_ID } from './calendar.js'
import {
	applyDragPreview,
	createRange,
	DRAG_HINTS,
	describeRange,
	dragHintId,
	dragKeyAction,
	dragRange,
	eventDragBlock,
	eventDragHint,
	eventEdgesOnDay,
	eventRange,
	type GridGeometry,
	isRecurringOccurrence,
	nudgeRange,
	pointToSlot,
	rangeStartsInColumns,
	snapMinutes,
} from './calendar-drag.js'

const TZ = 'America/Toronto'
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)
// The week of Sunday 9 June 2024; Toronto is on EDT (UTC-4).
const columns = Array.from({ length: 7 }, (_, index) => new Date(2024, 5, 9 + index))
const context = { columns, timeZone: TZ }
const SATURDAY = 6
const HOUR = 52

// Seven 100px day columns to the right of a 56px gutter; the body is visible from y=100 to y=700.
const geometry: GridGeometry = {
	columns: columns.map((_, index) => ({
		left: 56 + index * 100,
		right: 156 + index * 100,
		top: 100,
		bottom: 100 + 24 * HOUR,
	})),
	visible: { left: 0, right: 800, top: 100, bottom: 700 },
}

const timed = (overrides: Partial<Event> = {}): Event =>
	({
		id: 'e1',
		calendar_id: 'work',
		title: 'Standup',
		when: { start_time: at('2024-06-15T13:00:00Z'), end_time: at('2024-06-15T14:00:00Z') },
		...overrides,
	}) as Event

const calendars = [
	{ id: 'work', name: 'Work' },
	{ id: 'holidays', name: 'Holidays', read_only: true },
] as Calendar[]

describe('15-minute snap', () => {
	it('lands every time on a quarter hour', () => {
		expect(snapMinutes(547)).toBe(540)
		expect(snapMinutes(548)).toBe(555)
		expect(snapMinutes(541, 'ceil')).toBe(555)
		expect(snapMinutes(554, 'floor')).toBe(540)
	})
})

describe('finding the grid slot under the pointer', () => {
	it('maps a point to its day column and the minutes down that day', () => {
		// 9:30 is 9.5 hours down the Saturday column.
		expect(pointToSlot({ x: 700, y: 100 + 9.5 * HOUR }, geometry, HOUR)).toEqual({
			day: SATURDAY,
			minutes: 570,
		})
	})

	it('treats the sticky header, the time gutter and everything beyond the grid as outside', () => {
		// Above the visible body: over the day header, although the column extends beneath it.
		expect(pointToSlot({ x: 700, y: 90 }, geometry, HOUR)).toBeNull()
		expect(pointToSlot({ x: 700, y: 701 }, geometry, HOUR)).toBeNull()
		expect(pointToSlot({ x: -5, y: 300 }, geometry, HOUR)).toBeNull()
		expect(pointToSlot({ x: 801, y: 300 }, geometry, HOUR)).toBeNull()
		// Inside the visible area but in the gutter, left of the first column.
		expect(pointToSlot({ x: 30, y: 300 }, geometry, HOUR)).toBeNull()
	})

	it('never reports a time outside the day', () => {
		const tall = { ...geometry, visible: { left: 0, right: 800, top: -5000, bottom: 5000 } }
		expect(pointToSlot({ x: 100, y: 0 }, tall, HOUR)?.minutes).toBe(0)
		expect(pointToSlot({ x: 100, y: 4000 }, tall, HOUR)?.minutes).toBe(1440)
	})
})

describe('dragging out a new event', () => {
	it('covers the quarter hours between the press and the release', () => {
		expect(createRange({ day: SATURDAY, minutes: 545 }, { day: SATURDAY, minutes: 590 }, context)).toEqual({
			start: at('2024-06-15T13:00:00Z'),
			end: at('2024-06-15T14:00:00Z'),
		})
	})

	it('works when dragged upwards, keeping the pressed quarter hour inside the event', () => {
		expect(createRange({ day: SATURDAY, minutes: 610 }, { day: SATURDAY, minutes: 560 }, context)).toEqual({
			start: at('2024-06-15T13:15:00Z'),
			end: at('2024-06-15T14:15:00Z'),
		})
	})

	it('is never shorter than one step and never runs past midnight', () => {
		expect(createRange({ day: SATURDAY, minutes: 545 }, { day: SATURDAY, minutes: 546 }, context)).toEqual({
			start: at('2024-06-15T13:00:00Z'),
			end: at('2024-06-15T13:15:00Z'),
		})
		expect(createRange({ day: SATURDAY, minutes: 1439 }, { day: SATURDAY, minutes: 1440 }, context)).toEqual({
			start: at('2024-06-16T03:45:00Z'),
			end: at('2024-06-16T04:00:00Z'),
		})
	})

	it('stays in the day column the press began in', () => {
		const range = createRange({ day: SATURDAY, minutes: 540 }, { day: 2, minutes: 600 }, context)
		expect(range.start).toBe(at('2024-06-15T13:00:00Z'))
	})
})

describe('moving an event', () => {
	const original = { start: at('2024-06-15T13:00:00Z'), end: at('2024-06-15T14:00:00Z') }

	it('shifts by the distance dragged, snapped, and keeps its length', () => {
		// Grabbed at 9:20, released at 9:55: 35 minutes, which snaps to 9:30.
		expect(
			dragRange('move', original, { day: SATURDAY, minutes: 560 }, { day: SATURDAY, minutes: 595 }, context),
		).toEqual({ start: at('2024-06-15T13:30:00Z'), end: at('2024-06-15T14:30:00Z') })
	})

	it('lands an off-grid event on a quarter hour', () => {
		const odd = { start: at('2024-06-15T13:07:00Z'), end: at('2024-06-15T13:37:00Z') }
		expect(
			dragRange('move', odd, { day: SATURDAY, minutes: 550 }, { day: SATURDAY, minutes: 556 }, context),
		).toEqual({ start: at('2024-06-15T13:15:00Z'), end: at('2024-06-15T13:45:00Z') })
	})

	it('moves across days at the same wall-clock time', () => {
		expect(
			dragRange('move', original, { day: SATURDAY, minutes: 560 }, { day: 3, minutes: 560 }, context),
		).toEqual({ start: at('2024-06-12T13:00:00Z'), end: at('2024-06-12T14:00:00Z') })
	})

	it('keeps 9 AM at 9 AM when the move crosses a daylight saving change', () => {
		// Saturday 2 Nov 2024 is EDT (UTC-4); Sunday 3 Nov is EST (UTC-5).
		const november = Array.from({ length: 7 }, (_, index) => new Date(2024, 9, 27 + index))
		const beforeChange = { start: at('2024-11-02T13:00:00Z'), end: at('2024-11-02T14:00:00Z') }
		expect(
			dragRange(
				'move',
				beforeChange,
				{ day: 6, minutes: 560 },
				{ day: 7, minutes: 560 },
				{ columns: november, timeZone: TZ },
			),
		).toEqual({ start: at('2024-11-03T14:00:00Z'), end: at('2024-11-03T15:00:00Z') })
	})

	it('cannot be dragged off either end of the day', () => {
		expect(
			dragRange('move', original, { day: SATURDAY, minutes: 560 }, { day: SATURDAY, minutes: 0 }, context)
				.start,
		).toBe(at('2024-06-15T04:00:00Z'))
		expect(
			dragRange('move', original, { day: SATURDAY, minutes: 0 }, { day: SATURDAY, minutes: 1440 }, context)
				.start,
		).toBe(at('2024-06-16T03:45:00Z'))
	})
})

describe('resizing an event', () => {
	const original = { start: at('2024-06-15T13:00:00Z'), end: at('2024-06-15T14:00:00Z') }
	const origin = { day: SATURDAY, minutes: 600 }

	it('moves only the dragged edge, to the quarter hour under the pointer', () => {
		expect(dragRange('resize-end', original, origin, { day: SATURDAY, minutes: 668 }, context)).toEqual({
			start: original.start,
			end: at('2024-06-15T15:15:00Z'),
		})
		expect(dragRange('resize-start', original, origin, { day: SATURDAY, minutes: 512 }, context)).toEqual({
			start: at('2024-06-15T12:30:00Z'),
			end: original.end,
		})
	})

	it('never makes an event shorter than one step, however far an edge is dragged past the other', () => {
		expect(dragRange('resize-end', original, origin, { day: SATURDAY, minutes: 120 }, context)).toEqual({
			start: original.start,
			end: original.start + 900,
		})
		expect(dragRange('resize-start', original, origin, { day: SATURDAY, minutes: 1200 }, context)).toEqual({
			start: original.end - 900,
			end: original.end,
		})
	})

	it('ignores sideways movement: an edge stays in the column it was grabbed in', () => {
		expect(dragRange('resize-end', original, origin, { day: 1, minutes: 660 }, context).end).toBe(
			at('2024-06-15T15:00:00Z'),
		)
	})
})

describe('the keyboard path for moving and resizing', () => {
	const key = (name: string, altKey = true, shiftKey = false) => ({ key: name, altKey, shiftKey })
	const range = { start: at('2024-06-15T13:00:00Z'), end: at('2024-06-15T14:00:00Z') }

	it('uses Alt with the arrows to move and adds Shift to change the end', () => {
		expect(dragKeyAction(key('ArrowUp'))).toBe('earlier')
		expect(dragKeyAction(key('ArrowDown'))).toBe('later')
		expect(dragKeyAction(key('ArrowLeft'))).toBe('previous-day')
		expect(dragKeyAction(key('ArrowRight'))).toBe('next-day')
		expect(dragKeyAction(key('ArrowUp', true, true))).toBe('shorter')
		expect(dragKeyAction(key('ArrowDown', true, true))).toBe('longer')
	})

	it('leaves plain arrows and unrelated keys to their existing meaning', () => {
		// Plain arrows page the calendar and move between hour slots.
		expect(dragKeyAction(key('ArrowUp', false))).toBeNull()
		expect(dragKeyAction(key('ArrowLeft', true, true))).toBeNull()
		expect(dragKeyAction(key('Home'))).toBeNull()
	})

	it('moves by the same 15-minute step as a drag', () => {
		expect(nudgeRange(range, 'earlier', TZ)).toEqual({ start: range.start - 900, end: range.end - 900 })
		expect(nudgeRange(range, 'later', TZ)).toEqual({ start: range.start + 900, end: range.end + 900 })
		expect(nudgeRange(range, 'longer', TZ)).toEqual({ start: range.start, end: range.end + 900 })
		expect(nudgeRange(range, 'shorter', TZ)).toEqual({ start: range.start, end: range.end - 900 })
	})

	it('cannot shorten an event below one step', () => {
		const short = { start: range.start, end: range.start + 900 }
		expect(nudgeRange(short, 'shorter', TZ)).toEqual(short)
	})

	it('moves a day at a time at the same wall-clock time', () => {
		expect(nudgeRange(range, 'next-day', TZ)).toEqual({
			start: at('2024-06-16T13:00:00Z'),
			end: at('2024-06-16T14:00:00Z'),
		})
		expect(nudgeRange(range, 'previous-day', TZ)).toEqual({
			start: at('2024-06-14T13:00:00Z'),
			end: at('2024-06-14T14:00:00Z'),
		})
	})

	it('knows when a nudged event would leave the days on screen', () => {
		expect(rangeStartsInColumns(range, context)).toBe(true)
		expect(rangeStartsInColumns(nudgeRange(range, 'next-day', TZ), context)).toBe(false)
	})
})

describe('which events may be dragged', () => {
	it('allows an ordinary timed event on a writable calendar', () => {
		expect(eventDragBlock(timed(), calendars)).toBeNull()
		expect(eventDragHint(timed(), calendars)).toBe('movable')
	})

	it('a read-only event cannot be dragged', () => {
		expect(eventDragBlock(timed({ read_only: true }), calendars)).toBe('read-only')
		expect(eventDragHint(timed({ read_only: true }), calendars)).toBe('read-only')
	})

	it('an event on a read-only calendar cannot be dragged, even when the event itself does not say so', () => {
		expect(eventDragBlock(timed({ calendar_id: 'holidays' }), calendars)).toBe('read-only')
	})

	it('an all-day event is neither moved nor resized in the time grid', () => {
		const allDay = timed({ when: { date: '2024-06-15' } })
		expect(eventRange(allDay)).toBeNull()
		expect(eventDragBlock(allDay, calendars)).toBe('all-day')
		expect(eventDragHint(allDay, calendars)).toBeNull()
		expect(eventEdgesOnDay(allDay, columns[SATURDAY] as Date, TZ)).toEqual({ start: false, end: false })
	})

	it('a recurring occurrence can be dragged, and says the change is to that occurrence only', () => {
		const occurrence = timed({ id: 'e1_20240615' })
		Object.assign(occurrence, { master_event_id: 'e1' })
		expect(isRecurringOccurrence(occurrence)).toBe(true)
		expect(eventDragBlock(occurrence, calendars)).toBeNull()
		expect(eventDragHint(occurrence, calendars)).toBe('occurrence')
		expect(DRAG_HINTS.occurrence).toContain('only this occurrence')
	})

	it('a whole series cannot be dragged, because the change would move every occurrence', () => {
		const series = timed({ recurrence: ['RRULE:FREQ=WEEKLY'] })
		expect(isRecurringOccurrence(series)).toBe(false)
		expect(eventDragBlock(series, calendars)).toBe('recurring-series')
		expect(eventDragHint(series, calendars)).toBe('recurring-series')
		expect(DRAG_HINTS['recurring-series']).toContain('every occurrence')
	})

	it('ignores a malformed series marker rather than trusting provider data', () => {
		const odd = timed()
		Object.assign(odd, { master_event_id: 42 })
		expect(isRecurringOccurrence(odd)).toBe(false)
		Object.assign(odd, { master_event_id: '' })
		expect(isRecurringOccurrence(odd)).toBe(false)
	})

	it('an event that is not saved yet cannot be dragged', () => {
		expect(eventDragBlock(timed({ id: 'optimistic-event-123' }), calendars)).toBe('pending')
		expect(eventDragBlock(timed({ id: NEW_EVENT_PREVIEW_ID }), calendars)).toBe('pending')
		expect(eventDragHint(timed({ id: 'optimistic-event-123' }), calendars)).toBeNull()
	})

	it('gives every description a stable id for aria-describedby', () => {
		expect(dragHintId('read-only')).toBe('calendar-drag-hint-read-only')
	})
})

describe('which edge of an event a day holds', () => {
	it('holds both edges of an event within one day', () => {
		expect(eventEdgesOnDay(timed(), columns[SATURDAY] as Date, TZ)).toEqual({ start: true, end: true })
	})

	it('splits the edges of an event that runs past midnight across its two days', () => {
		// Friday 11 PM to Saturday 1 AM in Toronto.
		const late = timed({
			when: { start_time: at('2024-06-15T03:00:00Z'), end_time: at('2024-06-15T05:00:00Z') },
		})
		expect(eventEdgesOnDay(late, columns[5] as Date, TZ)).toEqual({ start: true, end: false })
		expect(eventEdgesOnDay(late, columns[SATURDAY] as Date, TZ)).toEqual({ start: false, end: true })
	})

	it('counts an event that ends exactly at midnight as ending on the day before', () => {
		const untilMidnight = timed({
			when: { start_time: at('2024-06-15T03:00:00Z'), end_time: at('2024-06-15T04:00:00Z') },
		})
		expect(eventEdgesOnDay(untilMidnight, columns[5] as Date, TZ)).toEqual({ start: true, end: true })
	})
})

describe('drawing a drag in progress', () => {
	const events = [timed(), timed({ id: 'e2', title: 'Other' })]
	const range = { start: at('2024-06-15T15:00:00Z'), end: at('2024-06-15T16:00:00Z') }

	it('changes nothing while no drag is open', () => {
		expect(applyDragPreview(events, null, 'work')).toBe(events)
	})

	it('shows the dragged event at its pending times and leaves the others alone', () => {
		const drawn = applyDragPreview(events, { eventId: 'e1', range }, 'work')
		expect(eventRange(drawn[0] as Event)).toEqual(range)
		expect(drawn[0]?.title).toBe('Standup')
		expect(drawn[1]).toBe(events[1])
	})

	it('shows a range being dragged out as a draft on the default calendar', () => {
		const drawn = applyDragPreview(events, { eventId: null, range }, 'work')
		expect(drawn).toHaveLength(3)
		expect(drawn[2]).toMatchObject({ id: NEW_EVENT_PREVIEW_ID, calendar_id: 'work', title: 'New event' })
		expect(eventRange(drawn[2] as Event)).toEqual(range)
	})

	it('replaces the open composer draft instead of drawing two', () => {
		const withDraft = [...events, timed({ id: NEW_EVENT_PREVIEW_ID, title: 'Draft' })]
		const drawn = applyDragPreview(withDraft, { eventId: null, range }, 'work')
		expect(drawn.filter((event) => event.id === NEW_EVENT_PREVIEW_ID)).toHaveLength(1)
		expect(drawn.at(-1)?.title).toBe('New event')
	})
})

describe('announcing where an event now sits', () => {
	it('names the day and both times in the display time zone', () => {
		const text = describeRange({ start: at('2024-06-15T13:15:00Z'), end: at('2024-06-15T14:15:00Z') }, TZ)
		expect(text).toContain('9:15 AM – 10:15 AM')
		expect(text).toMatch(/Sat/)
	})
})
