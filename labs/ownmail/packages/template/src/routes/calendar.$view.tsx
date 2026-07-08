import type { Event } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	addDays,
	type CalView,
	eventsOnDay,
	eventTimes,
	fmtTime,
	isCalView,
	shiftAnchor,
	startOfWeek,
	viewRange,
	ymd,
} from '../components/calendar.js'
import { EventModal } from '../components/EventModal.js'
import { getEvents } from '../server/calendar-fns.js'

export const Route = createFileRoute('/calendar/$view')({
	params: {
		parse: (params) => {
			if (!isCalView(params.view)) throw new Error(`Unknown view: ${params.view}`)
			return { view: params.view as CalView }
		},
	},
	validateSearch: (search): { date?: string } =>
		typeof search.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.date) ? { date: search.date } : {},
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ params, deps }) => {
		const anchor = deps.date ? new Date(`${deps.date}T00:00:00`) : new Date()
		const { start, end } = viewRange(params.view, anchor)
		const res = await getEvents({
			data: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) },
		})
		return { ...res, anchorIso: ymd(anchor) }
	},
	component: CalendarPage,
})

function CalendarPage() {
	const { view } = Route.useParams()
	const { events, calendar, anchorIso } = Route.useLoaderData()
	const navigate = useNavigate()
	const router = useRouter()
	const anchor = useMemo(() => new Date(`${anchorIso}T00:00:00`), [anchorIso])
	const [editing, setEditing] = useState<Event | 'new' | null>(null)
	const [newStart, setNewStart] = useState<Date | null>(null)
	const agenda = useMemo(
		() =>
			events
				.filter((event) => !eventTimes(event).allDay)
				.sort((a, b) => eventTimes(a).start.getTime() - eventTimes(b).start.getTime())
				.slice(0, 5),
		[events],
	)

	const go = useCallback(
		(nextView: CalView, nextAnchor: Date) => {
			navigate({ to: '/calendar/$view', params: { view: nextView }, search: { date: ymd(nextAnchor) } })
		},
		[navigate],
	)

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null
			const isTyping =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
			if (isTyping || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
			if (target?.closest('[role="dialog"]')) return
			if (event.key.toLowerCase() === 'm') {
				event.preventDefault()
				go('month', anchor)
			}
			if (event.key.toLowerCase() === 'w') {
				event.preventDefault()
				go('week', anchor)
			}
			if (event.key.toLowerCase() === 'd') {
				event.preventDefault()
				go('day', anchor)
			}
			if (event.key.toLowerCase() === 'n') {
				event.preventDefault()
				setNewStart(null)
				setEditing('new')
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [anchor, go])

	const title =
		view === 'month'
			? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
			: view === 'week'
				? `Week of ${startOfWeek(anchor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
				: anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

	return (
		<div className="calendar-shell">
			<header className="calendar-header">
				<Link to="/mail" className="btn btn-quiet">
					Mail
				</Link>
				<div className="min-w-0">
					<h1 className="calendar-title">{title}</h1>
					<p className="muted-line">
						{events.length} event{events.length === 1 ? '' : 's'} · {calendar.name}
					</p>
				</div>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					<button
						type="button"
						className="icon-btn"
						onClick={() => go(view, shiftAnchor(view, anchor, -1))}
						aria-label="Previous"
					>
						‹
					</button>
					<button type="button" className="btn btn-quiet" onClick={() => go(view, new Date())}>
						Today
					</button>
					<button
						type="button"
						className="icon-btn"
						onClick={() => go(view, shiftAnchor(view, anchor, 1))}
						aria-label="Next"
					>
						›
					</button>
					<div className="segmented">
						{(['month', 'week', 'day'] as const).map((v) => (
							<button
								key={v}
								type="button"
								onClick={() => go(v, anchor)}
								className="tab-btn capitalize"
								data-active={v === view}
							>
								{v}
							</button>
						))}
					</div>
					<button
						type="button"
						onClick={() => {
							setNewStart(null)
							setEditing('new')
						}}
						className="btn btn-primary"
					>
						New event
					</button>
				</div>
			</header>

			<div className="calendar-board">
				<div className="grid min-h-full gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
					<div className="overflow-auto rounded-2xl border border-neutral-200 bg-white">
						{view === 'month' ? (
							<MonthGrid
								anchor={anchor}
								events={events}
								onPickDay={(d) => go('day', d)}
								onPickEvent={setEditing}
								onCreateAt={(d) => {
									setNewStart(d)
									setEditing('new')
								}}
							/>
						) : (
							<TimeGrid
								days={view === 'week' ? 7 : 1}
								start={view === 'week' ? startOfWeek(anchor) : anchor}
								events={events}
								onPickEvent={setEditing}
								onCreateAt={(d) => {
									setNewStart(d)
									setEditing('new')
								}}
							/>
						)}
					</div>
					<aside className="hidden rounded-2xl border border-neutral-200 bg-white p-4 lg:block">
						<h2 className="text-sm font-semibold">Next up</h2>
						<div className="mt-3 grid gap-2">
							{agenda.length ? (
								agenda.map((event) => {
									const times = eventTimes(event)
									return (
										<button
											key={event.id}
											type="button"
											className="command-row"
											onClick={() => setEditing(event)}
										>
											<span>
												<strong>{event.title || '(untitled)'}</strong>
												<span className="block muted-line">{fmtTime(times.start)}</span>
											</span>
										</button>
									)
								})
							) : (
								<p className="muted-line">No timed events in this range.</p>
							)}
						</div>
					</aside>
				</div>
			</div>

			{editing ? (
				<EventModal
					event={editing === 'new' ? null : editing}
					defaultStart={newStart ?? anchor}
					calendarName={calendar.name}
					onClose={(changed) => {
						setEditing(null)
						if (changed) router.invalidate()
					}}
				/>
			) : null}
		</div>
	)
}

function MonthGrid({
	anchor,
	events,
	onPickDay,
	onPickEvent,
	onCreateAt,
}: {
	anchor: Date
	events: Event[]
	onPickDay: (d: Date) => void
	onPickEvent: (e: Event) => void
	onCreateAt: (d: Date) => void
}) {
	const { start, end } = viewRange('month', anchor)
	const days: Date[] = []
	for (let d = new Date(start); d < end; d = addDays(d, 1)) days.push(new Date(d))
	const todayIso = ymd(new Date())

	return (
		<div className="month-grid">
			{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
				<div key={label} className="month-head">
					{label}
				</div>
			))}
			{days.map((day) => {
				const inMonth = day.getMonth() === anchor.getMonth()
				const dayEvents = eventsOnDay(events, day)
				return (
					<div key={day.toISOString()} className={`month-cell ${inMonth ? '' : 'month-cell-muted'}`}>
						<div className="month-cell-head">
							<button
								type="button"
								onClick={() => onPickDay(day)}
								className={`day-button ${ymd(day) === todayIso ? 'day-button-today' : ''}`}
							>
								{day.getDate()}
							</button>
							<button
								type="button"
								onClick={() => onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9))}
								className="day-add-button"
								aria-label={`Create event on ${day.toLocaleDateString()}`}
							>
								+
							</button>
						</div>
						<div className="space-y-0.5">
							{dayEvents.slice(0, 3).map((event) => (
								<button
									key={event.id}
									type="button"
									onClick={() => onPickEvent(event)}
									className="calendar-event"
								>
									{eventTimes(event).allDay ? '' : `${fmtTime(eventTimes(event).start)} `}
									{event.title || '(untitled)'}
								</button>
							))}
							{dayEvents.length > 3 ? (
								<button
									type="button"
									onClick={() => onPickDay(day)}
									className="mt-1 text-xs text-neutral-500 hover:underline"
								>
									+{dayEvents.length - 3} more
								</button>
							) : null}
						</div>
					</div>
				)
			})}
		</div>
	)
}

function TimeGrid({
	days,
	start,
	events,
	onPickEvent,
	onCreateAt,
}: {
	days: number
	start: Date
	events: Event[]
	onPickEvent: (e: Event) => void
	onCreateAt: (d: Date) => void
}) {
	const HOUR_PX = 48
	// The hour value itself is the stable identity of each row/slot.
	const HOURS = Array.from({ length: 24 }, (_, i) => i)
	const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i))

	return (
		<div className="time-grid">
			<div className="time-rail">
				<div className="h-8" />
				{HOURS.map((h) => (
					<div key={`h${h}`} style={{ height: HOUR_PX }} className="pr-1">
						{h === 0 ? '' : `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`}
					</div>
				))}
			</div>
			{columns.map((day) => {
				const dayEvents = eventsOnDay(events, day).filter((e) => !eventTimes(e).allDay)
				const allDay = eventsOnDay(events, day).filter((e) => eventTimes(e).allDay)
				return (
					<div key={day.toISOString()} className="time-column">
						<div className="time-column-head">
							{day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
							{allDay.map((event) => (
								<button
									key={event.id}
									type="button"
									onClick={() => onPickEvent(event)}
									className="calendar-event mt-1"
								>
									{event.title}
								</button>
							))}
						</div>
						<div className="relative" style={{ height: HOUR_PX * 24 }}>
							{HOURS.map((h) => (
								<button
									key={`slot${h}`}
									type="button"
									aria-label={`Create event at ${h}:00`}
									onClick={() => onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h))}
									style={{ top: h * HOUR_PX, height: HOUR_PX }}
									className="time-slot"
								/>
							))}
							{dayEvents.map((event) => {
								const { start: s, end: e } = eventTimes(event)
								const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
								const topMin = Math.max(0, (s.getTime() - dayStart) / 60000)
								const endMin = Math.min(24 * 60, (e.getTime() - dayStart) / 60000)
								return (
									<button
										key={event.id}
										type="button"
										onClick={() => onPickEvent(event)}
										style={{
											top: (topMin / 60) * HOUR_PX,
											height: Math.max(20, ((endMin - topMin) / 60) * HOUR_PX),
										}}
										className="calendar-event time-event"
									>
										<div className="font-medium">{event.title || '(untitled)'}</div>
										<div>{fmtTime(s)}</div>
									</button>
								)
							})}
						</div>
					</div>
				)
			})}
		</div>
	)
}
