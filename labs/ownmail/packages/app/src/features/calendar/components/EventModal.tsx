import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import {
	AlertTriangle,
	AlignLeft,
	CalendarDays,
	Clock,
	GripVertical,
	MapPin,
	Pencil,
	Trash2,
	Users,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RecipientInput } from '#shared/components/RecipientInput'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#shared/components/ui/select'
import { Textarea } from '#shared/components/ui/textarea'
import { type EventTone, eventColorClass, labelBadgeClass } from '#shared/lib/color-tone'
import { valueToTokens } from '#shared/lib/contact-token'
import {
	clampPointToViewport,
	createPanelPosition,
	ESTIMATED_PANEL_SIZE,
	type Point,
	type Rect,
	type Size,
} from '#shared/lib/modal-position'
import { cn } from '#shared/lib/utils'
import {
	calendarDateInTimeZone,
	calendarSlotTime,
	calendarWallClockHour,
	eventTimes,
	fmtCompactTime,
	formatFullDate,
	ymd,
} from '../lib/calendar.js'
import { calendarTone, eventTone } from '../lib/calendar-ui-model.js'
import {
	useCreateEventMutation,
	useDeleteEventMutation,
	useRsvpEventMutation,
	useUpdateEventMutation,
} from '../state/calendar-state.js'

const START_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 0.5)
const END_TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 0.5)
const WEEKDAYS = [
	['MO', 'Mon'],
	['TU', 'Tue'],
	['WE', 'Wed'],
	['TH', 'Thu'],
	['FR', 'Fri'],
	['SA', 'Sat'],
	['SU', 'Sun'],
] as const
type Weekday = (typeof WEEKDAYS)[number][0]
const WEEKDAY_BY_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const satisfies readonly Weekday[]
type RepeatOption = 'none' | 'weekly' | 'biweekly' | 'yearly'
export const NEW_EVENT_HOURS = { startHour: 9, endHour: 10 } as const
export const EVENT_DIALOG_PANEL_CLASS =
	'w-full max-w-md overflow-hidden rounded-sm border border-border bg-card shadow-2xl'
/** Floating, draggable composer panel — no backdrop, positioned beside the slot. */
export const EVENT_COMPOSER_PANEL_CLASS =
	'fixed z-50 flex max-h-[calc(100dvh-1rem)] w-[28rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl'

export function eventComposerMaxHeight(top: number): string {
	return `calc(100dvh - ${Math.max(0, top) + 8}px)`
}

function currentViewportSize(): Size {
	return { width: window.innerWidth, height: window.innerHeight }
}

function eventBarClass(tone: EventTone): string {
	return eventColorClass(tone, 'bg')
}

function eventDotClass(tone: EventTone): string {
	return eventColorClass(tone, 'bg')
}

/** Create/edit/RSVP dialog for a single event on the primary calendar. */
export function EventModal({
	event,
	defaultStart,
	calendarId,
	calendarName,
	calendars,
	anchorRect,
	timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
	preserveDefaultStartTime = false,
	events = [],
	onDraftChange,
	onClose,
}: {
	event: Event | null
	defaultStart: Date
	calendarId: string
	calendarName: string
	calendars: Calendar[]
	anchorRect?: Rect | null
	timeZone?: string
	preserveDefaultStartTime?: boolean
	events?: Event[]
	onDraftChange?: (event: Event | null) => void
	onClose: (changed: boolean) => void
}) {
	const times = event ? eventTimes(event) : null
	const initialStart = times?.start ?? new Date(defaultStart.getTime())
	const initialDate = times?.allDay ? initialStart : calendarDateInTimeZone(initialStart, timeZone)
	const initialHours = eventInitialHours(initialStart, Boolean(event) || preserveDefaultStartTime, timeZone)

	const [title, setTitle] = useState(event?.title ?? '')
	const [location, setLocation] = useState(event?.location ?? '')
	const [description, setDescription] = useState(event?.description ?? '')
	const [guests, setGuests] = useState('')
	const [startHour, setStartHour] = useState(initialHours.startHour)
	const [endHour, setEndHour] = useState(initialHours.endHour)
	const [eventDate, setEventDate] = useState(() => ymd(initialDate))
	const [allDay, setAllDay] = useState(times?.allDay ?? false)
	const [repeat, setRepeat] = useState<RepeatOption>('none')
	const [weekdays, setWeekdays] = useState<Weekday[]>(() => [defaultWeekday(initialDate)])
	const [weekdaysTouched, setWeekdaysTouched] = useState(false)
	const [selectedCalendarId, setSelectedCalendarId] = useState(calendarId)
	const [editing, setEditing] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const titleInputRef = useRef<HTMLInputElement>(null)
	const editButtonRef = useRef<HTMLButtonElement>(null)
	const deleteButtonRef = useRef<HTMLButtonElement>(null)
	const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null)
	const deletePendingRef = useRef(false)
	const wasEditing = useRef(false)
	const wasConfirmingDelete = useRef(false)
	const createMutation = useCreateEventMutation()
	const updateMutation = useUpdateEventMutation(event)
	const deleteMutation = useDeleteEventMutation(event?.id ?? '')
	const rsvpMutation = useRsvpEventMutation(event?.id ?? '')

	// The create composer floats over the calendar (no backdrop) so the grid
	// stays visible; the user can drag it aside by its header to reference a day.
	const [panelPos, setPanelPos] = useState<Point>(() =>
		createPanelPosition(anchorRect, ESTIMATED_PANEL_SIZE, currentViewportSize()),
	)
	const dragCleanup = useRef<(() => void) | null>(null)

	function startPanelDrag(pointerEvent: React.PointerEvent) {
		const start = { x: pointerEvent.clientX, y: pointerEvent.clientY }
		const origin = { x: panelPos.x, y: panelPos.y }
		function onMove(moveEvent: PointerEvent) {
			setPanelPos(
				clampPointToViewport(
					{ x: origin.x + (moveEvent.clientX - start.x), y: origin.y + (moveEvent.clientY - start.y) },
					ESTIMATED_PANEL_SIZE,
					currentViewportSize(),
				),
			)
		}
		function stop() {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', stop)
			dragCleanup.current = null
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', stop)
		dragCleanup.current = stop
	}

	// Tear down a drag still in flight if the composer unmounts mid-drag.
	useEffect(() => () => dragCleanup.current?.(), [])

	// Keep the full composer inside the viewport after a resize or device rotation.
	useEffect(() => {
		function keepPanelInViewport() {
			setPanelPos((position) => clampPointToViewport(position, ESTIMATED_PANEL_SIZE, currentViewportSize()))
		}
		window.addEventListener('resize', keepPanelInViewport)
		return () => window.removeEventListener('resize', keepPanelInViewport)
	}, [])

	// The floating composer has no backdrop to click away, so Escape closes it.
	useEffect(() => {
		if (event) return
		function onKey(keyEvent: KeyboardEvent) {
			if (keyEvent.key === 'Escape' && !busy) onClose(false)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [busy, event, onClose])

	const canRsvp = Boolean(event?.participants?.length && event?.organizer)
	const eventCalendar = event ? calendars.find((calendar) => calendar.id === event.calendar_id) : undefined
	const tone = event ? eventTone(event, 0, eventCalendar) : 'blue'
	const selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId) ?? calendars[0]
	const selectedCalendarTone = selectedCalendar ? calendarTone(selectedCalendar) : 'blue'
	const previewEvent = useMemo(() => {
		if (event || !isDateInput(eventDate)) return null
		const selectedId = selectedCalendar?.id ?? calendarId
		const recurrence = repeat === 'none' ? undefined : recurrenceFromForm(repeat, weekdays)
		const when = allDay
			? { object: 'date' as const, date: eventDate }
			: {
					object: 'timespan' as const,
					start_time: Math.floor(
						calendarSlotTime(dateFromInput(eventDate), startHour, timeZone).getTime() / 1000,
					),
					end_time: Math.floor(
						calendarSlotTime(
							dateFromInput(eventDate),
							Math.max(endHour, startHour + 0.5),
							timeZone,
						).getTime() / 1000,
					),
				}
		return {
			id: '__new-event-preview__',
			calendar_id: selectedId,
			title: title.trim() || 'Untitled event',
			when,
			...(recurrence ? { recurrence: [recurrence] } : {}),
		} as Event
	}, [
		allDay,
		calendarId,
		endHour,
		event,
		eventDate,
		repeat,
		selectedCalendar?.id,
		startHour,
		title,
		timeZone,
		weekdays,
	])
	const conflictCount = previewEvent ? countConflicts(previewEvent, events) : 0

	useEffect(() => {
		onDraftChange?.(previewEvent)
	}, [onDraftChange, previewEvent])
	useEffect(() => () => onDraftChange?.(null), [onDraftChange])

	async function save() {
		if (!isDateInput(eventDate)) {
			setError('Choose a valid event date.')
			return
		}
		if ((repeat === 'weekly' || repeat === 'biweekly') && weekdays.length === 0) {
			setError('Choose at least one weekday for a repeating event.')
			return
		}
		if (
			(repeat === 'weekly' || repeat === 'biweekly') &&
			!weekdays.includes(defaultWeekday(dateFromInput(eventDate)))
		) {
			setError('Include the event date weekday in the repeating schedule.')
			return
		}
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(
				calendarSlotTime(dateFromInput(eventDate), startHour, timeZone).getTime() / 1000,
			)
			const endTime = Math.floor(
				calendarSlotTime(dateFromInput(eventDate), Math.max(endHour, startHour + 0.5), timeZone).getTime() /
					1000,
			)
			const participants = valueToTokens(guests)
			const recurrence = repeat === 'none' ? undefined : recurrenceFromForm(repeat, weekdays)
			await createMutation.mutateAsync({
				calendarId: selectedCalendar?.id ?? calendarId,
				title: title.trim() || 'Untitled event',
				...(location ? { location } : {}),
				...(description.trim() ? { description } : {}),
				...(participants.length ? { participants } : {}),
				...(allDay ? { allDayDate: eventDate } : { startTime, endTime }),
				...(recurrence ? { recurrence, timezone: timeZone } : {}),
			})
			onClose(true)
		} catch {
			setError('Could not save the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function saveEdit() {
		/* v8 ignore next -- saveEdit() is only wired to the edit form, which renders only when event is present -- @preserve */
		if (!event) return
		setBusy(true)
		setError(null)
		try {
			const eventDay = calendarDateInTimeZone(initialStart, timeZone)
			const startTime = Math.floor(calendarSlotTime(eventDay, startHour, timeZone).getTime() / 1000)
			const endTime = Math.floor(
				calendarSlotTime(eventDay, Math.max(endHour, startHour + 0.5), timeZone).getTime() / 1000,
			)
			await updateMutation.mutateAsync({
				eventId: event.id,
				calendarId: event.calendar_id ?? calendarId,
				title: title.trim() || 'Untitled event',
				location,
				description,
				...(allDay ? {} : { startTime, endTime }),
			})
			onClose(true)
		} catch {
			setError('Could not save the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function remove() {
		/* v8 ignore next -- remove() is only wired to the delete button, which renders only when event is present -- @preserve */
		if (!event) return
		/* v8 ignore next -- @preserve the disabled confirmation button prevents repeat UI activation; this guard also closes same-tick re-entry */
		if (deletePendingRef.current) return
		deletePendingRef.current = true
		setBusy(true)
		setError(null)
		try {
			await deleteMutation.mutateAsync({
				eventId: event.id,
				calendarId: event.calendar_id ?? calendarId,
			})
			onClose(true)
		} catch {
			deletePendingRef.current = false
			setError('Could not delete the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function rsvp(status: 'yes' | 'no' | 'maybe') {
		/* v8 ignore next -- rsvp() is only wired to the RSVP buttons, which render only when event is present -- @preserve */
		if (!event) return
		setBusy(true)
		try {
			await rsvpMutation.mutateAsync({
				eventId: event.id,
				calendarId: event.calendar_id ?? calendarId,
				status,
			})
			onClose(true)
		} catch {
			setError('RSVP failed')
			setBusy(false)
		}
	}

	useEffect(() => {
		if (!event) titleInputRef.current?.focus({ preventScroll: true })
	}, [event])
	useEffect(() => {
		if (!editing && wasEditing.current) editButtonRef.current?.focus()
		wasEditing.current = editing
	}, [editing])
	useEffect(() => {
		if (confirmingDelete) cancelDeleteButtonRef.current?.focus()
		else if (wasConfirmingDelete.current) deleteButtonRef.current?.focus()
		wasConfirmingDelete.current = confirmingDelete
	}, [confirmingDelete])

	function beginDelete() {
		setError(null)
		setConfirmingDelete(true)
	}

	function cancelDelete() {
		setError(null)
		setConfirmingDelete(false)
	}

	if (event && times) {
		const persistedEvent = event
		const persistedTimes = times

		function resetEditDraft() {
			setTitle(persistedEvent.title ?? '')
			setLocation(persistedEvent.location ?? '')
			setDescription(persistedEvent.description ?? '')
			setStartHour(initialHours.startHour)
			setEndHour(initialHours.endHour)
			setAllDay(persistedTimes.allDay)
			setError(null)
		}

		function beginEdit() {
			resetEditDraft()
			setEditing(true)
		}

		function cancelEdit() {
			resetEditDraft()
			setEditing(false)
		}

		const when = times.allDay ? 'All day' : `${fmtCompactTime(times.start)} – ${fmtCompactTime(times.end)}`
		const attendeeText = event.participants
			?.map((participant) => participant.name || participant.email)
			.filter(Boolean)
			.join(', ')
		return (
			<Dialog
				open
				onOpenChange={(next) => {
					/* v8 ignore else -- @preserve the controlled open dialog only requests dismissal; busy or open requests are intentional no-ops */
					if (!next && !busy) {
						if (confirmingDelete) cancelDelete()
						else onClose(false)
					}
				}}
			>
				<DialogContent className={EVENT_DIALOG_PANEL_CLASS}>
					<DialogTitle className="sr-only">Event details</DialogTitle>
					<div className={cn('h-1.5 w-full', eventBarClass(tone))} />
					<div className="flex items-start justify-between gap-3 px-5 pt-4">
						<div className="flex min-w-0 items-start gap-3">
							<span className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', eventDotClass(tone))} />
							<div className="min-w-0">
								<h2 className="text-lg leading-snug font-semibold text-balance">
									{event.title || '(untitled)'}
								</h2>
								<p className="text-sm text-muted-foreground">{calendarName}</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => onClose(false)}
							disabled={busy}
							aria-label="Close"
							className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

					{editing ? (
						<>
							<div className="space-y-4 px-5 py-4">
								<input
									aria-label="Title"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="Add title"
									className="event-dialog-field w-full border-b border-border bg-transparent pb-2 text-lg font-medium outline-none placeholder:text-muted-foreground focus:border-primary"
								/>
								<div className="flex items-center gap-3 text-sm">
									<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span>{formatFullDate(times.start)}</span>
								</div>
								<EventFields
									startHour={startHour}
									endHour={endHour}
									allDay={allDay}
									onStartHour={setStartHour}
									onEndHour={setEndHour}
									location={location}
									onLocation={setLocation}
									description={description}
									onDescription={setDescription}
								/>
								{error ? (
									<p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
								) : null}
							</div>
							<div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
								<button
									type="button"
									onClick={cancelEdit}
									disabled={busy}
									className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
								>
									Cancel
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={saveEdit}
									className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid active:scale-[0.98] disabled:opacity-50"
								>
									{busy ? 'Saving...' : 'Save changes'}
								</button>
							</div>
						</>
					) : (
						<>
							<div className="space-y-3 px-5 py-4 text-sm">
								<div className="flex items-center gap-3">
									<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span>{formatFullDate(times.start)}</span>
								</div>
								<div className="flex items-center gap-3">
									<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span>{when}</span>
								</div>
								{event.location ? (
									<div className="flex items-center gap-3">
										<MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span>{event.location}</span>
									</div>
								) : null}
								{attendeeText ? (
									<div className="flex items-start gap-3">
										<Users className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span>{attendeeText}</span>
									</div>
								) : null}
								{event.description ? (
									<div className="flex items-start gap-3">
										<AlignLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span className="text-foreground/80">{event.description}</span>
									</div>
								) : null}
								{error ? (
									<p
										className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
										role={confirmingDelete ? 'alert' : undefined}
									>
										{error}
									</p>
								) : null}
							</div>

							<div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
								{confirmingDelete ? (
									<fieldset
										className="flex w-full flex-wrap items-center justify-end gap-2"
										aria-describedby="event-delete-confirm-description"
									>
										<legend className="mr-auto min-w-48">
											<span className="block text-sm font-semibold text-foreground">Delete this event?</span>
											<span
												id="event-delete-confirm-description"
												className="block text-xs text-muted-foreground"
											>
												This action cannot be undone.
											</span>
										</legend>
										<button
											ref={cancelDeleteButtonRef}
											type="button"
											onClick={cancelDelete}
											disabled={busy}
											className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:opacity-50"
										>
											Cancel
										</button>
										<button
											type="button"
											onClick={remove}
											disabled={busy}
											aria-describedby="event-delete-confirm-description"
											className="flex min-h-11 items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:opacity-50"
										>
											<Trash2 className="h-4 w-4" /> {busy ? 'Deleting…' : 'Delete event'}
										</button>
									</fieldset>
								) : (
									<>
										{canRsvp
											? (['yes', 'maybe', 'no'] as const).map((status) => (
													<button
														key={status}
														type="button"
														disabled={busy}
														onClick={() => rsvp(status)}
														className="min-h-11 rounded-lg border border-border px-3 py-1.5 text-xs capitalize hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
													>
														{status === 'yes' ? '✓ Yes' : status === 'no' ? '✗ No' : '? Maybe'}
													</button>
												))
											: null}
										{!event.read_only ? (
											<>
												<button
													ref={editButtonRef}
													type="button"
													disabled={busy}
													onClick={beginEdit}
													className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
												>
													<Pencil className="h-4 w-4" /> Edit
												</button>
												<button
													ref={deleteButtonRef}
													type="button"
													disabled={busy}
													onClick={beginDelete}
													className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
												>
													<Trash2 className="h-4 w-4" /> Delete
												</button>
											</>
										) : null}
										<button
											type="button"
											onClick={() => onClose(false)}
											disabled={busy}
											className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid active:scale-[0.98]"
										>
											Done
										</button>
									</>
								)}
							</div>
						</>
					)}
				</DialogContent>
			</Dialog>
		)
	}

	return (
		<div
			role="dialog"
			aria-label="New event"
			className={EVENT_COMPOSER_PANEL_CLASS}
			style={{
				left: panelPos.x,
				top: panelPos.y,
				maxHeight: eventComposerMaxHeight(panelPos.y),
			}}
		>
			<div className={cn('h-1 w-full shrink-0', eventBarClass(selectedCalendarTone))} />
			<div
				onPointerDown={startPanelDrag}
				className="flex touch-none items-center justify-between gap-3 border-b border-border px-5 py-3 select-none"
			>
				<div className="flex min-w-0 cursor-grab items-center gap-2 active:cursor-grabbing">
					<GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<div>
						<h2 className="font-display text-lg font-semibold">New event</h2>
						<p className="text-xs text-muted-foreground">Add the essentials, then save.</p>
					</div>
				</div>
				<button
					type="button"
					onClick={() => onClose(false)}
					disabled={busy}
					aria-label="Close"
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-50"
				>
					<X className="h-5 w-5" />
				</button>
			</div>

			<div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
				<label className="block space-y-1.5" htmlFor="event-title">
					<span className="text-sm font-medium">Title</span>
					<input
						id="event-title"
						ref={titleInputRef}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Add title"
						className="event-dialog-field h-11 w-full rounded-lg border border-input bg-background px-3 text-base font-medium outline-none placeholder:text-muted-foreground hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
					/>
				</label>

				<section
					aria-labelledby="event-when-heading"
					className="space-y-4 rounded-xl border border-border bg-muted/20 p-4"
				>
					<div className="flex items-center justify-between gap-4">
						<div>
							<h3 id="event-when-heading" className="text-sm font-semibold">
								When
							</h3>
							<p className="text-xs text-muted-foreground">{formatFullDate(dateFromInput(eventDate))}</p>
						</div>
						<label className="flex items-center gap-2 text-sm font-medium">
							<span>All day</span>
							<input
								type="checkbox"
								checked={allDay}
								onChange={(changeEvent) => setAllDay(changeEvent.target.checked)}
								className="peer sr-only"
							/>
							<span
								aria-hidden="true"
								className="relative h-6 w-10 rounded-full bg-muted-foreground/35 transition-colors before:absolute before:top-1 before:left-1 before:h-4 before:w-4 before:rounded-full before:bg-background before:shadow-sm before:transition-transform peer-checked:bg-primary peer-checked:before:translate-x-4 peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40"
							/>
						</label>
					</div>
					<label className="block space-y-1.5" htmlFor="event-date">
						<span className="text-xs font-medium text-muted-foreground">Date</span>
						<input
							id="event-date"
							aria-label="Event date"
							type="date"
							value={eventDate}
							onChange={(changeEvent) => {
								const nextDate = changeEvent.target.value
								setEventDate(nextDate)
								if (!weekdaysTouched && isDateInput(nextDate))
									setWeekdays([defaultWeekday(dateFromInput(nextDate))])
							}}
							className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
						/>
					</label>
					<EventTimeFields
						startHour={startHour}
						endHour={endHour}
						allDay={allDay}
						onStartHour={setStartHour}
						onEndHour={setEndHour}
					/>
				</section>

				{conflictCount > 0 ? (
					<p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						May conflict with {conflictCount} existing {conflictCount === 1 ? 'event' : 'events'}.
					</p>
				) : null}

				<EventDetailsFields
					location={location}
					onLocation={setLocation}
					description={description}
					onDescription={setDescription}
				/>

				<section className="space-y-1.5">
					<h3 className="text-sm font-medium">Guests</h3>
					<div className="rounded-lg border border-input bg-background px-3 py-1.5 transition-colors hover:bg-muted/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
						<RecipientInput
							id="event-guests"
							label="Guests"
							value={guests}
							onChange={setGuests}
							placeholder="Add people by name or email"
							className="w-full"
						/>
					</div>
				</section>

				<RecurrenceFields
					repeat={repeat}
					onRepeat={setRepeat}
					weekdays={weekdays}
					onWeekdays={(nextWeekdays) => {
						setWeekdaysTouched(true)
						setWeekdays(nextWeekdays)
					}}
				/>

				<section className="space-y-2">
					<h3 className="text-sm font-medium">Calendar</h3>
					<div className="flex flex-wrap gap-2">
						{calendars.map((calendar, index) => {
							const active = calendar.id === selectedCalendarId
							const tone = calendarTone(calendar, index)
							return (
								<button
									key={calendar.id}
									type="button"
									onClick={() => setSelectedCalendarId(calendar.id)}
									className={eventCalendarChoiceClass(active, tone)}
								>
									<span className={cn('h-2 w-2 rounded-full', eventDotClass(tone))} />
									{calendar.name || 'Calendar'}
								</button>
							)
						})}
					</div>
				</section>
				{error ? (
					<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
				) : null}
			</div>

			<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">
				<button
					type="button"
					onClick={() => onClose(false)}
					disabled={busy}
					className="min-h-11 rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={save}
					className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? 'Saving...' : 'Save event'}
				</button>
			</div>
		</div>
	)
}

function EventTimeFields({
	startHour,
	endHour,
	allDay,
	onStartHour,
	onEndHour,
}: {
	startHour: number
	endHour: number
	allDay: boolean
	onStartHour: (hour: number) => void
	onEndHour: (hour: number) => void
}) {
	if (allDay)
		return <p className="text-sm text-muted-foreground">This event will appear across the full day.</p>
	return (
		<div className="grid grid-cols-2 gap-3">
			<div className="space-y-1.5">
				<span className="text-xs font-medium text-muted-foreground">Starts</span>
				<Select value={String(startHour)} onValueChange={(value) => onStartHour(Number(value))}>
					<SelectTrigger aria-label="Start time" className="h-11 w-full bg-background">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{START_TIME_OPTIONS.map((hour) => (
							<SelectItem key={hour} value={String(hour)}>
								{formatDecimalHour(hour)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-1.5">
				<span className="text-xs font-medium text-muted-foreground">Ends</span>
				<Select value={String(endHour)} onValueChange={(value) => onEndHour(Number(value))}>
					<SelectTrigger aria-label="End time" className="h-11 w-full bg-background">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{END_TIME_OPTIONS.map((hour) => (
							<SelectItem key={hour} value={String(hour)}>
								{formatDecimalHour(hour)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	)
}

function EventDetailsFields({
	location,
	onLocation,
	description,
	onDescription,
}: {
	location: string
	onLocation: (value: string) => void
	description: string
	onDescription: (value: string) => void
}) {
	return (
		<section className="space-y-4">
			<h3 className="text-sm font-medium">Details</h3>
			<label className="block space-y-1.5" htmlFor="event-location">
				<span className="text-xs font-medium text-muted-foreground">Location</span>
				<input
					id="event-location"
					aria-label="Location"
					value={location}
					onChange={(event) => onLocation(event.target.value)}
					placeholder="Add location"
					className="event-dialog-field h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
				/>
			</label>
			<label className="block space-y-1.5" htmlFor="event-description">
				<span className="text-xs font-medium text-muted-foreground">Notes</span>
				<Textarea
					id="event-description"
					aria-label="Description"
					value={description}
					onChange={(event) => onDescription(event.target.value)}
					placeholder="Add description"
					className="min-h-24 resize-y border-input bg-background shadow-none hover:bg-muted/30"
				/>
			</label>
		</section>
	)
}

/** Editable time / location / description fields shared by create and edit. */
function EventFields({
	startHour,
	endHour,
	allDay,
	onStartHour,
	onEndHour,
	location,
	onLocation,
	description,
	onDescription,
}: {
	startHour: number
	endHour: number
	allDay: boolean
	onStartHour: (hour: number) => void
	onEndHour: (hour: number) => void
	location: string
	onLocation: (value: string) => void
	description: string
	onDescription: (value: string) => void
}) {
	return (
		<>
			<EventTimeFields
				startHour={startHour}
				endHour={endHour}
				allDay={allDay}
				onStartHour={onStartHour}
				onEndHour={onEndHour}
			/>
			<EventDetailsFields
				location={location}
				onLocation={onLocation}
				description={description}
				onDescription={onDescription}
			/>
		</>
	)
}

function RecurrenceFields({
	repeat,
	onRepeat,
	weekdays,
	onWeekdays,
}: {
	repeat: RepeatOption
	onRepeat: (repeat: RepeatOption) => void
	weekdays: Weekday[]
	onWeekdays: (weekdays: Weekday[]) => void
}) {
	return (
		<section className="space-y-2">
			<label className="block space-y-1.5">
				<span className="text-sm font-medium">Repeat</span>
				<select
					value={repeat}
					onChange={(event) => onRepeat(event.target.value as RepeatOption)}
					className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
				>
					<option value="none">Does not repeat</option>
					<option value="weekly">Weekly</option>
					<option value="biweekly">Every 2 weeks</option>
					<option value="yearly">Yearly</option>
				</select>
			</label>
			{repeat === 'weekly' || repeat === 'biweekly' ? (
				<fieldset className="flex flex-wrap gap-1.5">
					<legend className="mb-1 text-xs font-medium text-muted-foreground">Repeat on</legend>
					{WEEKDAYS.map(([weekday, label]) => {
						const selected = weekdays.includes(weekday)
						return (
							<button
								key={weekday}
								type="button"
								aria-pressed={selected}
								onClick={() =>
									onWeekdays(
										selected ? weekdays.filter((value) => value !== weekday) : [...weekdays, weekday],
									)
								}
								className={cn(
									'min-h-11 min-w-11 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
									selected
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
								)}
							>
								{label}
							</button>
						)
					})}
				</fieldset>
			) : null}
		</section>
	)
}

function recurrenceFromForm(repeat: RepeatOption, weekdays: Weekday[]) {
	if (repeat === 'yearly') return { frequency: 'yearly' as const, interval: 1 as const }
	if ((repeat === 'weekly' || repeat === 'biweekly') && weekdays.length) {
		return {
			frequency: 'weekly' as const,
			interval: repeat === 'weekly' ? (1 as const) : (2 as const),
			weekdays,
		}
	}
	return undefined
}

function defaultWeekday(date: Date): Weekday {
	return WEEKDAY_BY_DAY[date.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6]
}

function isDateInput(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00`)
	return !Number.isNaN(date.getTime()) && ymd(date) === value
}

function dateFromInput(value: string): Date {
	return isDateInput(value) ? new Date(`${value}T00:00:00`) : new Date()
}

function countConflicts(candidate: Event, events: Event[]): number {
	const candidateTimes = eventTimes(candidate)
	/* v8 ignore next -- preview events are constructed only from a valid date and complete time range. -- @preserve */
	if (!candidateTimes) return 0
	return events.filter((event) => {
		const times = eventTimes(event)
		if (!times || event.id === candidate.id) return false
		return candidateTimes.start < times.end && candidateTimes.end > times.start
	}).length
}

export function eventCalendarChoiceClass(active: boolean, tone: EventTone): string {
	return cn(
		'flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
		active ? labelBadgeClass(tone) : 'border-border text-muted-foreground hover:bg-muted',
	)
}

function decimalHour(date: Date, timeZone?: string): number {
	return calendarWallClockHour(date, timeZone)
}

export function eventInitialHours(
	start: Date,
	preserveStartTime = false,
	timeZone?: string,
): { startHour: number; endHour: number } {
	const startHour = decimalHour(start, timeZone)
	const normalizedStartHour =
		(preserveStartTime ? startHour >= 0 : startHour >= 7) && startHour < 24 ? nearestHalfHour(startHour) : 9
	return { startHour: normalizedStartHour, endHour: Math.min(24, normalizedStartHour + 1) }
}

function nearestHalfHour(hour: number): number {
	return Math.min(23.5, Math.round(hour * 2) / 2)
}

function formatDecimalHour(hour: number): string {
	const rawWholeHour = Math.floor(hour)
	const wholeHour = rawWholeHour % 24
	const minute = Math.round((hour - rawWholeHour) * 60)
	const period = wholeHour >= 12 ? 'PM' : 'AM'
	const displayHour = wholeHour % 12 === 0 ? 12 : wholeHour % 12
	return minute === 0
		? `${displayHour} ${period}`
		: `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}
