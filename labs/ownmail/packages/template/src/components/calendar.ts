import type { Event } from '@nylas-labs/cli-kit/v3'

export type CalView = 'month' | 'week' | 'day'

export function isCalView(value: string): value is CalView {
	return value === 'month' || value === 'week' || value === 'day'
}

/** [start, end) of the visible range for a view, in local time. */
export function viewRange(view: CalView, anchor: Date): { start: Date; end: Date } {
	if (view === 'day') {
		const start = startOfDay(anchor)
		return { start, end: addDays(start, 1) }
	}
	if (view === 'week') {
		const start = startOfWeek(anchor)
		return { start, end: addDays(start, 7) }
	}
	// Month grid: from the week containing the 1st through the week containing the last day.
	const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
	const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
	return { start: startOfWeek(first), end: addDays(startOfWeek(last), 7) }
}

export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Sunday-based week start. */
export function startOfWeek(d: Date): Date {
	const day = startOfDay(d)
	day.setDate(day.getDate() - day.getDay())
	return day
}

export function addDays(d: Date, days: number): Date {
	const next = new Date(d)
	next.setDate(next.getDate() + days)
	return next
}

export function shiftAnchor(view: CalView, anchor: Date, direction: 1 | -1): Date {
	if (view === 'day') return addDays(anchor, direction)
	if (view === 'week') return addDays(anchor, 7 * direction)
	return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
}

export function eventTimes(event: Event): { start: Date; end: Date; allDay: boolean } {
	const when = event.when
	if ('start_time' in when) {
		return { start: new Date(when.start_time * 1000), end: new Date(when.end_time * 1000), allDay: false }
	}
	if ('date' in when) {
		const start = new Date(`${when.date}T00:00:00`)
		return { start, end: addDays(start, 1), allDay: true }
	}
	return {
		start: new Date(`${when.start_date}T00:00:00`),
		end: addDays(new Date(`${when.end_date}T00:00:00`), 1),
		allDay: true,
	}
}

export function eventsOnDay(events: Event[], day: Date): Event[] {
	const dayStart = startOfDay(day).getTime()
	const dayEnd = dayStart + 24 * 60 * 60 * 1000
	return events
		.filter((e) => {
			const { start, end } = eventTimes(e)
			return start.getTime() < dayEnd && end.getTime() > dayStart
		})
		.sort((a, b) => eventTimes(a).start.getTime() - eventTimes(b).start.getTime())
}

export function fmtTime(d: Date): string {
	return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function ymd(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
