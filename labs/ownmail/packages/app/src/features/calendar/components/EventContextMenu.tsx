import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { CalendarPlus, Check, CircleHelp, Eye, Pencil, Trash2, X } from 'lucide-react'
import { type PointerEvent, type ReactElement, type SyntheticEvent, useRef, useState } from 'react'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { eventDragBlock } from '../lib/calendar-drag.js'
import { useRsvpEventMutation } from '../state/calendar-state.js'

/** What an event's menu hands back to the screen that owns the pane and the dialogs. */
export type EventMenuActions = {
	/** The default calendar, for an event that does not name its own. */
	calendarId: string
	/** Read-only calendars make their events read-only, as they do for dragging. */
	calendars: readonly Calendar[]
	/** View the event the way a click does: the pane on desktop, the dialog on mobile. */
	onOpen: (event: Event) => void
	onEdit: (event: Event) => void
	/** Show the event on its delete confirmation; the menu itself deletes nothing. */
	onRequestDelete: (event: Event) => void
	/** The answer was rolled back; the screen says so, naming this event. */
	onRsvpFailed: (event: Event) => void
}

/**
 * A closing menu gives focus back to where it was. An item that opens the
 * pane, the dialog or the composer hands focus to that surface instead, so
 * the menu must not take it back afterwards.
 */
function useFocusHandOff() {
	const handedOn = useRef(false)
	return {
		handOn: () => {
			handedOn.current = true
		},
		onCloseAutoFocus: (event: { preventDefault(): void }) => {
			if (handedOn.current) event.preventDefault()
			handedOn.current = false
		},
	}
}

const RSVP_ITEMS = [
	{ status: 'yes', label: 'Accept', icon: Check },
	{ status: 'maybe', label: 'Maybe', icon: CircleHelp },
	{ status: 'no', label: 'Decline', icon: X },
] as const

/**
 * The right-click menu of an event, holding what the event's detail view
 * offers: open, edit, answer, delete. Opening the menu selects nothing, and a
 * right-click never starts a drag (a drag needs the primary button).
 */
export function EventContextMenu({
	event,
	actions,
	disabled = false,
	children,
}: {
	event: Event
	actions: EventMenuActions
	/** A draft preview has nothing to act on yet. */
	disabled?: boolean
	/** The chip or row; it becomes the trigger. */
	children: ReactElement
}) {
	const focus = useFocusHandOff()
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={disabled}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={`Actions for ${event.title || '(untitled)'}`}
				onCloseAutoFocus={focus.onCloseAutoFocus}
			>
				<EventMenuItems event={event} actions={actions} onFocusHandOff={focus.handOn} />
			</ContextMenuContent>
		</ContextMenu>
	)
}

/** Mounted only while the menu is open, so a grid of chips holds no idle mutations. */
function EventMenuItems({
	event,
	actions,
	onFocusHandOff,
}: {
	event: Event
	actions: EventMenuActions
	onFocusHandOff: () => void
}) {
	const opening = (open: (event: Event) => void) => () => {
		onFocusHandOff()
		open(event)
	}
	const rsvp = useRsvpEventMutation(event.id)
	// The same condition the detail view uses for its answer buttons.
	const canRsvp = Boolean(event.participants?.length && event.organizer)
	// The same rule that stops a read-only event from being dragged.
	const readOnly = eventDragBlock(event, actions.calendars) === 'read-only'
	return (
		<>
			<ContextMenuItem onSelect={opening(actions.onOpen)}>
				<Eye aria-hidden="true" />
				Open
			</ContextMenuItem>
			<ContextMenuItem disabled={readOnly} onSelect={opening(actions.onEdit)}>
				<Pencil aria-hidden="true" />
				Edit
			</ContextMenuItem>
			<ContextMenuSeparator />
			{RSVP_ITEMS.map(({ status, label, icon: Icon }) => (
				<ContextMenuItem
					key={status}
					disabled={!canRsvp}
					onSelect={() => {
						// The mutation applies the answer at once and restores the event if it
						// fails. The menu is gone by then, so the screen reports the failure.
						rsvp
							.mutateAsync({ eventId: event.id, calendarId: event.calendar_id ?? actions.calendarId, status })
							.catch(() => actions.onRsvpFailed(event))
					}}
				>
					<Icon aria-hidden="true" />
					{label}
				</ContextMenuItem>
			))}
			<ContextMenuSeparator />
			<ContextMenuItem variant="destructive" disabled={readOnly} onSelect={opening(actions.onRequestDelete)}>
				<Trash2 aria-hidden="true" />
				Delete…
			</ContextMenuItem>
		</>
	)
}

/**
 * The right-click menu of the empty time slots in one day column. One menu
 * serves the whole column and remembers the slot it was opened on. An event
 * chip inside the column opens its own menu instead, and a press on anything
 * else (a draft preview, the now line) is left to the browser. A colleague's
 * busy block takes no pointer events, so a press on it lands on the slot
 * beneath and opens that slot's menu.
 */
export function SlotContextMenu({
	onNewEvent,
	children,
}: {
	onNewEvent: (slot: HTMLElement) => void
	/** The day column; it becomes the trigger. */
	children: ReactElement
}) {
	const [slot, setSlot] = useState<HTMLElement | null>(null)
	// The composer focuses its title as it opens. It is opened once the menu has
	// closed and let go of focus, so that focus is not pulled back into the menu.
	const chosen = useRef(false)
	function rememberSlot(event: SyntheticEvent<HTMLElement>) {
		// A mouse press belongs to click and drag; only a touch or pen press can
		// become a long press. A right-click arrives as `contextmenu`.
		if (event.type === 'pointerdown' && (event as PointerEvent<HTMLElement>).pointerType === 'mouse') return
		const target = event.target as Element
		const pressed = target.closest<HTMLElement>('[data-calendar-slot]')
		if (pressed) return setSlot(pressed)
		const chip = target.closest('[data-slot="context-menu-trigger"]')
		if (chip === event.currentTarget || chip?.hasAttribute('data-disabled')) event.stopPropagation()
	}
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild onContextMenuCapture={rememberSlot} onPointerDownCapture={rememberSlot}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label="Time slot actions"
				onCloseAutoFocus={(event) => {
					if (!chosen.current) return
					chosen.current = false
					event.preventDefault()
					onNewEvent(slot as HTMLElement)
				}}
			>
				<ContextMenuItem
					onSelect={() => {
						chosen.current = true
					}}
				>
					<CalendarPlus aria-hidden="true" />
					New event here
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}
