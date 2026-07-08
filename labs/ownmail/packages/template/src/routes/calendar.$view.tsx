import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, PanelLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppRailLogo, AppRailNav } from '../components/AppRail.js'
import { CommandPalette, useCommandPaletteShortcut } from '../components/CommandPalette.js'
import {
	addDays,
	allDayEventSegments,
	type CalView,
	dateWithHour,
	eventsOnDay,
	eventTimes,
	filterEventsByCalendars,
	fmtAgendaTime,
	fmtTime,
	isCalView,
	shiftAnchor,
	startOfWeek,
	timedEventLayout,
	timedEventsOnDay,
	viewRange,
	ymd,
} from '../components/calendar.js'
import { EventModal } from '../components/EventModal.js'
import { Sheet } from '../components/Sheet.js'
import {
	APP_RAIL_WIDTH_CLASS,
	CALENDAR_HEADER_GRID_CLASS,
	CALENDAR_SIDEBAR_WIDTH_CLASS,
	CHROME_ROW_CLASS,
	CHROME_ROW_SHELL_CLASS,
	calendarTone,
	cn,
	type EventTone,
	eventChipClass,
	eventColorClass,
	eventTone,
} from '../components/ui-model.js'
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
	loader: async ({ params, deps }) => loadCalendarRouteData(params.view, deps.date),
	component: CalendarViewRoutePage,
})

export async function loadCalendarRouteData(view: CalView, date?: string) {
	const anchor = date ? new Date(`${date}T00:00:00`) : new Date()
	const { start, end } = viewRange(view, anchor)
	const [info, res] = await Promise.all([
		getMailboxInfo(),
		getEvents({
			data: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) },
		}),
	])
	return { ...res, info, anchorIso: ymd(anchor) }
}

type CalendarRouteData = Awaited<ReturnType<typeof loadCalendarRouteData>>

function CalendarViewRoutePage() {
	const { view } = Route.useParams()
	const data = Route.useLoaderData()

	return <CalendarRouteScreen view={view} data={data} />
}

export function CalendarRouteScreen({
	view,
	data,
	navigationMode = 'route',
}: {
	view: CalView
	data: CalendarRouteData
	navigationMode?: 'route' | 'local'
}) {
	const { events, calendar, calendars, info, anchorIso } = data
	const navigate = useNavigate()
	const router = useRouter()
	const [localView, setLocalView] = useState(view)
	const [localAnchorIso, setLocalAnchorIso] = useState(anchorIso)
	const [editing, setEditing] = useState<Event | 'new' | null>(null)
	const [newStart, setNewStart] = useState<Date | null>(null)
	const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set())
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const today = useMemo(() => new Date(), [])
	const openPalette = useCallback(() => setPaletteOpen(true), [])
	const closePalette = useCallback(() => setPaletteOpen(false), [])
	useCommandPaletteShortcut(openPalette)
	const currentView = navigationMode === 'local' ? localView : view
	const currentAnchorIso = navigationMode === 'local' ? localAnchorIso : anchorIso
	const anchor = useMemo(() => new Date(`${currentAnchorIso}T00:00:00`), [currentAnchorIso])
	const visibleEvents = useMemo(
		() => filterEventsByCalendars(events, hiddenCalendarIds),
		[events, hiddenCalendarIds],
	)
	const calendarNameById = useMemo(
		() => new Map(calendars.map((cal) => [cal.id, cal.name || 'Calendar'])),
		[calendars],
	)
	const calendarById = useMemo(() => new Map(calendars.map((cal) => [cal.id, cal])), [calendars])
	const agenda = useMemo(
		() =>
			timedEventsOnDay(visibleEvents, today)
				.sort((a, b) => eventTimes(a).start.getTime() - eventTimes(b).start.getTime())
				.slice(0, 5),
		[today, visibleEvents],
	)

	const toggleCalendar = useCallback((calendarId: string) => {
		setHiddenCalendarIds((current) => {
			const next = new Set(current)
			if (next.has(calendarId)) next.delete(calendarId)
			else next.add(calendarId)
			return next
		})
	}, [])

	const go = useCallback(
		(nextView: CalView, nextAnchor: Date) => {
			if (navigationMode === 'local') {
				setLocalView(nextView)
				setLocalAnchorIso(ymd(nextAnchor))
				return
			}
			navigate({ to: '/calendar/$view', params: { view: nextView }, search: { date: ymd(nextAnchor) } })
		},
		[navigate, navigationMode],
	)

	useEffect(() => {
		setLocalView(view)
		setLocalAnchorIso(anchorIso)
	}, [anchorIso, view])

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
		currentView === 'month'
			? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
			: currentView === 'week'
				? formatWeekTitle(anchor)
				: anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={CHROME_ROW_SHELL_CLASS}>
				<AppRailLogo appName={info.appName} />
				<header
					className={cn(
						'flex min-w-0 flex-1 items-stretch border-b border-border bg-background',
						CHROME_ROW_CLASS,
					)}
				>
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						className={cn(
							'flex shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:hidden',
							APP_RAIL_WIDTH_CLASS,
						)}
						aria-label="Open calendar sidebar"
					>
						<PanelLeft className="h-4 w-4" />
					</button>
					<div className={cn('min-w-0 flex-1', CALENDAR_HEADER_GRID_CLASS)}>
						<div className="hidden border-r border-border lg:block" aria-hidden="true" />
						<div className="flex min-w-0 items-stretch">
							<button
								type="button"
								onClick={() => {
									setNewStart(anchor)
									setEditing('new')
								}}
								className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
							>
								<Plus className="h-4 w-4" strokeWidth={2} />
								<span className="hidden sm:inline">Create</span>
							</button>
							<button
								type="button"
								className="flex shrink-0 items-center border-r border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
								onClick={() => go(currentView, new Date())}
							>
								Today
							</button>
							<button
								type="button"
								className="flex w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
								onClick={() => go(currentView, shiftAnchor(currentView, anchor, -1))}
								aria-label="Previous"
							>
								<ChevronLeft className="h-4 w-4" />
							</button>
							<button
								type="button"
								className="flex w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
								onClick={() => go(currentView, shiftAnchor(currentView, anchor, 1))}
								aria-label="Next"
							>
								<ChevronRight className="h-4 w-4" />
							</button>
							<div className="flex min-w-0 flex-1 items-center border-r border-border px-3">
								<h1 className="truncate font-display text-sm font-semibold text-balance sm:text-base">
									{title}
								</h1>
							</div>
							<fieldset
								className="m-0 flex min-w-0 shrink-0 items-stretch border-0 p-0"
								aria-label="Calendar view"
							>
								{(['day', 'week', 'month'] as const).map((v) => (
									<button
										key={v}
										type="button"
										onClick={() => go(v, anchor)}
										aria-pressed={v === currentView}
										className={cn(
											'flex items-center border-r border-border px-3 text-sm font-medium capitalize transition-colors last:border-r-0',
											v === currentView
												? 'bg-muted text-foreground'
												: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
										)}
									>
										{v}
									</button>
								))}
							</fieldset>
						</div>
					</div>
				</header>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppRailNav
					email={info.email}
					displayName={info.displayName}
					active="calendar"
					onOpenCommandPalette={openPalette}
				/>
				<aside
					className={cn(
						'hidden shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-background px-4 py-4 lg:flex',
						CALENDAR_SIDEBAR_WIDTH_CLASS,
					)}
				>
					<CalendarSidebarPanel
						anchor={anchor}
						calendars={calendars}
						calendarById={calendarById}
						hiddenCalendarIds={hiddenCalendarIds}
						agenda={agenda}
						onPickDate={(date) => go(currentView === 'month' ? 'day' : currentView, date)}
						onToggleCalendar={toggleCalendar}
						onPickEvent={setEditing}
					/>
				</aside>
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
					{currentView === 'month' ? (
						<MonthGrid
							anchor={anchor}
							events={visibleEvents}
							calendarById={calendarById}
							onPickDay={(d) => go('day', d)}
							onPickEvent={setEditing}
						/>
					) : (
						<TimeGrid
							days={currentView === 'week' ? 7 : 1}
							start={currentView === 'week' ? startOfWeek(anchor) : anchor}
							events={visibleEvents}
							calendarById={calendarById}
							onPickEvent={setEditing}
							onPickSlot={(date, hour) => {
								setNewStart(dateWithHour(date, hour))
								setEditing('new')
							}}
						/>
					)}
				</div>
			</div>

			{editing ? (
				<EventModal
					event={editing === 'new' ? null : editing}
					defaultStart={newStart ?? anchor}
					calendarId={calendar.id}
					calendarName={
						editing !== 'new' && editing.calendar_id
							? (calendarNameById.get(editing.calendar_id) ?? calendar.name)
							: calendar.name
					}
					calendars={calendars}
					onClose={(changed) => {
						setEditing(null)
						if (changed) router.invalidate()
					}}
				/>
			) : null}

			<Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Calendar">
				<CalendarSidebarPanel
					anchor={anchor}
					calendars={calendars}
					calendarById={calendarById}
					hiddenCalendarIds={hiddenCalendarIds}
					agenda={agenda}
					onPickDate={(date) => {
						go(currentView === 'month' ? 'day' : currentView, date)
						setSidebarOpen(false)
					}}
					onToggleCalendar={toggleCalendar}
					onPickEvent={(event) => {
						setEditing(event)
						setSidebarOpen(false)
					}}
				/>
			</Sheet>

			<CommandPalette open={paletteOpen} onClose={closePalette} />
		</div>
	)
}

function CalendarSidebarPanel({
	anchor,
	calendars,
	calendarById,
	hiddenCalendarIds,
	agenda,
	onPickDate,
	onToggleCalendar,
	onPickEvent,
}: {
	anchor: Date
	calendars: Calendar[]
	calendarById: Map<string, Calendar>
	hiddenCalendarIds: Set<string>
	agenda: Event[]
	onPickDate: (date: Date) => void
	onToggleCalendar: (calendarId: string) => void
	onPickEvent: (event: Event) => void
}) {
	return (
		<div className="flex flex-col gap-5 px-1 py-2">
			<MiniCalendar refDate={anchor} onPick={onPickDate} />
			<div>
				<p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					My calendars
				</p>
				<div className="flex flex-col gap-0.5">
					{calendars.map((cal, index) => {
						const hidden = hiddenCalendarIds.has(cal.id)
						const tone = calendarTone(cal, index)
						return (
							<button
								key={cal.id}
								type="button"
								aria-pressed={!hidden}
								onClick={() => onToggleCalendar(cal.id)}
								className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
							>
								<span
									className={cn(
										'flex h-4 w-4 items-center justify-center rounded border-2 transition-colors',
										hidden ? 'border-border' : cn(eventBarClass(tone), 'border-transparent'),
									)}
								>
									{hidden ? null : <Check className="h-3 w-3 text-primary-foreground" />}
								</span>
								<span className={cn('truncate', hidden ? 'text-muted-foreground' : 'text-foreground')}>
									{cal.name || 'Calendar'}
								</span>
							</button>
						)
					})}
				</div>
			</div>
			<div className="rounded-lg border border-border bg-card p-3">
				<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Up next today</p>
				<div className="mt-2 flex flex-col gap-2">
					{agenda.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing left today.</p>
					) : (
						agenda.slice(0, 4).map((event, index) => (
							<button
								key={event.id}
								type="button"
								onClick={() => onPickEvent(event)}
								className="flex items-start gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted"
							>
								<span
									className={cn(
										'mt-1 h-2 w-2 shrink-0 rounded-full',
										eventDotClass(eventTone(event, index, calendarById.get(event.calendar_id))),
									)}
								/>
								<span className="min-w-0">
									<span className="block truncate text-sm font-medium">{event.title || '(untitled)'}</span>
									<span className="text-xs text-muted-foreground">
										{fmtAgendaTime(eventTimes(event).start)}
									</span>
								</span>
							</button>
						))
					)}
				</div>
			</div>
		</div>
	)
}

function eventBarClass(tone: EventTone): string {
	return eventColorClass(tone, 'bg')
}

function eventDotClass(tone: EventTone): string {
	return eventColorClass(tone, 'bg')
}

function formatWeekTitle(anchor: Date): string {
	const start = startOfWeek(anchor)
	const end = addDays(start, 6)
	const sameMonth = start.getMonth() === end.getMonth()
	const sameYear = start.getFullYear() === end.getFullYear()
	if (sameMonth && sameYear) {
		return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.getDate()}, ${end.getFullYear()}`
	}
	if (sameYear) {
		return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
	}
	return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
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
	calendarById,
	onPickDay,
	onPickEvent,
}: {
	anchor: Date
	events: Event[]
	calendarById: Map<string, Calendar>
	onPickDay: (d: Date) => void
	onPickEvent: (e: Event) => void
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
						// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Reference calendar cells are mouse-clickable static cells, not separate buttons.
						<div
							key={day.toISOString()}
							onClick={() => onPickDay(day)}
							className={cn(
								'group relative flex min-h-0 cursor-pointer flex-col gap-1 border-r border-b border-border p-1.5 transition-colors hover:bg-muted/40',
								!inMonth && 'bg-muted/30',
							)}
						>
							<div className="pointer-events-none relative z-10 flex items-center justify-center">
								<span
									className={cn(
										'flex h-6 min-w-6 items-center justify-center rounded-sm px-1.5 text-xs font-medium tabular-nums',
										iso === todayIso && 'bg-primary text-primary-foreground',
										iso !== todayIso && !inMonth && 'text-muted-foreground/60',
										iso !== todayIso && inMonth && 'text-foreground',
									)}
								>
									{day.getDate()}
								</span>
							</div>
							<div className="pointer-events-none relative z-10 flex min-h-0 flex-col gap-1 overflow-hidden">
								{dayEvents.slice(0, 3).map((event, index) => {
									const tone = eventTone(event, index, calendarById.get(event.calendar_id))
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
												'pointer-events-auto flex items-center gap-1.5 truncate rounded-sm px-1.5 py-0.5 text-left text-xs transition-transform hover:scale-[1.01]',
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
									<span className="px-1.5 text-left text-xs font-medium text-muted-foreground">
										+{dayEvents.length - 3} more
									</span>
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
	calendarById,
	onPickEvent,
	onPickSlot,
}: {
	days: number
	start: Date
	events: Event[]
	calendarById: Map<string, Calendar>
	onPickEvent: (e: Event) => void
	onPickSlot: (date: Date, hour: number) => void
}) {
	const HOUR_PX = 52
	const START_HOUR = 7
	const END_HOUR = 22
	const GRID_END_HOUR = END_HOUR + 1
	const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
	const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i))
	const todayIso = ymd(new Date())
	const scrollRef = useRef<HTMLDivElement>(null)
	const [nowOffset, setNowOffset] = useState<number | null>(null)
	const allDaySegments = allDayEventSegments(events, columns)
	const allDayRowCount = Math.max(1, ...allDaySegments.map((segment) => segment.row + 1))
	const hasAllDay = allDaySegments.length > 0
	const dayGridTemplateColumns = days === 1 ? '3.5rem minmax(0, 1fr)' : '3.5rem repeat(7, minmax(0, 1fr))'

	useEffect(() => {
		function updateNowOffset() {
			const current = new Date()
			const hour = current.getHours() + current.getMinutes() / 60
			setNowOffset(hour < START_HOUR || hour > END_HOUR ? null : (hour - START_HOUR) * HOUR_PX)
		}
		updateNowOffset()
		const id = setInterval(updateNowOffset, 60_000)
		return () => clearInterval(id)
	}, [])

	useEffect(() => {
		if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (8 - START_HOUR) * HOUR_PX - 12)
	}, [])

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div ref={scrollRef} className="isolate relative min-h-0 flex-1 overflow-y-auto">
				<div className="sticky top-0 z-30 bg-background">
					<div
						className="grid border-b border-border pr-3"
						style={{ gridTemplateColumns: dayGridTemplateColumns }}
					>
						<div aria-hidden="true" style={{ gridColumn: 1, gridRow: 1 }} />
						{columns.map((day, dayIndex) => (
							<div
								key={day.toISOString()}
								className="flex flex-col items-center gap-0.5 py-2"
								style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
							>
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
					{hasAllDay ? (
						<div
							className="grid border-b border-border pr-3"
							style={{
								gridTemplateColumns: dayGridTemplateColumns,
								gridTemplateRows: `repeat(${allDayRowCount}, minmax(2.5rem, auto))`,
							}}
						>
							<div
								className="flex items-center justify-end self-stretch pr-2 text-[10px] text-muted-foreground uppercase"
								style={{ gridColumn: 1, gridRow: `1 / span ${allDayRowCount}` }}
							>
								All day
							</div>
							{columns.map((day, dayIndex) => (
								<div
									key={day.toISOString()}
									aria-hidden="true"
									className="pointer-events-none min-h-10"
									style={{
										gridColumn: dayIndex + 2,
										gridRow: `1 / span ${allDayRowCount}`,
									}}
								/>
							))}
							{allDaySegments.map((segment) => {
								const { event } = segment
								const tone = eventTone(event, segment.index, calendarById.get(event.calendar_id))
								return (
									<button
										key={event.id}
										type="button"
										onClick={() => onPickEvent(event)}
										style={{
											gridColumn: `${segment.startColumn + 1} / span ${segment.span}`,
											gridRow: segment.row + 1,
										}}
										className={cn(
											'z-10 mx-1 min-w-0 self-center truncate rounded-sm px-2 py-1 text-left text-xs font-medium text-primary-foreground',
											eventBarClass(tone),
										)}
									>
										{event.title || '(untitled)'}
									</button>
								)
							})}
						</div>
					) : null}
				</div>
				<div className="relative">
					<ContinuousDayColumnRules days={days} gridTemplateColumns={dayGridTemplateColumns} />
					<div className="grid pr-3" style={{ gridTemplateColumns: dayGridTemplateColumns }}>
						<div style={{ gridColumn: 1, gridRow: 1 }}>
							{HOURS.map((hour) => (
								<div key={hour} className="relative h-[52px]">
									<span className="absolute -top-2 right-2 text-[11px] tabular-nums text-muted-foreground">
										{hour === START_HOUR ? '' : fmtHour(hour)}
									</span>
								</div>
							))}
						</div>
						{columns.map((day, dayIndex) => {
							const dayEvents = eventsOnDay(events, day).filter((event) => !eventTimes(event).allDay)
							const isToday = ymd(day) === todayIso
							return (
								<div
									key={day.toISOString()}
									className="relative min-w-0 overflow-visible [clip-path:inset(-100vh_0_-100vh_0)]"
									style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
								>
									{HOURS.map((hour) => (
										<button
											key={hour}
											type="button"
											onClick={() => onPickSlot(day, hour)}
											aria-label={`Create event at ${fmtHour(hour)} on ${day.toLocaleDateString(undefined, {
												weekday: 'long',
												month: 'long',
												day: 'numeric',
											})}`}
											className="h-[52px] w-full cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/40"
										/>
									))}
									{isToday && nowOffset !== null ? (
										<div
											className="pointer-events-none absolute right-0 left-0 z-20"
											style={{ top: nowOffset }}
										>
											<div className="relative">
												<div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-destructive" />
												<div className="h-px w-full bg-destructive" />
											</div>
										</div>
									) : null}
									{dayEvents.map((event, index) => {
										const { start: s, end: e } = eventTimes(event)
										const layout = timedEventLayout(event, day, {
											startHour: START_HOUR,
											endHour: GRID_END_HOUR,
											hourHeight: HOUR_PX,
										})
										if (!layout) return null
										return (
											<button
												key={event.id}
												type="button"
												onClick={() => onPickEvent(event)}
												style={{
													top: layout.top,
													height: layout.height,
												}}
												className={cn(
													'absolute right-1 left-1 z-10 flex min-w-0 flex-col overflow-hidden rounded-sm px-1.5 py-1 text-left transition-shadow hover:shadow-md',
													eventChipClass(eventTone(event, index, calendarById.get(event.calendar_id))),
												)}
											>
												<span className="truncate text-xs leading-tight font-semibold">
													{event.title || '(untitled)'}
												</span>
												{layout.height > 30 ? (
													<span className="truncate text-[10px] opacity-80">
														{fmtTime(s)} – {fmtTime(e)}
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

function ContinuousDayColumnRules({
	days,
	gridTemplateColumns,
}: {
	days: number
	gridTemplateColumns: string
}) {
	if (days <= 1) return null
	const ruleGridColumns = Array.from({ length: days - 1 }, (_, offset) => offset + 3)
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-y-0 right-3 left-0 z-0 grid"
			style={{ gridTemplateColumns }}
		>
			{ruleGridColumns.map((gridColumn) => (
				<div
					key={`day-column-rule-${gridColumn}`}
					className="w-0 self-stretch justify-self-start border-l border-border"
					style={{
						gridColumn,
						gridRow: 1,
					}}
				/>
			))}
		</div>
	)
}

function fmtHour(hour: number): string {
	const period = hour >= 12 ? 'PM' : 'AM'
	const displayHour = hour % 12 === 0 ? 12 : hour % 12
	return `${displayHour} ${period}`
}
