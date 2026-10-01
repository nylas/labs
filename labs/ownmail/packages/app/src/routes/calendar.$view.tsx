import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Menu, Plus, Settings2 } from 'lucide-react'
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import { AppRailLogo, AppRailMobileNav, AppRailNav } from '#app/components/AppRail'
import { CommandPalette, useCommandPaletteShortcut } from '#app/components/CommandPalette'
import { MobileTabBar } from '#app/components/MobileTabBar'
import {
	CALENDAR_HEADER_GRID_CLASS,
	CALENDAR_SIDEBAR_WIDTH_CLASS,
	CHROME_ROW_CLASS,
	CHROME_ROW_SHELL_CLASS,
} from '#app/config/layout'
import {
	hiddenCalendarIdsFor,
	useUserPreferences,
	withHiddenCalendarIds,
} from '#app/preferences/user-preferences'
import { CalendarManagerDialog } from '#features/calendar/components/CalendarManagerDialog'
import { EventModal } from '#features/calendar/components/EventModal'
import {
	type AgendaEntry,
	addDays,
	allDayBand,
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
	initialTimeGridScrollHour,
	isCalendarDate,
	isCalView,
	isNewEventPreview,
	isPastEvent,
	moveCalendarDay,
	nowBadgeCoversLabel,
	shiftAnchor,
	startOfWeek,
	timedChipLines,
	timedDayLayout,
	timeZoneShortName,
	upcomingAgenda,
	viewRange,
	ymd,
} from '#features/calendar/lib/calendar'
import {
	calendarColors,
	EVENT_ENDED_LABEL,
	type EventColor,
	eventAccessibleName,
	eventColor,
	eventColorStyle,
	eventRsvp,
	eventRsvpLabel,
} from '#features/calendar/lib/calendar-ui-model'
import {
	type CalendarRouteData,
	loadCalendarRouteData,
	useCalendarRouteData,
	useHiddenCalendarIdsForRequest,
	usePrefetchAdjacentCalendarRanges,
} from '#features/calendar/state/calendar-state'
import { PullToRefresh, RefreshButton } from '#shared/components/PullToRefresh'
import { Sheet } from '#shared/components/Sheet'
import { ScrollArea } from '#shared/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '#shared/components/ui/tooltip'
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
	loader: async ({ context, params, deps }) =>
		loadCalendarRouteData(context.queryClient, params.view, deps.date),
	component: CalendarViewRoutePage,
})

export { loadCalendarRouteData }

function CalendarViewRoutePage() {
	const { view } = Route.useParams()
	const { date } = Route.useSearch()
	const initialData = Route.useLoaderData()
	// Hidden calendars are not fetched at all, so the request follows the preference.
	const hiddenCalendarIds = useHiddenCalendarIdsForRequest(
		initialData.info.email,
		initialData.hiddenCalendarIds,
	)
	const calendarQuery = useCalendarRouteData(view, date, initialData, hiddenCalendarIds)
	usePrefetchAdjacentCalendarRanges(view, calendarQuery.data.anchorIso, hiddenCalendarIds)

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
	const { events, calendar, calendars, info, anchorIso, truncated } = data
	const navigate = useNavigate()
	const [editing, setEditing] = useState<Event | 'new' | null>(null)
	const [newStart, setNewStart] = useState<Date | null>(null)
	const [newStartIsSlot, setNewStartIsSlot] = useState(false)
	const [composerAnchor, setComposerAnchor] = useState<Rect | null>(null)
	const [eventPreview, setEventPreview] = useState<Event | null>(null)
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [managingCalendars, setManagingCalendars] = useState(false)
	const [preferences, savePreferences] = useUserPreferences()
	const mobileCalendarLayout = useMobileCalendarLayout()
	const primaryTimezone = preferences.primaryTimezone
	const secondaryTimezone = preferences.secondaryTimezone
	const now = useMinuteClock()
	const todayIso = ymd(calendarDateInTimeZone(now, primaryTimezone))
	const hiddenCalendarIds = useMemo(
		() => new Set(hiddenCalendarIdsFor(preferences, info.email)),
		[preferences, info.email],
	)
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
	const colors = useMemo(() => calendarColors(calendars), [calendars])
	const agenda = useMemo(
		() => upcomingAgenda(visibleEvents, now, primaryTimezone),
		[now, visibleEvents, primaryTimezone],
	)

	const setCalendarHidden = useCallback(
		(calendarId: string, hidden: boolean) => {
			const next = new Set(hiddenCalendarIds)
			if (hidden) next.add(calendarId)
			else next.delete(calendarId)
			savePreferences(withHiddenCalendarIds(preferences, info.email, [...next]))
		},
		[hiddenCalendarIds, info.email, preferences, savePreferences],
	)
	const toggleCalendar = useCallback(
		(calendarId: string) => setCalendarHidden(calendarId, !hiddenCalendarIds.has(calendarId)),
		[hiddenCalendarIds, setCalendarHidden],
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

	const title = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

	return (
		<div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
			<div className={cn(CHROME_ROW_SHELL_CLASS, 'calendar-chrome-row')}>
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
								<span className="hidden md:inline">Create</span>
							</button>
							<div className="col-start-2 row-start-1 flex min-w-0 items-center border-r border-border px-3 sm:flex-1">
								<h1 className="truncate font-display text-base font-bold tracking-[-0.02em] sm:text-xl">
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
								className="touch-target col-start-2 col-end-5 row-start-2 h-11 w-full shrink-0 cursor-pointer border-0 border-t border-border bg-background px-3 text-sm font-medium text-foreground outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring sm:w-auto sm:border-t-0 sm:border-r"
							>
								<option value="day">Day</option>
								<option value="week">Week</option>
								<option value="month">Month</option>
							</select>
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
										className="touch-target-square col-start-4 row-start-1 flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
										onClick={() => go(currentView, shiftAnchor(currentView, anchor, 1))}
										aria-label="Next"
									>
										<ChevronRight className="h-4 w-4" />
									</button>
								</TooltipTrigger>
								<TooltipContent>Next {currentView}</TooltipContent>
							</Tooltip>
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
						mobile={mobileCalendarLayout}
						anchor={anchor}
						view={currentView}
						email={info.email}
						calendars={calendars}
						colors={colors}
						hiddenCalendarIds={hiddenCalendarIds}
						agenda={agenda}
						timeZone={primaryTimezone}
						todayIso={todayIso}
						onPickDate={(date) => go(currentView === 'month' ? 'day' : currentView, date)}
						onToggleCalendar={toggleCalendar}
						onPickEvent={setEditing}
						onManageCalendars={() => setManagingCalendars(true)}
					/>
				</aside>
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
					{truncated ? (
						<p
							role="status"
							className="shrink-0 border-b border-border bg-muted px-region py-hairline text-sm font-medium text-foreground"
						>
							Some events could not be loaded
						</p>
					) : null}
					{currentView === 'month' ? (
						<MonthGrid
							anchor={anchor}
							events={visibleEvents}
							colors={colors}
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
							colors={colors}
							email={info.email}
							now={now}
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
			<MobileTabBar active="calendar" />

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
				<div className="border-t border-border px-3 pt-3">
					{onRefresh ? (
						<div className="flex items-center justify-between py-2 pl-1">
							<span className="text-sm font-medium text-foreground">Refresh calendar</span>
							<RefreshButton onRefresh={onRefresh} label="Refresh calendar" />
						</div>
					) : null}
					<CalendarSidebarPanel
						mobile
						anchor={anchor}
						view={currentView}
						email={info.email}
						calendars={calendars}
						colors={colors}
						hiddenCalendarIds={hiddenCalendarIds}
						agenda={agenda}
						timeZone={primaryTimezone}
						todayIso={todayIso}
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
					onDeleted={(calendarId) => setCalendarHidden(calendarId, false)}
				/>
			) : null}
		</div>
	)
}

function CalendarSidebarPanel({
	anchor,
	view,
	email,
	calendars,
	colors,
	hiddenCalendarIds,
	agenda,
	timeZone,
	todayIso,
	onPickDate,
	onToggleCalendar,
	onPickEvent,
	onManageCalendars,
	mobile = false,
}: {
	anchor: Date
	view: CalView
	email: string
	calendars: Calendar[]
	colors: Map<string, EventColor>
	hiddenCalendarIds: Set<string>
	agenda: AgendaEntry[]
	timeZone: string
	todayIso: string
	onPickDate: (date: Date) => void
	onToggleCalendar: (calendarId: string) => void
	onPickEvent: (event: Event) => void
	onManageCalendars: () => void
	mobile?: boolean
}) {
	return (
		<div className="flex flex-col gap-5 px-1 py-2">
			<MiniCalendar
				refDate={anchor}
				todayIso={todayIso}
				onPick={onPickDate}
				mobile={mobile}
				highlightWeek={view === 'week'}
			/>
			<section aria-label={`Calendars for ${email}`}>
				<div className="mb-1 flex items-center justify-between gap-2">
					<p className="min-w-0 truncate text-xs text-muted-foreground" title={email}>
						{email}
					</p>
					<button
						type="button"
						onClick={onManageCalendars}
						aria-label="Manage calendars"
						className="touch-target-square flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
					>
						<Settings2 className="h-4 w-4" />
					</button>
				</div>
				<div className="flex flex-col gap-0.5">
					{calendars.map((cal) => {
						const hidden = hiddenCalendarIds.has(cal.id)
						const name = cal.name || 'Calendar'
						// The tag is part of the name, so "hidden" is announced, not only drawn.
						const tag = hidden ? 'hidden' : cal.is_primary ? 'Default' : null
						return (
							<button
								key={cal.id}
								type="button"
								aria-label={tag ? `${name}, ${tag}` : name}
								aria-pressed={!hidden}
								onClick={() => onToggleCalendar(cal.id)}
								style={eventColorProps(cal, colors)}
								className="event-color touch-target flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
							>
								<span
									aria-hidden="true"
									className={cn(
										'size-[11px] shrink-0 rounded-[3px] bg-[var(--event-c)]',
										hidden && 'opacity-40',
									)}
								/>
								<span
									className={cn(
										'min-w-0 truncate text-left',
										hidden ? 'text-muted-foreground' : 'text-foreground',
									)}
								>
									{name}
								</span>
								{tag ? (
									<span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{tag}</span>
								) : null}
							</button>
						)
					})}
				</div>
			</section>
			<div className="rounded-lg border border-border bg-card p-3">
				<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Up next today</p>
				<div className="mt-2 flex flex-col gap-2">
					{agenda.length === 0 ? (
						<p className="text-sm text-muted-foreground">Nothing left today.</p>
					) : (
						agenda.slice(0, 4).map(({ event, start, inProgress }) => (
							<button
								key={event.id}
								type="button"
								onClick={() => onPickEvent(event)}
								className="flex min-h-12 w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted"
							>
								<span
									className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', EVENT_SWATCH_CLASS)}
									style={eventColorProps(event, colors)}
								/>
								<span className="min-w-0">
									<span className="block truncate text-sm font-medium">{event.title || '(untitled)'}</span>
									<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
										{inProgress ? (
											<span className="rounded-sm bg-primary/10 px-1 font-semibold text-primary">Now</span>
										) : null}
										{fmtAgendaTime(start, timeZone)}
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

/** Solid swatch in the calendar's colour; pair with `eventColorProps`. */
const EVENT_SWATCH_CLASS = 'event-color bg-[var(--event-c)]'

/** Inline colour variables for an event, or for a calendar (whose id is its own key). */
function eventColorProps(
	source: Pick<Event, 'calendar_id'> | Pick<Calendar, 'id'>,
	colors: Map<string, EventColor>,
): CSSProperties {
	const calendarId = 'calendar_id' in source ? source.calendar_id : source.id
	return eventColorStyle(eventColor({ calendar_id: calendarId }, colors))
}

/** Current time, refreshed each minute so "today" and "Up next" roll forward on their own. */
function useMinuteClock(): Date {
	const [now, setNow] = useState(() => new Date())
	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 60_000)
		return () => clearInterval(id)
	}, [])
	return now
}

const MOBILE_CALENDAR_MEDIA_QUERY = '(max-width: 63.999rem)'

function subscribeMobileCalendarLayout(onStoreChange: () => void) {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
	const media = window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY)
	media.addEventListener('change', onStoreChange)
	return () => media.removeEventListener('change', onStoreChange)
}

function readMobileCalendarLayout() {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY).matches
	)
}

function useMobileCalendarLayout() {
	return useSyncExternalStore(
		subscribeMobileCalendarLayout,
		readMobileCalendarLayout,
		/* v8 ignore next -- this snapshot runs only during server rendering -- @preserve */
		() => false,
	)
}

/* v8 ignore start -- grid movement is unit-tested in moveCalendarDay; pointer rendering is covered separately -- @preserve */
function MiniCalendar({
	refDate,
	todayIso,
	onPick,
	mobile,
	highlightWeek,
}: {
	refDate: Date
	todayIso: string
	onPick: (date: Date) => void
	mobile: boolean
	highlightWeek: boolean
}) {
	const [cursor, setCursor] = useState(() => new Date(refDate.getFullYear(), refDate.getMonth(), 1))
	const [activeDay, setActiveDay] = useState(() => new Date(refDate))
	useEffect(() => setActiveDay(new Date(refDate)), [refDate])
	const { start, end } = viewRange('month', cursor)
	const days: Date[] = []
	for (let day = new Date(start); day < end; day = addDays(day, 1)) days.push(new Date(day))
	const refIso = ymd(refDate)
	const refWeekIso = ymd(startOfWeek(refDate))
	if (mobile) {
		return (
			<label className="block text-sm font-medium" htmlFor="mobile-calendar-date">
				Go to date
				<input
					id="mobile-calendar-date"
					type="date"
					value={refIso}
					onChange={(event) => {
						if (!isCalendarDate(event.currentTarget.value)) return
						onPick(new Date(`${event.currentTarget.value}T00:00:00`))
					}}
					className="mt-2 h-12 w-full rounded-lg border border-border bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
				/>
			</label>
		)
	}

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
			<div className="grid grid-cols-7 gap-y-0.5 text-center" role="grid" aria-label="Date picker">
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
					const isToday = iso === todayIso
					// In week view the whole visible week is marked, as one continuous band.
					const inWeek = highlightWeek && ymd(startOfWeek(day)) === refWeekIso
					return (
						<button
							key={iso}
							type="button"
							onClick={() => onPick(day)}
							data-current-week={inWeek ? '' : undefined}
							aria-current={isToday ? 'date' : undefined}
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
								'flex h-7 items-center justify-center text-xs tabular-nums transition-colors',
								inMonth ? 'text-foreground' : 'text-muted-foreground/60',
								inWeek
									? cn('bg-muted', day.getDay() === 0 && 'rounded-l-md', day.getDay() === 6 && 'rounded-r-md')
									: 'rounded-sm hover:bg-muted',
								!isToday && iso === refIso && 'font-semibold',
								!isToday && !highlightWeek && iso === refIso && 'bg-accent text-accent-foreground',
								isToday && 'rounded-[5px] bg-today font-semibold text-today-foreground',
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
	colors,
	timeZone,
	onPickDay,
	onPickEvent,
	onRefresh,
}: {
	anchor: Date
	events: Event[]
	colors: Map<string, EventColor>
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
	const mobileLayout = useMobileCalendarLayout()
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
									aria-label={`${day.toLocaleDateString(undefined, {
										weekday: 'long',
										month: 'long',
										day: 'numeric',
										year: 'numeric',
									})}; ${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`}
									aria-selected={ymd(day) === ymd(activeDay)}
									aria-current={iso === todayIso ? 'date' : undefined}
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
												iso === todayIso && 'rounded-[5px] bg-today text-today-foreground',
												iso !== todayIso && !inMonth && 'text-muted-foreground/60',
												iso !== todayIso && inMonth && 'text-foreground',
											)}
										>
											{day.getDate()}
										</span>
									</div>
									<div className="pointer-events-none relative z-10 flex min-h-0 flex-col gap-1 overflow-hidden">
										{dayEvents.slice(0, 3).map((event) => {
											const times = eventTimes(event)
											/* v8 ignore next -- eventsOnDay excludes records without parsed times -- @preserve */
											if (!times) return null
											const allDay = times.allDay
											const preview = isNewEventPreview(event)
											const content = (
												<>
													{!allDay ? (
														<span className="h-2 w-2 shrink-0 rounded-full bg-[var(--event-c)]" />
													) : null}
													{!allDay ? (
														<span className="shrink-0 tabular-nums text-muted-foreground">
															{fmtTime(times.start, timeZone)}
														</span>
													) : null}
													<span className="truncate font-medium text-foreground">
														{event.title || '(untitled)'}
													</span>
												</>
											)
											const chipClass = cn(
												'event-color flex items-center gap-1.5 truncate rounded-sm px-1.5 py-0.5 text-left text-xs transition-transform',
												allDay ? 'event-chip' : 'hover:bg-muted',
												preview && !allDay && 'border border-dashed border-primary/70 opacity-70',
											)
											const chipProps = {
												style: eventColorProps(event, colors),
												'data-preview': preview && allDay ? '' : undefined,
											}
											if (mobileLayout)
												return (
													<div key={event.id} aria-hidden="true" className={chipClass} {...chipProps}>
														{content}
													</div>
												)
											return (
												<button
													key={event.id}
													type="button"
													onClick={(clickEvent) => {
														clickEvent.stopPropagation()
														if (!preview) onPickEvent(event)
													}}
													disabled={preview}
													className={cn('pointer-events-auto hover:scale-[1.01]', chipClass)}
													{...chipProps}
												>
													{content}
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
	colors,
	email,
	now,
	timeZone,
	secondaryTimezone,
	onPickEvent,
	onPickSlot,
	onRefresh,
}: {
	days: number
	start: Date
	events: Event[]
	colors: Map<string, EventColor>
	email: string
	now: Date
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
	const todayIso = ymd(calendarDateInTimeZone(now, timeZone))
	const todayIndex = columns.findIndex((day) => ymd(day) === todayIso)
	const nowOffset = (calendarWallClockHour(now, timeZone) - START_HOUR) * HOUR_PX
	const coveredByNowBadge = (labelCentre: number, labelHeight: number) =>
		todayIndex !== -1 && nowBadgeCoversLabel(nowOffset, labelCentre, labelHeight)
	const scrollRef = useRef<HTMLDivElement>(null)
	const [activeSlot, setActiveSlot] = useState({ day: 0, hour: START_HOUR })
	const [allDayExpanded, setAllDayExpanded] = useState(false)
	const mobileLayout = useMobileCalendarLayout()
	const allDaySegments = allDayEventSegments(events, columns)
	// The band shows three rows; the rest sit behind an expand control.
	const allDayOverflow = allDayBand(allDaySegments, false).hiddenCount
	const band = allDayBand(allDaySegments, allDayExpanded)
	const allDayRowCount = band.rowCount
	const hasAllDay = allDaySegments.length > 0
	const dayGridTemplateColumns = days === 1 ? '3.5rem minmax(0, 1fr)' : '3.5rem repeat(7, minmax(0, 1fr))'
	const mobileAgendaEvents = mobileLayout
		? events
				.filter(
					(event) =>
						!isNewEventPreview(event) &&
						columns.some((day) => eventsOnDay([event], day, timeZone).length > 0),
				)
				.sort(
					(first, second) =>
						(eventTimes(first)?.start.getTime() ?? 0) - (eventTimes(second)?.start.getTime() ?? 0),
				)
		: []

	const startIso = ymd(start)
	useEffect(() => {
		const first = new Date(`${startIso}T00:00:00`)
		const columnIsos = Array.from({ length: days }, (_, index) => ymd(addDays(first, index)))
		const current = new Date()
		const hour = initialTimeGridScrollHour(
			columnIsos,
			ymd(calendarDateInTimeZone(current, timeZone)),
			calendarWallClockHour(current, timeZone),
		)
		if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (hour - START_HOUR) * HOUR_PX - 12)
	}, [days, startIso, timeZone])

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
			{mobileAgendaEvents.length > 0 ? (
				<section
					aria-labelledby="mobile-calendar-agenda-heading"
					className="shrink-0 border-b border-border bg-card"
				>
					<h2
						id="mobile-calendar-agenda-heading"
						className="px-3 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
					>
						{days === 1 ? 'Events this day' : 'Events this week'}
					</h2>
					<div className="max-h-48 overflow-y-auto px-2 py-1">
						{mobileAgendaEvents.map((event) => {
							const times = eventTimes(event)
							if (!times) return null
							const rsvp = eventRsvp(event, email)
							const rsvpLabel = eventRsvpLabel(rsvp)
							const ended = isPastEvent(event, now, timeZone)
							const day = columns.find((column) => eventsOnDay([event], column, timeZone).length > 0)
							return (
								<button
									key={event.id}
									type="button"
									onClick={() => onPickEvent(event)}
									className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-muted"
								>
									<span
										className={cn('h-2.5 w-2.5 shrink-0 rounded-full', EVENT_SWATCH_CLASS)}
										style={eventColorProps(event, colors)}
									/>
									<span className="min-w-0 flex-1">
										<span
											className={cn(
												'block truncate text-sm font-medium',
												rsvp === 'declined' && 'line-through',
											)}
										>
											{event.title || '(untitled)'}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											{day?.toLocaleDateString(undefined, {
												weekday: 'short',
												month: 'short',
												day: 'numeric',
											})}
											{' · '}
											{times.allDay ? 'All day' : fmtTime(times.start, timeZone)}
											{rsvpLabel ? ` · ${rsvpLabel}` : null}
											{ended ? ` · ${EVENT_ENDED_LABEL}` : null}
										</span>
									</span>
								</button>
							)
						})}
					</div>
				</section>
			) : null}
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
								{timeZoneShortName(timeZone, now)}
							</span>
							{secondaryTimezone ? (
								<span
									title={timezoneCity(secondaryTimezone)}
									className="truncate text-[9px] text-muted-foreground"
								>
									{timeZoneShortName(secondaryTimezone, now)}
								</span>
							) : null}
						</section>
						{columns.map((day, dayIndex) => {
							const isToday = dayIndex === todayIndex
							return (
								<div
									key={day.toISOString()}
									className={cn(
										'flex items-baseline justify-center gap-control py-hairline text-[0.8125rem]',
										isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
									)}
									style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
									aria-current={isToday ? 'date' : undefined}
								>
									<span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
									<span
										className={cn(
											'tabular-nums',
											isToday && 'rounded-[5px] bg-today px-control text-today-foreground',
										)}
									>
										{day.getDate()}
									</span>
								</div>
							)
						})}
					</div>
					{hasAllDay ? (
						<div
							className="grid gap-y-control border-b border-border py-hairline pr-3"
							data-testid="calendar-all-day-band"
							style={{
								gridTemplateColumns: dayGridTemplateColumns,
								gridTemplateRows: `repeat(${allDayRowCount}, minmax(1.5rem, auto))`,
							}}
						>
							<div
								className="flex items-center justify-end self-stretch pr-2 text-[10px] text-muted-foreground uppercase"
								style={{ gridColumn: 1, gridRow: `1 / span ${allDayRowCount}` }}
							>
								All day
							</div>
							{band.segments.map((segment) => {
								const { event } = segment
								const preview = isNewEventPreview(event)
								const rsvp = eventRsvp(event, email)
								const ended = isPastEvent(event, now, timeZone)
								const title = event.title || '(untitled)'
								const chipProps = {
									style: {
										...eventColorProps(event, colors),
										gridColumn: `${segment.startColumn + 1} / span ${segment.span}`,
										gridRow: segment.row + 1,
									},
									className:
										'event-color event-chip z-10 mx-control min-w-0 self-center truncate rounded-[5px] px-cluster py-control text-left text-xs font-medium',
									'data-rsvp': rsvp,
									'data-past': ended ? '' : undefined,
									'data-preview': preview ? '' : undefined,
									'data-continues-before': segment.continuesBefore ? '' : undefined,
									'data-continues-after': segment.continuesAfter ? '' : undefined,
								}
								if (mobileLayout)
									return (
										<div key={event.id} aria-hidden="true" {...chipProps}>
											{title}
										</div>
									)
								return (
									<button
										key={event.id}
										type="button"
										onClick={() => {
											if (!preview) onPickEvent(event)
										}}
										disabled={preview}
										aria-label={eventAccessibleName(title, 'All day', {
											rsvp,
											ended,
											continuesBefore: segment.continuesBefore,
											continuesAfter: segment.continuesAfter,
										})}
										{...chipProps}
									>
										{title}
									</button>
								)
							})}
							{allDayOverflow === 0 ? null : mobileLayout ? (
								<div
									aria-hidden="true"
									className="px-cluster text-xs text-muted-foreground"
									style={{ gridColumn: '2 / -1', gridRow: allDayRowCount + 1 }}
								>
									{allDayOverflow} more
								</div>
							) : (
								<button
									type="button"
									aria-expanded={allDayExpanded}
									onClick={() => setAllDayExpanded((expanded) => !expanded)}
									className="touch-target mx-control justify-self-start rounded-[5px] px-cluster py-control text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
									style={{ gridColumn: '2 / -1', gridRow: allDayRowCount + 1 }}
								>
									{allDayExpanded ? 'Show fewer' : `${allDayOverflow} more`}
								</button>
							)}
						</div>
					) : null}
				</div>
				<div
					className={cn('relative', days > 1 && 'max-sm:min-w-[54rem]')}
					data-testid="calendar-time-grid-body"
				>
					<ContinuousDayColumnRules days={days} gridTemplateColumns={dayGridTemplateColumns} />
					{todayIndex === -1 ? null : (
						<div
							aria-hidden="true"
							data-testid="calendar-now-line"
							className="pointer-events-none absolute right-3 left-0 z-20 grid -translate-y-1/2 items-center"
							style={{ top: nowOffset, gridTemplateColumns: dayGridTemplateColumns }}
						>
							<span
								data-testid="calendar-now-badge"
								className="mr-1 flex h-4 items-center justify-self-end rounded-sm bg-today px-1 text-[10px] leading-none font-semibold whitespace-nowrap text-today-foreground tabular-nums"
								style={{ gridColumn: 1, gridRow: 1 }}
							>
								{fmtTime(now, timeZone)}
							</span>
							<span className="h-px bg-today/45" style={{ gridColumn: '2 / -1', gridRow: 1 }} />
							<span
								data-testid="calendar-now-line-today"
								className="h-0.5 bg-today"
								style={{ gridColumn: todayIndex + 2, gridRow: 1 }}
							/>
						</div>
					)}
					<div className="grid pr-3" style={{ gridTemplateColumns: dayGridTemplateColumns }}>
						<div style={{ gridColumn: 1, gridRow: 1 }}>
							{HOURS.map((hour) => (
								<div key={hour} className="relative h-[52px]">
									<span
										data-hour-label={hour}
										className={cn(
											'absolute -top-2 right-2 h-4 text-[11px] leading-4 tabular-nums text-muted-foreground',
											// The now badge takes this label's place; hiding keeps the layout still.
											coveredByNowBadge((hour - START_HOUR) * HOUR_PX, 16) && 'invisible',
										)}
									>
										{hour === START_HOUR ? '' : fmtHour(hour)}
									</span>
									{secondaryTimezone && hour !== START_HOUR ? (
										<span
											data-hour-label={`${hour}-secondary`}
											className={cn(
												'absolute top-2 right-2 h-3 text-[9px] leading-3 tabular-nums text-muted-foreground/70',
												coveredByNowBadge((hour - START_HOUR) * HOUR_PX + 14, 12) && 'invisible',
											)}
										>
											{fmtTime(calendarSlotTime(columns[0] ?? start, hour, timeZone), secondaryTimezone)}
										</span>
									) : null}
								</div>
							))}
						</div>
						{columns.map((day, dayIndex) => {
							const boxes = timedDayLayout(events, day, {
								startHour: START_HOUR,
								endHour: GRID_END_HOUR,
								hourHeight: HOUR_PX,
								timeZone,
							})
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
									{boxes.map(({ event, top, height, left, width }) => {
										const times = eventTimes(event)
										/* v8 ignore next -- timedDayLayout only places events with parsed times -- @preserve */
										if (!times) return null
										const preview = isNewEventPreview(event)
										const rsvp = eventRsvp(event, email)
										const title = event.title || '(untitled)'
										const range = `${fmtTime(times.start, timeZone)} – ${fmtTime(times.end, timeZone)}`
										const ended = isPastEvent(event, now, timeZone)
										// Concurrent events share the column side by side, each with a small gutter.
										const chipProps = {
											style: {
												...eventColorProps(event, colors),
												top,
												height,
												left: `calc(${left * 100}% + 2px)`,
												width: `calc(${width * 100}% - 4px)`,
											},
											'data-rsvp': rsvp,
											'data-past': ended ? '' : undefined,
											'data-preview': preview ? '' : undefined,
										}
										// A short chip is one centred line (title, then start time) so no glyph
										// is clipped; a taller one stacks the title over the time range.
										const twoLines = timedChipLines(height) === 2
										const className = cn(
											'event-color event-chip absolute z-10 flex min-w-0 overflow-hidden rounded-[5px] px-cluster text-left transition-shadow',
											twoLines ? 'flex-col py-control' : 'items-center gap-control py-0',
										)
										const content = twoLines ? (
											<>
												<span className="truncate text-xs leading-[15px] font-medium">{title}</span>
												<span className="truncate text-[11px] leading-[14px] opacity-75">{range}</span>
											</>
										) : (
											<>
												<span
													data-chip-title=""
													className="max-w-full shrink-0 truncate text-xs leading-4 font-medium"
												>
													{title}
												</span>
												<span className="min-w-0 truncate text-[11px] leading-4 opacity-75">
													{fmtTime(times.start, timeZone)}
												</span>
											</>
										)
										if (mobileLayout)
											return (
												<div key={event.id} aria-hidden="true" className={className} {...chipProps}>
													{content}
												</div>
											)
										return (
											<button
												key={event.id}
												type="button"
												onClick={() => {
													if (!preview) onPickEvent(event)
												}}
												disabled={preview}
												aria-label={eventAccessibleName(title, range, { rsvp, ended })}
												className={cn('hover:shadow-md', className)}
												{...chipProps}
											>
												{content}
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
