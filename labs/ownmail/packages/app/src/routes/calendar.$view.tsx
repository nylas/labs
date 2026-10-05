import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AppRailLogo, AppRailNav } from '#app/components/AppRail'
import { MobileTabBar } from '#app/components/MobileTabBar'
import {
	CALENDAR_HEADER_COLLAPSED_GRID_CLASS,
	CALENDAR_HEADER_GRID_CLASS,
	CALENDAR_SIDEBAR_WIDTH_CLASS,
	CHROME_ROW_CLASS,
	CHROME_ROW_SHELL_CLASS,
} from '#app/config/layout'
import { useLocalPreferencesReady, useUserPreferences } from '#app/preferences/user-preferences'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { type CalView, isCalendarDate, isCalView } from '#features/calendar/lib/calendar'
import {
	calendarRouteRange,
	loadCalendarRouteData,
	useCalendarRouteData,
	useHiddenCalendarIdsForRequest,
	usePrefetchAdjacentCalendarRanges,
} from '#features/calendar/state/calendar-state'
import { UNDER_MOBILE_BAR_CLASS } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'
import { CREATE_CELL_CLASS, calendarTitle, DETAIL_PANE_WIDTH_CLASS } from './-calendar-view-chrome'
import { CalendarRouteScreen } from './-calendar-view-screen'

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
	pendingComponent: CalendarPending,
})

export { loadCalendarRouteData }

/** Shown while another date range or view loads: the destination's title in
 * the same chrome, over an empty grid. The previous range's events and title
 * are never kept, and the header cells keep their loaded sizes so the title
 * does not move when the grid arrives. */
function CalendarPending() {
	const { date, view } = { ...Route.useSearch(), ...Route.useParams() }
	const info = useQueryClient().getQueryData(mailboxInfoQueryOptions().queryKey)
	// The sidebar column follows the same device preference as the loaded view,
	// so the title and grid do not move sideways when the content arrives.
	const [{ calendarSidebarCollapsed: sidebarCollapsed, calendarDetailPaneOpen: detailPaneOpen }] =
		useUserPreferences()
	return (
		<div
			data-testid="calendar-pending"
			aria-busy="true"
			className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground"
		>
			<div className={cn(CHROME_ROW_SHELL_CLASS, 'calendar-chrome-row')}>
				{info ? <AppRailLogo appName={info.appName} className="hidden md:flex" /> : null}
				<header
					className={cn(
						'flex min-w-0 flex-1 items-stretch border-b border-border bg-background',
						CHROME_ROW_CLASS,
						'h-[5.5rem] sm:h-11',
					)}
				>
					<div className="h-11 w-11 shrink-0 border-r border-border lg:hidden" aria-hidden="true" />
					<div
						data-testid="calendar-pending-header"
						className={cn(
							'min-w-0 flex-1',
							sidebarCollapsed ? CALENDAR_HEADER_COLLAPSED_GRID_CLASS : CALENDAR_HEADER_GRID_CLASS,
						)}
					>
						{sidebarCollapsed ? null : (
							<div className="hidden border-r border-border lg:block" aria-hidden="true" />
						)}
						<div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_2.75rem] grid-rows-[2.75rem_2.75rem] items-stretch sm:flex">
							<div
								data-testid="calendar-pending-create-cell"
								className={cn(CREATE_CELL_CLASS, !sidebarCollapsed && 'lg:hidden')}
								aria-hidden="true"
							>
								{sidebarCollapsed ? <span className="hidden size-11 shrink-0 lg:block" /> : null}
								<span className="size-9 shrink-0" />
							</div>
							<div className="col-start-2 row-start-1 flex min-w-0 items-center border-r border-border px-3 sm:flex-1">
								<h1 className="truncate font-display text-base font-bold tracking-[-0.02em] sm:text-xl">
									{calendarTitle(calendarRouteRange(view, date).anchor)}
								</h1>
							</div>
						</div>
					</div>
				</header>
			</div>
			<div className={cn('flex min-h-0 flex-1 overflow-hidden', UNDER_MOBILE_BAR_CLASS)}>
				{info ? (
					<AppRailNav
						email={info.email}
						displayName={info.displayName}
						accounts={info.accounts}
						active="calendar"
					/>
				) : null}
				<div
					data-testid="calendar-pending-sidebar"
					className={cn(
						'hidden shrink-0 border-r border-border bg-background',
						!sidebarCollapsed && 'lg:block',
						CALENDAR_SIDEBAR_WIDTH_CLASS,
					)}
					aria-hidden="true"
				/>
				<div
					className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-background p-4"
					aria-hidden="true"
				>
					<div className="h-4 w-1/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
					<div className="min-h-0 flex-1 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
				</div>
				{detailPaneOpen ? (
					<div
						data-testid="calendar-pending-detail-pane"
						className={cn(
							'hidden shrink-0 border-l border-border bg-background lg:block',
							DETAIL_PANE_WIDTH_CLASS,
						)}
						aria-hidden="true"
					/>
				) : null}
			</div>
			<MobileTabBar active="calendar" />
		</div>
	)
}

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

	// The grid is drawn in the saved timezone and without the calendars hidden
	// on this device. Until those can be read, the grid stays empty rather than
	// showing events at times, or from calendars, that change after hydration.
	if (!useLocalPreferencesReady()) return <CalendarPending />

	return (
		<CalendarRouteScreen
			view={view}
			data={calendarQuery.data}
			onRefresh={() => calendarQuery.refetch({ throwOnError: true }).then(() => undefined)}
		/>
	)
}
