import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { AlignLeft, CalendarDays, Clock, MapPin, Trash2, Users, X } from 'lucide-react'
import { useState } from 'react'
import { createEvent, deleteEvent, rsvpEvent } from '../server/calendar-fns.js'
import { eventTimes, fmtCompactTime, formatFullDate } from './calendar.js'
import { cn, type EventTone, eventTone } from './ui-model.js'

const TIME_OPTIONS = Array.from({ length: 32 }, (_, i) => 7 + i * 0.5).filter((hour) => hour <= 22)

function eventBarClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal'
	if (tone === 'amber') return 'bg-event-amber'
	if (tone === 'rose') return 'bg-event-rose'
	return 'bg-event-blue'
}

function eventDotClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal'
	if (tone === 'amber') return 'bg-event-amber'
	if (tone === 'rose') return 'bg-event-rose'
	return 'bg-event-blue'
}

/** Create/edit/RSVP dialog for a single event on the primary calendar. */
export function EventModal({
	event,
	defaultStart,
	calendarId,
	calendarName,
	calendars,
	onClose,
}: {
	event: Event | null
	defaultStart: Date
	calendarId: string
	calendarName: string
	calendars: Calendar[]
	onClose: (changed: boolean) => void
}) {
	const times = event ? eventTimes(event) : null
	const initialStart = times?.start ?? new Date(defaultStart.getTime())
	const defaultStartHour = decimalHour(initialStart)
	const normalizedStartHour =
		defaultStartHour >= 7 && defaultStartHour <= 22 ? nearestHalfHour(defaultStartHour) : 9

	const [title, setTitle] = useState(event?.title ?? '')
	const [location, setLocation] = useState(event?.location ?? '')
	const [startHour, setStartHour] = useState(normalizedStartHour)
	const [endHour, setEndHour] = useState(Math.min(22, normalizedStartHour + 1))
	const [selectedCalendarId, setSelectedCalendarId] = useState(calendarId)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const canRsvp = Boolean(event?.participants?.length && event?.organizer)
	const tone = event ? eventTone(event) : 'blue'
	const selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId) ?? calendars[0]
	const selectedCalendarTone = selectedCalendar
		? eventTone({ title: selectedCalendar.name, calendar_id: selectedCalendar.id } as Event)
		: 'blue'

	async function save() {
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(dateWithHour(defaultStart, startHour).getTime() / 1000)
			const endTime = Math.floor(
				dateWithHour(defaultStart, Math.max(endHour, startHour + 0.5)).getTime() / 1000,
			)
			await createEvent({
				data: {
					calendarId: selectedCalendar?.id ?? calendarId,
					title: title.trim() || 'Untitled event',
					...(location ? { location } : {}),
					startTime,
					endTime,
				},
			})
			onClose(true)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save')
			setBusy(false)
		}
	}

	async function remove() {
		if (!event) return
		setBusy(true)
		try {
			await deleteEvent({ data: { eventId: event.id, calendarId: event.calendar_id ?? calendarId } })
			onClose(true)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete')
			setBusy(false)
		}
	}

	async function rsvp(status: 'yes' | 'no' | 'maybe') {
		if (!event) return
		setBusy(true)
		try {
			await rsvpEvent({ data: { eventId: event.id, calendarId: event.calendar_id ?? calendarId, status } })
			onClose(true)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'RSVP failed')
			setBusy(false)
		}
	}

	if (event && times) {
		const when = times.allDay ? 'All day' : `${fmtCompactTime(times.start)} – ${fmtCompactTime(times.end)}`
		const attendeeText = event.participants
			?.map((participant) => participant.name || participant.email)
			.filter(Boolean)
			.join(', ')
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-[2px]">
				<button
					type="button"
					className="absolute inset-0 cursor-default"
					aria-label="Close event dialog"
					onClick={() => onClose(false)}
				/>
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Event details"
					className="relative w-full max-w-md overflow-hidden rounded-sm border border-border bg-card shadow-2xl"
				>
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
							aria-label="Close"
							className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
						>
							<X className="h-4 w-4" />
						</button>
					</div>

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
							<button
								type="button"
								disabled={busy}
								onClick={remove}
								className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
							>
								<Trash2 className="h-4 w-4" /> Delete
							</button>
						) : null}
						<button
							type="button"
							onClick={() => onClose(false)}
							className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98]"
						>
							Done
						</button>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-[2px]">
			<button
				type="button"
				className="absolute inset-0 cursor-default"
				aria-label="Close event dialog"
				onClick={() => onClose(false)}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={event ? 'Event details' : 'New event'}
				className="relative w-full max-w-md overflow-hidden rounded-sm border border-border bg-card shadow-2xl"
			>
				<div className={cn('h-1.5 w-full', eventBarClass(selectedCalendarTone))} />
				<div className="flex items-center justify-between px-5 pt-4">
					<h2 className="text-lg font-semibold">New event</h2>
					<button
						type="button"
						onClick={() => onClose(false)}
						aria-label="Close"
						className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="space-y-4 px-5 py-4">
					<input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Add title"
						className="w-full border-b border-border bg-transparent pb-2 text-lg font-medium outline-none placeholder:text-muted-foreground focus:border-primary"
					/>
					<div className="flex items-center gap-3 text-sm">
						<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span>{formatFullDate(defaultStart)}</span>
					</div>
					<div className="flex items-center gap-3 text-sm">
						<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
						<select
							value={startHour}
							onChange={(e) => setStartHour(Number(e.target.value))}
							className="rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
						>
							{TIME_OPTIONS.map((hour) => (
								<option key={hour} value={hour}>
									{formatDecimalHour(hour)}
								</option>
							))}
						</select>
						<span className="text-muted-foreground">to</span>
						<select
							value={endHour}
							onChange={(e) => setEndHour(Number(e.target.value))}
							className="rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
						>
							{TIME_OPTIONS.map((hour) => (
								<option key={hour} value={hour}>
									{formatDecimalHour(hour)}
								</option>
							))}
						</select>
					</div>
					<label className="flex items-center gap-3 text-sm">
						<MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
						<input
							value={location}
							onChange={(e) => setLocation(e.target.value)}
							placeholder="Add location"
							className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
						/>
					</label>
					<div className="flex flex-wrap items-center gap-2">
						{calendars.map((calendar, index) => {
							const active = calendar.id === selectedCalendarId
							const calendarTone = eventTone(
								{ title: calendar.name, calendar_id: calendar.id } as Event,
								index,
							)
							return (
								<button
									key={calendar.id}
									type="button"
									onClick={() => setSelectedCalendarId(calendar.id)}
									className={cn(
										'flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors',
										active
											? cn('border-transparent', eventBlockClass(calendarTone))
											: 'border-border text-muted-foreground hover:bg-muted',
									)}
								>
									<span className={cn('h-2 w-2 rounded-full', eventDotClass(calendarTone))} />
									{calendar.name || 'Calendar'}
								</button>
							)
						})}
					</div>
					{error ? (
						<p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
					) : null}
				</div>

				<div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
					<div className="flex gap-1">
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
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => onClose(false)}
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
			</div>
		</div>
	)
}

function eventBlockClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal/10 text-event-teal border-l-[3px] border-event-teal'
	if (tone === 'amber') return 'bg-event-amber/12 text-event-amber border-l-[3px] border-event-amber'
	if (tone === 'rose') return 'bg-event-rose/10 text-event-rose border-l-[3px] border-event-rose'
	return 'bg-event-blue/10 text-event-blue border-l-[3px] border-event-blue'
}

function decimalHour(date: Date): number {
	return date.getHours() + date.getMinutes() / 60
}

function nearestHalfHour(hour: number): number {
	return Math.round(hour * 2) / 2
}

function dateWithHour(day: Date, hour: number): Date {
	const next = new Date(day)
	const wholeHour = Math.floor(hour)
	next.setHours(wholeHour, Math.round((hour - wholeHour) * 60), 0, 0)
	return next
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
