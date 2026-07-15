import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { AlignLeft, CalendarDays, Clock, GripVertical, MapPin, Pencil, Trash2, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createEvent, deleteEvent, rsvpEvent, updateEvent } from '../server/calendar-fns.js'
import { dateWithHour, eventTimes, fmtCompactTime, formatFullDate } from './calendar.js'
import { valueToTokens } from './contact-token.js'
import {
	clampPointToViewport,
	createPanelPosition,
	ESTIMATED_PANEL_SIZE,
	type Point,
	type Rect,
} from './modal-position.js'
import { RecipientInput } from './RecipientInput.js'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'
import { Textarea } from './ui/textarea.js'
import { calendarTone, cn, type EventTone, eventColorClass, eventTone, labelBadgeClass } from './ui-model.js'

const TIME_OPTIONS = Array.from({ length: 32 }, (_, i) => 7 + i * 0.5).filter((hour) => hour <= 22)
export const NEW_EVENT_HOURS = { startHour: 9, endHour: 10 } as const
export const EVENT_DIALOG_PANEL_CLASS =
	'w-full max-w-md overflow-hidden rounded-sm border border-border bg-card shadow-2xl'
/** Floating, draggable composer panel — no backdrop, positioned beside the slot. */
export const EVENT_COMPOSER_PANEL_CLASS =
	'fixed z-50 w-[27rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border bg-card shadow-2xl'

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
	onClose,
}: {
	event: Event | null
	defaultStart: Date
	calendarId: string
	calendarName: string
	calendars: Calendar[]
	anchorRect?: Rect | null
	onClose: (changed: boolean) => void
}) {
	const times = event ? eventTimes(event) : null
	const initialStart = times?.start ?? new Date(defaultStart.getTime())
	const initialHours = eventInitialHours(initialStart)

	const [title, setTitle] = useState(event?.title ?? '')
	const [location, setLocation] = useState(event?.location ?? '')
	const [description, setDescription] = useState(event?.description ?? '')
	const [guests, setGuests] = useState('')
	const [startHour, setStartHour] = useState(initialHours.startHour)
	const [endHour, setEndHour] = useState(initialHours.endHour)
	const [selectedCalendarId, setSelectedCalendarId] = useState(calendarId)
	const [editing, setEditing] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const titleInputRef = useRef<HTMLInputElement>(null)

	// The create composer floats over the calendar (no backdrop) so the grid
	// stays visible; the user can drag it aside by its header to reference a day.
	const [panelPos, setPanelPos] = useState<Point>(() =>
		createPanelPosition(anchorRect, ESTIMATED_PANEL_SIZE, {
			width: window.innerWidth,
			height: window.innerHeight,
		}),
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
					{ width: window.innerWidth, height: window.innerHeight },
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

	// The floating composer has no backdrop to click away, so Escape closes it.
	useEffect(() => {
		if (event) return
		function onKey(keyEvent: KeyboardEvent) {
			if (keyEvent.key === 'Escape') onClose(false)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [event, onClose])

	const canRsvp = Boolean(event?.participants?.length && event?.organizer)
	const eventCalendar = event ? calendars.find((calendar) => calendar.id === event.calendar_id) : undefined
	const tone = event ? eventTone(event, 0, eventCalendar) : 'blue'
	const selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId) ?? calendars[0]
	const selectedCalendarTone = selectedCalendar ? calendarTone(selectedCalendar) : 'blue'

	async function save() {
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(dateWithHour(defaultStart, startHour).getTime() / 1000)
			const endTime = Math.floor(
				dateWithHour(defaultStart, Math.max(endHour, startHour + 0.5)).getTime() / 1000,
			)
			const participants = valueToTokens(guests)
			await createEvent({
				data: {
					calendarId: selectedCalendar?.id ?? calendarId,
					title: title.trim() || 'Untitled event',
					...(location ? { location } : {}),
					...(description.trim() ? { description } : {}),
					...(participants.length ? { participants } : {}),
					startTime,
					endTime,
				},
			})
			onClose(true)
		} catch {
			setError('Could not save the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function saveEdit() {
		/* v8 ignore next -- saveEdit() is only wired to the edit form, which renders only when event is present */
		if (!event) return
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(dateWithHour(initialStart, startHour).getTime() / 1000)
			const endTime = Math.floor(
				dateWithHour(initialStart, Math.max(endHour, startHour + 0.5)).getTime() / 1000,
			)
			await updateEvent({
				data: {
					eventId: event.id,
					calendarId: event.calendar_id ?? calendarId,
					title: title.trim() || 'Untitled event',
					location,
					description,
					startTime,
					endTime,
				},
			})
			onClose(true)
		} catch {
			setError('Could not save the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function remove() {
		/* v8 ignore next -- remove() is only wired to the delete button, which renders only when event is present */
		if (!event) return
		setBusy(true)
		try {
			await deleteEvent({ data: { eventId: event.id, calendarId: event.calendar_id ?? calendarId } })
			onClose(true)
		} catch {
			setError('Could not delete the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function rsvp(status: 'yes' | 'no' | 'maybe') {
		/* v8 ignore next -- rsvp() is only wired to the RSVP buttons, which render only when event is present */
		if (!event) return
		setBusy(true)
		try {
			await rsvpEvent({ data: { eventId: event.id, calendarId: event.calendar_id ?? calendarId, status } })
			onClose(true)
		} catch {
			setError('RSVP failed')
			setBusy(false)
		}
	}

	useEffect(() => {
		if (!event) titleInputRef.current?.focus({ preventScroll: true })
	}, [event])

	if (event && times) {
		const when = times.allDay ? 'All day' : `${fmtCompactTime(times.start)} – ${fmtCompactTime(times.end)}`
		const attendeeText = event.participants
			?.map((participant) => participant.name || participant.email)
			.filter(Boolean)
			.join(', ')
		return (
			<Dialog
				open
				onOpenChange={(next) => {
					if (!next && !busy) onClose(false)
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
							className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
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
							<div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
								<button
									type="button"
									onClick={() => setEditing(false)}
									disabled={busy}
									className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
								>
									Cancel
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={saveEdit}
									className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
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
									<p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
								) : null}
							</div>

							<div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
								{canRsvp
									? (['yes', 'maybe', 'no'] as const).map((status) => (
											<button
												key={status}
												type="button"
												disabled={busy}
												onClick={() => rsvp(status)}
												className="rounded-lg border border-border px-3 py-1.5 text-xs capitalize hover:bg-muted"
											>
												{status === 'yes' ? '✓ Yes' : status === 'no' ? '✗ No' : '? Maybe'}
											</button>
										))
									: null}
								{!event.read_only ? (
									<>
										<button
											type="button"
											disabled={busy}
											onClick={() => setEditing(true)}
											className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										>
											<Pencil className="h-4 w-4" /> Edit
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={remove}
											className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
										>
											<Trash2 className="h-4 w-4" /> Delete
										</button>
									</>
								) : null}
								<button
									type="button"
									onClick={() => onClose(false)}
									disabled={busy}
									className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98]"
								>
									Done
								</button>
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
			style={{ left: panelPos.x, top: panelPos.y }}
		>
			<div className={cn('h-px w-full opacity-50', eventBarClass(selectedCalendarTone))} />
			<div
				onPointerDown={startPanelDrag}
				className="flex touch-none items-center justify-between gap-2 px-5 pt-4 pb-1 select-none"
			>
				<div className="flex min-w-0 cursor-grab items-center gap-1.5 active:cursor-grabbing">
					<GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<h2 className="text-lg font-semibold">New event</h2>
				</div>
				<button
					type="button"
					onClick={() => onClose(false)}
					disabled={busy}
					aria-label="Close"
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="space-y-4 px-5 py-4">
				<input
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Add title"
					className="event-dialog-field w-full border-b border-border bg-transparent pb-2 text-lg font-medium outline-none placeholder:text-muted-foreground focus:border-primary"
				/>
				<div className="flex items-center gap-3 text-sm">
					<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
					<span>{formatFullDate(defaultStart)}</span>
				</div>
				<EventFields
					startHour={startHour}
					endHour={endHour}
					onStartHour={setStartHour}
					onEndHour={setEndHour}
					location={location}
					onLocation={setLocation}
					description={description}
					onDescription={setDescription}
				/>
				<div className="flex items-start gap-3 text-sm">
					<Users className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
					<RecipientInput
						id="event-guests"
						label="Guests"
						value={guests}
						onChange={setGuests}
						placeholder="Add guests"
						className="flex-1"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
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
				{error ? (
					<p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
				) : null}
			</div>

			<div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
				<button
					type="button"
					onClick={() => onClose(false)}
					disabled={busy}
					className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={save}
					className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
				>
					{busy ? 'Saving...' : 'Save event'}
				</button>
			</div>
		</div>
	)
}

/** Editable time / location / description fields shared by create and edit. */
function EventFields({
	startHour,
	endHour,
	onStartHour,
	onEndHour,
	location,
	onLocation,
	description,
	onDescription,
}: {
	startHour: number
	endHour: number
	onStartHour: (hour: number) => void
	onEndHour: (hour: number) => void
	location: string
	onLocation: (value: string) => void
	description: string
	onDescription: (value: string) => void
}) {
	return (
		<>
			<div className="flex items-center gap-3 text-sm">
				<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
				<Select value={String(startHour)} onValueChange={(value) => onStartHour(Number(value))}>
					<SelectTrigger aria-label="Start time" className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TIME_OPTIONS.map((hour) => (
							<SelectItem key={hour} value={String(hour)}>
								{formatDecimalHour(hour)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-muted-foreground">to</span>
				<Select value={String(endHour)} onValueChange={(value) => onEndHour(Number(value))}>
					<SelectTrigger aria-label="End time" className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TIME_OPTIONS.map((hour) => (
							<SelectItem key={hour} value={String(hour)}>
								{formatDecimalHour(hour)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<label className="flex items-center gap-3 text-sm">
				<MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
				<input
					aria-label="Location"
					value={location}
					onChange={(e) => onLocation(e.target.value)}
					placeholder="Add location"
					className="event-dialog-field flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
				/>
			</label>
			<div className="flex items-start gap-3 text-sm">
				<AlignLeft className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
				<Textarea
					aria-label="Description"
					value={description}
					onChange={(e) => onDescription(e.target.value)}
					placeholder="Add description"
					className="min-h-16 flex-1 resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
				/>
			</div>
		</>
	)
}

export function eventCalendarChoiceClass(active: boolean, tone: EventTone): string {
	return cn(
		'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
		active ? labelBadgeClass(tone) : 'border-border text-muted-foreground hover:bg-muted',
	)
}

function decimalHour(date: Date): number {
	return date.getHours() + date.getMinutes() / 60
}

export function eventInitialHours(start: Date): { startHour: number; endHour: number } {
	const startHour = decimalHour(start)
	const normalizedStartHour = startHour >= 7 && startHour <= 22 ? nearestHalfHour(startHour) : 9
	return { startHour: normalizedStartHour, endHour: Math.min(22, normalizedStartHour + 1) }
}

function nearestHalfHour(hour: number): number {
	return Math.round(hour * 2) / 2
}

function formatDecimalHour(hour: number): string {
	const wholeHour = Math.floor(hour)
	const minute = Math.round((hour - wholeHour) * 60)
	const period = wholeHour >= 12 ? 'PM' : 'AM'
	const displayHour = wholeHour % 12 === 0 ? 12 : wholeHour % 12
	return minute === 0
		? `${displayHour} ${period}`
		: `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}
