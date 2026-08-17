import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, Menu, Plus, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav } from '#app/components/AppRail'
import { CommandPalette, useCommandPaletteShortcut } from '#app/components/CommandPalette'
import { MobileAppNav } from '#app/components/MobileAppNav'
import {
	CALENDAR_HEADER_GRID_CLASS,
	CALENDAR_SIDEBAR_WIDTH_CLASS,
	CHROME_ROW_CLASS,
	CHROME_ROW_SHELL_CLASS,
} from '#app/config/layout'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { CalendarManagerDialog } from '#features/calendar/components/CalendarManagerDialog'
import { EventModal } from '#features/calendar/components/EventModal'
import {
	addDays,
	allDayEventSegments,
	type CalView,
	calendarDateInTimeZone,
	calendarKeyAction,
	calendarSlotTime,
	calendarWallClockHour,
	eventsOnDay,
	eventTimes,
	filterEventsByCalendars,
	fmtAgendaTime,
	fmtTime,
	isCalendarDate,
	isCalView,
	isNewEventPreview,
	moveCalendarDay,
	shiftAnchor,
	startOfWeek,
	timedEventLayout,
	timedEventsOnDay,
	viewRange,
	ymd,
} from '#features/calendar/lib/calendar'
import { calendarTone, eventTone } from '#features/calendar/lib/calendar-ui-model'
import {
	type CalendarRouteData,
	loadCalendarRouteData,
	useCalendarRouteData,
} from '#features/calendar/state/calendar-state'
import { PullToRefresh, RefreshButton } from '#shared/components/PullToRefresh'
import { Sheet } from '#shared/components/Sheet'
import { ScrollArea } from '#shared/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '#shared/components/ui/tooltip'
import { type EventTone, eventChipClass, eventColorClass } from '#shared/lib/color-tone'
import type { Rect } from '#shared/lib/modal-position'
import { cn } from '#shared/lib/utils'

export const Route = createFileRoute('/calendar/$view')({
	params: {
		parse: (params) => {
			if (!isCalView(params.view)) throw new Error(`Unknown view: ${params.view}`)
			return { view: params.view as CalView }
		},
	},
	validateSearch: (search): { date?: string } => (isCalendarDate(search.date) ? { date: search.date } : {}),
	loaderDeps: ({ search }) => ({ date: search.date }),
	loader: async ({ params, deps }) => loadCalendarRouteData(params.view, deps.date),
	component: CalendarViewRoutePage,
})

export { loadCalendarRouteData }

function CalendarViewRoutePage() {
	const { view } = Route.useParams()
	const { date } = Route.useSearch()
	const initialData = Route.useLoaderData()
	const calendarQuery = useCalendarRouteData(view, date, initialData)

	return (
		<CalendarRouteScreen
			view={view}
			data={calendarQuery.data}
			onRefresh={() => calendarQuery.refetch({ throwOnError: true }).then(() => undefined)}
		/>
	)
}

export function CalendarRouteScreen({
	view,
	data,
	onRefresh,
}: {
	view: CalView
	data: CalendarRouteData
	onRefresh?: () => Promise<unknown>
}) {
	const { events, calendar, calendars, info, anchorIso } = data
	const navigate = useNavigate()
	const [editing, setEditing] = useState<Event | 'new' | null>(null)
	const [newStart, setNewStart] = useState<Date | null>(null)
	const [newStartIsSlot, setNewStartIsSlot] = useState(false)
	const [composerAnchor, setComposerAnchor] = useState<Rect | null>(null)
	const [eventPreview, setEventPreview] = useState<Event | null>(null)
	const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set())
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [managingCalendars, setManagingCalendars] = useState(false)
	const [preferences] = useUserPreferences()
	const primaryTimezone = preferences.primaryTimezone
	const secondaryTimezone = preferences.secondaryTimezone
	const today = useMemo(() => calendarDateInTimeZone(new Date(), primaryTimezone), [primaryTimezone])
	const openPalette = useCallback(() => setPaletteOpen(true), [])
	const closePalette = useCallback(() => setPaletteOpen(false), [])
	useCommandPaletteShortcut(openPalette)
	const currentView = view
	const currentAnchorIso = anchorIso
	const anchor = useMemo(() => new Date(`${currentAnchorIso}T00:00:00`), [currentAnchorIso])
	const visibleEvents = useMemo(
		() => filterEventsByCalendars(eventPreview ? [...events, eventPreview] : events, hiddenCalendarIds),
		[events, eventPreview, hiddenCalendarIds],
	)
	const calendarNameById = useMemo(
		() => new Map(calendars.map((cal) => [cal.id, cal.name || 'Calendar'])),
		[calendars],
	)
	const calendarById = useMemo(() => new Map(calendars.map((cal) => [cal.id, cal])), [calendars])
	const agenda = useMemo(
		() =>
			timedEventsOnDay(visibleEvents, today, primaryTimezone)
				.filter((event) => !isNewEventPreview(event))
				.sort((a, b) => {
					const aTimes = eventTimes(a)
					const bTimes = eventTimes(b)
					/* v8 ignore next -- timedEventsOnDay only returns events with parsed times -- @preserve */
					if (!aTimes || !bTimes) return 0
					return aTimes.start.getTime() - bTimes.start.getTime()
				})
				.slice(0, 5),
		[today, visibleEvents, primaryTimezone],
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
			if (target?.closest?.('[role="dialog"], button, a, select, [role="grid"]')) return
			const action = calendarKeyAction(event.key)
			if (!action) return
			event.preventDefault()
			if (action.kind === 'view') go(action.view, anchor)
			else if (action.kind === 'shift') go(currentView, shiftAnchor(currentView, anchor, action.direction))
			else if (action.kind === 'today') go(currentView, calendarDateInTimeZone(new Date(), primaryTimezone))
			else {
				setNewStart(null)
				setNewStartIsSlot(false)
				setComposerAnchor(null)
				setEditing('new')
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [anchor, currentView, go, primaryTimezone])

	const title =
		currentView === 'month'
			? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
			: currentView === 'week'
				? formatWeekTitle(anchor)
				: anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

	return (
		<div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={cn(CHROME_ROW_SHELL_CLASS, 'h-[5.5rem] sm:h-11')}>
				<AppRailLogo appName={info.appName} className="hidden md:flex" />
				<header
					className={cn(
						'flex min-w-0 flex-1 items-stretch border-b border-border bg-background',
						CHROME_ROW_CLASS,
						'h-[5.5rem] sm:h-11',
					)}
				>
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						className={cn(
							'touch-target-square flex h-11 w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:hidden',
						)}
						aria-label="Open navigation"
					>
						<Menu className="h-4 w-4" />
					</button>
					<div className={cn('min-w-0 flex-1', CALENDAR_HEADER_GRID_CLASS)}>
						<div className="hidden border-r border-border lg:block" aria-hidden="true" />
						<div
							className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_2.75rem] grid-rows-[2.75rem_2.75rem] items-stretch sm:flex"
							data-testid="calendar-header-controls"
						>
							<button
								type="button"
								onClick={() => {
									setNewStart(anchor)
									setNewStartIsSlot(false)
									setComposerAnchor(null)
									setEditing('new')
								}}
								className="touch-target-square col-start-1 row-start-1 flex size-11 shrink-0 items-center justify-center gap-1.5 border-r border-border text-sm font-medium text-foreground transition-colors hover:bg-muted/60 sm:w-auto sm:justify-start sm:px-3"
								aria-label="Create"
							>
								<Plus className="h-4 w-4" strokeWidth={2} />
								<span className="hidden sm:inline">Create</span>
							</button>
							<button
								type="button"
								className="touch-target col-start-1 row-start-2 flex size-11 shrink-0 items-center justify-center border-r border-t border-border text-xs font-medium text-foreground transition-colors hover:bg-muted/60 sm:w-auto sm:border-t-0 sm:px-3 sm:text-sm"
								onClick={() => go(currentView, calendarDateInTimeZone(new Date(), primaryTimezone))}
							>
								Today
							</button>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										className="touch-target-square col-start-3 row-start-1 flex size-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
										onClick={() => go(currentView, shiftAnchor(currentView, anchor, -1))}
										aria-label="Previous"
									>
										<ChevronLeft className="h-4 w-4" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Previous {currentView}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										className="touch-target-square col-start-4 row-start-1 flex size-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
										onClick={() => go(currentView, shiftAnchor(currentView, anchor, 1))}
										aria-label="Next"
									>
										<ChevronRight className="h-4 w-4" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Next {currentView}</TooltipContent>
							</Tooltip>
							<div className="col-start-2 row-start-1 flex min-w-0 items-center border-r border-border px-3 sm:flex-1">
								<h1 className="truncate font-display text-sm font-semibold text-balance sm:text-base">
									{title}
								</h1>
							</div>
							<select
								aria-label="Calendar view"
								value={currentView}
								onChange={(event) => {
									const nextView = event.currentTarget.value
									if (nextView === 'day' || nextView === 'week' || nextView === 'month') go(nextView, anchor)
								}}
								className="touch-target col-start-2 col-end-5 row-start-2 h-11 w-full shrink-0 border-0 border-t border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring sm:hidden"
							>
								<option value="day">Day</option>
								<option value="week">Week</option>
								<option value="month">Month</option>
							</select>
							<fieldset
								className="m-0 hidden min-w-0 shrink-0 items-stretch border-0 p-0 sm:flex"
								aria-label="Calendar view"
							>
								{(['day', 'week', 'month'] as const).map((v) => (
									<button
										key={v}
										type="button"
										onClick={() => go(v, anchor)}
										aria-pressed={v === currentView}
										className={cn(
											'touch-target flex h-11 min-w-11 items-center justify-center whitespace-nowrap border-r border-border px-2 text-xs font-medium capitalize transition-colors last:border-r-0 sm:w-auto sm:px-3 sm:text-sm',
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
					accounts={info.accounts}
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
						timeZone={primaryTimezone}
						onPickDate={(date) => go(currentView === 'month' ? 'day' : currentView, date)}
						onToggleCalendar={toggleCalendar}
						onPickEvent={setEditing}
						onManageCalendars={() => setManagingCalendars(true)}
					/>
				</aside>
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
					{currentView === 'month' ? (
						<MonthGrid
							anchor={anchor}
							events={visibleEvents}
							calendarById={calendarById}
							onRefresh={onRefresh}
							onPickDay={(d) => go('day', d)}
							onPickEvent={setEditing}
							timeZone={primaryTimezone}
						/>
					) : (
						<TimeGrid
							days={currentView === 'week' ? 7 : 1}
							start={currentView === 'week' ? startOfWeek(anchor) : anchor}
							events={visibleEvents}
							calendarById={calendarById}
							onPickEvent={setEditing}
							timeZone={primaryTimezone}
							secondaryTimezone={secondaryTimezone}
							onRefresh={onRefresh}
							onPickSlot={(date, hour, rect) => {
								setNewStart(calendarSlotTime(date, hour, primaryTimezone))
								setNewStartIsSlot(true)
								setComposerAnchor(rect)
								setEditing('new')
							}}
						/>
					)}
				</div>
			</div>
			<MobileAppNav active="calendar" />

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
					anchorRect={editing === 'new' ? composerAnchor : null}
					timeZone={primaryTimezone}
					preserveDefaultStartTime={editing === 'new' && newStartIsSlot}
					events={events}
					onDraftChange={setEventPreview}
					onClose={() => {
						setEventPreview(null)
						setEditing(null)
					}}
				/>
			) : null}

			<Sheet open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Navigation" hideAt="lg">
				<AppRailMobileNav
					email={info.email}
					displayName={info.displayName}
					accounts={info.accounts}
					active="calendar"
					onOpenCommandPalette={openPalette}
					onNavigate={() => setSidebarOpen(false)}
					showDestinations={false}
				/>
				<div className="border-t border-border px-3 pt-2">
					{onRefresh ? (
						<div className="flex items-center justify-between border-b border-border py-2 pl-1">
							<span className="text-sm font-medium text-foreground">Refresh calendar</span>
							<RefreshButton onRefresh={onRefresh} label="Refresh calendar" />
						</div>
					) : null}
					<CalendarSidebarPanel
						anchor={anchor}
						calendars={calendars}
						calendarById={calendarById}
						hiddenCalendarIds={hiddenCalendarIds}
						agenda={agenda}
						timeZone={primaryTimezone}
						onPickDate={(date) => {
							go(currentView === 'month' ? 'day' : currentView, date)
							setSidebarOpen(false)
						}}
						onToggleCalendar={toggleCalendar}
						onPickEvent={(event) => {
							setEditing(event)
							setSidebarOpen(false)
						}}
						onManageCalendars={() => setManagingCalendars(true)}
					/>
				</div>
			</Sheet>

			<CommandPalette open={paletteOpen} onClose={closePalette} />
			{managingCalendars ? (
				<CalendarManagerDialog
					calendars={calendars}
					onClose={() => setManagingCalendars(false)}
					onDeleted={(calendarId) => {
						setHiddenCalendarIds((current) => {
							const next = new Set(current)
							next.delete(calendarId)
							return next
						})
					}}
				/>
			) : null}
		</div>
	)
}

function CalendarSidebarPanel({
	anchor,
	calendars,
	calendarById,
	hiddenCalendarIds,
	agenda,
	timeZone,
	onPickDate,
	onToggleCalendar,
	onPickEvent,
	onManageCalendars,
}: {
	anchor: Date
	calendars: Calendar[]
	calendarById: Map<string, Calendar>
	hiddenCalendarIds: Set<string>
	agenda: Event[]
	timeZone: string
	onPickDate: (date: Date) => void
	onToggleCalendar: (calendarId: string) => void
	onPickEvent: (event: Event) => void
	onManageCalendars: () => void
}) {
	return (
		<div className="flex flex-col gap-5 px-1 py-2">
			<MiniCalendar refDate={anchor} onPick={onPickDate} />
			<div>
				<div className="mb-2 flex items-center justify-between">
					<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">My calendars</p>
					<button
						type="button"
						onClick={onManageCalendars}
						aria-label="Manage calendars"
						className="touch-target-square flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
					>
						<Settings2 className="h-4 w-4" />
					</button>
				</div>
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
								className="touch-target flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
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
						agenda.slice(0, 4).map((event, index) => {
							const times = eventTimes(event)
							/* v8 ignore next -- visibleEvents only contains runtime-validated events -- @preserve */
							if (!times) return null
							return (
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
											{fmtAgendaTime(times.start, timeZone)}
										</span>
									</span>
								</button>
							)
						})
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

/* v8 ignore start -- grid movement is unit-tested in moveCalendarDay; pointer rendering is covered separately -- @preserve */
function MiniCalendar({ refDate, onPick }: { refDate: Date; onPick: (date: Date) => void }) {
	const [cursor, setCursor] = useState(() => new Date(refDate.getFullYear(), refDate.getMonth(), 1))
	const [activeDay, setActiveDay] = useState(() => new Date(refDate))
	useEffect(() => setActiveDay(new Date(refDate)), [refDate])
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
						className="touch-target-square flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted"
					>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<button
						type="button"
						aria-label="Next month"
						onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
						className="touch-target-square flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted"
					>
						<ChevronRight className="h-4 w-4" />
					</button>
				</div>
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: The date picker uses ARIA grid keyboard navigation with roving tab stops. */}
			<div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label="Date picker">
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
							tabIndex={ymd(day) === ymd(activeDay) ? 0 : -1}
							onKeyDown={(event) => {
								const next = moveCalendarDay(day, event.key)
								if (!next) return
								event.preventDefault()
								setActiveDay(next)
								if (next.getMonth() !== cursor.getMonth() || next.getFullYear() !== cursor.getFullYear()) {
									setCursor(new Date(next.getFullYear(), next.getMonth(), 1))
								}
								requestAnimationFrame(() =>
									document.querySelector<HTMLElement>(`[data-mini-calendar-day="${ymd(next)}"]`)?.focus(),
								)
							}}
							data-mini-calendar-day={iso}
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
	timeZone,
	onPickDay,
	onPickEvent,
	onRefresh,
}: {
	anchor: Date
	events: Event[]
	calendarById: Map<string, Calendar>
	timeZone: string
	onPickDay: (d: Date) => void
	onPickEvent: (e: Event) => void
	onRefresh?: () => Promise<unknown>
}) {
	const { start, end } = viewRange('month', anchor)
	const days: Date[] = []
	for (let d = new Date(start); d < end; d = addDays(d, 1)) days.push(new Date(d))
	const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7))
	const visibleDayIds = new Set(days.map(ymd))
	const todayIso = ymd(calendarDateInTimeZone(new Date(), timeZone))
	const [activeDay, setActiveDay] = useState(() => new Date(anchor))
	useEffect(() => setActiveDay(new Date(anchor)), [anchor])

	const monthGrid = (
		/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: The native table structure provides the required row and cell ownership for this interactive ARIA grid. */
		<table className="flex min-h-0 flex-1 flex-col" role="grid" aria-label="Month calendar">
			<thead className="block shrink-0">
				<tr className="grid grid-cols-7 border-b border-border">
					{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
						<th
							key={label}
							scope="col"
							className="px-2 py-2 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
						>
							{label}
						</th>
					))}
				</tr>
			</thead>
			<tbody className="flex min-h-0 flex-1 flex-col">
				{weeks.map((week) => (
					<tr key={week[0]?.toISOString()} className="grid min-h-0 flex-1 grid-cols-7">
						{week.map((day) => {
							const inMonth = day.getMonth() === anchor.getMonth()
							const dayEvents = eventsOnDay(events, day, timeZone)
							const iso = ymd(day)
							return (
								<td
									key={day.toISOString()}
									onClick={() => onPickDay(day)}
									onFocus={() => setActiveDay(day)}
									onKeyDown={(event) => {
										if (event.target !== event.currentTarget) return
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault()
											onPickDay(day)
											return
										}
										const next = moveCalendarDay(day, event.key)
										if (!next) return
										event.preventDefault()
										if (!visibleDayIds.has(ymd(next))) return
										setActiveDay(next)
										requestAnimationFrame(() =>
											document
												.querySelector<HTMLElement>(`[data-month-calendar-day="${ymd(next)}"]`)
												?.focus(),
										)
									}}
									// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: This focusable table cell is an interactive day in the ARIA grid.
									role="gridcell"
									aria-label={day.toLocaleDateString(undefined, {
										weekday: 'long',
										month: 'long',
										day: 'numeric',
										year: 'numeric',
									})}
									aria-selected={ymd(day) === ymd(activeDay)}
									tabIndex={ymd(day) === ymd(activeDay) ? 0 : -1}
									data-month-calendar-day={iso}
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
											const times = eventTimes(event)
											/* v8 ignore next -- eventsOnDay excludes records without parsed times -- @preserve */
											if (!times) return null
											const tone = eventTone(event, index, calendarById.get(event.calendar_id))
											const allDay = times.allDay
											const preview = isNewEventPreview(event)
											return (
												<button
													key={event.id}
													type="button"
													onClick={(clickEvent) => {
														clickEvent.stopPropagation()
														if (!preview) onPickEvent(event)
													}}
													disabled={preview}
													className={cn(
														'pointer-events-auto flex items-center gap-1.5 truncate rounded-sm px-1.5 py-0.5 text-left text-xs transition-transform hover:scale-[1.01]',
														allDay ? cn(eventBarClass(tone), 'text-primary-foreground') : 'hover:bg-muted',
														preview && 'border border-dashed border-primary/70 opacity-70',
													)}
												>
													{!allDay ? (
														<span className={cn('h-2 w-2 shrink-0 rounded-full', eventDotClass(tone))} />
													) : null}
													{!allDay ? (
														<span className="shrink-0 tabular-nums text-muted-foreground">
															{fmtTime(times.start, timeZone)}
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
								</td>
							)
						})}
					</tr>
				))}
			</tbody>
		</table>
	)
	return onRefresh ? (
		<PullToRefresh onRefresh={onRefresh} className="flex min-h-0 flex-1 flex-col">
			{monthGrid}
		</PullToRefresh>
	) : (
		monthGrid
	)
}

function TimeGrid({
	days,
	start,
	events,
	calendarById,
	timeZone,
	secondaryTimezone,
	onPickEvent,
	onPickSlot,
	onRefresh,
}: {
	days: number
	start: Date
	events: Event[]
	calendarById: Map<string, Calendar>
	timeZone: string
	secondaryTimezone: string
	onPickEvent: (e: Event) => void
	onPickSlot: (date: Date, hour: number, rect: Rect) => void
	onRefresh?: () => Promise<unknown>
}) {
	const HOUR_PX = 52
	// Render the full day so selections made in the event composer always
	// remain visible after the calendar refreshes.
	const START_HOUR = 0
	// Midnight belongs at the top of each calendar day; 24:00 remains only as
	// the end boundary for layouts that run through the end of the day.
	const END_HOUR = 24
	const LAST_SLOT_HOUR = END_HOUR - 1
	const GRID_END_HOUR = END_HOUR
	const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
	const columns: Date[] = Array.from({ length: days }, (_, i) => addDays(start, i))
	const todayIso = ymd(calendarDateInTimeZone(new Date(), timeZone))
	const scrollRef = useRef<HTMLDivElement>(null)
	const [nowOffset, setNowOffset] = useState<number | null>(null)
	const [activeSlot, setActiveSlot] = useState({ day: 0, hour: START_HOUR })
	const allDaySegments = allDayEventSegments(events, columns)
	const allDayRowCount = Math.max(1, ...allDaySegments.map((segment) => segment.row + 1))
	const hasAllDay = allDaySegments.length > 0
	const dayGridTemplateColumns = days === 1 ? '3.5rem minmax(0, 1fr)' : '3.5rem repeat(7, minmax(0, 1fr))'

	useEffect(() => {
		function updateNowOffset() {
			const current = new Date()
			const hour = calendarWallClockHour(current, timeZone)
			setNowOffset((hour - START_HOUR) * HOUR_PX)
		}
		updateNowOffset()
		const id = setInterval(updateNowOffset, 60_000)
		return () => clearInterval(id)
	}, [timeZone])

	useEffect(() => {
		if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (8 - START_HOUR) * HOUR_PX - 12)
	}, [])

	function moveSlot(dayIndex: number, hour: number, key: string) {
		let nextDay = dayIndex
		let nextHour = hour
		if (key === 'ArrowLeft') nextDay = Math.max(0, dayIndex - 1)
		else if (key === 'ArrowRight') nextDay = Math.min(days - 1, dayIndex + 1)
		else if (key === 'ArrowUp') nextHour = Math.max(START_HOUR, hour - 1)
		else if (key === 'ArrowDown') nextHour = Math.min(LAST_SLOT_HOUR, hour + 1)
		else if (key === 'Home') nextHour = START_HOUR
		else if (key === 'End') nextHour = LAST_SLOT_HOUR
		else return
		setActiveSlot({ day: nextDay, hour: nextHour })
		requestAnimationFrame(() =>
			document.querySelector<HTMLElement>(`[data-calendar-slot="${nextDay}-${nextHour}"]`)?.focus(),
		)
	}

	const timeGrid = (
		<div className="flex min-h-0 flex-1 flex-col">
			<ScrollArea
				aria-label="Calendar time grid"
				viewportRef={scrollRef}
				viewportClassName={days > 1 ? 'max-sm:overflow-x-auto' : undefined}
				className="isolate min-h-0 flex-1"
			>
				<div
					className={cn('sticky top-0 z-30 bg-background', days > 1 && 'max-sm:min-w-[54rem]')}
					data-testid="calendar-time-grid-header"
				>
					<div
						className="grid border-b border-border pr-3"
						style={{ gridTemplateColumns: dayGridTemplateColumns }}
					>
						<section
							className="flex min-w-0 flex-col justify-end gap-0.5 px-1 py-2 text-right"
							style={{ gridColumn: 1, gridRow: 1 }}
							aria-label={
								secondaryTimezone
									? `Time ruler: ${timezoneCity(timeZone)} primary time, ${timezoneCity(secondaryTimezone)} secondary time`
									: `Time ruler: ${timezoneCity(timeZone)} primary time`
							}
						>
							<span
								title={timezoneCity(timeZone)}
								className="truncate text-[10px] font-semibold text-foreground"
							>
								{timezoneShortLabel(timeZone)}
							</span>
							{secondaryTimezone ? (
								<span
									title={timezoneCity(secondaryTimezone)}
									className="truncate text-[9px] text-muted-foreground"
								>
									{timezoneShortLabel(secondaryTimezone)}
								</span>
							) : null}
						</section>
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
								const preview = isNewEventPreview(event)
								return (
									<button
										key={event.id}
										type="button"
										onClick={() => {
											if (!preview) onPickEvent(event)
										}}
										disabled={preview}
										style={{
											gridColumn: `${segment.startColumn + 1} / span ${segment.span}`,
											gridRow: segment.row + 1,
										}}
										className={cn(
											'z-10 mx-1 min-w-0 self-center truncate rounded-sm px-2 py-1 text-left text-xs font-medium text-primary-foreground',
											eventBarClass(tone),
											preview && 'border border-dashed border-primary-foreground/80 opacity-70',
										)}
									>
										{event.title || '(untitled)'}
									</button>
								)
							})}
						</div>
					) : null}
				</div>
				<div
					className={cn('relative', days > 1 && 'max-sm:min-w-[54rem]')}
					data-testid="calendar-time-grid-body"
				>
					<ContinuousDayColumnRules days={days} gridTemplateColumns={dayGridTemplateColumns} />
					<div className="grid pr-3" style={{ gridTemplateColumns: dayGridTemplateColumns }}>
						<div style={{ gridColumn: 1, gridRow: 1 }}>
							{HOURS.map((hour) => (
								<div key={hour} className="relative h-[52px]">
									<span className="absolute -top-2 right-2 text-[11px] tabular-nums text-muted-foreground">
										{hour === START_HOUR ? '' : fmtHour(hour)}
									</span>
									{secondaryTimezone && hour !== START_HOUR ? (
										<span className="absolute top-2 right-2 text-[9px] tabular-nums text-muted-foreground/70">
											{fmtTime(calendarSlotTime(columns[0] ?? start, hour, timeZone), secondaryTimezone)}
										</span>
									) : null}
								</div>
							))}
						</div>
						{columns.map((day, dayIndex) => {
							const dayEvents = eventsOnDay(events, day, timeZone).filter(
								(event) => eventTimes(event)?.allDay === false,
							)
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
											onClick={(clickEvent) =>
												onPickSlot(day, hour, clickEvent.currentTarget.getBoundingClientRect())
											}
											tabIndex={activeSlot.day === dayIndex && activeSlot.hour === hour ? 0 : -1}
											onFocus={() => setActiveSlot({ day: dayIndex, hour })}
											onKeyDown={(event) => {
												if (
													event.key === 'ArrowLeft' ||
													event.key === 'ArrowRight' ||
													event.key === 'ArrowUp' ||
													event.key === 'ArrowDown' ||
													event.key === 'Home' ||
													event.key === 'End'
												) {
													event.preventDefault()
													moveSlot(dayIndex, hour, event.key)
												}
											}}
											data-calendar-slot={`${dayIndex}-${hour}`}
											aria-label={`Create event at ${fmtHour(hour)} on ${day.toLocaleDateString(undefined, {
												weekday: 'long',
												month: 'long',
												day: 'numeric',
											})}`}
											className="block h-[52px] w-full cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/40"
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
										const times = eventTimes(event)
										/* v8 ignore next -- dayEvents excludes records without parsed times -- @preserve */
										if (!times) return null
										const { start: s, end: e } = times
										const preview = isNewEventPreview(event)
										const layout = timedEventLayout(event, day, {
											startHour: START_HOUR,
											endHour: GRID_END_HOUR,
											hourHeight: HOUR_PX,
											timeZone,
										})
										if (!layout) return null
										return (
											<button
												key={event.id}
												type="button"
												onClick={() => {
													if (!preview) onPickEvent(event)
												}}
												disabled={preview}
												style={{
													top: layout.top,
													height: layout.height,
												}}
												className={cn(
													'absolute right-1 left-1 z-10 flex min-w-0 flex-col overflow-hidden rounded-sm px-1.5 py-1 text-left transition-shadow hover:shadow-md',
													eventChipClass(eventTone(event, index, calendarById.get(event.calendar_id))),
													preview && 'border border-dashed border-primary/70 opacity-70',
												)}
											>
												<span className="truncate text-xs leading-tight font-semibold">
													{event.title || '(untitled)'}
												</span>
												{layout.height > 30 ? (
													<span className="truncate text-[10px] opacity-80">
														{fmtTime(s, timeZone)} – {fmtTime(e, timeZone)}
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
			</ScrollArea>
		</div>
	)
	return onRefresh ? (
		<PullToRefresh onRefresh={onRefresh} scrollRef={scrollRef} className="flex min-h-0 flex-1 flex-col">
			{timeGrid}
		</PullToRefresh>
	) : (
		timeGrid
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
/* v8 ignore stop -- @preserve */

function fmtHour(hour: number): string {
	const normalizedHour = hour % 24
	const period = normalizedHour >= 12 ? 'PM' : 'AM'
	const displayHour = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12
	return `${displayHour} ${period}`
}

function timezoneCity(timeZone: string): string {
	return timeZone.replace(/^.*\//, '').replaceAll('_', ' ')
}

function timezoneShortLabel(timeZone: string): string {
	return timezoneCity(timeZone).replace(/ .*/, '')
}
