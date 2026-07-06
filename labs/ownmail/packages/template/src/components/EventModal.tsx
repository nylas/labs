import type { Event } from '@nylas-labs/cli-kit/v3'
import { useState } from 'react'
import { createEvent, deleteEvent, rsvpEvent, updateEvent } from '../server/calendar-fns.js'
import { eventTimes, ymd } from './calendar.js'

function toLocalInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Create/edit/RSVP dialog for a single event on the primary calendar. */
export function EventModal({
	event,
	defaultStart,
	calendarName,
	onClose,
}: {
	event: Event | null
	defaultStart: Date
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

	const isOrganizerless = Boolean(event && event.read_only)
	const canRsvp = Boolean(event?.participants?.length && event?.organizer)

	async function save() {
		setBusy(true)
		setError(null)
		try {
			const startTime = Math.floor(new Date(start).getTime() / 1000)
			const endTime = Math.floor(new Date(end).getTime() / 1000)
			if (event) {
				await updateEvent({ data: { eventId: event.id, title, description, location, startTime, endTime } })
			} else {
				await createEvent({
					data: {
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
			}
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
			await deleteEvent({ data: { eventId: event.id } })
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
			await rsvpEvent({ data: { eventId: event.id, status } })
			onClose(true)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'RSVP failed')
			setBusy(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
			<div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
				<div className="mb-3 flex items-baseline justify-between">
					<h2 className="text-lg font-semibold">{event ? 'Event' : 'New event'}</h2>
					<span className="text-xs text-neutral-400">{calendarName}</span>
				</div>
				<div className="space-y-3">
					<input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Title"
						disabled={isOrganizerless}
						className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-neutral-50"
					/>
					<div className="flex gap-2">
						<label className="flex-1 text-xs text-neutral-500">
							Starts
							<input
								type="datetime-local"
								value={start}
								onChange={(e) => setStart(e.target.value)}
								disabled={isOrganizerless}
								className="mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm disabled:bg-neutral-50"
							/>
						</label>
						<label className="flex-1 text-xs text-neutral-500">
							Ends
							<input
								type="datetime-local"
								value={end}
								onChange={(e) => setEnd(e.target.value)}
								disabled={isOrganizerless}
								className="mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm disabled:bg-neutral-50"
							/>
						</label>
					</div>
					<input
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="Location"
						disabled={isOrganizerless}
						className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-neutral-50"
					/>
					{!event ? (
						<input
							value={participants}
							onChange={(e) => setParticipants(e.target.value)}
							placeholder="Guests (comma-separated emails)"
							className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
						/>
					) : null}
					<textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Description"
						rows={3}
						disabled={isOrganizerless}
						className="w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-neutral-50"
					/>
					{error ? <p className="text-xs text-red-600">{error}</p> : null}
					<div className="flex items-center justify-between pt-1">
						<div className="flex gap-1">
							{canRsvp
								? (['yes', 'maybe', 'no'] as const).map((status) => (
										<button
											key={status}
											type="button"
											disabled={busy}
											onClick={() => rsvp(status)}
											className="rounded-full border border-neutral-200 px-3 py-1 text-xs capitalize hover:bg-neutral-50"
										>
											{status === 'yes' ? '✓ Yes' : status === 'no' ? '✗ No' : '? Maybe'}
										</button>
									))
								: null}
						</div>
						<div className="flex gap-2">
							{event && !isOrganizerless ? (
								<button
									type="button"
									disabled={busy}
									onClick={remove}
									className="rounded-full px-4 py-1.5 text-sm text-red-600 hover:bg-red-50"
								>
									Delete
								</button>
							) : null}
							<button
								type="button"
								onClick={() => onClose(false)}
								className="rounded-full px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
							>
								Close
							</button>
							{!isOrganizerless ? (
								<button
									type="button"
									disabled={busy || !title.trim()}
									onClick={save}
									className="rounded-full bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
								>
									{busy ? 'Saving…' : 'Save'}
								</button>
							) : null}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
