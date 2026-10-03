import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { AlignLeft, CalendarDays, Clock, MapPin, Pencil, Trash2, Users, X } from 'lucide-react'
import { type CSSProperties, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '#shared/lib/utils'
import { eventTimes, fmtCompactTime, formatFullDate } from '../lib/calendar.js'
import { calendarColors, eventColor, eventColorStyle, eventRsvp } from '../lib/calendar-ui-model.js'
import { useDeleteEventMutation, useRsvpEventMutation } from '../state/calendar-state.js'

/** Solid swatch in the calendar's colour; pair with `eventColorStyle`. */
const EVENT_SWATCH_CLASS = 'event-color bg-[var(--event-c)]'

const FOCUS_RING_CLASS =
	'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid'

/** `dialog` is the mobile sheet and desktop dialog; `panel` is the desktop pane beside the grid. */
export type EventDetailsVariant = 'dialog' | 'panel'

/** The dialog keeps its 20px gutter; a pane uses the 16px region gutter. */
const GUTTER_CLASS: Record<EventDetailsVariant, string> = { dialog: 'px-5', panel: 'px-region' }

const RSVP_STATE = { yes: 'accepted', maybe: 'tentative', no: 'declined' } as const

export type EventDetailsHandle = {
	/** A dismissal request from the surrounding surface: Escape or a backdrop press. */
	requestClose: () => void
}

/** Title, calendar name and close button, shared by the read-only view and the editor. */
export function EventDetailsHeader({
	event,
	calendarName,
	colorStyle,
	variant,
	busy,
	onClose,
}: {
	event: Event
	calendarName: string
	colorStyle: CSSProperties
	variant: EventDetailsVariant
	busy: boolean
	onClose: () => void
}) {
	return (
		<div className={cn('flex items-start justify-between gap-3 pt-4', GUTTER_CLASS[variant])}>
			<div className="flex min-w-0 items-start gap-3">
				<span
					data-slot="calendar-swatch"
					aria-hidden="true"
					className={cn('mt-2 h-[11px] w-[11px] shrink-0 rounded-[3px]', EVENT_SWATCH_CLASS)}
					style={colorStyle}
				/>
				<div className="min-w-0">
					<h2 className="text-lg leading-snug font-semibold text-balance">{event.title || '(untitled)'}</h2>
					<p className="text-sm text-muted-foreground">{calendarName}</p>
				</div>
			</div>
			<button
				type="button"
				onClick={onClose}
				disabled={busy}
				aria-label="Close"
				className={cn(
					'flex size-9 max-md:size-11 [@media(any-pointer:coarse)]:size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted',
					FOCUS_RING_CLASS,
				)}
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	)
}

/**
 * The read-only view of one event with its RSVP, edit and delete actions. It is
 * the whole of viewing: the desktop pane and the mobile dialog both render it,
 * and editing is handed to the editor through `onEdit`.
 */
export function EventDetails({
	ref,
	event,
	calendarId,
	calendarName,
	calendars,
	email,
	variant,
	focusEditOnMount = false,
	startOnDeleteConfirmation = false,
	onEdit,
	onClose,
	onRsvped,
	onDeleted,
}: {
	ref?: Ref<EventDetailsHandle>
	event: Event
	/** Used when the event carries no calendar of its own. */
	calendarId: string
	calendarName: string
	calendars: Calendar[]
	/** The signed-in mailbox; with it, the person's current answer is marked. */
	email?: string
	variant: EventDetailsVariant
	focusEditOnMount?: boolean
	/** Asked for from the event's context menu: show the delete confirmation at once. */
	startOnDeleteConfirmation?: boolean
	onEdit: () => void
	onClose: () => void
	/** Called after an answer is saved; the pane stays open, the dialog closes. */
	onRsvped?: () => void
	onDeleted: () => void
}) {
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [confirmingDelete, setConfirmingDelete] = useState(startOnDeleteConfirmation && !event.read_only)
	const editButtonRef = useRef<HTMLButtonElement>(null)
	const deleteButtonRef = useRef<HTMLButtonElement>(null)
	const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null)
	const deletePendingRef = useRef(false)
	const wasConfirmingDelete = useRef(false)
	const deleteMutation = useDeleteEventMutation(event.id)
	const rsvpMutation = useRsvpEventMutation(event.id)

	function beginDelete() {
		setError(null)
		setConfirmingDelete(true)
	}

	function cancelDelete() {
		setError(null)
		setConfirmingDelete(false)
	}

	useImperativeHandle(ref, () => ({
		requestClose() {
			if (busy) return
			if (confirmingDelete) cancelDelete()
			else onClose()
		},
	}))

	// Returning from the editor puts focus back on the control that opened it.
	const focusEditOnMountRef = useRef(focusEditOnMount)
	useEffect(() => {
		if (focusEditOnMountRef.current) editButtonRef.current?.focus()
	}, [])
	// Asked for from a context menu: that menu is still closing when this view
	// mounts, so the safe choice takes focus on the next frame, once it is gone.
	const startOnDeleteRef = useRef(startOnDeleteConfirmation)
	useEffect(() => {
		if (!startOnDeleteRef.current) return
		const frame = requestAnimationFrame(() => cancelDeleteButtonRef.current?.focus())
		return () => cancelAnimationFrame(frame)
	}, [])
	useEffect(() => {
		if (confirmingDelete) cancelDeleteButtonRef.current?.focus()
		else if (wasConfirmingDelete.current) deleteButtonRef.current?.focus()
		wasConfirmingDelete.current = confirmingDelete
	}, [confirmingDelete])

	const times = eventTimes(event)
	if (!times) return null

	async function remove() {
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
			onDeleted()
		} catch {
			deletePendingRef.current = false
			setError('Could not delete the event. Check your connection, then try again.')
			setBusy(false)
		}
	}

	async function rsvp(status: 'yes' | 'no' | 'maybe') {
		setBusy(true)
		setError(null)
		try {
			await rsvpMutation.mutateAsync({
				eventId: event.id,
				calendarId: event.calendar_id ?? calendarId,
				status,
			})
			setBusy(false)
			onRsvped?.()
		} catch {
			setError('RSVP failed')
			setBusy(false)
		}
	}

	const canRsvp = Boolean(event.participants?.length && event.organizer)
	const answer = email ? eventRsvp(event, email) : null
	const colorStyle = eventColorStyle(eventColor(event, calendarColors(calendars)))
	const when = times.allDay ? 'All day' : `${fmtCompactTime(times.start)} – ${fmtCompactTime(times.end)}`
	const attendeeText = event.participants
		?.map((participant) => participant.name || participant.email)
		.filter(Boolean)
		.join(', ')
	const gutter = GUTTER_CLASS[variant]

	return (
		<>
			<EventDetailsHeader
				event={event}
				calendarName={calendarName}
				colorStyle={colorStyle}
				variant={variant}
				busy={busy}
				onClose={onClose}
			/>
			<div className={cn('space-y-3 py-4 text-sm', gutter)}>
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
						role={confirmingDelete || variant === 'panel' ? 'alert' : undefined}
					>
						{error}
					</p>
				) : null}
			</div>

			<div
				className={cn(
					'flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3',
					gutter,
					variant === 'dialog' ? 'pb-[calc(0.75rem+var(--safe-area-bottom))]' : 'pb-hairline',
				)}
			>
				{confirmingDelete ? (
					<fieldset
						className="flex w-full flex-wrap items-center justify-end gap-2"
						aria-describedby="event-delete-confirm-description"
					>
						<legend className="mr-auto min-w-48">
							<span className="block text-sm font-semibold text-foreground">Delete this event?</span>
							<span id="event-delete-confirm-description" className="block text-xs text-muted-foreground">
								This action cannot be undone.
							</span>
						</legend>
						<button
							ref={cancelDeleteButtonRef}
							type="button"
							onClick={cancelDelete}
							disabled={busy}
							className={cn(
								'min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50',
								FOCUS_RING_CLASS,
							)}
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={remove}
							disabled={busy}
							aria-describedby="event-delete-confirm-description"
							className={cn(
								'flex min-h-11 items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-50',
								FOCUS_RING_CLASS,
							)}
						>
							<Trash2 className="h-4 w-4" /> {busy ? 'Deleting…' : 'Delete event'}
						</button>
					</fieldset>
				) : (
					<>
						{canRsvp
							? (['yes', 'maybe', 'no'] as const).map((status) => {
									// The current answer is stated, not only tinted: aria-pressed plus a heavier label.
									const current = answer === null ? undefined : answer === RSVP_STATE[status]
									return (
										<button
											key={status}
											type="button"
											disabled={busy}
											aria-pressed={current}
											onClick={() => rsvp(status)}
											className={cn(
												'min-h-11 rounded-lg border border-border px-3 py-1.5 text-xs capitalize hover:bg-muted',
												current && 'bg-muted font-semibold',
												FOCUS_RING_CLASS,
											)}
										>
											{status === 'yes' ? '✓ Yes' : status === 'no' ? '✗ No' : '? Maybe'}
										</button>
									)
								})
							: null}
						{!event.read_only ? (
							<>
								<button
									ref={editButtonRef}
									type="button"
									disabled={busy}
									onClick={onEdit}
									className={cn(
										'flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
										FOCUS_RING_CLASS,
									)}
								>
									<Pencil className="h-4 w-4" /> Edit
								</button>
								<button
									ref={deleteButtonRef}
									type="button"
									disabled={busy}
									onClick={beginDelete}
									className={cn(
										'flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10',
										FOCUS_RING_CLASS,
									)}
								>
									<Trash2 className="h-4 w-4" /> Delete
								</button>
							</>
						) : null}
						{variant === 'dialog' ? (
							<button
								type="button"
								onClick={onClose}
								disabled={busy}
								className={cn(
									'min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98]',
									FOCUS_RING_CLASS,
								)}
							>
								Done
							</button>
						) : null}
					</>
				)}
			</div>
		</>
	)
}
