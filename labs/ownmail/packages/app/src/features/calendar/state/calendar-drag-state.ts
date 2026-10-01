import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { useCallback, useEffect, useRef } from 'react'
import { useIdentityState } from '#shared/hooks/use-identity-state'
import type { Rect } from '#shared/lib/modal-position'
import {
	createRange,
	DRAG_HINTS,
	DRAG_THRESHOLD_PX,
	type DragKind,
	type DragPreview,
	describeRange,
	dragKeyAction,
	dragRange,
	eventDragBlock,
	eventRange,
	type GridGeometry,
	type GridSlot,
	nudgeRange,
	pointToSlot,
	rangeStartsInColumns,
	type TimeRange,
} from '../lib/calendar-drag.js'

export type CalendarDragOptions = {
	/** What the grid is showing: the account, view and date range. A drag or adjustment never outlives it. */
	identity: readonly unknown[]
	/** The day columns the time grid shows, in order. */
	columns: readonly Date[]
	hourHeight: number
	timeZone: string
	calendars: readonly Calendar[]
	/** A move or resize was dropped on new times. */
	onReschedule: (event: Event, range: TimeRange) => void
	/** A new range was dragged out; `anchor` is where the press began. */
	onCreate: (range: TimeRange, anchor: Rect | null) => void
}

/** The parts of a pointer event the drag reads; React and DOM events both fit. */
type PointerStart = {
	pointerType: string
	button: number
	clientX: number
	clientY: number
	currentTarget: { getBoundingClientRect(): Rect }
}

type KeyPress = {
	key: string
	altKey: boolean
	shiftKey: boolean
	preventDefault(): void
	stopPropagation(): void
}

type PointerSession = {
	kind: DragKind
	event: Event | null
	original: TimeRange | null
	origin: GridSlot
	startX: number
	startY: number
	anchor: Rect
	active: boolean
}

type KeyboardSession = { event: Event; range: TimeRange; scope: string }

type MoveKind = Exclude<DragKind, 'create'>

function rect(element: Element) {
	const { left, right, top, bottom } = element.getBoundingClientRect()
	return { left, right, top, bottom }
}

/**
 * Reads where the grid is on screen. The visible body is the scroll viewport
 * below the sticky day header, so a pointer over the header, the gutter or
 * anything outside the grid resolves to no slot.
 */
export function readGridGeometry(root: ParentNode): GridGeometry | null {
	const header = root.querySelector('[data-testid="calendar-time-grid-header"]')
	const viewport = header?.closest('[data-slot="scroll-area-viewport"]')
	const columns = [...root.querySelectorAll('[data-calendar-day-column]')]
	if (!header || !viewport || columns.length === 0) return null
	const visible = rect(viewport)
	return { columns: columns.map(rect), visible: { ...visible, top: rect(header).bottom } }
}

function sameRange(a: TimeRange, b: TimeRange): boolean {
	return a.start === b.start && a.end === b.end
}

/**
 * Drag to create, move and resize in the time grid, with the keyboard
 * equivalent. Only a mouse starts a pointer drag: touch and pen keep native
 * scrolling and use the editor instead. Nothing is saved until the drag is
 * dropped inside the grid or the keyboard adjustment is confirmed with Enter.
 */
export function useCalendarDrag(options: CalendarDragOptions) {
	// Both belong to the grid on screen: another range, view or inbox starts with neither.
	const [preview, setPreview] = useIdentityState<DragPreview | null>(options.identity, () => null)
	const [announcement, setAnnouncement] = useIdentityState(options.identity, () => '')
	const scope = options.identity.join('\n')
	const latest = useRef(options)
	latest.current = options
	const pointer = useRef<PointerSession | null>(null)
	const keyboardSession = useRef<KeyboardSession | null>(null)
	// An adjustment begun in another range, view or inbox is not this grid's to finish.
	const keyboard = {
		get current() {
			return keyboardSession.current?.scope === scope ? keyboardSession.current : null
		},
		set current(session: KeyboardSession | null) {
			keyboardSession.current = session
		},
	}
	const suppressClick = useRef(false)
	const stopListening = useRef<(() => void) | null>(null)

	const slotAt = (x: number, y: number): GridSlot | null => {
		const geometry = readGridGeometry(document)
		return geometry ? pointToSlot({ x, y }, geometry, latest.current.hourHeight) : null
	}

	const endPointerDrag = useCallback(() => {
		stopListening.current?.()
		stopListening.current = null
		pointer.current = null
	}, [])

	// A drag still in flight when the grid unmounts, or shows something else,
	// must not leave listeners behind.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the cleanup must also run when the grid's identity changes.
	useEffect(() => endPointerDrag, [endPointerDrag, scope])

	const beginPointerDrag = (start: PointerStart, kind: DragKind, drawn: Event | null) => {
		{
			// Touch and pen scroll the grid; they never start a drag.
			if (start.pointerType !== 'mouse' || start.button !== 0) return
			// A box drawn at pending keyboard times stands for the stored event, which is what moves.
			const event = drawn && keyboard.current?.event.id === drawn.id ? keyboard.current.event : drawn
			if (event && eventDragBlock(event, latest.current.calendars)) return
			const origin = slotAt(start.clientX, start.clientY)
			if (!origin) return
			endPointerDrag()
			// A press on the grid abandons an unconfirmed keyboard adjustment.
			keyboard.current = null
			setPreview(null)
			pointer.current = {
				kind,
				event,
				original: event ? eventRange(event) : null,
				origin,
				startX: start.clientX,
				startY: start.clientY,
				anchor: start.currentTarget.getBoundingClientRect(),
				active: false,
			}

			const rangeAt = (session: PointerSession, slot: GridSlot): TimeRange => {
				const context = { columns: latest.current.columns, timeZone: latest.current.timeZone }
				// Only an existing event has stored times; without them the drag is creating one.
				return session.original
					? dragRange(session.kind as MoveKind, session.original, session.origin, slot, context)
					: createRange(session.origin, slot, context)
			}
			const cancel = () => {
				const wasActive = pointer.current?.active
				endPointerDrag()
				setPreview(null)
				if (wasActive) setAnnouncement('Cancelled. Nothing was changed.')
			}
			const onMove = (move: PointerEvent) => {
				const session = pointer.current as PointerSession
				if (!session.active) {
					const travel = Math.hypot(move.clientX - session.startX, move.clientY - session.startY)
					if (travel < DRAG_THRESHOLD_PX) return
					session.active = true
				}
				const slot = slotAt(move.clientX, move.clientY)
				// Outside the grid the preview holds its last position; releasing there cancels.
				if (slot) setPreview({ eventId: session.event?.id ?? null, range: rangeAt(session, slot) })
			}
			const onUp = (up: PointerEvent) => {
				const session = pointer.current as PointerSession
				if (!session.active) {
					// Never became a drag: the click that follows opens the event or the composer.
					endPointerDrag()
					return
				}
				// The click that ends a drag must not also open the event it was dropped on.
				suppressClick.current = true
				setTimeout(() => {
					suppressClick.current = false
				}, 0)
				const slot = slotAt(up.clientX, up.clientY)
				if (!slot) {
					cancel()
					return
				}
				const range = rangeAt(session, slot)
				endPointerDrag()
				setPreview(null)
				if (!session.event) {
					latest.current.onCreate(range, session.anchor)
				} else if (!sameRange(range, session.original as TimeRange)) {
					setAnnouncement(`Moved to ${describeRange(range, latest.current.timeZone)}.`)
					latest.current.onReschedule(session.event, range)
				}
			}
			const onKeyDown = (key: KeyboardEvent) => {
				if (key.key !== 'Escape') return
				key.preventDefault()
				key.stopPropagation()
				cancel()
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
			window.addEventListener('pointercancel', cancel)
			window.addEventListener('blur', cancel)
			window.addEventListener('keydown', onKeyDown, true)
			stopListening.current = () => {
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
				window.removeEventListener('pointercancel', cancel)
				window.removeEventListener('blur', cancel)
				window.removeEventListener('keydown', onKeyDown, true)
			}
		}
	}

	/** True once after a drag ends, so the click it produces is ignored. */
	const consumeClick = () => {
		const suppressed = suppressClick.current
		suppressClick.current = false
		return suppressed
	}

	const endKeyboard = () => {
		keyboard.current = null
		setPreview(null)
	}

	const onEventKeyDown = (key: KeyPress, event: Event) => {
		{
			const { calendars, columns, timeZone, onReschedule } = latest.current
			const open = keyboard.current?.event.id === event.id ? keyboard.current : null
			if (open && key.key === 'Enter') {
				// Enter confirms the adjustment instead of opening the event.
				key.preventDefault()
				endKeyboard()
				// The box under the keys is drawn at the pending times; the stored event is the one saved.
				if (!sameRange(open.range, eventRange(open.event) as TimeRange)) {
					setAnnouncement(`Moved to ${describeRange(open.range, timeZone)}.`)
					onReschedule(open.event, open.range)
				}
				return
			}
			if (open && key.key === 'Escape') {
				key.preventDefault()
				key.stopPropagation()
				endKeyboard()
				setAnnouncement('Cancelled. Nothing was changed.')
				return
			}
			const action = dragKeyAction(key)
			if (!action) return
			key.preventDefault()
			const block = eventDragBlock(event, calendars)
			if (block) {
				// Say why nothing moved, when there is a reason worth stating.
				if (block === 'read-only' || block === 'recurring-series') setAnnouncement(DRAG_HINTS[block])
				return
			}
			const from = open?.range ?? (eventRange(event) as TimeRange)
			const range = nudgeRange(from, action, timeZone)
			if (!rangeStartsInColumns(range, { columns, timeZone })) {
				setAnnouncement('That is outside the days shown.')
				return
			}
			keyboard.current = { event: open?.event ?? event, range, scope }
			setPreview({ eventId: event.id, range })
			setAnnouncement(`${describeRange(range, timeZone)}. Press Enter to save or Escape to cancel.`)
			if (action === 'previous-day' || action === 'next-day') {
				// The box is redrawn in another day column, which drops focus; put it back.
				requestAnimationFrame(() => {
					const chips = [...document.querySelectorAll<HTMLElement>('[data-event-chip]')]
					chips.find((chip) => chip.dataset.eventChip === event.id)?.focus()
				})
			}
		}
	}

	/** Moving focus to something else abandons an unconfirmed keyboard adjustment. */
	const onEventBlur = (blur: { relatedTarget: EventTarget | null }, event: Event) => {
		if (keyboard.current?.event.id !== event.id) return
		const next = blur.relatedTarget
		// No next target means the box itself was redrawn; focus is restored to it.
		if (!(next instanceof HTMLElement) || next.dataset.eventChip === event.id) return
		endKeyboard()
		setAnnouncement('Cancelled. Nothing was changed.')
	}

	return { preview, announcement, beginPointerDrag, consumeClick, onEventKeyDown, onEventBlur }
}
