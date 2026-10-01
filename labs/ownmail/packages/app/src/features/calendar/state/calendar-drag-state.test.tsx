// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAG_HINTS } from '../lib/calendar-drag.js'
import { readGridGeometry, useCalendarDrag } from './calendar-drag-state.js'

const TZ = 'America/Toronto'
const HOUR = 52
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)
// The week of Sunday 9 June 2024; Saturday the 15th is the last column.
const columns = Array.from({ length: 7 }, (_, index) => new Date(2024, 5, 9 + index))
const SATURDAY_X = 56 + 6 * 100 + 50
/** The y position of a Toronto wall-clock time in the grid, which starts 100px down the page. */
const y = (hours: number) => 100 + hours * HOUR

const calendars = [{ id: 'work', name: 'Work' }] as Calendar[]
const standup = {
	id: 'e1',
	calendar_id: 'work',
	title: 'Standup',
	when: { start_time: at('2024-06-15T13:00:00Z'), end_time: at('2024-06-15T14:00:00Z') },
} as Event

function box(left: number, top: number, width: number, height: number) {
	return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect
}

/** A grid as the route draws it: a scroll viewport, its sticky header, and seven day columns. */
function mountGrid() {
	const viewport = document.createElement('section')
	viewport.dataset.slot = 'scroll-area-viewport'
	viewport.getBoundingClientRect = () => box(0, 60, 800, 640)
	const header = document.createElement('div')
	header.dataset.testid = 'calendar-time-grid-header'
	header.getBoundingClientRect = () => box(0, 60, 800, 40)
	viewport.append(header)
	columns.forEach((_, index) => {
		const column = document.createElement('div')
		column.dataset.calendarDayColumn = String(index)
		column.getBoundingClientRect = () => box(56 + index * 100, 100, 100, 24 * HOUR)
		viewport.append(column)
	})
	document.body.append(viewport)
}

const anchor = box(700, 568, 100, 52)
const press = (x: number, yPosition: number, overrides: Record<string, unknown> = {}) => ({
	pointerType: 'mouse',
	button: 0,
	ctrlKey: false,
	clientX: x,
	clientY: yPosition,
	currentTarget: { getBoundingClientRect: () => anchor },
	...overrides,
})

function pointer(type: 'pointermove' | 'pointerup' | 'pointercancel', x: number, yPosition: number) {
	act(() => {
		window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: yPosition }))
	})
}

const WEEK = ['ada@example.com', 'week', '2024-06-09']

function setup(overrides: { calendars?: Calendar[] } = {}) {
	const onReschedule = vi.fn()
	const onCreate = vi.fn()
	const hook = renderHook(
		({ identity }: { identity: readonly unknown[] }) =>
			useCalendarDrag({
				identity,
				columns,
				hourHeight: HOUR,
				timeZone: TZ,
				calendars: overrides.calendars ?? calendars,
				onReschedule,
				onCreate,
			}),
		{ initialProps: { identity: WEEK } },
	)
	return { ...hook, onReschedule, onCreate }
}

beforeEach(mountGrid)
afterEach(() => {
	cleanup()
	document.body.replaceChildren()
	vi.useRealTimers()
})

describe('reading the grid from the page', () => {
	it('limits the droppable area to the scroll viewport below the sticky day header', () => {
		const geometry = readGridGeometry(document)
		expect(geometry?.columns).toHaveLength(7)
		expect(geometry?.visible).toEqual({ left: 0, right: 800, top: 100, bottom: 700 })
	})

	it('finds no grid in the month view, so nothing there can start a drag', () => {
		document.body.replaceChildren()
		expect(readGridGeometry(document)).toBeNull()
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		expect(result.current.preview).toBeNull()
		pointer('pointerup', SATURDAY_X, y(11))
		expect(onReschedule).not.toHaveBeenCalled()
	})
})

describe('dragging with the mouse', () => {
	it('moves an event to the snapped time it is dropped on and saves once', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		// 35 minutes down: the start snaps from 9:35 to 9:30.
		pointer('pointermove', SATURDAY_X, y(9.5 + 35 / 60))
		expect(result.current.preview).toEqual({
			eventId: 'e1',
			range: { start: at('2024-06-15T13:30:00Z'), end: at('2024-06-15T14:30:00Z') },
		})
		// Nothing is saved until the drop.
		expect(onReschedule).not.toHaveBeenCalled()
		pointer('pointerup', SATURDAY_X, y(9.5 + 35 / 60))
		expect(onReschedule).toHaveBeenCalledExactlyOnceWith(standup, {
			start: at('2024-06-15T13:30:00Z'),
			end: at('2024-06-15T14:30:00Z'),
		})
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toContain('Moved to')
		expect(result.current.announcement).toContain('9:30 AM – 10:30 AM')
	})

	it('a read-only event cannot be dragged', () => {
		const { result, onReschedule } = setup()
		const readOnly = { ...standup, read_only: true } as Event
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', readOnly))
		pointer('pointermove', SATURDAY_X, y(12))
		expect(result.current.preview).toBeNull()
		pointer('pointerup', SATURDAY_X, y(12))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('a drag that ends outside the grid changes nothing', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		const inside = result.current.preview
		// Past the right edge of the grid the preview holds where it last was.
		pointer('pointermove', 900, y(11))
		expect(result.current.preview).toEqual(inside)
		pointer('pointerup', 900, y(11))
		expect(onReschedule).not.toHaveBeenCalled()
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe('Cancelled. Nothing was changed.')
	})

	it('a drag released over the sticky day header is outside the grid too', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(8))
		pointer('pointerup', SATURDAY_X, 80)
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('Escape cancels an in-progress drag and is not passed on to anything else', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
		act(() => {
			window.dispatchEvent(other)
		})
		expect(other.defaultPrevented).toBe(false)
		expect(result.current.preview).not.toBeNull()
		const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
		act(() => {
			window.dispatchEvent(escapeKey)
		})
		expect(escapeKey.defaultPrevented).toBe(true)
		expect(result.current.preview).toBeNull()
		// The release that follows belongs to nothing.
		pointer('pointerup', SATURDAY_X, y(11))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it.each(['pointercancel', 'blur'] as const)(
		'abandons the drag when the browser interrupts it (%s)',
		(type) => {
			const { result, onReschedule } = setup()
			act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
			pointer('pointermove', SATURDAY_X, y(11))
			act(() => {
				window.dispatchEvent(new Event(type))
			})
			expect(result.current.preview).toBeNull()
			pointer('pointerup', SATURDAY_X, y(11))
			expect(onReschedule).not.toHaveBeenCalled()
		},
	)

	it('says nothing when a press is interrupted before it ever became a drag', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
		})
		expect(result.current.announcement).toBe('')
		pointer('pointerup', SATURDAY_X, y(9.5))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('touch and pen never start a drag, so the grid keeps scrolling', () => {
		const { result, onReschedule } = setup()
		for (const pointerType of ['touch', 'pen']) {
			act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5), { pointerType }), 'move', standup))
			pointer('pointermove', SATURDAY_X, y(12))
			expect(result.current.preview).toBeNull()
			pointer('pointerup', SATURDAY_X, y(12))
		}
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('only the primary mouse button drags', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5), { button: 2 }), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(12))
		pointer('pointerup', SATURDAY_X, y(12))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('a press that barely moves stays a click: nothing is saved and the click opens the event', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X + 2, y(9.5) + 2)
		expect(result.current.preview).toBeNull()
		pointer('pointerup', SATURDAY_X + 2, y(9.5) + 2)
		expect(onReschedule).not.toHaveBeenCalled()
		expect(result.current.consumeClick()).toBe(false)
		expect(result.current.announcement).toBe('')
	})

	it('swallows the click that ends a real drag, once, so the drop does not also open the event', () => {
		vi.useFakeTimers()
		const { result } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		pointer('pointerup', SATURDAY_X, y(11))
		expect(result.current.consumeClick()).toBe(true)
		expect(result.current.consumeClick()).toBe(false)

		// When no click follows the drop, the next genuine click is not swallowed.
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		pointer('pointerup', SATURDAY_X, y(11))
		vi.runAllTimers()
		expect(result.current.consumeClick()).toBe(false)
	})

	it('does not save when an event is dropped back where it started', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		pointer('pointermove', SATURDAY_X, y(9.5))
		pointer('pointerup', SATURDAY_X, y(9.5))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('resizes from the bottom edge without moving the start', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(10)), 'resize-end', standup))
		pointer('pointermove', SATURDAY_X, y(11.25))
		pointer('pointerup', SATURDAY_X, y(11.25))
		expect(onReschedule).toHaveBeenCalledExactlyOnceWith(standup, {
			start: at('2024-06-15T13:00:00Z'),
			end: at('2024-06-15T15:15:00Z'),
		})
	})

	it('drags out a new event and hands the range to the composer with where the press began', () => {
		const { result, onCreate, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.3)), 'create', null))
		pointer('pointermove', SATURDAY_X, y(10.4))
		expect(result.current.preview).toEqual({
			eventId: null,
			range: { start: at('2024-06-15T13:15:00Z'), end: at('2024-06-15T14:30:00Z') },
		})
		pointer('pointerup', SATURDAY_X, y(10.4))
		expect(onCreate).toHaveBeenCalledExactlyOnceWith(
			{ start: at('2024-06-15T13:15:00Z'), end: at('2024-06-15T14:30:00Z') },
			anchor,
		)
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('drops a drag in flight when the grid shows another range, so it cannot land there', () => {
		const { result, rerender, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		rerender({ identity: ['ada@example.com', 'week', '2024-06-16'] })
		expect(result.current.preview).toBeNull()
		pointer('pointerup', SATURDAY_X, y(11))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('stops listening when the grid unmounts in the middle of a drag', () => {
		const { result, unmount, onReschedule } = setup()
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		pointer('pointermove', SATURDAY_X, y(11))
		unmount()
		window.dispatchEvent(new MouseEvent('pointerup', { clientX: SATURDAY_X, clientY: y(11) }))
		expect(onReschedule).not.toHaveBeenCalled()
	})
})

describe('moving and resizing from the keyboard', () => {
	const key = (name: string, modifiers: { altKey?: boolean; shiftKey?: boolean } = {}) => ({
		key: name,
		altKey: modifiers.altKey ?? false,
		shiftKey: modifiers.shiftKey ?? false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	})
	const alt = (name: string, shiftKey = false) => key(name, { altKey: true, shiftKey })

	it('adjusts in 15-minute steps and saves once, on Enter', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))
		act(() => result.current.onEventKeyDown(alt('ArrowDown', true), standup))
		expect(result.current.preview?.range).toEqual({
			start: at('2024-06-15T13:30:00Z'),
			end: at('2024-06-15T14:45:00Z'),
		})
		expect(result.current.announcement).toContain('Press Enter to save or Escape to cancel.')
		expect(onReschedule).not.toHaveBeenCalled()

		const enter = key('Enter')
		// The grid redraws the event at its pending times, and that redrawn copy receives the key.
		const redrawn = {
			...standup,
			when: { start_time: at('2024-06-15T13:30:00Z'), end_time: at('2024-06-15T14:45:00Z') },
		} as Event
		act(() => result.current.onEventKeyDown(enter, redrawn))
		// Enter confirms instead of activating the event's button.
		expect(enter.preventDefault).toHaveBeenCalled()
		expect(onReschedule).toHaveBeenCalledExactlyOnceWith(standup, {
			start: at('2024-06-15T13:30:00Z'),
			end: at('2024-06-15T14:45:00Z'),
		})
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toContain('Moved to')
	})

	it('Escape abandons the adjustment without saving and without closing anything else', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowUp'), standup))
		const escapeKey = key('Escape')
		act(() => result.current.onEventKeyDown(escapeKey, standup))
		expect(escapeKey.stopPropagation).toHaveBeenCalled()
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe('Cancelled. Nothing was changed.')
		act(() => result.current.onEventKeyDown(key('Enter'), standup))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('leaves Enter, Escape and other keys alone when no adjustment is open', () => {
		const { result, onReschedule } = setup()
		for (const name of ['Enter', 'Escape', 'a', 'ArrowDown']) {
			const press = key(name)
			act(() => result.current.onEventKeyDown(press, standup))
			expect(press.preventDefault).not.toHaveBeenCalled()
		}
		expect(onReschedule).not.toHaveBeenCalled()
		expect(result.current.preview).toBeNull()
	})

	it('does not save when the adjustment ends back at the original times', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))
		act(() => result.current.onEventKeyDown(alt('ArrowUp'), standup))
		act(() => result.current.onEventKeyDown(key('Enter'), standup))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('a read-only event cannot be moved from the keyboard, and says why', () => {
		const { result, onReschedule } = setup()
		const readOnly = { ...standup, read_only: true } as Event
		const press = alt('ArrowDown')
		act(() => result.current.onEventKeyDown(press, readOnly))
		// The key is still handled, so it does not page the calendar instead.
		expect(press.preventDefault).toHaveBeenCalled()
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe(DRAG_HINTS['read-only'])
		act(() => result.current.onEventKeyDown(key('Enter'), readOnly))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('a whole repeating series cannot be moved from the keyboard, and says why', () => {
		const { result } = setup()
		const series = { ...standup, recurrence: ['RRULE:FREQ=WEEKLY'] } as Event
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), series))
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe(DRAG_HINTS['recurring-series'])
	})

	it('ignores an event that is not saved yet without announcing anything', () => {
		const { result } = setup()
		const pending = { ...standup, id: 'optimistic-event-1' } as Event
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), pending))
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe('')
	})

	it('keeps the event on the days shown rather than moving it out of sight', () => {
		const { result } = setup()
		// Saturday is the last visible day.
		act(() => result.current.onEventKeyDown(alt('ArrowRight'), standup))
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe('That is outside the days shown.')
	})

	it('returns focus to the event after it is redrawn in another day column', () => {
		const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
			callback(0)
			return 0
		})
		const other = document.createElement('button')
		other.dataset.eventChip = 'someone-else'
		const chip = document.createElement('button')
		chip.dataset.eventChip = 'e1'
		document.body.append(other, chip)
		const { result } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowLeft'), standup))
		expect(result.current.preview?.range.start).toBe(at('2024-06-14T13:00:00Z'))
		expect(chip).toHaveFocus()
		raf.mockRestore()
	})

	it('abandons the adjustment when focus moves to something else', () => {
		const { result, onReschedule } = setup()
		const elsewhere = document.createElement('button')
		const sameEvent = document.createElement('button')
		sameEvent.dataset.eventChip = 'e1'
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))

		// Another event losing focus is not this adjustment's business.
		act(() => result.current.onEventBlur({ relatedTarget: elsewhere }, { ...standup, id: 'other' } as Event))
		// The box being redrawn blurs to nothing, or to its own new element.
		act(() => result.current.onEventBlur({ relatedTarget: null }, standup))
		act(() => result.current.onEventBlur({ relatedTarget: sameEvent }, standup))
		expect(result.current.preview).not.toBeNull()

		act(() => result.current.onEventBlur({ relatedTarget: elsewhere }, standup))
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe('Cancelled. Nothing was changed.')
		act(() => result.current.onEventKeyDown(key('Enter'), standup))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('an adjustment does not follow the grid to another week, view or inbox', () => {
		const { result, rerender, onReschedule } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))
		expect(result.current.preview).not.toBeNull()
		rerender({ identity: ['ada@example.com', 'week', '2024-06-16'] })
		// The next range starts clean on its first render: no preview and no announcement.
		expect(result.current.preview).toBeNull()
		expect(result.current.announcement).toBe('')
		// Enter there opens the event; it does not save the abandoned adjustment.
		const enter = key('Enter')
		act(() => result.current.onEventKeyDown(enter, standup))
		expect(enter.preventDefault).not.toHaveBeenCalled()
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('a mouse press on the grid abandons an unconfirmed keyboard adjustment', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', standup))
		expect(result.current.preview).toBeNull()
		pointer('pointerup', SATURDAY_X, y(9.5))
		act(() => result.current.onEventKeyDown(key('Enter'), standup))
		expect(onReschedule).not.toHaveBeenCalled()
	})

	it('a drag begun on a box shown at pending keyboard times moves the stored event', () => {
		const { result, onReschedule } = setup()
		act(() => result.current.onEventKeyDown(alt('ArrowDown'), standup))
		// The box pressed is the redrawn copy, 15 minutes later than the stored event.
		const redrawn = {
			...standup,
			when: { start_time: at('2024-06-15T13:15:00Z'), end_time: at('2024-06-15T14:15:00Z') },
		} as Event
		act(() => result.current.beginPointerDrag(press(SATURDAY_X, y(9.5)), 'move', redrawn))
		pointer('pointermove', SATURDAY_X, y(10.5))
		pointer('pointerup', SATURDAY_X, y(10.5))
		// One hour down from the stored 9 AM, not from the unsaved 9:15.
		expect(onReschedule).toHaveBeenCalledExactlyOnceWith(standup, {
			start: at('2024-06-15T14:00:00Z'),
			end: at('2024-06-15T15:00:00Z'),
		})
	})
})
