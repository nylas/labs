import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { AlertTriangle, CalendarDays, GripVertical, X } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { RecipientInput } from '#shared/components/RecipientInput'
import { Button } from '#shared/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { GLASS_PANEL_FROM_SM_CLASS, GlassPanelScope } from '#shared/components/ui/glass'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#shared/components/ui/select'
import { Textarea } from '#shared/components/ui/textarea'
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
	formatFullDate,
	ymd,
} from '../lib/calendar.js'
import { calendarColors, eventColor, eventColorStyle } from '../lib/calendar-ui-model.js'
import { useCreateEventMutation, useUpdateEventMutation } from '../state/calendar-state.js'
import { EventDetails, type EventDetailsHandle, EventDetailsHeader } from './EventDetails.js'

/** Times are offered in the grid's 15-minute steps, so a dragged event round-trips through the editor. */
const TIME_STEP_HOURS = 0.25
const START_TIME_OPTIONS = Array.from({ length: 24 / TIME_STEP_HOURS }, (_, i) => i * TIME_STEP_HOURS)
const END_TIME_OPTIONS = Array.from({ length: 24 / TIME_STEP_HOURS }, (_, i) => (i + 1) * TIME_STEP_HOURS)
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
	'w-full overflow-y-auto overscroll-contain bg-card sm:max-h-[85vh] sm:max-w-md'
/** Floating, draggable composer panel — no backdrop, positioned beside the slot.
 * Panel glass where it floats (from `sm`); a flat full-screen editor on a phone. */
export const EVENT_COMPOSER_PANEL_CLASS = `event-composer-panel fixed z-50 flex flex-col overflow-hidden border ${GLASS_PANEL_FROM_SM_CLASS}`

export function eventComposerMaxHeight(top: number): string {
	return `calc(100dvh - ${Math.max(0, top) + 8}px)`
}

function currentViewportSize(): Size {
	return { width: window.innerWidth, height: window.innerHeight }
}

/** Solid swatch in the calendar's colour; pair with `eventColorStyle`. */
const EVENT_SWATCH_CLASS = 'event-color bg-[var(--event-c)]'

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
	defaultDurationMinutes = 60,
	startInEdit = false,
	startOnDeleteConfirmation = false,
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
	/** Length of a new event, e.g. the range dragged out on the grid. */
	defaultDurationMinutes?: number
	/** Open an existing event straight in the editor; cancelling then closes it. */
	startInEdit?: boolean
	/** Open an existing event on its delete confirmation, from its context menu. */
	startOnDeleteConfirmation?: boolean
	events?: Event[]
	onDraftChange?: (event: Event | null) => void
	onClose: (changed: boolean) => void
}) {
	const times = event ? eventTimes(event) : null
	const initialStart = times?.start ?? new Date(defaultStart.getTime())
	const initialDate = times?.allDay ? initialStart : calendarDateInTimeZone(initialStart, timeZone)
	const initialHours = times
		? eventHours(times, timeZone)
		: eventInitialHours(initialStart, preserveDefaultStartTime, timeZone, defaultDurationMinutes / 60)

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
	const [editing, setEditing] = useState(startInEdit)
	const [busy, setBusy] = useState(false)
	const savingRef = useRef(false)
	const [error, setError] = useState<string | null>(null)
	const [confirmDiscard, setConfirmDiscard] = useState(false)
	const router = useRouter({ warn: false })
	const cancelNavigation = useRef<(() => void) | null>(null)
	const discardAction = useRef<(() => void) | null>(null)
	const scheduleChanged =
		startHour !== initialHours.startHour || endHour !== initialHours.endHour || eventDate !== ymd(initialDate)
	// Persisted instants disambiguate the repeated hour when clocks move back.
	const durationMinutes =
		times && !scheduleChanged
			? (times.end.getTime() - times.start.getTime()) / 60_000
			: (calendarSlotTime(dateFromInput(eventDate), endHour, timeZone).getTime() -
					calendarSlotTime(dateFromInput(eventDate), startHour, timeZone).getTime()) /
				60_000
	const invalidTimeRange = (!times || scheduleChanged) && endHour <= startHour
	const dirty =
		title !== (event?.title ?? '') ||
		location !== (event?.location ?? '') ||
		description !== (event?.description ?? '') ||
		Boolean(guests) ||
		scheduleChanged ||
		allDay !== (times?.allDay ?? false) ||
		repeat !== 'none' ||
		selectedCalendarId !== calendarId
	const discardFocus = useRef<HTMLElement | null>(null)
	const requestDiscard = useCallback(
		(action: () => void) => {
			if (busy || savingRef.current) return
			if (!dirty) {
				action()
				return
			}
			discardFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
			discardAction.current = action
			setConfirmDiscard(true)
		},
		[busy, dirty],
	)

	function changeStartHour(hour: number) {
		const day = dateFromInput(eventDate)
		const duration = Math.max(60_000, durationMinutes * 60_000)
		const nextStart = calendarSlotTime(day, hour, timeZone)
		const nextEnd = new Date(nextStart.getTime() + duration)
		setEndHour(eventHours({ start: nextStart, end: nextEnd }, timeZone).endHour)
		setStartHour(hour)
		setError(null)
	}

	function dismissDiscard() {
		setConfirmDiscard(false)
		cancelNavigation.current?.()
		cancelNavigation.current = null
	}

	function confirmNavigation(): Promise<boolean> {
		if (savingRef.current) return Promise.resolve(true)
		return new Promise((resolve) => {
			cancelNavigation.current?.()
			cancelNavigation.current = () => resolve(true)
			requestDiscard(() => {
				cancelNavigation.current = null
				resolve(false)
			})
		})
	}

	useEffect(() => () => cancelNavigation.current?.(), [])
	const discardConfirmation = (
		<Dialog open={confirmDiscard} onOpenChange={dismissDiscard}>
			<DialogContent
				aria-describedby="event-discard-description"
				className="p-5"
				onCloseAutoFocus={(focusEvent) => {
					focusEvent.preventDefault()
					if (discardFocus.current?.isConnected) discardFocus.current.focus()
				}}
			>
				<DialogTitle className="text-lg font-semibold">Discard event changes?</DialogTitle>
				<p id="event-discard-description" className="mt-hairline text-sm text-muted-foreground">
					Your unsaved changes will be lost.
				</p>
				<div className="mt-section flex justify-end gap-cluster">
					<Button variant="outline" onClick={dismissDiscard}>
						Keep editing
					</Button>
					<Button
						variant="destructive"
						onClick={() => {
							setConfirmDiscard(false)
							discardAction.current?.()
						}}
					>
						Discard changes
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
	const titleInputRef = useRef<HTMLInputElement>(null)
	const detailsRef = useRef<EventDetailsHandle>(null)
	// Set when the editor hands back to the read-only view, so focus returns to Edit.
	const returnedFromEdit = useRef(false)
	const createMutation = useCreateEventMutation()
	const updateMutation = useUpdateEventMutation(event)

	// The create composer floats over the calendar (no backdrop) so the grid
	// stays visible; the user can drag it aside by its header to reference a day.
	const [panelPos, setPanelPos] = useState<Point>(() =>
		createPanelPosition(anchorRect, ESTIMATED_PANEL_SIZE, currentViewportSize()),
	)
	const dragCleanup = useRef<(() => void) | null>(null)

	function startPanelDrag(pointerEvent: React.PointerEvent) {
		if (pointerEvent.pointerType === 'touch') return
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
			if (keyEvent.key === 'Escape' && !keyEvent.defaultPrevented && !busy && !confirmDiscard)
				requestDiscard(() => onClose(false))
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [busy, event, onClose, requestDiscard, confirmDiscard])

	const colors = calendarColors(calendars)
	const selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId) ?? calendars[0]
	// The detail view shows the event's own calendar; the composer shows the one being chosen.
	const selectedColorStyle = eventColorStyle(
		eventColor({ calendar_id: selectedCalendar?.id ?? calendarId }, colors),
	)
	const colorStyle = event ? eventColorStyle(eventColor(event, colors)) : selectedColorStyle
	const previewEvent = useMemo(() => {
		if (event || !isDateInput(eventDate) || (!allDay && endHour <= startHour)) return null
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
						calendarSlotTime(dateFromInput(eventDate), endHour, timeZone).getTime() / 1000,
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
		if (savingRef.current) return
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
		if (!allDay && endHour <= startHour) {
			setError('Choose an end time after the start time.')
			return
		}
		if (!allDay && !validEditorRange(dateFromInput(eventDate), startHour, endHour, timeZone)) {
			setError('Choose times that exist in this time zone. Daylight saving time may skip this hour.')
			return
		}
		savingRef.current = true
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(
				calendarSlotTime(dateFromInput(eventDate), startHour, timeZone).getTime() / 1000,
			)
			const endTime = Math.floor(
				calendarSlotTime(dateFromInput(eventDate), endHour, timeZone).getTime() / 1000,
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
			savingRef.current = false
			setBusy(false)
		}
	}

	async function saveEdit() {
		if (savingRef.current) return
		/* v8 ignore next -- saveEdit() is only wired to the edit form, which renders only when event is present -- @preserve */
		if (!event) return
		if (!allDay && !isDateInput(eventDate)) {
			setError('Choose a valid event date.')
			return
		}
		if (!allDay && (!event || scheduleChanged) && endHour <= startHour) {
			setError('Choose an end time after the start time.')
			return
		}
		if (
			!allDay &&
			(!event || scheduleChanged) &&
			!validEditorRange(dateFromInput(eventDate), startHour, endHour, timeZone)
		) {
			setError('Choose times that exist in this time zone. Daylight saving time may skip this hour.')
			return
		}
		savingRef.current = true
		setBusy(true)
		setError(null)
		try {
			const eventDay = dateFromInput(eventDate)
			const startTime = Math.floor(calendarSlotTime(eventDay, startHour, timeZone).getTime() / 1000)
			const endTime = Math.floor(calendarSlotTime(eventDay, endHour, timeZone).getTime() / 1000)
			await updateMutation.mutateAsync({
				eventId: event.id,
				calendarId: event.calendar_id ?? calendarId,
				title: title.trim() || 'Untitled event',
				location,
				description,
				// Keep provider precision, overnight spans and ambiguous DST instants when only text changes.
				...(!allDay && scheduleChanged ? { startTime, endTime } : {}),
			})
			onClose(true)
		} catch {
			setError('Could not save the event. Check your connection, then try again.')
			savingRef.current = false
			setBusy(false)
		}
	}

	useEffect(() => {
		if (!event) titleInputRef.current?.focus({ preventScroll: true })
	}, [event])
	if (event && times) {
		const persistedEvent = event
		const persistedTimes = times

		function resetEditDraft() {
			setTitle(persistedEvent.title ?? '')
			setLocation(persistedEvent.location ?? '')
			setDescription(persistedEvent.description ?? '')
			setStartHour(initialHours.startHour)
			setEndHour(initialHours.endHour)
			setEventDate(ymd(initialDate))
			setAllDay(persistedTimes.allDay)
			setError(null)
		}

		function beginEdit() {
			resetEditDraft()
			setEditing(true)
		}

		function cancelEdit() {
			// Opened straight in the editor (from the detail pane): cancelling returns there.
			if (startInEdit) {
				onClose(false)
				return
			}
			resetEditDraft()
			returnedFromEdit.current = true
			setEditing(false)
		}
		return (
			<Dialog
				open
				onOpenChange={(next) => {
					/* v8 ignore else -- @preserve the controlled open dialog only requests dismissal; busy or open requests are intentional no-ops */
					if (!next && !busy) {
						if (editing) requestDiscard(() => onClose(false))
						else detailsRef.current?.requestClose()
					}
				}}
			>
				<DialogContent presentation="bottom-sheet" className={EVENT_DIALOG_PANEL_CLASS}>
					<DialogTitle className="sr-only">Event details</DialogTitle>
					{editing ? (
						<>
							<EventDetailsHeader
								event={event}
								calendarName={calendarName}
								colorStyle={colorStyle}
								variant="dialog"
								busy={busy}
								onClose={() => requestDiscard(() => onClose(false))}
							/>
							<div className="space-y-4 px-5 py-4">
								<input
									aria-label="Title"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="Add title"
									className="event-dialog-field w-full border-b border-border bg-transparent pb-2 text-lg font-medium outline-none placeholder:text-muted-foreground focus:border-primary"
								/>
								{allDay ? (
									<div className="flex items-center gap-3 text-sm">
										<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
										<span>{formatFullDate(times.start)}</span>
									</div>
								) : (
									<label className="block space-y-control" htmlFor="event-edit-date">
										<span className="text-xs font-medium text-muted-foreground">Date</span>
										<input
											id="event-edit-date"
											aria-label="Event date"
											type="date"
											value={eventDate}
											onChange={(changeEvent) => setEventDate(changeEvent.target.value)}
											className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
										/>
									</label>
								)}
								<EventFields
									startHour={startHour}
									endHour={endHour}
									allDay={allDay}
									durationMinutes={durationMinutes}
									invalidTimeRange={invalidTimeRange}
									onStartHour={changeStartHour}
									onEndHour={setEndHour}
									location={location}
									onLocation={setLocation}
									description={description}
									onDescription={setDescription}
								/>
								{error ? (
									<p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
										{error}
									</p>
								) : null}
							</div>
							<div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))]">
								<button
									type="button"
									onClick={() => requestDiscard(cancelEdit)}
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
						<EventDetails
							ref={detailsRef}
							event={event}
							calendarId={calendarId}
							calendarName={calendarName}
							calendars={calendars}
							variant="dialog"
							focusEditOnMount={returnedFromEdit.current}
							startOnDeleteConfirmation={startOnDeleteConfirmation}
							onEdit={beginEdit}
							onClose={() => onClose(false)}
							onRsvped={() => onClose(true)}
							onDeleted={() => onClose(true)}
						/>
					)}
					{discardConfirmation}
					{router ? <EventNavigationGuard dirty={dirty || busy} onNavigate={confirmNavigation} /> : null}
				</DialogContent>
			</Dialog>
		)
	}

	return (
		// Lists opened from the composer are solid: glass never sits on glass.
		<GlassPanelScope>
			<div
				role="dialog"
				aria-label="New event"
				className={EVENT_COMPOSER_PANEL_CLASS}
				style={
					{
						'--event-composer-left': `${panelPos.x}px`,
						'--event-composer-top': `${panelPos.y}px`,
						'--event-composer-max-height': eventComposerMaxHeight(panelPos.y),
					} as CSSProperties
				}
			>
				<div
					onPointerDown={startPanelDrag}
					className="flex touch-auto items-center justify-between gap-3 border-b border-border px-5 pt-[calc(1rem+var(--safe-area-top))] pb-4 select-none sm:touch-none sm:pt-4"
				>
					<div className="flex min-w-0 cursor-grab items-center gap-2 active:cursor-grabbing">
						<GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<div>
							<div className="flex items-center gap-2">
								<span
									data-slot="calendar-swatch"
									aria-hidden="true"
									className={cn('h-[11px] w-[11px] shrink-0 rounded-[3px]', EVENT_SWATCH_CLASS)}
									style={selectedColorStyle}
								/>
								<h2 className="font-display text-lg font-semibold">New event</h2>
								<span className="sr-only">{selectedCalendar?.name || calendarName} calendar</span>
							</div>
							<p className="text-xs text-muted-foreground">Add the essentials, then save.</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => requestDiscard(() => onClose(false))}
						disabled={busy}
						aria-label="Close"
						className="flex size-9 max-md:size-11 [@media(any-pointer:coarse)]:size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-50"
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
							className="event-dialog-field h-11 w-full rounded-lg border border-input bg-background px-3 text-base font-medium outline-none placeholder:text-muted-foreground hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
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
							<label className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium">
								<span>All day</span>
								<input
									type="checkbox"
									checked={allDay}
									onChange={(changeEvent) => setAllDay(changeEvent.target.checked)}
									className="peer sr-only"
								/>
								<span
									aria-hidden="true"
									className="relative h-6 w-10 rounded-full bg-muted-foreground/35 transition-colors before:absolute before:top-1 before:left-1 before:h-4 before:w-4 before:rounded-full before:bg-background before:shadow-sm before:transition-transform peer-checked:bg-primary peer-checked:before:translate-x-4 peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring"
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
								className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
							/>
						</label>
						<EventTimeFields
							startHour={startHour}
							endHour={endHour}
							allDay={allDay}
							durationMinutes={durationMinutes}
							invalidTimeRange={invalidTimeRange}
							onStartHour={changeStartHour}
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
						<div className="rounded-lg border border-input bg-background px-3 py-1.5 transition-colors hover:bg-muted/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring">
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
							{calendars.map((calendar) => {
								const active = calendar.id === selectedCalendarId
								return (
									<button
										key={calendar.id}
										type="button"
										onClick={() => setSelectedCalendarId(calendar.id)}
										className={eventCalendarChoiceClass(active)}
										style={eventColorStyle(eventColor({ calendar_id: calendar.id }, colors))}
									>
										<span className="h-2 w-2 rounded-full bg-[var(--event-c)]" />
										{calendar.name || 'Calendar'}
									</button>
								)
							})}
						</div>
					</section>
					{error ? (
						<p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</p>
					) : null}
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))] sm:pb-3">
					<button
						type="button"
						onClick={() => requestDiscard(() => onClose(false))}
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
			{discardConfirmation}
			{router ? <EventNavigationGuard dirty={dirty || busy} onNavigate={confirmNavigation} /> : null}
		</GlassPanelScope>
	)
}

function EventTimeFields({
	invalidTimeRange,
	durationMinutes,
	startHour,
	endHour,
	allDay,
	onStartHour,
	onEndHour,
}: {
	invalidTimeRange: boolean
	durationMinutes: number
	startHour: number
	endHour: number
	allDay: boolean
	onStartHour: (hour: number) => void
	onEndHour: (hour: number) => void
}) {
	const timeHintId = useId()
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
						{[...new Set([...START_TIME_OPTIONS, startHour])]
							.sort((a, b) => a - b)
							.map((hour) => (
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
					<SelectTrigger
						aria-label="End time"
						aria-invalid={invalidTimeRange || undefined}
						aria-describedby={timeHintId}
						className="h-11 w-full bg-background"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{[...new Set([...END_TIME_OPTIONS, endHour])]
							.sort((a, b) => a - b)
							.map((hour) => (
								<SelectItem key={hour} value={String(hour)}>
									{formatDecimalHour(hour)}
								</SelectItem>
							))}
					</SelectContent>
				</Select>
			</div>
			<p id={timeHintId} className="col-span-2 text-xs text-muted-foreground" aria-live="polite">
				{invalidTimeRange
					? 'End time must be after start time.'
					: `${Math.round(durationMinutes)} minutes${endHour >= 24 ? ` · Ends ${Math.floor(endHour / 24)} day${endHour >= 48 ? 's' : ''} later` : ''}`}
			</p>
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
					className="event-dialog-field h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
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
	invalidTimeRange,
	durationMinutes,
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
	invalidTimeRange: boolean
	durationMinutes: number
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
				invalidTimeRange={invalidTimeRange}
				durationMinutes={durationMinutes}
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
					className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
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

export function eventCalendarChoiceClass(active: boolean): string {
	return cn(
		'event-color flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
		active ? 'event-chip' : 'border-border text-muted-foreground hover:bg-muted',
	)
}

function decimalHour(date: Date, timeZone?: string): number {
	return calendarWallClockHour(date, timeZone)
}

export function eventInitialHours(
	start: Date,
	preserveStartTime = false,
	timeZone?: string,
	durationHours = 1,
): { startHour: number; endHour: number } {
	const startHour = decimalHour(start, timeZone)
	const normalizedStartHour =
		(preserveStartTime ? startHour >= 0 : startHour >= 7) && startHour < 24 ? nearestTimeStep(startHour) : 9
	const day = calendarDateInTimeZone(start, timeZone)
	const normalizedStart = timeZone
		? calendarSlotTime(day, normalizedStartHour, timeZone)
		: new Date(
				day.getFullYear(),
				day.getMonth(),
				day.getDate(),
				Math.floor(normalizedStartHour),
				Math.round((normalizedStartHour % 1) * 60),
			)
	return eventHours(
		{ start: normalizedStart, end: new Date(normalizedStart.getTime() + durationHours * 3_600_000) },
		timeZone,
	)
}

/**
 * Preserve provider wall-clock minutes and the end date, including overnight events.
 * Text-only edits omit timestamps entirely, preserving seconds and DST disambiguation.
 */
export function eventHours(
	times: { start: Date; end: Date },
	timeZone?: string,
): { startHour: number; endHour: number } {
	const startHour = decimalHour(times.start, timeZone)
	const startDate = calendarDateInTimeZone(times.start, timeZone)
	const endDate = calendarDateInTimeZone(times.end, timeZone)
	const days =
		(Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) -
			Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())) /
		86_400_000
	return { startHour, endHour: decimalHour(times.end, timeZone) + days * 24 }
}

function nearestTimeStep(hour: number): number {
	return Math.min(24 - TIME_STEP_HOURS, Math.round(hour / TIME_STEP_HOURS) * TIME_STEP_HOURS)
}

function formatDecimalHour(hour: number): string {
	const rawWholeHour = Math.floor(hour)
	const wholeHour = rawWholeHour % 24
	const minute = Math.round((hour - rawWholeHour) * 60)
	const period = wholeHour >= 12 ? 'PM' : 'AM'
	const displayHour = wholeHour % 12 === 0 ? 12 : wholeHour % 12
	const time =
		minute === 0 ? `${displayHour} ${period}` : `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
	return hour > 24 ? `${time} (+${Math.floor(hour / 24)} day${hour >= 48 ? 's' : ''})` : time
}

/** Reject nonexistent local times instead of silently normalizing across a DST gap. */
export function validEditorRange(day: Date, startHour: number, endHour: number, timeZone: string): boolean {
	const start = calendarSlotTime(day, startHour, timeZone)
	const end = calendarSlotTime(day, endHour, timeZone)
	const matches = (instant: Date, hour: number) => {
		const expectedDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + Math.floor(hour / 24))
		return (
			ymd(calendarDateInTimeZone(instant, timeZone)) === ymd(expectedDay) &&
			Math.abs(calendarWallClockHour(instant, timeZone) - (hour % 24)) < 1 / 120
		)
	}
	return end > start && matches(start, startHour) && matches(end, endHour)
}

function EventNavigationGuard({ dirty, onNavigate }: { dirty: boolean; onNavigate: () => Promise<boolean> }) {
	useBlocker({ shouldBlockFn: onNavigate, disabled: !dirty, enableBeforeUnload: dirty })
	return null
}
