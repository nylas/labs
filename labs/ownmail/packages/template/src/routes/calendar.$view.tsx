import type { Event } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppRail } from '../components/AppRail.js'
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
import { cn, type EventTone, eventTone } from '../components/ui-model.js'
import { getEvents } from '../server/calendar-fns.js'
import { getMailboxInfo } from '../server/fns.js'

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
		const [info, res] = await Promise.all([
			getMailboxInfo(),
			getEvents({
				data: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) },
			}),
		])
		return { ...res, info, anchorIso: ymd(anchor) }
	},
	component: CalendarPage,
})

function CalendarPage() {
	const { view } = Route.useParams()
	const { events, calendar, info, anchorIso } = Route.useLoaderData()
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
		<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
			<AppRail email={info.email} active="calendar" />
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2.5">
					<button
						type="button"
						onClick={() => {
							setNewStart(anchor)
							setEditing('new')
						}}
						className="flex items-center gap-2 rounded-sm bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:brightness-105 active:scale-[0.98]"
					>
						<Plus className="h-4 w-4" strokeWidth={2.5} /> Create
					</button>
					<button
						type="button"
						className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
						onClick={() => go(view, new Date())}
					>
						Today
					</button>
					<div className="flex items-center">
						<button
							type="button"
							className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
							onClick={() => go(view, shiftAnchor(view, anchor, -1))}
							aria-label="Previous"
						>
							<ChevronLeft className="h-5 w-5" />
						</button>
						<button
							type="button"
							className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
							onClick={() => go(view, shiftAnchor(view, anchor, 1))}
							aria-label="Next"
						>
							<ChevronRight className="h-5 w-5" />
						</button>
					</div>
					<h1 className="text-lg font-semibold text-balance">{title}</h1>
					<div className="ml-auto flex items-center rounded-lg border border-border bg-card p-0.5">
						{(['month', 'week', 'day'] as const).map((v) => (
							<button
								key={v}
								type="button"
								onClick={() => go(v, anchor)}
								className={cn(
									'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
									v === view
										? 'bg-primary text-primary-foreground'
										: 'text-muted-foreground hover:text-foreground',
								)}
							>
								{v}
							</button>
						))}
					</div>
				</header>

				<div className="flex min-h-0 flex-1">
					<aside className="hidden w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-sidebar px-4 py-4 lg:flex">
						<MiniCalendar refDate={anchor} onPick={(date) => go(view === 'month' ? 'day' : view, date)} />
						<div>
							<p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								My calendars
							</p>
							<div className="flex flex-col gap-0.5">
								<button
									type="button"
									className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
								>
									<span className="flex h-4 w-4 items-center justify-center rounded border-2 border-transparent bg-event-blue" />
									<span className="text-foreground">{calendar.name}</span>
								</button>
							</div>
						</div>
						<div className="rounded-sm border border-border bg-card p-3">
							<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								Up next today
							</p>
							<div className="mt-2 flex flex-col gap-2">
								{agenda.length === 0 ? (
									<p className="text-sm text-muted-foreground">Nothing left today.</p>
								) : (
									agenda.slice(0, 4).map((event, index) => (
										<button
											key={event.id}
											type="button"
											onClick={() => setEditing(event)}
											className="rounded-sm border border-border bg-card p-2 text-left transition-colors hover:bg-muted"
										>
											<span
												className={cn('mb-1 block h-1 rounded-full', eventBarClass(eventTone(event, index)))}
											/>
											<span className="block truncate text-sm font-medium">
												{event.title || '(untitled)'}
											</span>
											<span className="text-xs text-muted-foreground">
												{fmtTime(eventTimes(event).start)}
											</span>
										</button>
									))
								)}
							</div>
						</div>
					</aside>
					<div className="flex min-w-0 flex-1 bg-card">
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

function eventBarClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal'
	if (tone === 'amber') return 'bg-event-amber'
	if (tone === 'rose') return 'bg-event-rose'
	return 'bg-event-blue'
}

function eventBlockClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal/10 text-event-teal border-l-[3px] border-event-teal'
	if (tone === 'amber') return 'bg-event-amber/12 text-event-amber border-l-[3px] border-event-amber'
	if (tone === 'rose') return 'bg-event-rose/10 text-event-rose border-l-[3px] border-event-rose'
	return 'bg-event-blue/10 text-event-blue border-l-[3px] border-event-blue'
}

function eventDotClass(tone: EventTone): string {
	if (tone === 'teal') return 'bg-event-teal'
	if (tone === 'amber') return 'bg-event-amber'
	if (tone === 'rose') return 'bg-event-rose'
	return 'bg-event-blue'
}

function MiniCalendar({ refDate, onPick }: { refDate: Date; onPick: (date: Date) => void }) {
	const [cursor, setCursor] = useState(() => new Date(refDate.getFullYear(), refDate.getMonth(), 1))
	const { start, end } = viewRange('month', cursor)
	const days: Date[] = []
	for (let day = new Date(start); day < end; day = addDays(day, 1)) days.push(new Date(day))
	const todayIso = ymd(new Date())
	const refIso = ymd(refDate)

	return (
		<div>
			<div className="mb-2 flex items-center justify-between">
				<span className="text-sm font-semibold">
					{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
				</span>
				<div className="flex items-center gap-1">
					<button
						type="button"
						aria-label="Previous month"
						onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
						className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						aria-label="Next month"
						onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
						className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>
			</div>
			<div className="grid grid-cols-7 gap-0.5 text-center">
				{[
					['sun', 'S'],
					['mon', 'M'],
					['tue', 'T'],
					['wed', 'W'],
					['thu', 'T'],
					['fri', 'F'],
					['sat', 'S'],
				].map(([key, label]) => (
					<span key={key} className="py-1 text-[10px] font-medium text-muted-foreground">
						{label}
					</span>
				))}
				{days.map((day) => {
					const inMonth = day.getMonth() === cursor.getMonth()
					const iso = ymd(day)
					return (
						<button
							key={iso}
							type="button"
							onClick={() => onPick(day)}
							className={cn(
								'flex h-7 items-center justify-center rounded-sm text-xs tabular-nums transition-colors',
								iso === todayIso && 'bg-primary text-primary-foreground',
								iso !== todayIso && iso === refIso && 'bg-accent font-semibold text-accent-foreground',
								iso !== todayIso && iso !== refIso && inMonth && 'text-foreground hover:bg-muted',
								iso !== todayIso && iso !== refIso && !inMonth && 'text-muted-foreground/50 hover:bg-muted',
							)}
						>
							{day.getDate()}
						</button>
					)
				})}
			</div>
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
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="grid grid-cols-7 border-b border-border">
				{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
					<div
						key={label}
						className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
					>
						{label}
					</div>
				))}
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
				{days.map((day) => {
					const inMonth = day.getMonth() === anchor.getMonth()
					const dayEvents = eventsOnDay(events, day)
					const iso = ymd(day)
					return (
						<div
							key={day.toISOString()}
							className={cn(
								'group flex min-h-0 cursor-pointer flex-col gap-1 border-r border-b border-border p-1.5 transition-colors hover:bg-muted/40',
								!inMonth && 'bg-muted/30',
							)}
						>
							<div className="flex items-center justify-center gap-1">
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										onPickDay(day)
									}}
									className={cn(
										'flex h-6 min-w-6 items-center justify-center rounded-sm px-1.5 text-xs font-medium tabular-nums',
										iso === todayIso && 'bg-primary text-primary-foreground',
										iso !== todayIso && !inMonth && 'text-muted-foreground/60',
										iso !== todayIso && inMonth && 'text-foreground',
									)}
								>
									{day.getDate()}
								</button>
								<button
									type="button"
									onClick={() => onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9))}
									className="flex h-6 w-6 items-center justify-center rounded-sm text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
									aria-label={`Create event on ${day.toLocaleDateString()}`}
								>
									+
								</button>
							</div>
							<div className="flex min-h-0 flex-col gap-1 overflow-hidden">
								{dayEvents.slice(0, 3).map((event, index) => {
									const tone = eventTone(event, index)
									const allDay = eventTimes(event).allDay
									return (
										<button
											key={event.id}
											type="button"
											onClick={(clickEvent) => {
												clickEvent.stopPropagation()
												onPickEvent(event)
											}}
											className={cn(
												'flex items-center gap-1.5 truncate rounded-sm px-1.5 py-0.5 text-left text-xs transition-transform hover:scale-[1.01]',
												allDay ? cn(eventBarClass(tone), 'text-primary-foreground') : 'hover:bg-muted',
											)}
										>
											{!allDay ? (
												<span className={cn('h-2 w-2 shrink-0 rounded-full', eventDotClass(tone))} />
											) : null}
											{!allDay ? (
												<span className="shrink-0 tabular-nums text-muted-foreground">
													{fmtTime(eventTimes(event).start)}
												</span>
											) : null}
											<span
												className={cn(
													'truncate font-medium',
													allDay ? 'text-primary-foreground' : 'text-foreground',
												)}
											>
												{event.title || '(untitled)'}
											</span>
										</button>
									)
								})}
								{dayEvents.length > 3 ? (
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation()
											onPickDay(day)
										}}
										className="px-1.5 text-left text-xs font-medium text-muted-foreground"
									>
										+{dayEvents.length - 3} more
									</button>
								) : null}
							</div>
						</div>
					)
				})}
			</div>
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
	const HOUR_PX = 52
	const START_HOUR = 7
	const END_HOUR = 22
	const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
	const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i))
	const todayIso = ymd(new Date())

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex border-b border-border pr-3">
				<div className="w-14 shrink-0" />
				<div className={cn('grid flex-1', days === 1 ? 'grid-cols-1' : 'grid-cols-7')}>
					{columns.map((day) => (
						<div key={day.toISOString()} className="flex flex-col items-center gap-0.5 py-2">
							<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								{day.toLocaleDateString(undefined, { weekday: 'short' })}
							</span>
							<span
								className={cn(
									'flex h-8 min-w-8 items-center justify-center rounded-sm px-1 text-sm font-semibold tabular-nums',
									ymd(day) === todayIso ? 'bg-primary text-primary-foreground' : 'text-foreground',
								)}
							>
								{day.getDate()}
							</span>
						</div>
					))}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex pr-3">
					<div className="w-14 shrink-0">
						{HOURS.map((hour) => (
							<div key={hour} className="relative h-[52px]">
								<span className="absolute -top-2 right-2 text-[11px] tabular-nums text-muted-foreground">
									{hour === START_HOUR ? '' : fmtHour(hour)}
								</span>
							</div>
						))}
					</div>
					<div className={cn('relative grid flex-1', days === 1 ? 'grid-cols-1' : 'grid-cols-7')}>
						{columns.map((day) => {
							const dayEvents = eventsOnDay(events, day).filter((event) => !eventTimes(event).allDay)
							return (
								<div key={day.toISOString()} className="relative border-l border-border first:border-l-0">
									{HOURS.map((hour) => (
										<button
											key={hour}
											type="button"
											aria-label={`Create event at ${hour}:00`}
											onClick={() =>
												onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour))
											}
											className="h-[52px] w-full cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/40"
										/>
									))}
									{dayEvents.map((event, index) => {
										const { start: s, end: e } = eventTimes(event)
										const top = (s.getHours() + s.getMinutes() / 60 - START_HOUR) * HOUR_PX
										const endHour = e.getHours() + e.getMinutes() / 60
										const height = Math.max(
											(endHour - (s.getHours() + s.getMinutes() / 60)) * HOUR_PX - 2,
											20,
										)
										return (
											<button
												key={event.id}
												type="button"
												onClick={() => onPickEvent(event)}
												style={{ top, height }}
												className={cn(
													'absolute right-0.5 left-0.5 z-10 flex flex-col overflow-hidden rounded-sm px-1.5 py-1 text-left transition-shadow hover:shadow-md',
													eventBlockClass(eventTone(event, index)),
												)}
											>
												<span className="truncate text-xs leading-tight font-semibold">
													{event.title || '(untitled)'}
												</span>
												{height > 30 ? (
													<span className="truncate text-[10px] opacity-80">
														{fmtTime(s)} - {fmtTime(e)}
													</span>
												) : null}
											</button>
										)
									})}
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</div>
	)
}

function fmtHour(hour: number): string {
	const period = hour >= 12 ? 'PM' : 'AM'
	const displayHour = hour % 12 === 0 ? 12 : hour % 12
	return `${displayHour} ${period}`
}
