import type { Event } from '@nylas-labs/cli-kit/v3'
import { AlignLeft, CalendarDays, Clock, MapPin, Trash2, Users, X } from 'lucide-react'
import { useState } from 'react'
import { createEvent, deleteEvent, rsvpEvent } from '../server/calendar-fns.js'
import { eventTimes, fmtCompactTime, formatFullDate, ymd } from './calendar.js'
import { cn, type EventTone, eventTone } from './ui-model.js'

function toLocalInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
	onClose,
}: {
	event: Event | null
	defaultStart: Date
	calendarId: string
	calendarName: string
	onClose: (changed: boolean) => void
}) {
	const times = event ? eventTimes(event) : null
	const initialStart = times?.start ?? new Date(defaultStart.getTime())
	const initialEnd = times?.end ?? new Date(initialStart.getTime() + 60 * 60 * 1000)

	const [title, setTitle] = useState(event?.title ?? '')
	const [location, setLocation] = useState(event?.location ?? '')
	const [description, setDescription] = useState(event?.description ?? '')
	const [participants, setParticipants] = useState(
		event?.participants?.map((par) => par.email).join(', ') ?? '',
	)
	const [start, setStart] = useState(toLocalInput(initialStart))
	const [end, setEnd] = useState(toLocalInput(initialEnd))
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const canRsvp = Boolean(event?.participants?.length && event?.organizer)
	const tone = event ? eventTone(event) : 'blue'

	async function save() {
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(new Date(start).getTime() / 1000)
			const endTime = Math.floor(new Date(end).getTime() / 1000)
			await createEvent({
				data: {
					calendarId,
					title,
					...(description ? { description } : {}),
					...(location ? { location } : {}),
					startTime,
					endTime,
					...(participants.trim()
						? {
								participants: participants
									.split(',')
									.map((email) => email.trim())
									.filter(Boolean),
							}
						: {}),
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
				<div className={cn('h-1.5 w-full', eventBarClass(tone))} />
				<div className="flex items-start justify-between gap-3 px-5 pt-4">
					<div className="flex min-w-0 items-start gap-3">
						<span className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', eventDotClass(tone))} />
						<div className="min-w-0">
							<h2 className="text-lg leading-snug font-semibold text-balance">
								{event ? 'Event' : 'New event'}
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

				<div className="space-y-4 px-5 py-4">
					<input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Add title"
						className="w-full border-b border-border bg-transparent pb-2 text-lg font-medium outline-none placeholder:text-muted-foreground focus:border-primary"
					/>
					<div className="flex items-center gap-3 text-sm">
						<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span>{formatFullDate(new Date(start))}</span>
					</div>
					<div className="flex items-center gap-3 text-sm">
						<Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
						<label className="sr-only" htmlFor="event-start">
							Starts
						</label>
						<input
							id="event-start"
							type="datetime-local"
							value={start}
							onChange={(e) => setStart(e.target.value)}
							className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
						/>
						<span className="text-muted-foreground">to</span>
						<label className="sr-only" htmlFor="event-end">
							Ends
						</label>
						<input
							id="event-end"
							type="datetime-local"
							value={end}
							onChange={(e) => setEnd(e.target.value)}
							className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 outline-none focus:border-primary"
						/>
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
					{!event ? (
						<label className="flex items-center gap-3 text-sm">
							<Users className="h-4 w-4 shrink-0 text-muted-foreground" />
							<input
								value={participants}
								onChange={(e) => setParticipants(e.target.value)}
								placeholder="Add guests"
								className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
							/>
						</label>
					) : null}
					<label className="flex items-start gap-3 text-sm">
						<AlignLeft className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Add description"
							rows={3}
							className="min-h-20 flex-1 resize-none bg-transparent outline-none placeholder:text-muted-foreground"
						/>
					</label>
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
							disabled={busy || !title.trim()}
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
