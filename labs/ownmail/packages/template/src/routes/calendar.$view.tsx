import type { Event } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
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
	const anchor = new Date(`${anchorIso}T00:00:00`)
	const [editing, setEditing] = useState<Event | 'new' | null>(null)
	const [newStart, setNewStart] = useState<Date | null>(null)

	function go(nextView: CalView, nextAnchor: Date) {
		navigate({ to: '/calendar/$view', params: { view: nextView }, search: { date: ymd(nextAnchor) } })
	}

	const title =
		view === 'month'
			? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
			: view === 'week'
				? `Week of ${startOfWeek(anchor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
				: anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

	return (
		<div className="flex h-screen flex-col">
			<header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2">
				<Link to="/mail" className="text-sm text-neutral-500 hover:text-neutral-800">
					← Mail
				</Link>
				<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
				<div className="ml-auto flex items-center gap-1">
					<button
						type="button"
						className="rounded px-2 py-1 text-sm hover:bg-neutral-100"
						onClick={() => go(view, shiftAnchor(view, anchor, -1))}
					>
						‹
					</button>
					<button
						type="button"
						className="rounded px-2 py-1 text-sm hover:bg-neutral-100"
						onClick={() => go(view, new Date())}
					>
						Today
					</button>
					<button
						type="button"
						className="rounded px-2 py-1 text-sm hover:bg-neutral-100"
						onClick={() => go(view, shiftAnchor(view, anchor, 1))}
					>
						›
					</button>
					<div className="mx-2 flex overflow-hidden rounded-md border border-neutral-200 text-sm">
						{(['month', 'week', 'day'] as const).map((v) => (
							<button
								key={v}
								type="button"
								onClick={() => go(v, anchor)}
								className={`px-3 py-1 capitalize ${v === view ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100'}`}
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
						className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
					>
						New event
					</button>
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
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
		<div className="grid h-full grid-cols-7" style={{ gridAutoRows: 'minmax(6rem, 1fr)' }}>
			{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
				<div
					key={label}
					className="border-b border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-500"
				>
					{label}
				</div>
			))}
			{days.map((day) => {
				const inMonth = day.getMonth() === anchor.getMonth()
				const dayEvents = eventsOnDay(events, day)
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: double-click-to-create is an enhancement; the buttons inside remain accessible
					<div
						key={day.toISOString()}
						onDoubleClick={() => onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9))}
						className={`border-b border-r border-neutral-100 p-1 ${inMonth ? '' : 'bg-neutral-50 text-neutral-400'}`}
					>
						<button
							type="button"
							onClick={() => onPickDay(day)}
							className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
								ymd(day) === todayIso ? 'bg-blue-600 font-semibold text-white' : 'hover:bg-neutral-100'
							}`}
						>
							{day.getDate()}
						</button>
						<div className="space-y-0.5">
							{dayEvents.slice(0, 3).map((event) => (
								<button
									key={event.id}
									type="button"
									onClick={() => onPickEvent(event)}
									className="block w-full truncate rounded bg-blue-50 px-1 py-0.5 text-left text-xs text-blue-900 hover:bg-blue-100"
								>
									{eventTimes(event).allDay ? '' : `${fmtTime(eventTimes(event).start)} `}
									{event.title || '(untitled)'}
								</button>
							))}
							{dayEvents.length > 3 ? (
								<button
									type="button"
									onClick={() => onPickDay(day)}
									className="text-xs text-neutral-500 hover:underline"
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
		<div className="flex">
			<div className="w-14 shrink-0 border-r border-neutral-100 text-right text-xs text-neutral-400">
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
					<div key={day.toISOString()} className="relative min-w-0 flex-1 border-r border-neutral-100">
						<div className="sticky top-0 z-10 h-8 border-b border-neutral-200 bg-white px-2 py-1 text-xs font-medium">
							{day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
							{allDay.map((event) => (
								<button
									key={event.id}
									type="button"
									onClick={() => onPickEvent(event)}
									className="ml-1 rounded bg-emerald-50 px-1 text-xs text-emerald-900"
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
									onDoubleClick={() =>
										onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h))
									}
									style={{ top: h * HOUR_PX, height: HOUR_PX }}
									className="absolute right-0 left-0 border-b border-neutral-50"
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
										className="absolute right-1 left-1 overflow-hidden rounded border border-blue-200 bg-blue-50 px-1 text-left text-xs text-blue-900 hover:bg-blue-100"
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
