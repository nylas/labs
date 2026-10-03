// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, render as testingRender, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ymd } from '#features/calendar/lib/calendar'
import { PRIMARY_ACTION_ICON_CLASS } from '#shared/components/ui/primary-action'

function render(ui: ReactElement) {
	return testingRender(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			{ui}
		</QueryClientProvider>,
	)
}

// Router + server + child-component seams are stubbed so we can drive the loader helper
// and the exported CalendarRouteScreen in isolation, with no live router or network.
const h = vi.hoisted(() => ({
	navigate: vi.fn(),
	invalidate: vi.fn(),
	getEvents: vi.fn(),
	getMailboxInfo: vi.fn(),
	updateEvent: vi.fn(),
	getFreeBusy: vi.fn(),
	rsvpEvent: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	Link: ({ children, to, ...props }: any) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => h.navigate,
	useRouter: () => ({ invalidate: h.invalidate }),
}))

vi.mock('#features/calendar/server/calendar-fns', () => ({
	getEvents: (args: any) => h.getEvents(args),
	updateEvent: (args: any) => h.updateEvent(args),
	getFreeBusy: (args: any) => h.getFreeBusy(args),
	rsvpEvent: (args: any) => h.rsvpEvent(args),
}))
vi.mock('#server/fns', () => ({ getMailboxInfo: () => h.getMailboxInfo() }))

// The chrome/dialog children own their own render tests; stub them to observable markers
// so this suite stays focused on the calendar grid + navigation logic.
vi.mock('#app/components/AppRail', () => ({
	AppRailLogo: (props: any) => <div data-testid="app-rail-logo">{props.appName}</div>,
	AppRailNav: (props: any) => (
		<div data-testid="app-rail-nav" data-active={props.active}>
			<button type="button" onClick={props.onOpenCommandPalette}>
				open-palette
			</button>
		</div>
	),
	AppRailMobileNav: (props: any) => (
		<div data-testid="app-rail-mobile-nav">
			<button type="button" onClick={props.onNavigate}>
				close-mobile-navigation
			</button>
		</div>
	),
}))

vi.mock('#app/components/MobileTabBar', () => ({
	MobileTabBar: ({ active }: { active: string }) => <nav data-testid="mobile-tabs" data-active={active} />,
}))

vi.mock('#app/components/CommandPalette', () => ({
	CommandPalette: (props: any) =>
		props.open ? (
			<div data-testid="command-palette">
				<button type="button" onClick={props.onClose}>
					close-palette
				</button>
			</div>
		) : null,
	useCommandPaletteShortcut: () => {},
}))

vi.mock('#shared/components/Sheet', () => ({
	Sheet: (props: any) =>
		props.open ? (
			<div data-testid="sheet">
				<button type="button" onClick={props.onClose}>
					close-sheet
				</button>
				{props.children}
			</div>
		) : null,
}))

vi.mock('#features/calendar/components/EventModal', () => ({
	EventModal: (props: any) => (
		<div
			role="dialog"
			data-testid="event-modal"
			data-event={props.event ? props.event.id : 'new'}
			data-calendar-id={props.calendarId}
			data-calendar-name={props.calendarName}
			data-default-start={props.defaultStart?.toISOString?.()}
			data-preserve-default-start-time={String(props.preserveDefaultStartTime)}
			data-default-duration-minutes={String(props.defaultDurationMinutes)}
			data-start-in-edit={String(props.startInEdit)}
			data-start-on-delete={String(props.startOnDeleteConfirmation)}
		>
			<button
				type="button"
				onClick={() =>
					props.onDraftChange?.({
						id: '__new-event-preview__',
						calendar_id: 'cal1',
						title: 'Live draft',
						when: {
							start_time: Math.floor(new Date('2024-06-15T09:30:00').getTime() / 1000),
							end_time: Math.floor(new Date('2024-06-15T10:30:00').getTime() / 1000),
						},
					})
				}
			>
				show-live-preview
			</button>
			<button type="button" onClick={() => props.onClose(true)}>
				close-changed
			</button>
			<button type="button" onClick={() => props.onClose(false)}>
				close-unchanged
			</button>
		</div>
	),
}))

// The read-only view owns its render tests; here it is a marker that exposes what the
// pane was given and lets a test drive its callbacks.
vi.mock('#features/calendar/components/EventDetails', async () => {
	const { useImperativeHandle } = await import('react')
	return {
		EventDetails: (props: any) => {
			useImperativeHandle(props.ref, () => ({ requestClose: props.onClose }))
			return (
				<div
					data-testid="event-details"
					data-event={props.event.id}
					data-variant={props.variant}
					data-calendar-id={props.calendarId}
					data-calendar-name={props.calendarName}
					data-email={props.email}
					data-start-on-delete={String(props.startOnDeleteConfirmation)}
				>
					<button type="button" onClick={props.onEdit}>
						details-edit
					</button>
					<button type="button" onClick={props.onClose}>
						details-close
					</button>
					<button type="button" onClick={props.onDeleted}>
						details-deleted
					</button>
				</div>
			)
		},
	}
})

// The people search owns its render tests; here it shows what the route gave it and
// lets a test choose people and ask for a retry.
vi.mock('#features/calendar/components/MeetWith', () => ({
	MeetWith: (props: any) => (
		<div
			data-testid="meet-with"
			data-people={props.people.map((person: any) => person.email).join(',')}
			data-results={JSON.stringify(props.results)}
			data-loading={String(props.loading)}
			data-error={props.error ?? ''}
			data-shown-on-grid={String(props.shownOnGrid)}
		>
			<button
				type="button"
				onClick={() => props.onChange([...props.people, { email: 'mina@example.com', name: 'Mina Park' }])}
			>
				meet-add-mina
			</button>
			<button type="button" onClick={() => props.onChange([])}>
				meet-clear
			</button>
			<button type="button" onClick={props.onRetry}>
				meet-retry
			</button>
		</div>
	),
}))

vi.mock('#features/calendar/components/CalendarManagerDialog', () => ({
	CalendarManagerDialog: (props: any) => (
		<div
			role="dialog"
			aria-label="Calendar manager"
			data-initial-action={JSON.stringify(props.initialAction ?? null)}
		>
			<button type="button" onClick={() => props.onDeleted('cal2')}>
				delete-cal2
			</button>
			<button type="button" onClick={props.onClose}>
				close-calendar-manager
			</button>
		</div>
	),
}))

import { CalendarRouteScreen } from './-calendar-view-screen.js'
import { loadCalendarRouteData, Route } from './calendar.$view.js'

// ---- fixtures -------------------------------------------------------------

/** The New event action at the top of the desktop sidebar, the module's create action. */
function sidebarNewEvent() {
	return within(document.getElementById('calendar-sidebar') as HTMLElement).getByRole('button', {
		name: 'New event',
	})
}

const e = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

const info = { appName: 'OwnMail', email: 'user@ownmail.local', displayName: 'Test User' }
const calendars: Calendar[] = [
	{ id: 'cal1', name: 'Work', hex_color: '#3b82f6', is_primary: true },
	{ id: 'cal2', name: '' },
]
// Primary calendar deliberately carries a different display name than the cal1 entry in the
// list, so a name sourced from the calendar map ('Work') is distinguishable from the primary
// fallback ('Primary Cal').
const primaryCalendar: Calendar = { id: 'cal1', name: 'Primary Cal' }

const richEvents = (): Event[] => [
	{
		id: 't1',
		calendar_id: 'cal1',
		title: 'Standup',
		when: { start_time: e('2024-06-15T09:00:00'), end_time: e('2024-06-15T10:00:00') },
	},
	{
		id: 't2',
		calendar_id: 'cal2',
		title: '',
		when: { start_time: e('2024-06-15T11:00:00'), end_time: e('2024-06-15T11:05:00') },
	},
	{
		id: 't3',
		calendar_id: 'cal1',
		title: 'Night',
		when: { start_time: e('2024-06-15T02:00:00'), end_time: e('2024-06-15T03:00:00') },
	},
	{
		id: 't4',
		calendar_id: 'cal-unknown',
		title: 'Sync',
		when: { start_time: e('2024-06-15T13:00:00'), end_time: e('2024-06-15T14:00:00') },
	},
	{
		id: 't5',
		calendar_id: '',
		title: 'Solo',
		when: { start_time: e('2024-06-15T15:00:00'), end_time: e('2024-06-15T15:30:00') },
	},
	{ id: 'a1', calendar_id: 'cal1', title: 'Holiday', when: { date: '2024-06-15' } },
	{
		id: 'a2',
		calendar_id: 'cal2',
		title: 'Trip',
		when: { start_date: '2024-06-14', end_date: '2024-06-17' },
	},
]

const richData = (anchorIso = '2024-06-15') => ({
	events: richEvents(),
	calendar: primaryCalendar,
	calendars,
	info,
	anchorIso,
	truncated: false,
	hiddenCalendarIds: [] as string[],
})

const timedOnlyData = () => ({
	events: [
		{
			id: 'to1',
			calendar_id: 'cal1',
			title: 'Focus',
			when: { start_time: e('2024-06-16T09:00:00'), end_time: e('2024-06-16T10:00:00') },
		},
	] as Event[],
	calendar: primaryCalendar,
	calendars,
	info,
	anchorIso: '2024-06-16',
	truncated: false,
	hiddenCalendarIds: [] as string[],
})

const monthData = () => ({
	events: [
		{ id: 'm1', calendar_id: 'cal1', title: 'Holiday', when: { date: '2024-06-20' } },
		{
			id: 'm2',
			calendar_id: 'cal1',
			title: 'Meeting',
			when: { start_time: e('2024-06-20T15:00:00'), end_time: e('2024-06-20T16:00:00') },
		},
		{
			id: 'm3',
			calendar_id: 'cal2',
			title: '',
			when: { start_time: e('2024-06-20T16:00:00'), end_time: e('2024-06-20T17:00:00') },
		},
		{
			id: 'm4',
			calendar_id: 'cal1',
			title: 'Extra',
			when: { start_time: e('2024-06-20T17:00:00'), end_time: e('2024-06-20T18:00:00') },
		},
	] as Event[],
	calendar: primaryCalendar,
	calendars,
	info,
	anchorIso: '2024-06-20',
	truncated: false,
	hiddenCalendarIds: [] as string[],
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	localStorage.clear()
})
beforeEach(() => {
	vi.clearAllMocks()
	h.getEvents.mockResolvedValue({ calendar: primaryCalendar, calendars, events: [], truncated: false })
	h.getMailboxInfo.mockResolvedValue(info)
})

// ---- route config + loader ------------------------------------------------

describe('/calendar/$view route config', () => {
	it('parses a known view param so the loader receives a typed CalView', () => {
		expect(Route.options.params.parse({ view: 'week' })).toEqual({ view: 'week' })
	})

	it('rejects an unknown view param rather than rendering an undefined grid', () => {
		expect(() => Route.options.params.parse({ view: 'sideways' })).toThrow('Unknown view: sideways')
	})

	it('keeps a well-formed ISO date so deep links to a specific day survive validation', () => {
		expect(Route.options.validateSearch({ date: '2024-06-15' })).toEqual({ date: '2024-06-15' })
	})

	it('drops a malformed date string instead of trusting arbitrary search input', () => {
		expect(Route.options.validateSearch({ date: '15/06/2024' })).toEqual({})
	})

	it('drops an impossible ISO-shaped date before it reaches the calendar loader', () => {
		expect(Route.options.validateSearch({ date: '2024-02-30' })).toEqual({})
	})

	it('drops a non-string date value', () => {
		expect(Route.options.validateSearch({ date: 20240615 })).toEqual({})
	})

	it('threads the validated date into loader deps for cache-correct refetches', () => {
		expect(Route.options.loaderDeps({ search: { date: '2024-06-15' } })).toEqual({ date: '2024-06-15' })
	})

	it('loads the requested view + date via the shared loader helper', async () => {
		h.getEvents.mockResolvedValue({
			calendar: primaryCalendar,
			calendars,
			events: richEvents(),
			truncated: false,
		})
		const result = await Route.options.loader({
			context: { queryClient: new QueryClient() },
			params: { view: 'week' },
			deps: { date: '2024-06-15' },
		})
		expect(h.getMailboxInfo).toHaveBeenCalledOnce()
		expect(h.getEvents).toHaveBeenCalledOnce()
		expect(result.info).toEqual(info)
		expect(result.anchorIso).toBe('2024-06-15')
		expect(result.events).toHaveLength(7)
	})
})

describe('loadCalendarRouteData', () => {
	it('anchors on the requested date and buffers the fetched range for display timezone boundaries', async () => {
		const data = await loadCalendarRouteData(new QueryClient(), 'week', '2024-06-15')
		expect(data.anchorIso).toBe('2024-06-15')
		const arg = h.getEvents.mock.calls[0][0]
		expect(arg.data).toEqual({
			start: Math.floor(new Date('2024-06-08T00:00:00').getTime() / 1000),
			end: Math.floor(new Date('2024-06-17T00:00:00').getTime() / 1000),
		})
	})

	it('falls back to today when no date is supplied', async () => {
		const data = await loadCalendarRouteData(new QueryClient(), 'month')
		expect(data.anchorIso).toBe(ymd(new Date()))
		expect(h.getEvents).toHaveBeenCalledOnce()
	})

	it('serves a revisited week from the cache so navigating back does not wait on the provider', async () => {
		const queryClient = new QueryClient()
		h.getEvents.mockResolvedValue({
			calendar: primaryCalendar,
			calendars,
			events: richEvents(),
			truncated: false,
		})
		await loadCalendarRouteData(queryClient, 'week', '2024-06-15')
		await loadCalendarRouteData(queryClient, 'week', '2024-06-22')
		const revisited = await loadCalendarRouteData(queryClient, 'week', '2024-06-12')
		expect(h.getEvents).toHaveBeenCalledTimes(2)
		expect(h.getMailboxInfo).toHaveBeenCalledOnce()
		// A different day in a cached week still re-anchors the view.
		expect(revisited.anchorIso).toBe('2024-06-12')
		expect(revisited.events).toHaveLength(7)
	})
})

describe('calendar pending view', () => {
	it('reserves the sidebar column exactly as the loaded view will, so nothing shifts when content arrives', () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		const Pending = Route.options.pendingComponent
		const first = render(<Pending />)
		expect(screen.getByTestId('calendar-pending-header')).toHaveClass('lg:grid-cols-[16rem_minmax(0,1fr)]')
		expect(screen.getByTestId('calendar-pending-sidebar')).toHaveClass('lg:block')
		// New event lives in the sidebar on desktop, so the top bar's create cell is a mobile-only placeholder.
		expect(screen.getByTestId('calendar-pending-create-cell')).toHaveClass('lg:hidden')
		first.unmount()

		// With the sidebar collapsed on this device, the pending view is collapsed too: no
		// sidebar column at all, and the create cell keeps room for the toggle and the icon action.
		localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ calendarSidebarCollapsed: true }))
		render(<Pending />)
		const header = screen.getByTestId('calendar-pending-header')
		expect(header.className).not.toMatch(/lg:grid-cols-/)
		expect(header.children).toHaveLength(1)
		expect(screen.getByTestId('calendar-pending-create-cell')).not.toHaveClass('lg:hidden')
		expect(screen.getByTestId('calendar-pending-create-cell').children).toHaveLength(2)
		expect(screen.getByTestId('calendar-pending-sidebar')).not.toHaveClass('lg:block')
	})

	it('reserves the details pane while loading when this device keeps it open, at the loaded width', () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		const Pending = Route.options.pendingComponent
		const first = render(<Pending />)
		expect(screen.queryByTestId('calendar-pending-detail-pane')).toBeNull()
		first.unmount()

		localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ calendarDetailPaneOpen: true }))
		const pending = render(<Pending />)
		const reserved = screen.getByTestId('calendar-pending-detail-pane')
		expect(reserved).toHaveClass('w-72', 'xl:w-80', 'lg:block')
		pending.unmount()
		render(<CalendarRouteScreen view="week" data={richData()} />)
		expect(screen.getByRole('complementary', { name: 'Event details' })).toHaveClass('w-72', 'xl:w-80')
	})
})

describe('CalendarViewRoutePage wrapper', () => {
	it('prefetches the previous and next weeks so Previous/Next open without a fetch wait', async () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		Route.useLoaderData = vi.fn(() => richData())
		const Page = Route.options.component
		render(<Page />)
		const range = (from: string, to: string) => ({
			data: {
				start: Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000),
				end: Math.floor(new Date(`${to}T00:00:00`).getTime() / 1000),
			},
		})
		await vi.waitFor(() => {
			expect(h.getEvents).toHaveBeenCalledWith(range('2024-06-01', '2024-06-10'))
			expect(h.getEvents).toHaveBeenCalledWith(range('2024-06-15', '2024-06-24'))
		})
	})

	it('feeds the params view + loader data straight into the screen', () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2026-06-15' }))
		Route.useLoaderData = vi.fn(() => richData())
		const Page = Route.options.component
		render(<Page />)
		expect(screen.getByTestId('app-rail-logo').textContent).toBe('OwnMail')
		expect(screen.getByTestId('mobile-tabs')).toHaveAttribute('data-active', 'calendar')
		expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('week')
	})

	it('stops requesting calendars the user has hidden, in the visible and the adjacent weeks', async () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ hiddenCalendarsByAccount: { [info.email]: ['cal2', 'cal1', 'cal2'] } }),
		)
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		// The loader ran before the preference was known (as on the server), so its
		// data is only a stand-in and the hidden-aware request must still be made.
		Route.useLoaderData = vi.fn(() => richData())
		const Page = Route.options.component
		render(<Page />)
		await vi.waitFor(() => expect(h.getEvents).toHaveBeenCalledTimes(3))
		for (const [args] of h.getEvents.mock.calls) {
			expect(args.data.hiddenCalendarIds).toEqual(['cal1', 'cal2'])
		}
	})

	it('loads a calendar events when it is shown again, since they were not fetched while it was hidden', async () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		Route.useLoaderData = vi.fn(() => richData())
		const Page = Route.options.component
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const settled = () => vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
		testingRender(
			<QueryClientProvider client={queryClient}>
				<Page />
			</QueryClientProvider>,
		)
		await vi.waitFor(() => expect(h.getEvents).toHaveBeenCalledTimes(3))
		await settled()

		h.getEvents.mockClear()
		fireEvent.click(screen.getByRole('button', { name: /^Work/ }))
		await vi.waitFor(() => expect(h.getEvents).toHaveBeenCalledTimes(3))
		for (const [args] of h.getEvents.mock.calls) expect(args.data.hiddenCalendarIds).toEqual(['cal1'])
		await settled()

		h.getEvents.mockClear()
		fireEvent.click(screen.getByRole('button', { name: /^Work/ }))
		await vi.waitFor(() => expect(h.getEvents).toHaveBeenCalled())
		for (const [args] of h.getEvents.mock.calls) expect(args.data.hiddenCalendarIds).toBeUndefined()
	})

	it('passes the stored hidden calendars from the loader and reports what it loaded with', async () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ hiddenCalendarsByAccount: { [info.email]: ['cal2'] } }),
		)
		h.getEvents.mockResolvedValue({ calendar: primaryCalendar, calendars, events: [], truncated: true })
		const data = await loadCalendarRouteData(new QueryClient(), 'week', '2024-06-15')
		expect(h.getEvents.mock.calls[0][0].data.hiddenCalendarIds).toEqual(['cal2'])
		expect(data.hiddenCalendarIds).toEqual(['cal2'])
		// The ceiling flag survives the loader so the grid can show its notice.
		expect(data.truncated).toBe(true)
	})

	it('connects refresh interactions to the live calendar query', async () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		Route.useLoaderData = vi.fn(() => richData())
		const Page = Route.options.component
		render(<Page />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		await vi.waitFor(() => expect(h.getEvents).toHaveBeenCalledTimes(3))
		const sheetRefresh = within(screen.getByTestId('sheet')).getByRole('button', { name: 'Refresh calendar' })
		// One separator above the section with 12px clearance, and no second line stacked beneath it.
		const refreshRow = within(screen.getByTestId('sheet')).getByText('Refresh calendar').parentElement
		expect(refreshRow?.className).not.toMatch(/\bborder-/)
		// The section's one separator sits above the New event action, which is the first thing
		// in it; the refresh row follows in the same inset column with no line of its own.
		const section = refreshRow?.closest('.border-t') as HTMLElement
		expect(section.querySelector('button')).toHaveAccessibleName('New event')
		expect(refreshRow?.parentElement).toHaveClass('px-hairline')
		fireEvent.click(sheetRefresh)
		await vi.waitFor(() => expect(h.getEvents).toHaveBeenCalledTimes(4))
	})

	it('announces a generic failure when the live calendar refresh rejects', async () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useSearch = vi.fn(() => ({ date: '2024-06-15' }))
		Route.useLoaderData = vi.fn(() => richData())
		h.getEvents.mockRejectedValue(new Error('provider-secret-detail'))
		const Page = Route.options.component
		render(<Page />)

		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getByRole('button', { name: 'Refresh calendar' }))
		expect(await screen.findByRole('status', { name: 'Refresh calendar status' })).toHaveTextContent(
			'Could not refresh. Check your connection, then try again.',
		)
		expect(screen.queryByText(/provider-secret-detail/)).toBeNull()
	})
})

// ---- week view (route navigation) -----------------------------------------

describe('week view + header navigation', () => {
	const renderWeek = (data = richData()) => render(<CalendarRouteScreen view="week" data={data} />)

	it('titles the week by its month and shows the active view in the dropdown', () => {
		renderWeek()
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('June 2024')
		expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('week')
		expect(screen.getByRole('region', { name: 'Calendar time grid' })).toHaveClass('max-sm:overflow-x-auto')
		expect(screen.getByTestId('calendar-time-grid-header')).toHaveClass('max-sm:min-w-[54rem]')
		expect(screen.getByTestId('calendar-time-grid-body')).toHaveClass('max-sm:min-w-[54rem]')
	})

	it('draws one line under the day header when there is no all-day band', () => {
		renderWeek({ ...richData(), events: [] })
		const header = screen.getByTestId('calendar-time-grid-header')
		expect(screen.queryByTestId('calendar-all-day-band')).toBeNull()
		// The glass bar draws the line on its content edge; the day row inside adds none.
		expect(header).toHaveClass('glass-bar')
		expect(header.firstElementChild?.className).not.toMatch(/border/)
	})

	it('keeps every calendar action available in the 320px mobile header', () => {
		renderWeek()

		const controls = screen.getByTestId('calendar-header-controls')
		expect(controls.closest('.app-chrome-row')).toHaveClass('calendar-chrome-row')
		expect(controls).toHaveClass('grid', 'min-w-0', 'sm:flex')
		expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
		// The sidebar is in its sheet on a phone, so the icon-only New event stays in the top bar,
		// with a full touch target, and is dropped from the top bar only where the sidebar shows.
		const createCell = screen.getByTestId('calendar-header-create-cell')
		expect(createCell).toHaveClass('lg:hidden')
		expect(within(createCell).getByRole('button', { name: 'New event' })).toHaveClass(
			...PRIMARY_ACTION_ICON_CLASS.split(' '),
		)
		expect(within(createCell).getByRole('button', { name: 'New event' })).toHaveAttribute(
			'aria-keyshortcuts',
			'N',
		)
		expect(screen.getByRole('button', { name: 'Today' })).toHaveClass('size-11', 'sm:w-auto', 'touch-target')
		expect(screen.getByRole('button', { name: 'Previous' })).toHaveClass('size-11', 'touch-target-square')
		expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('size-11', 'touch-target-square')
		// One dropdown serves every width: full-width on the second mobile row, compact on desktop.
		expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveClass(
			'h-11',
			'w-full',
			'sm:w-auto',
			'touch-target',
		)
		expect(screen.queryByRole('button', { name: 'week' })).toBeNull()
	})

	it('switches view from the allow-listed view dropdown', () => {
		renderWeek()
		const picker = screen.getByRole('combobox', { name: 'Calendar view' })
		fireEvent.change(picker, { target: { value: 'day' } })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-15' },
		})
		fireEvent.change(picker, { target: { value: 'week' } })
		expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { view: 'week' } }))
		fireEvent.change(picker, { target: { value: 'month' } })
		expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ params: { view: 'month' } }))
		const invalidOption = document.createElement('option')
		invalidOption.value = 'agenda'
		picker.append(invalidOption)
		h.navigate.mockClear()
		fireEvent.change(picker, { target: { value: 'agenda' } })
		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('jumps to today keeping the current view', async () => {
		const user = userEvent.setup()
		renderWeek()
		await user.click(screen.getByRole('button', { name: 'Today' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: ymd(new Date()) },
		})
	})

	it('steps to the previous and next week', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-06-08' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-06-22' },
		})
	})

	it('shows an empty agenda note when nothing is left today', () => {
		renderWeek()
		expect(screen.getByText('Nothing left today.')).toBeInTheDocument()
	})

	it('opens the command palette from the app rail and closes it again', async () => {
		const user = userEvent.setup()
		renderWeek()
		expect(screen.queryByTestId('command-palette')).toBeNull()
		await user.click(screen.getByRole('button', { name: 'open-palette' }))
		expect(screen.getByTestId('command-palette')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'close-palette' }))
		expect(screen.queryByTestId('command-palette')).toBeNull()
	})
})

describe('week view mini-calendar', () => {
	const renderWeek = () => render(<CalendarRouteScreen view="week" data={richData()} />)

	it('pages the mini calendar between months without navigating the grid', () => {
		renderWeek()
		const mini = within(screen.getByRole('grid', { name: 'Date picker' }).parentElement as HTMLElement)
		expect(mini.getByText('June 2024')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
		expect(mini.getByText('May 2024')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
		fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
		expect(mini.getByText('July 2024')).toBeInTheDocument()
		// The grid title still names the anchored month.
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('June 2024')
		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('marks the whole visible week in week view so the grid and the month stay in step', () => {
		renderWeek()
		const grid = screen.getByRole('grid', { name: 'Date picker' })
		const marked = [...grid.querySelectorAll('[data-current-week]')].map((cell) => cell.textContent)
		expect(marked).toEqual(['9', '10', '11', '12', '13', '14', '15'])
		// The band is continuous: only its two ends are rounded.
		expect(grid.querySelector('[data-mini-calendar-day="2024-06-09"]')).toHaveClass('rounded-l-md')
		expect(grid.querySelector('[data-mini-calendar-day="2024-06-15"]')).toHaveClass('rounded-r-md')
		expect(grid.querySelector('[data-mini-calendar-day="2024-06-12"]')).not.toHaveClass('rounded-sm')
	})

	it('marks only the chosen day outside week view', () => {
		render(<CalendarRouteScreen view="day" data={richData()} />)
		const grid = screen.getByRole('grid', { name: 'Date picker' })
		expect(grid.querySelectorAll('[data-current-week]')).toHaveLength(0)
		expect(grid.querySelector('[data-mini-calendar-day="2024-06-15"]')).toHaveClass('bg-accent')
	})

	it('picking a mini-calendar day keeps the week view and re-anchors it', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: '10' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-06-10' },
		})
	})
})

describe('mobile event access', () => {
	it('uses touch-sized agenda rows while calendar event chips become noninteractive visuals', () => {
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
		)
		render(<CalendarRouteScreen view="day" data={richData()} />)
		expect(screen.getByRole('heading', { name: 'Events this day' })).toBeInTheDocument()
		const standup = screen.getByRole('button', { name: /Standup/ })
		expect(standup).toHaveClass('min-h-12')
		// The agenda is the accessible list on mobile, so it states in words that a 2024 event is over.
		expect(standup).toHaveTextContent(/· Ended$/)
		const standupCopies = screen.getAllByText('Standup')
		expect(standupCopies).toHaveLength(2)
		expect(standupCopies.filter((node) => node.closest('button'))).toHaveLength(1)
	})
})

describe('week view calendar list', () => {
	it('toggles a calendar off and back on, hiding its events in between', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		const workToggle = screen.getByRole('button', { name: /^Work/ })
		expect(workToggle).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: /Standup/ })).toBeInTheDocument()
		fireEvent.click(workToggle)
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-pressed', 'false')
		expect(screen.queryByRole('button', { name: /Standup/ })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: /^Work/ }))
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: /Standup/ })).toBeInTheDocument()
	})

	it('groups calendars under the signed-in account and tags the default one', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		const group = within(screen.getByRole('region', { name: `Calendars for ${info.email}` }))
		expect(group.getByText(info.email)).toBeInTheDocument()
		expect(group.getByRole('button', { name: /^Work/ })).toHaveTextContent('Default')
		expect(group.getByRole('button', { name: /^Calendar/ })).not.toHaveTextContent('Default')
	})

	it('says a hidden calendar is hidden in words, not only by dimming its swatch', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		const toggle = screen.getByRole('button', { name: /^Work/ })
		expect(toggle).not.toHaveTextContent('hidden')
		fireEvent.click(toggle)
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveTextContent('hidden')
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveAccessibleName('Work, hidden')
	})

	it('draws the swatch in the calendar own colour and falls back to an event token without one', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		const own = screen.getByRole('button', { name: /^Work/ })
		expect(own.style.getPropertyValue('--event-c-light')).toMatch(/^oklch\(/)
		const fallback = screen.getByRole('button', { name: /^Calendar/ })
		expect(fallback.style.getPropertyValue('--event-c-light')).toBe('var(--event-teal)')
	})

	it('labels an unnamed calendar as "Calendar"', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		expect(screen.getByRole('button', { name: /^Calendar/ })).toBeInTheDocument()
	})

	it('opens calendar management and clears deleted calendars from hidden state', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: /^Calendar/ }))
		expect(screen.getByRole('button', { name: /^Calendar/ })).toHaveAttribute('aria-pressed', 'false')
		fireEvent.click(screen.getByRole('button', { name: 'Manage calendars' }))
		expect(screen.getByRole('dialog', { name: 'Calendar manager' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'delete-cal2' }))
		expect(screen.getByRole('button', { name: /^Calendar/ })).toHaveAttribute('aria-pressed', 'true')
		fireEvent.click(screen.getByRole('button', { name: 'close-calendar-manager' }))
		expect(screen.queryByRole('dialog', { name: 'Calendar manager' })).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getAllByRole('button', { name: 'Manage calendars' }).at(-1) as HTMLElement)
		expect(screen.getByRole('dialog', { name: 'Calendar manager' })).toBeInTheDocument()
	})
})

describe('week view time grid', () => {
	// The fixtures are dated June 2024. Pin the date before them so chips are named
	// as upcoming; only the clock is faked, so async queries keep working.
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(new Date('2024-06-09T08:00:00'))
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	const renderWeek = () => render(<CalendarRouteScreen view="week" data={richData()} />)

	it('renders an all-day band with single-day and multi-day segments', () => {
		renderWeek()
		expect(screen.getByText('All day')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Holiday, All day' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Trip, All day, Continues later' })).toBeInTheDocument()
	})

	it('marks an all-day event that runs past the visible week instead of ending it at the edge', () => {
		renderWeek()
		// Trip covers Jun 14-16; the week ends on Jun 15. The cut-off edge is also put into words.
		const trip = screen.getByRole('button', { name: 'Trip, All day, Continues later' })
		expect(trip).toHaveAttribute('data-continues-after')
		expect(trip).not.toHaveAttribute('data-continues-before')
		expect(screen.getByRole('button', { name: 'Holiday, All day' })).not.toHaveAttribute(
			'data-continues-after',
		)
	})

	it('caps the all-day band at three rows and expands on request so no event is silently dropped', () => {
		const allDay = ['One', 'Two', 'Three', 'Four', 'Five'].map((title) => ({
			id: title,
			calendar_id: 'cal1',
			title,
			when: { date: '2024-06-12' },
		})) as Event[]
		render(<CalendarRouteScreen view="week" data={{ ...richData(), events: allDay }} />)
		const band = within(screen.getByTestId('calendar-all-day-band'))
		expect(band.getAllByRole('button', { name: /, All day/ })).toHaveLength(3)
		// The day header and its all-day band are one pinned glass bar the grid scrolls beneath.
		// The recipe draws its one line on the content edge, so the rows inside draw none.
		const header = screen.getByTestId('calendar-time-grid-header')
		expect(header).toHaveClass('glass-bar', 'sticky', 'top-0')
		expect(header).not.toHaveClass('bg-background')
		expect(header).toContainElement(screen.getByTestId('calendar-all-day-band'))
		expect(screen.getByTestId('calendar-all-day-band').className).not.toMatch(/border-b|border-border/)
		expect(header.firstElementChild).toHaveClass('border-b', 'border-transparent')
		expect(header.closest('[data-slot="scroll-area-viewport"]')).toHaveClass('under-mobile-bar')
		const more = band.getByRole('button', { name: '2 more' })
		expect(more).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(more)
		expect(band.getAllByRole('button', { name: /, All day/ })).toHaveLength(5)
		const fewer = band.getByRole('button', { name: 'Show fewer' })
		expect(fewer).toHaveAttribute('aria-expanded', 'true')
		fireEvent.click(fewer)
		expect(band.getAllByRole('button', { name: /, All day/ })).toHaveLength(3)
	})

	it('places concurrent events side by side so neither covers the other', () => {
		const overlapping = [
			{
				id: 'o1',
				calendar_id: 'cal1',
				title: 'Offsite',
				when: { start_time: e('2024-06-12T12:00:00'), end_time: e('2024-06-12T14:00:00') },
			},
			{
				id: 'o2',
				calendar_id: 'cal1',
				title: 'Review',
				when: { start_time: e('2024-06-12T13:00:00'), end_time: e('2024-06-12T14:00:00') },
			},
		] as Event[]
		render(<CalendarRouteScreen view="week" data={{ ...richData(), events: overlapping }} />)
		const offsite = screen.getByRole('button', { name: /^Offsite/ })
		const review = screen.getByRole('button', { name: /^Review/ })
		expect(offsite.style.left).toBe('calc(0% + 2px)')
		expect(review.style.left).toBe('calc(50% + 2px)')
		expect(offsite.style.width).toBe('calc(50% - 4px)')
		expect(review.style.width).toBe('calc(50% - 4px)')
	})

	it('names the signed-in user answer on each event so RSVP state never depends on colour', () => {
		const invited = (id: string, title: string, hour: number, status: string) => ({
			id,
			calendar_id: 'cal1',
			title,
			organizer: { email: 'boss@ownmail.local' },
			participants: [
				{ email: 'someone@ownmail.local', status: 'yes' },
				{ email: info.email, status },
			],
			when: {
				start_time: e(`2024-06-12T${String(hour).padStart(2, '0')}:00:00`),
				end_time: e(`2024-06-12T${String(hour + 1).padStart(2, '0')}:00:00`),
			},
		})
		const events = [
			invited('r1', 'Accepted', 9, 'yes'),
			invited('r2', 'Maybe', 11, 'maybe'),
			invited('r3', 'Unanswered', 13, 'noreply'),
			invited('r4', 'Skipped', 15, 'no'),
		] as Event[]
		render(<CalendarRouteScreen view="week" data={{ ...richData(), events }} />)
		expect(screen.getByRole('button', { name: 'Accepted, 9 AM – 10 AM' })).toHaveAttribute(
			'data-rsvp',
			'accepted',
		)
		expect(screen.getByRole('button', { name: 'Maybe, 11 AM – 12 PM, Tentative' })).toHaveAttribute(
			'data-rsvp',
			'tentative',
		)
		expect(screen.getByRole('button', { name: 'Unanswered, 1 PM – 2 PM, Not yet answered' })).toHaveAttribute(
			'data-rsvp',
			'awaiting',
		)
		expect(screen.getByRole('button', { name: 'Skipped, 3 PM – 4 PM, Declined' })).toHaveAttribute(
			'data-rsvp',
			'declined',
		)
	})

	it('never draws a one-sided accent on an event: the chip is a tinted fill with a uniform border', () => {
		renderWeek()
		const standup = screen.getByRole('button', { name: /^Standup/ })
		expect(standup).toHaveClass('event-chip', 'event-color')
		expect(standup.className).not.toMatch(/border-l|border-s-|shadow-\[inset/)
		expect(standup.style.getPropertyValue('--event-c-light')).toMatch(/^oklch\(/)
	})

	it('says so in the grid when the provider held back events, rather than showing a partial week as complete', () => {
		render(<CalendarRouteScreen view="week" data={{ ...richData(), truncated: true }} />)
		expect(screen.getByText('Some events could not be loaded')).toHaveAttribute('role', 'status')
		cleanup()
		renderWeek()
		expect(screen.queryByText('Some events could not be loaded')).toBeNull()
	})

	it('shows a tall timed event with its time range but drops the range for a short one', () => {
		renderWeek()
		const standup = screen.getByRole('button', { name: /Standup/ })
		expect(standup.textContent).toContain('9 AM')
		expect(standup.textContent).toContain('10 AM')
		// The 5-minute event is too short to show a time range and has no title.
		const untitled = screen.getByRole('button', { name: /^\(untitled\)/ })
		expect(untitled.textContent).not.toContain('–')
		// A chip too short for two lines is one centred line with no block padding, so the
		// title is never cut off. An event of 30 minutes or less has room for its title only:
		// its time is not drawn, but it stays in the name read out for it.
		expect(untitled).toHaveClass('items-center', 'py-0')
		expect(untitled).not.toHaveClass('flex-col')
		expect(untitled).toHaveTextContent(/^\(untitled\)$/)
		expect(untitled).toHaveAccessibleName(expect.stringContaining('11 AM'))
		expect(untitled.querySelector('[data-chip-title]')).toHaveClass('leading-4', 'truncate')
		expect(standup).toHaveClass('flex-col', 'py-control')
	})

	it('labels the primary and secondary time scales directly in the time ruler', async () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({
				displayName: '',
				autoSaveContacts: true,
				primaryTimezone: 'America/Toronto',
				secondaryTimezone: 'Europe/London',
			}),
		)
		renderWeek()
		const ruler = await screen.findByLabelText('Time ruler: Toronto primary time, London secondary time')
		// Each hour column is headed by its whole city: the second zone with its offset
		// from the first, the first with its abbreviation.
		// The offset follows today's date: +4h in the weeks only one of the two observes daylight time.
		expect(ruler).toHaveTextContent(/^London\+[45]hTorontoE[SD]T$/)
	})

	it('draws the second zone as its own hour column before the first, shading hours no one there is working', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T14:30:00Z'))
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ primaryTimezone: 'America/Toronto', secondaryTimezone: 'Europe/Lisbon' }),
		)
		render(<CalendarRouteScreen view="day" data={richData('2024-06-15')} />)
		act(() => {
			vi.advanceTimersByTime(0)
		})
		// The gutter track doubles so the day columns keep their own tracks and line up.
		const header = screen.getByTestId('calendar-time-grid-header').firstElementChild as HTMLElement
		const body = screen.getByTestId('calendar-time-grid-body').lastElementChild as HTMLElement
		expect(header.style.gridTemplateColumns).toBe('7rem repeat(1, minmax(0, 1fr)) 2.75rem')
		expect(body.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns)
		const label = (key: string) => document.querySelector(`[data-hour-label="${key}"]`) as HTMLElement
		// 9 AM in Toronto is 2 PM in Lisbon, a working hour: plain.
		expect(label('9-secondary')).toHaveTextContent(/^2 PM$/)
		expect(label('9-secondary').parentElement).not.toHaveAttribute('data-outside-working-hours')
		// 1 AM in Toronto is 6 AM in Lisbon, and 5 PM is 10 PM there: both shaded, and both say why.
		for (const hour of [1, 17]) {
			expect(label(`${hour}-secondary`).parentElement).toHaveClass('bg-muted')
			expect(label(`${hour}-secondary`)).toHaveAttribute('title', 'Outside working hours there')
			expect(label(`${hour}-secondary`)).toHaveTextContent(/, outside working hours there$/)
		}
		// Lisbon reaches midnight at 7 PM in Toronto: that label names the day it moves into.
		expect(label('19-secondary')).toHaveTextContent(/^Sun12 AM/)
		expect(label('18-secondary')).toHaveTextContent(/^11 PM/)
		// The now line reads the current time in both columns, the first in the today colour.
		expect(screen.getByTestId('calendar-now-badge')).toHaveTextContent('10:30 AM')
		expect(screen.getByTestId('calendar-now-badge')).toHaveClass('bg-today', 'text-today-foreground')
		expect(screen.getByTestId('calendar-now-badge-secondary')).toHaveTextContent('3:30 PM')
		expect(screen.getByTestId('calendar-now-badge-secondary')).toHaveClass('border-today')
		expect(screen.getByTestId('calendar-now-badge-secondary')).not.toHaveClass('bg-today')
	})

	it('marks a week ruler’s midnight relative to each column, since one weekday would fit only the first', () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ primaryTimezone: 'America/Toronto', secondaryTimezone: 'Europe/Lisbon' }),
		)
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		expect(document.querySelector('[data-hour-label="19-secondary"]')).toHaveTextContent(/^Next day12 AM/)
		// Hours are shown at the zoom step's height in both columns, so their rows line up.
		const secondaryRow = document.querySelector('[data-secondary-hour="9"]')?.parentElement as HTMLElement
		expect(secondaryRow.style.height).toBe('52px')
	})

	it('hides an event that falls outside the selected calendar day', () => {
		renderWeek()
		expect(screen.queryByRole('button', { name: 'Night' })).toBeNull()
	})

	it('skips malformed loader events rather than crashing the calendar', () => {
		const data = {
			...richData(),
			events: [
				...richEvents(),
				null,
				{ id: 'bad-null-when', calendar_id: 'cal1', title: 'Malformed', when: null },
			] as unknown as Event[],
		}

		expect(() => render(<CalendarRouteScreen view="week" data={data} />)).not.toThrow()
		expect(screen.getByRole('button', { name: /Standup/ })).toBeInTheDocument()
		expect(screen.queryByText('Malformed')).toBeNull()
	})

	it('shows a timed event in the detail pane with its calendar name resolved, not in a dialog', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /Standup/ }))
		const details = screen.getByTestId('event-details')
		expect(details.dataset.event).toBe('t1')
		expect(details.dataset.calendarName).toBe('Work')
		// Viewing never covers the grid: no dialog opens.
		expect(screen.queryByTestId('event-modal')).toBeNull()
	})

	it('shows an all-day event in the detail pane', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /^Trip/ }))
		expect(screen.getByTestId('event-details').dataset.event).toBe('a2')
	})

	it('opens a new event editor when an empty hour slot is clicked', () => {
		renderWeek()
		const slots = screen.getAllByRole('button', { name: /Create event at/ })
		fireEvent.click(slots[0])
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset.event).toBe('new')
		// Slot click seeds a concrete start time rather than falling back to the anchor.
		expect(modal.dataset.defaultStart).toBeTruthy()
		expect(modal.dataset.preserveDefaultStartTime).toBe('true')
	})

	it('draws inter-day column rules across a multi-day week', () => {
		const { container } = renderWeek()
		expect(container.querySelectorAll('.border-l').length).toBeGreaterThan(0)
	})

	it('keeps week columns readable through an intentional mobile horizontal viewport', () => {
		renderWeek()
		const scrollArea = screen.getByLabelText('Calendar time grid')
		expect(scrollArea).toHaveClass('max-sm:overflow-x-auto')
		expect(screen.getByTestId('calendar-time-grid-header')).toHaveClass('max-sm:min-w-[54rem]')
		expect(screen.getByTestId('calendar-time-grid-body')).toHaveClass('max-sm:min-w-[54rem]')
	})

	it('labels an untitled all-day event in the band', () => {
		const data = {
			...richData(),
			events: [{ id: 'ad', calendar_id: 'cal1', title: '', when: { date: '2024-06-15' } }] as Event[],
		}
		render(<CalendarRouteScreen view="day" data={data} />)
		expect(screen.getByRole('button', { name: '(untitled), All day' })).toBeInTheDocument()
	})
})

describe('day view time grid', () => {
	it('renders a single day column with all-day events and no inter-day rules', () => {
		const { container } = render(<CalendarRouteScreen view="day" data={richData()} />)
		// A day has one midnight row (at the top) and runs through 11 PM.
		expect(screen.getAllByRole('button', { name: /Create event at/ })).toHaveLength(24)
		expect(screen.getAllByRole('button', { name: /Create event at 12 AM/ })).toHaveLength(1)
		expect(screen.getByRole('button', { name: /Create event at 11 PM/ })).toBeInTheDocument()
		expect(screen.getByText('All day')).toBeInTheDocument()
		expect(container.querySelectorAll('.border-l')).toHaveLength(0)
	})

	it('omits the all-day band entirely when a day has only timed events', () => {
		render(<CalendarRouteScreen view="day" data={timedOnlyData()} />)
		expect(screen.queryByText('All day')).toBeNull()
		expect(screen.getByRole('button', { name: /Focus/ })).toBeInTheDocument()
	})
})

// ---- month view -----------------------------------------------------------

describe('month view', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	const renderMonth = () => render(<CalendarRouteScreen view="month" data={monthData()} />)

	it('highlights today and dims out-of-month days', () => {
		renderMonth()
		const fifteens = screen.getAllByText('15')
		const monthTodayCell = fifteens.find((el) => el.tagName === 'SPAN')
		// Today uses its own token, not the primary action colour.
		expect(monthTodayCell?.className).toContain('bg-today')
		expect(monthTodayCell?.className).not.toContain('bg-primary')
		// May 27 belongs to the leading week and is styled as out-of-month.
		const outOfMonth = screen.getAllByText('27').find((el) => el.tagName === 'SPAN')
		expect(outOfMonth?.className).toContain('text-muted-foreground')
	})

	it('caps a busy day at three events and shows an overflow count', () => {
		renderMonth()
		expect(screen.getByRole('button', { name: /Holiday/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Meeting/ })).toBeInTheDocument()
		expect(screen.getByText('+1 more')).toBeInTheDocument()
	})

	it('opening an event does not also trigger the day-cell drill-in', () => {
		renderMonth()
		fireEvent.click(screen.getByRole('button', { name: /Meeting/ }))
		expect(screen.getByTestId('event-details').dataset.event).toBe('m2')
		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('clicking a day cell drills into the day view', () => {
		renderMonth()
		fireEvent.click(screen.getByText('+1 more'))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-20' },
		})
	})

	it.each([
		['Enter', 'Enter'],
		['Space', ' '],
	])('opens the focused day with %s', (_label, key) => {
		renderMonth()
		const day = document.querySelector<HTMLElement>('[data-month-calendar-day="2024-06-20"]')
		expect(day).not.toBeNull()
		day?.focus()
		fireEvent.focus(day as HTMLElement)
		fireEvent.keyDown(day as HTMLElement, { key })
		expect(h.navigate).toHaveBeenCalledTimes(1)
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-20' },
		})
	})

	it('keeps keyboard event activation scoped to the child event', () => {
		renderMonth()
		const event = screen.getByRole('button', { name: /Meeting/ })
		fireEvent.keyDown(event, { key: 'Enter' })
		fireEvent.click(event)
		expect(screen.getByTestId('event-details').dataset.event).toBe('m2')
		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('opens the newly focused day after arrow-key navigation', () => {
		renderMonth()
		const day = document.querySelector<HTMLElement>('[data-month-calendar-day="2024-06-20"]')
		day?.focus()
		fireEvent.keyDown(day as HTMLElement, { key: 'ArrowRight' })
		vi.runOnlyPendingTimers()
		const nextDay = document.querySelector<HTMLElement>('[data-month-calendar-day="2024-06-21"]')
		expect(nextDay).toHaveFocus()
		fireEvent.keyDown(nextDay as HTMLElement, { key: 'Enter' })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-21' },
		})
	})

	it('exposes column headers and six owned week rows', () => {
		renderMonth()
		const grid = screen.getByRole('grid', { name: 'Month calendar' })
		const rows = within(grid).getAllByRole('row')
		expect(rows).toHaveLength(7)
		expect(within(rows[0] as HTMLElement).getAllByRole('columnheader')).toHaveLength(7)
		const cells = within(grid).getAllByRole('gridcell')
		expect(cells).toHaveLength(42)
		expect(cells.every((cell) => cell.parentElement?.tagName === 'TR')).toBe(true)
	})

	it.each([
		['ArrowLeft', 'first'],
		['ArrowUp', 'first'],
		['ArrowRight', 'last'],
		['ArrowDown', 'last'],
	] as const)('keeps one active day when %s reaches the %s rendered boundary', (key, edge) => {
		renderMonth()
		const grid = screen.getByRole('grid', { name: 'Month calendar' })
		const cells = within(grid).getAllByRole('gridcell')
		const day = edge === 'first' ? cells[0] : cells.at(-1)
		expect(day).toBeDefined()
		day?.focus()
		fireEvent.focus(day as HTMLElement)
		fireEvent.keyDown(day as HTMLElement, { key })
		vi.runOnlyPendingTimers()
		expect(day).toHaveFocus()
		expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([day])
		fireEvent.keyDown(day as HTMLElement, { key: 'Enter' })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: day?.dataset.monthCalendarDay },
		})
	})

	it.each(['PageUp', 'PageDown'])(
		'retains the active rendered day when %s points outside the grid',
		(key) => {
			renderMonth()
			const grid = screen.getByRole('grid', { name: 'Month calendar' })
			const day = within(grid).getByRole('gridcell', { name: /Thursday, June 20, 2024/ })
			day.focus()
			fireEvent.focus(day)
			fireEvent.keyDown(day, { key })
			vi.runOnlyPendingTimers()
			expect(day).toHaveFocus()
			expect(
				within(grid)
					.getAllByRole('gridcell')
					.filter((cell) => cell.tabIndex === 0),
			).toEqual([day])
			fireEvent.keyDown(day, { key: ' ' })
			expect(h.navigate).toHaveBeenCalledWith({
				to: '/calendar/$view',
				params: { view: 'day' },
				search: { date: '2024-06-20' },
			})
		},
	)

	it('marks today and the anchor date distinctly in the mini calendar', () => {
		renderMonth()
		const miniToday = screen.getAllByText('15').find((el) => el.tagName === 'BUTTON')
		expect(miniToday?.className).toContain('bg-today')
		const miniRef = screen.getAllByText('20').find((el) => el.tagName === 'BUTTON')
		expect(miniRef?.className).toContain('bg-accent')
	})

	it('picking a mini-calendar day from the month view drills into that day', () => {
		renderMonth()
		const miniDay = screen.getAllByText('12').find((el) => el.tagName === 'BUTTON')
		fireEvent.click(miniDay as HTMLElement)
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-12' },
		})
	})
})

// ---- now indicator (deterministic clock) ----------------------------------

describe('current-time indicator', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('draws the now line across the whole week, strongest on today, with the time in the gutter', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-12T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-12')} />)
		const line = screen.getByTestId('calendar-now-line')
		expect(line.style.top).toBe(`${10.5 * 52}px`)
		expect(line).toHaveTextContent('10:30 AM')
		// Wednesday is the fourth day column, after the time gutter.
		expect(screen.getByTestId('calendar-now-line-today').style.gridColumn).toBe('5')
		// The line is the today token, never the error colour.
		expect(line.querySelector('.bg-destructive')).toBeNull()
		expect(line.querySelector('.bg-today')).not.toBeNull()
	})

	it('moves the now line as the minute changes', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T05:00:00'))
		render(<CalendarRouteScreen view="day" data={richData('2024-06-15')} />)
		expect(screen.getByTestId('calendar-now-line').style.top).toBe(`${5 * 52}px`)
		act(() => {
			vi.advanceTimersByTime(60 * 60_000)
		})
		expect(screen.getByTestId('calendar-now-line').style.top).toBe(`${6 * 52}px`)
	})

	it('hides the hour label under the now badge instead of drawing two times on top of each other', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-12T05:46:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-12')} />)
		const label = (hour: number) => document.querySelector(`[data-hour-label="${hour}"]`) as HTMLElement
		expect(screen.getByTestId('calendar-now-badge')).toHaveTextContent('5:46 AM')
		// `invisible` keeps the label's box, so nothing in the gutter moves.
		expect(label(6)).toHaveClass('invisible')
		expect(label(6)).toHaveTextContent('6 AM')
		expect(label(5)).not.toHaveClass('invisible')
		expect(label(7)).not.toHaveClass('invisible')
		act(() => {
			vi.advanceTimersByTime(44 * 60_000)
		})
		// 6:30 AM: the badge has moved clear of both neighbours.
		expect(label(6)).not.toHaveClass('invisible')
		expect(label(7)).not.toHaveClass('invisible')
	})

	it('hides a second-timezone label under the badge too, and no label when today is not shown', () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ primaryTimezone: 'America/Toronto', secondaryTimezone: 'Europe/London' }),
		)
		vi.useFakeTimers()
		// 6:17 AM in Toronto: the badge is over the secondary label that sits just below the 6 AM line.
		vi.setSystemTime(new Date('2024-06-12T10:17:00Z'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-12')} />)
		act(() => {
			vi.advanceTimersByTime(0)
		})
		expect(document.querySelector('[data-hour-label="6-secondary"]')).toHaveClass('invisible')
		expect(document.querySelector('[data-hour-label="7-secondary"]')).not.toHaveClass('invisible')
		cleanup()
		render(<CalendarRouteScreen view="week" data={richData('2024-06-25')} />)
		act(() => {
			vi.advanceTimersByTime(0)
		})
		expect(document.querySelectorAll('[data-hour-label].invisible')).toHaveLength(0)
	})

	it('centres the now line on the current time rather than hanging the badge below it', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-12T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-12')} />)
		expect(screen.getByTestId('calendar-now-line')).toHaveClass('-translate-y-1/2')
	})

	it('draws no now line on a week that does not contain today', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-25')} />)
		expect(screen.queryByTestId('calendar-now-line')).toBeNull()
	})

	it('writes today inline with a pill on the date and leaves other days plain', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-12T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-12')} />)
		const header = screen.getByTestId('calendar-time-grid-header')
		const today = header.querySelector('[aria-current="date"]') as HTMLElement
		expect(today).toHaveTextContent(/^Wed\s*12$/)
		expect(within(today).getByText('12')).toHaveClass('bg-today', 'text-today-foreground')
		expect(within(header).getByText('13')).not.toHaveClass('bg-today')
	})

	it('dims events that have already ended and leaves upcoming ones at full strength', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		const grid = within(screen.getByTestId('calendar-time-grid-body'))
		expect(grid.getByRole('button', { name: /^Standup/ })).toHaveAttribute('data-past')
		expect(grid.getByRole('button', { name: /^Sync/ })).not.toHaveAttribute('data-past')
	})

	it('says an ended event has ended in its name, because fading alone tells a screen reader nothing', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		const grid = within(screen.getByTestId('calendar-time-grid-body'))
		expect(grid.getByRole('button', { name: /^Standup/ })).toHaveAccessibleName(
			'Standup, 9 AM – 10 AM, Ended',
		)
		expect(grid.getByRole('button', { name: /^Sync/ })).toHaveAccessibleName('Sync, 1 PM – 2 PM')
		// All-day events end with their date: today's holiday is still current.
		expect(screen.getByRole('button', { name: /^Holiday/ })).toHaveAccessibleName('Holiday, All day')
		cleanup()
		vi.setSystemTime(new Date('2024-06-16T09:00:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		expect(screen.getByRole('button', { name: /^Holiday/ })).toHaveAccessibleName('Holiday, All day, Ended')
	})

	it('marks today for assistive technology in the mini-month and the month grid, not only by its fill', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		render(<CalendarRouteScreen view="month" data={monthData()} />)
		const mini = screen.getByRole('grid', { name: 'Date picker' })
		expect(mini.querySelectorAll('[aria-current="date"]')).toHaveLength(1)
		expect(mini.querySelector('[data-mini-calendar-day="2024-06-15"]')).toHaveAttribute(
			'aria-current',
			'date',
		)
		const month = screen.getByRole('grid', { name: 'Month calendar' })
		expect(month.querySelectorAll('[aria-current="date"]')).toHaveLength(1)
		expect(month.querySelector('[data-month-calendar-day="2024-06-15"]')).toHaveAttribute(
			'aria-current',
			'date',
		)
	})
})

// ---- keyboard shortcuts ---------------------------------------------------

describe('keyboard shortcuts', () => {
	const renderView = (view: 'day' | 'week' | 'month' = 'week') =>
		render(<CalendarRouteScreen view={view} data={richData()} />)

	it('navigates the view via the m / w / d shortcuts', () => {
		renderView('week')
		fireEvent.keyDown(document.body, { key: 'm' })
		expect(h.navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/calendar/$view', params: { view: 'month' } }),
		)
		fireEvent.keyDown(document.body, { key: 'd' })
		expect(h.navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/calendar/$view', params: { view: 'day' } }),
		)
		fireEvent.keyDown(document.body, { key: 'w' })
		expect(h.navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/calendar/$view', params: { view: 'week' } }),
		)
	})

	it('opens a blank new-event editor with the n shortcut', () => {
		renderView()
		fireEvent.keyDown(document.body, { key: 'n' })
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset.event).toBe('new')
		// No slot start was chosen, so the editor falls back to the anchor day.
		expect(modal.dataset.defaultStart).toBeTruthy()
	})

	it('pages the visible range backward with [ / ArrowLeft and forward with ] / ArrowRight', () => {
		renderView('week') // anchor 2024-06-15
		fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-06-08' },
		})
		fireEvent.keyDown(document.body, { key: ']' })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-06-22' },
		})
	})

	it('jumps to today with the t shortcut, keeping the current view', () => {
		renderView('week')
		fireEvent.keyDown(document.body, { key: 't' })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: ymd(new Date()) },
		})
	})

	it('ignores shortcuts while typing, with modifiers, on other keys, and inside dialogs', () => {
		renderView()

		const input = document.createElement('input')
		document.body.appendChild(input)
		fireEvent.keyDown(input, { key: 'm' })
		input.remove()

		const textarea = document.createElement('textarea')
		document.body.appendChild(textarea)
		fireEvent.keyDown(textarea, { key: 'm' })
		textarea.remove()

		const editable = document.createElement('div')
		Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true })
		document.body.appendChild(editable)
		fireEvent.keyDown(editable, { key: 'm' })
		editable.remove()

		fireEvent.keyDown(document.body, { key: 'm', metaKey: true })
		fireEvent.keyDown(document.body, { key: 'm', ctrlKey: true })
		fireEvent.keyDown(document.body, { key: 'm', altKey: true })
		fireEvent.keyDown(document.body, { key: 'm', repeat: true })
		fireEvent.keyDown(document.body, { key: 'x' })
		// None of the guarded keys reach the calendar, so no view navigation fires.
		expect(h.navigate).not.toHaveBeenCalled()

		// Keys pressed from inside an open dialog must not steer the calendar behind it.
		fireEvent.keyDown(document.body, { key: 'n' })
		const dialogButton = within(screen.getByTestId('event-modal')).getByText('close-unchanged')
		fireEvent.keyDown(dialogButton, { key: 'd' })
		expect(h.navigate).not.toHaveBeenCalled()
	})
})

// ---- editor open/close paths ----------------------------------------------

describe('event editor', () => {
	const renderWeek = () => render(<CalendarRouteScreen view="week" data={richData()} />)

	it('seeds the editor from the create button using the primary calendar name', () => {
		renderWeek()
		// The sidebar's create action names the key that does the same thing.
		expect(sidebarNewEvent()).toHaveAttribute('aria-keyshortcuts', 'N')
		fireEvent.click(sidebarNewEvent())
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset.event).toBe('new')
		expect(modal.dataset.calendarName).toBe('Primary Cal')
		// A one-hour draft on the date being shown, not tied to a slot.
		expect(modal.dataset).toMatchObject({
			defaultStart: new Date('2024-06-15T00:00:00').toISOString(),
			defaultDurationMinutes: '60',
		})
	})

	it('starts a new event from the sheet on mobile layouts, closing the sheet so the editor is not covered', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		const sheet = screen.getByTestId('sheet')
		// The create action is the first control in the sheet's calendar section, above the refresh row.
		expect(
			within(sheet).getAllByRole('button', { name: /New event|Refresh calendar/ })[0],
		).toHaveAccessibleName('New event')
		fireEvent.click(within(sheet).getByRole('button', { name: 'New event' }))
		expect(screen.queryByTestId('sheet')).toBeNull()
		expect(screen.getByTestId('event-modal').dataset.event).toBe('new')
	})

	it('starts a new event from the top bar the same way while the sidebar is hidden', () => {
		renderWeek()
		fireEvent.click(
			within(screen.getByTestId('calendar-header-create-cell')).getByRole('button', { name: 'New event' }),
		)
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({
			event: 'new',
			defaultStart: new Date('2024-06-15T00:00:00').toISOString(),
			defaultDurationMinutes: '60',
		})
	})

	it('renders a live composer draft alongside saved events with preview styling', () => {
		renderWeek()
		fireEvent.click(sidebarNewEvent())
		fireEvent.click(screen.getByRole('button', { name: 'show-live-preview' }))

		const preview = screen.getByRole('button', { name: /Live draft/ })
		const saved = screen.getByRole('button', { name: /Standup/ })
		expect(preview).toHaveAttribute('data-preview')
		expect(preview).toBeDisabled()
		expect(saved).not.toHaveAttribute('data-preview')
		fireEvent.click(preview)
		expect(screen.getByTestId('event-modal').dataset.event).toBe('new')
	})

	it('falls back to the primary calendar name for an event on an unknown calendar', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /Sync/ }))
		expect(screen.getByTestId('event-details').dataset.calendarName).toBe('Primary Cal')
	})

	it('falls back to the primary calendar name for an event with no calendar id', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /Solo/ }))
		expect(screen.getByTestId('event-details').dataset.calendarName).toBe('Primary Cal')
	})

	it('closes after the editor reports a cached change', () => {
		renderWeek()
		fireEvent.click(sidebarNewEvent())
		fireEvent.click(screen.getByText('close-changed'))
		expect(screen.queryByTestId('event-modal')).toBeNull()
		expect(h.invalidate).not.toHaveBeenCalled()
	})

	it('does not revalidate when the editor closes unchanged', () => {
		renderWeek()
		fireEvent.click(sidebarNewEvent())
		fireEvent.click(screen.getByText('close-unchanged'))
		expect(screen.queryByTestId('event-modal')).toBeNull()
		expect(h.invalidate).not.toHaveBeenCalled()
	})
})

// ---- mobile sheet ---------------------------------------------------------

describe('mobile calendar sheet', () => {
	it('offers an explicit calendar refresh action in the contextual sheet', () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined)
		render(<CalendarRouteScreen view="week" data={richData()} onRefresh={onRefresh} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Refresh calendar' }))
		expect(onRefresh).toHaveBeenCalledOnce()
		expect(screen.getByText('Pull to refresh')).toBeInTheDocument()
	})

	it('closes the sheet when mobile primary navigation is chosen', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		fireEvent.click(screen.getByRole('button', { name: 'close-mobile-navigation' }))
		expect(screen.queryByTestId('sheet')).toBeNull()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('opens the sheet and re-anchors the grid when a sheet date is picked', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		const sheet = screen.getByTestId('sheet')
		const dateInput = within(sheet).getByLabelText('Go to date')
		expect(dateInput).toHaveClass('h-12')
		fireEvent.change(dateInput, { target: { value: '2024-06-10' } })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-06-10' },
		})
		// Picking a date dismisses the sheet.
		expect(screen.queryByTestId('sheet')).toBeNull()
	})

	it('drills from a month-view sheet date straight into that day', () => {
		render(<CalendarRouteScreen view="month" data={monthData()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		const sheet = screen.getByTestId('sheet')
		fireEvent.change(within(sheet).getByLabelText('Go to date'), { target: { value: '2024-06-12' } })
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-12' },
		})
	})

	it('dismisses the sheet via its own close control', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		const sheet = screen.getByTestId('sheet')
		fireEvent.click(within(sheet).getByRole('button', { name: 'close-sheet' }))
		expect(screen.queryByTestId('sheet')).toBeNull()
	})

	it('opens an event editor from the sheet agenda and closes the sheet', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T08:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		const sheet = screen.getByTestId('sheet')
		// The agenda lists the day's timed events; open the first one.
		fireEvent.click(within(sheet).getByRole('button', { name: /Standup/ }))
		expect(screen.getByTestId('event-modal').dataset.event).toBe('t1')
		expect(screen.queryByTestId('sheet')).toBeNull()
	})
})

// ---- week title formatting ------------------------------------------------

describe('grid title', () => {
	const titleFor = (view: 'day' | 'week' | 'month', anchorIso: string) => {
		render(<CalendarRouteScreen view={view} data={richData(anchorIso)} />)
		return screen.getByRole('heading', { level: 1 }).textContent ?? ''
	}

	it('names the month and year in every view', () => {
		expect(titleFor('week', '2024-06-15')).toBe('June 2024')
		cleanup()
		expect(titleFor('day', '2024-06-15')).toBe('June 2024')
		cleanup()
		expect(titleFor('month', '2024-06-15')).toBe('June 2024')
		cleanup()
	})

	it('follows the anchored day when a week crosses a month or year boundary', () => {
		expect(titleFor('week', '2024-05-30')).toBe('May 2024')
		cleanup()
		expect(titleFor('week', '2024-12-31')).toBe('December 2024')
		cleanup()
	})
})

// ---- current time awareness -----------------------------------------------

describe('current-time aware sidebar and grid', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	const agendaPanel = () => screen.getByText('Up next today').parentElement as HTMLElement

	it('leaves ended meetings out of "Up next" and marks the meeting in progress as Now', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T09:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		const panel = within(agendaPanel())
		// Night (02:00–03:00) is over; Standup (09:00–10:00) is happening now.
		expect(panel.queryByRole('button', { name: /Night/ })).toBeNull()
		expect(panel.getByRole('button', { name: /Standup/ })).toHaveTextContent('Now')
		expect(panel.getByRole('button', { name: /Sync/ })).not.toHaveTextContent('Now')
	})

	it('rolls the agenda forward as time passes without a reload', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T15:28:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		expect(within(agendaPanel()).getByRole('button', { name: /Solo/ })).toBeInTheDocument()
		act(() => {
			vi.advanceTimersByTime(3 * 60_000)
		})
		expect(within(agendaPanel()).queryByRole('button', { name: /Solo/ })).toBeNull()
		expect(screen.getByText('Nothing left today.')).toBeInTheDocument()
	})

	it('opens the time grid just before now when today is visible', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T15:30:00'))
		render(<CalendarRouteScreen view="day" data={richData('2024-06-15')} />)
		const body = screen.getByRole('region', { name: 'Calendar time grid' })
		expect(body.scrollTop).toBe(14 * 52 - 12)
	})

	it('keeps the 8am default when the visible range does not include today', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T15:30:00'))
		render(<CalendarRouteScreen view="day" data={richData('2024-06-20')} />)
		const body = screen.getByRole('region', { name: 'Calendar time grid' })
		expect(body.scrollTop).toBe(8 * 52 - 12)
	})
})

describe('hidden calendars', () => {
	it('remembers unchecked calendars across visits so hidden events stay hidden', () => {
		const first = render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: /^Work/ }))
		expect(screen.queryByRole('button', { name: /Standup/ })).toBeNull()
		first.unmount()

		render(<CalendarRouteScreen view="week" data={richData()} />)
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-pressed', 'false')
		expect(screen.queryByRole('button', { name: /Standup/ })).toBeNull()
	})

	it('keeps hidden calendars per inbox because calendar ids are only unique within one grant', () => {
		const first = render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: /^Work/ }))
		expect(screen.queryByRole('button', { name: /Standup/ })).toBeNull()
		first.unmount()

		// A different inbox with the same calendar id still shows that calendar.
		const other = { ...richData(), info: { ...info, email: 'Other@OwnMail.local' } }
		const second = render(<CalendarRouteScreen view="week" data={other} />)
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: /Standup/ })).toBeInTheDocument()
		second.unmount()

		// Returning to the first inbox (email case-insensitive) restores its choice.
		const same = { ...richData(), info: { ...info, email: 'USER@ownmail.local' } }
		render(<CalendarRouteScreen view="week" data={same} />)
		expect(screen.getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-pressed', 'false')
	})
})

describe('calendar grid controls', () => {
	const storedPreferences = () => JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')
	const slot = () => screen.getByRole('button', { name: /^Create event at 9 AM on Saturday/ })

	it('zooms the grid: every hour row, event box and the now line follow the chosen hour height', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		try {
			render(<CalendarRouteScreen view="day" data={richData()} />)
			expect(slot().style.height).toBe('52px')
			fireEvent.click(screen.getByRole('button', { name: 'Grid zoom' }))
			fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
			expect(slot().style.height).toBe('64px')
			// Standup runs 9-10 AM: nine hours down, one hour tall less the 2px gap.
			const standup = screen.getByRole('button', { name: /^Standup/ })
			expect(standup.style.top).toBe(`${9 * 64}px`)
			expect(standup.style.height).toBe(`${64 - 2}px`)
			expect(screen.getByTestId('calendar-now-line').style.top).toBe(`${10.5 * 64}px`)
			expect(storedPreferences().calendarHourHeight).toBe(64)
		} finally {
			vi.useRealTimers()
		}
	})

	it('keeps the hour at the top of the viewport when the zoom changes', () => {
		render(<CalendarRouteScreen view="day" data={richData('2024-06-20')} />)
		const body = screen.getByRole('region', { name: 'Calendar time grid' })
		body.scrollTop = 10 * 52
		fireEvent.click(screen.getByRole('button', { name: 'Grid zoom' }))
		fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
		expect(body.scrollTop).toBe(10 * 40)
	})

	it('restores the zoom this device chose on the next visit', async () => {
		localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ calendarHourHeight: 80 }))
		render(<CalendarRouteScreen view="day" data={richData()} />)
		await vi.waitFor(() => expect(slot().style.height).toBe('80px'))
	})

	it('keeps the zoom control in its own track so header and grid columns stay aligned', () => {
		renderControlsWeek()
		const header = screen.getByTestId('calendar-time-grid-header').firstElementChild as HTMLElement
		const body = screen.getByTestId('calendar-time-grid-body').lastElementChild as HTMLElement
		expect(header.style.gridTemplateColumns).toBe('3.5rem repeat(7, minmax(0, 1fr)) 2.75rem')
		expect(body.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns)
	})

	it('adds and removes the second time zone from the gutter head, updating the ruler in place', () => {
		localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ primaryTimezone: 'America/Toronto' }),
		)
		renderControlsWeek()
		fireEvent.click(screen.getByRole('button', { name: /Add a second time zone$/ }))
		fireEvent.change(screen.getByRole('combobox', { name: 'Second time zone' }), {
			target: { value: 'Europe/London' },
		})
		expect(storedPreferences().secondaryTimezone).toBe('Europe/London')
		expect(
			screen.getByLabelText('Time ruler: Toronto primary time, London secondary time'),
		).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Remove second time zone' }))
		expect(storedPreferences().secondaryTimezone).toBe('')
		expect(screen.getByLabelText('Time ruler: Toronto primary time')).toBeInTheDocument()
	})

	it('collapses the desktop sidebar from the mini-month header and brings it back from the top bar, remembered on this device', () => {
		const first = renderControlsWeek()
		const sidebar = () => document.getElementById('calendar-sidebar') as HTMLElement
		const createCell = () => screen.getByTestId('calendar-header-create-cell')
		// While the sidebar shows, its quiet toggle sits beside the mini-month's own controls,
		// and the top bar has neither a toggle nor a second New event on desktop.
		const toggle = within(sidebar()).getByRole('button', { name: 'Hide calendar sidebar' })
		expect(toggle.parentElement).toContainElement(
			within(sidebar()).getByRole('button', { name: 'Next month' }),
		)
		expect(toggle).toHaveAttribute('title', 'Hide calendar sidebar')
		expect(toggle).toHaveAttribute('aria-expanded', 'true')
		expect(toggle).toHaveAttribute('aria-controls', 'calendar-sidebar')
		expect(sidebar()).toHaveClass('lg:flex')
		expect(createCell()).toHaveClass('lg:hidden')
		expect(within(createCell()).queryByRole('button', { name: /calendar sidebar/ })).toBeNull()

		fireEvent.click(toggle)
		// The state is carried by the name and aria-expanded, not by the icon alone.
		expect(within(sidebar()).queryByRole('button', { name: /calendar sidebar/ })).toBeNull()
		const collapsed = within(createCell()).getByRole('button', { name: 'Show calendar sidebar' })
		expect(collapsed).toHaveAttribute('aria-expanded', 'false')
		expect(collapsed).toHaveAttribute('title', 'Show calendar sidebar')
		expect(sidebar()).not.toHaveClass('lg:flex')
		// The top bar starts with the toggle and then the icon-only New event, shown on desktop too.
		expect(createCell()).not.toHaveClass('lg:hidden')
		expect([...createCell().children].map((child) => child.getAttribute('aria-label'))).toEqual([
			'Show calendar sidebar',
			'New event',
		])
		// The sidebar's header column goes with it, so the title is not left indented.
		const headerGrid = screen.getByTestId('calendar-header-controls').parentElement as HTMLElement
		expect(headerGrid.className).not.toMatch(/lg:grid-cols-/)
		expect(headerGrid.children).toHaveLength(1)
		expect(storedPreferences().calendarSidebarCollapsed).toBe(true)
		first.unmount()

		renderControlsWeek()
		expect(screen.getByRole('button', { name: 'Show calendar sidebar' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Show calendar sidebar' }))
		expect(sidebar()).toHaveClass('lg:flex')
		expect(storedPreferences().calendarSidebarCollapsed).toBe(false)
	})
})

function renderControlsWeek() {
	return render(<CalendarRouteScreen view="week" data={richData()} />)
}

describe('event detail pane', () => {
	const pane = () => screen.queryByRole('complementary', { name: 'Event details' })
	const standup = () => screen.getByRole('button', { name: /^Standup/ })

	it('opens from the top-bar toggle with a prompt, and closes from it again', () => {
		renderControlsWeek()
		const toggle = screen.getByRole('button', { name: 'Show event details' })
		expect(toggle).toHaveAttribute('aria-expanded', 'false')
		expect(toggle).toHaveAttribute('aria-controls', 'calendar-detail-panel')
		expect(pane()).toBeNull()

		fireEvent.click(toggle)
		expect(pane()).toHaveTextContent('Select an event to see its details.')
		// A pane in the flow beside the grid, not a dialog over it.
		expect(pane()).toHaveClass('shrink-0', 'border-l')
		expect(pane()?.parentElement).toContainElement(screen.getByLabelText('Calendar time grid'))
		const open = screen.getByRole('button', { name: 'Hide event details' })
		expect(open).toHaveAttribute('aria-expanded', 'true')

		fireEvent.click(open)
		expect(pane()).toBeNull()
	})

	it('shows the clicked event in the pane, marks it in the grid, and moves focus to the pane', async () => {
		renderControlsWeek()
		fireEvent.click(standup())
		const details = screen.getByTestId('event-details')
		expect(details.dataset).toMatchObject({ event: 't1', variant: 'panel', email: info.email })
		expect(pane()).toContainElement(details)
		// The selection is an ARIA state on the event, not only a ring.
		expect(standup()).toHaveAttribute('aria-current', 'true')
		expect(screen.getByRole('button', { name: /^Sync/ })).not.toHaveAttribute('aria-current')
		await vi.waitFor(() => expect(pane()).toHaveFocus())
	})

	it('hands focus back to the event when the pane is closed', () => {
		renderControlsWeek()
		fireEvent.click(standup())
		fireEvent.click(screen.getByText('details-close'))
		expect(pane()).toBeNull()
		expect(standup()).toHaveFocus()
		expect(standup()).not.toHaveAttribute('aria-current')
	})

	it('closes on Escape from inside the pane, and ignores other keys', () => {
		renderControlsWeek()
		fireEvent.click(standup())
		fireEvent.keyDown(pane() as HTMLElement, { key: 'a' })
		expect(pane()).not.toBeNull()
		// With an event shown, the view decides: it may first cancel a delete confirmation.
		fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape' })
		expect(pane()).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Show event details' }))
		fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape' })
		expect(pane()).toBeNull()
	})

	it('opens the existing editor from the pane, straight in edit mode, and returns to the pane', () => {
		renderControlsWeek()
		fireEvent.click(standup())
		fireEvent.click(screen.getByText('details-edit'))
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset).toMatchObject({ event: 't1', startInEdit: 'true', calendarName: 'Work' })
		fireEvent.click(screen.getByText('close-changed'))
		expect(screen.queryByTestId('event-modal')).toBeNull()
		expect(screen.getByTestId('event-details').dataset.event).toBe('t1')
	})

	it('falls back to the prompt once the shown event is deleted or its calendar is hidden', () => {
		renderControlsWeek()
		fireEvent.click(standup())
		fireEvent.click(screen.getByText('details-deleted'))
		expect(pane()).toHaveTextContent('Select an event to see its details.')

		fireEvent.click(standup())
		expect(screen.getByTestId('event-details')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: /^Work/ }))
		expect(screen.queryByTestId('event-details')).toBeNull()
		expect(pane()).toHaveTextContent('Select an event to see its details.')
	})

	it('remembers on this device whether the pane is open, and shows it on the first render', () => {
		const first = renderControlsWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Show event details' }))
		expect(
			JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').calendarDetailPaneOpen,
		).toBe(true)
		first.unmount()

		renderControlsWeek()
		// No default-then-flip: the pane is there without waiting for an effect.
		expect(pane()).toHaveTextContent('Select an event to see its details.')
		fireEvent.click(screen.getByRole('button', { name: 'Hide event details' }))
		expect(
			JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').calendarDetailPaneOpen,
		).toBe(false)
	})

	it('does not carry the shown event into another inbox', () => {
		const view = renderControlsWeek()
		fireEvent.click(standup())
		expect(screen.getByTestId('event-details').dataset.event).toBe('t1')
		// Another inbox has its own events, even where ids coincide.
		view.rerender(
			<QueryClientProvider client={new QueryClient()}>
				<CalendarRouteScreen
					view="week"
					data={{ ...richData(), info: { ...info, email: 'other@ownmail.local' } }}
				/>
			</QueryClientProvider>,
		)
		expect(screen.queryByTestId('event-details')).toBeNull()
		expect(pane()).toHaveTextContent('Select an event to see its details.')
	})

	it('keeps the dialog on mobile layouts, where there is no room for a pane', () => {
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
		)
		render(<CalendarRouteScreen view="day" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: /Standup/ }))
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({
			event: 't1',
			startInEdit: 'false',
			calendarName: 'Work',
		})
		expect(screen.queryByTestId('event-details')).toBeNull()
		// An event on a calendar this account does not list is named after the primary one.
		fireEvent.click(screen.getByText('close-unchanged'))
		fireEvent.click(screen.getByRole('button', { name: /Sync/ }))
		expect(screen.getByTestId('event-modal').dataset.calendarName).toBe('Primary Cal')
	})
})

describe('dragging events in the time grid', () => {
	// The Saturday column of the rendered week; one hour is 52px and the grid starts at y=0.
	const X = 750
	const y = (hours: number) => hours * 52
	const standup = () => screen.getByRole('button', { name: /^Standup/ })
	const box = (left: number, top: number, width: number, height: number) =>
		({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect
	const mouse = { pointerType: 'mouse', button: 0 }
	const move = (clientX: number, clientY: number) =>
		fireEvent(window, new MouseEvent('pointermove', { clientX, clientY }))
	const release = (clientX: number, clientY: number) =>
		fireEvent(window, new MouseEvent('pointerup', { clientX, clientY }))

	beforeEach(() => {
		h.updateEvent.mockResolvedValue({})
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			const element = this as HTMLElement
			const column = element.dataset.calendarDayColumn
			if (column !== undefined) return box(100 + Number(column) * 100, 0, 100, 24 * 52)
			if (element.dataset.testid === 'calendar-time-grid-header') return box(0, -40, 900, 40)
			if (element.dataset.slot === 'scroll-area-viewport') return box(0, -40, 900, 2000)
			return box(0, 0, 0, 0)
		})
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('moves an event by dragging: one optimistic update with 15-minute times, and the drop does not open it', async () => {
		renderControlsWeek()
		fireEvent.pointerDown(standup(), { ...mouse, clientX: X, clientY: y(9.5) })
		move(X, y(10.1))
		// While dragging, the box is drawn at the snapped time: 9:30, not 9:36.
		expect(standup().style.top).toBe(`${y(9.5)}px`)
		expect(standup()).toHaveAttribute('data-dragging')
		// While it is dragged the event floats over the grid, so it is panel glass; at rest it is flat again.
		expect(standup()).toHaveClass('glass-panel')
		release(X, y(10.1))
		expect(standup()).not.toHaveClass('glass-panel')
		fireEvent.click(standup())

		await vi.waitFor(() => expect(h.updateEvent).toHaveBeenCalledOnce())
		expect(h.updateEvent.mock.calls[0][0].data).toEqual({
			eventId: 't1',
			calendarId: 'cal1',
			startTime: e('2024-06-15T09:30:00'),
			endTime: e('2024-06-15T10:30:00'),
		})
		expect(screen.queryByTestId('event-details')).toBeNull()
		expect(screen.getByTestId('calendar-drag-status')).toHaveTextContent(/^Moved to .*9:30 AM – 10:30 AM\.$/)
		// A plain move is silent: the event is already where it was dropped.
		expect(screen.queryByText('Only this occurrence was moved.')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('says so, visibly, when the provider refuses a move and the event is put back', async () => {
		h.updateEvent.mockRejectedValue(new Error('provider detail that must not be shown'))
		renderControlsWeek()
		fireEvent.pointerDown(standup(), { ...mouse, clientX: X, clientY: y(9.5) })
		move(X, y(11))
		release(X, y(11))
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Could not move the event. It was put back.')
		expect(alert).not.toHaveTextContent('provider detail')
	})

	it('a recurring occurrence moves alone and says so', async () => {
		const data = richData()
		Object.assign(data.events[0] as Event, { master_event_id: 'series-1' })
		render(<CalendarRouteScreen view="week" data={data} />)
		expect(standup()).toHaveAttribute('aria-describedby', 'calendar-drag-hint-occurrence')
		expect(document.getElementById('calendar-drag-hint-occurrence')).toHaveTextContent(
			'changes only this occurrence',
		)
		fireEvent.pointerDown(standup(), { ...mouse, clientX: X, clientY: y(9.5) })
		move(X, y(11))
		release(X, y(11))
		expect(await screen.findByText('Only this occurrence was moved.')).toHaveAttribute('role', 'status')
		// Only the occurrence's own id is updated, never the series.
		expect(h.updateEvent.mock.calls[0][0].data.eventId).toBe('t1')

		// The notice belongs to the last drop: the next one clears it.
		h.updateEvent.mockReturnValue(new Promise(() => {}))
		fireEvent.pointerDown(standup(), { ...mouse, clientX: X, clientY: y(9.5) })
		move(X, y(12))
		release(X, y(12))
		expect(screen.queryByText('Only this occurrence was moved.')).toBeNull()
	})

	it('drops the outcome of a drag when the calendar moves to another range', async () => {
		h.updateEvent.mockRejectedValue(new Error('offline'))
		const view = renderControlsWeek()
		fireEvent.pointerDown(standup(), { ...mouse, clientX: X, clientY: y(9.5) })
		move(X, y(11))
		release(X, y(11))
		expect(await screen.findByRole('alert')).toHaveTextContent('Could not move the event.')
		view.rerender(
			<QueryClientProvider client={new QueryClient()}>
				<CalendarRouteScreen view="week" data={richData('2024-06-22')} />
			</QueryClientProvider>,
		)
		// The message was about last week; this week starts without it.
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('a read-only event cannot be dragged or resized, and its description says so', () => {
		const data = richData()
		Object.assign(data.events[0] as Event, { read_only: true })
		render(<CalendarRouteScreen view="week" data={data} />)
		expect(standup()).toHaveAttribute('aria-describedby', 'calendar-drag-hint-read-only')
		expect(document.getElementById('calendar-drag-hint-read-only')).toHaveTextContent(
			'Read-only event. It cannot be moved or resized.',
		)
		expect(standup().querySelector('[data-drag-handle]')).toBeNull()
		fireEvent.pointerDown(standup(), { ...mouse, clientX: X, clientY: y(9.5) })
		move(X, y(11))
		release(X, y(11))
		expect(h.updateEvent).not.toHaveBeenCalled()
	})

	it('resizes from an edge handle; an all-day event has no handles to resize by', async () => {
		renderControlsWeek()
		expect(screen.getByRole('button', { name: /^Holiday/ }).querySelector('[data-drag-handle]')).toBeNull()
		const handle = standup().querySelector('[data-drag-handle="end"]') as HTMLElement
		expect(handle).toHaveAttribute('aria-hidden', 'true')
		fireEvent.pointerDown(handle, { ...mouse, clientX: X, clientY: y(10) })
		move(X, y(11.5))
		release(X, y(11.5))
		await vi.waitFor(() => expect(h.updateEvent).toHaveBeenCalledOnce())
		expect(h.updateEvent.mock.calls[0][0].data).toMatchObject({
			startTime: e('2024-06-15T09:00:00'),
			endTime: e('2024-06-15T11:30:00'),
		})

		const top = standup().querySelector('[data-drag-handle="start"]') as HTMLElement
		fireEvent.pointerDown(top, { ...mouse, clientX: X, clientY: y(9) })
		move(X, y(8.5))
		release(X, y(8.5))
		await vi.waitFor(() => expect(h.updateEvent).toHaveBeenCalledTimes(2))
		expect(h.updateEvent.mock.calls[1][0].data).toMatchObject({
			startTime: e('2024-06-15T08:30:00'),
			endTime: e('2024-06-15T10:00:00'),
		})
	})

	it('moves an event from the keyboard: Alt+arrows preview, Enter saves once', async () => {
		renderControlsWeek()
		fireEvent.keyDown(standup(), { key: 'ArrowDown', altKey: true })
		fireEvent.keyDown(standup(), { key: 'ArrowDown', altKey: true })
		expect(standup().style.top).toBe(`${y(9.5)}px`)
		expect(h.updateEvent).not.toHaveBeenCalled()
		fireEvent.keyDown(standup(), { key: 'Enter' })
		await vi.waitFor(() => expect(h.updateEvent).toHaveBeenCalledOnce())
		expect(h.updateEvent.mock.calls[0][0].data).toMatchObject({
			startTime: e('2024-06-15T09:30:00'),
			endTime: e('2024-06-15T10:30:00'),
		})
		expect(standup()).toHaveAttribute('aria-describedby', 'calendar-drag-hint-movable')
	})

	it('abandons a keyboard adjustment when focus leaves the event', () => {
		renderControlsWeek()
		fireEvent.keyDown(standup(), { key: 'ArrowDown', altKey: true })
		expect(standup().style.top).toBe(`${y(9.25)}px`)
		fireEvent.blur(standup(), { relatedTarget: screen.getByRole('button', { name: 'Today' }) })
		expect(standup().style.top).toBe(`${y(9)}px`)
	})

	it('drags out a new event and opens the composer on that range', () => {
		renderControlsWeek()
		const slot = screen.getByRole('button', { name: /^Create event at 2 PM on Saturday/ })
		fireEvent.pointerDown(slot, { ...mouse, clientX: X, clientY: y(14.1) })
		move(X, y(15.4))
		// The range being dragged out is drawn as a draft.
		// The draft chip's name carries its range, which sets it apart from the New event action.
		expect(screen.getByRole('button', { name: /^New event, / })).toBeDisabled()
		release(X, y(15.4))
		// The click that ends the drag on the slot must not replace the range with the slot's hour.
		fireEvent.click(slot)
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset).toMatchObject({
			event: 'new',
			defaultStart: new Date('2024-06-15T14:00:00').toISOString(),
			defaultDurationMinutes: '90',
			preserveDefaultStartTime: 'true',
			startInEdit: 'false',
		})
	})

	it('a plain click on a slot still opens a one-hour composer', () => {
		renderControlsWeek()
		const slot = screen.getByRole('button', { name: /^Create event at 2 PM on Saturday/ })
		fireEvent.pointerDown(slot, { ...mouse, clientX: X, clientY: y(14.1) })
		release(X, y(14.1))
		fireEvent.click(slot)
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({
			defaultStart: new Date('2024-06-15T14:00:00').toISOString(),
			defaultDurationMinutes: '60',
		})
	})
})

describe('meet with: colleagues availability on the grid', () => {
	const meetWith = () => screen.getAllByTestId('meet-with')[0] as HTMLElement
	const blocks = () => [...document.querySelectorAll<HTMLElement>('[data-busy-block]')]
	// Mina is busy 1 PM to 2 PM on Saturday, when "Sync" is also on.
	const busy = { start: e('2024-06-15T13:00:00'), end: e('2024-06-15T14:00:00') }

	beforeEach(() => {
		h.getFreeBusy.mockResolvedValue({
			people: [{ email: 'mina@example.com', busy: [busy], unavailable: false }],
		})
	})

	it('overlays a chosen person busy times as named, non-interactive blocks beside the events', async () => {
		renderControlsWeek()
		expect(meetWith().dataset).toMatchObject({ people: '', shownOnGrid: 'true', loading: 'false' })
		expect(blocks()).toHaveLength(0)
		fireEvent.click(within(meetWith()).getByText('meet-add-mina'))
		await vi.waitFor(() => expect(blocks()).toHaveLength(1), { timeout: 3000 })

		// One lookup for the visible week plus a day either side, naming only the person.
		expect(h.getFreeBusy).toHaveBeenCalledExactlyOnceWith({
			data: {
				start: e('2024-06-08T00:00:00'),
				end: e('2024-06-17T00:00:00'),
				emails: ['mina@example.com'],
			},
		})
		const block = blocks()[0] as HTMLElement
		// Named in text, so it is not told apart by colour alone.
		expect(block).toHaveTextContent('Mina Park')
		expect(block.dataset.busyBlock).toBe('0')
		// Decorative and inert: it cannot be focused, clicked or dragged, and the slot beneath stays usable.
		expect(block.tagName).toBe('DIV')
		expect(block).toHaveAttribute('aria-hidden', 'true')
		expect(block).toHaveClass('pointer-events-none', 'busy-block')
		expect(block.querySelector('button, a, [tabindex]')).toBeNull()
		expect(block.style.top).toBe(`${13 * 52}px`)
		// It sits beside the overlapping event instead of covering it.
		const sync = screen.getByRole('button', { name: /^Sync/ })
		expect(sync.style.width).toBe('calc(50% - 4px)')
		expect(block.style.width).toBe('calc(50% - 4px)')
		expect(block.style.left).not.toBe(sync.style.left)
		expect(meetWith().dataset.results).toContain('mina@example.com')
	})

	it('removes the blocks when the person is removed', async () => {
		renderControlsWeek()
		fireEvent.click(within(meetWith()).getByText('meet-add-mina'))
		await vi.waitFor(() => expect(blocks()).toHaveLength(1), { timeout: 3000 })
		fireEvent.click(within(meetWith()).getByText('meet-clear'))
		expect(blocks()).toHaveLength(0)
		expect(screen.getByRole('button', { name: /^Sync/ }).style.width).toBe('calc(100% - 4px)')
	})

	it('passes a generic failure to the panel and retries only when asked', async () => {
		h.getFreeBusy.mockRejectedValue(new Error('Availability is temporarily rate limited. Try again shortly.'))
		renderControlsWeek()
		fireEvent.click(within(meetWith()).getByText('meet-add-mina'))
		await vi.waitFor(
			() =>
				expect(meetWith().dataset.error).toBe('Availability is temporarily rate limited. Try again shortly.'),
			{ timeout: 3000 },
		)
		expect(h.getFreeBusy).toHaveBeenCalledOnce()
		expect(blocks()).toHaveLength(0)

		h.getFreeBusy.mockResolvedValue({
			people: [{ email: 'mina@example.com', busy: [busy], unavailable: false }],
		})
		fireEvent.click(within(meetWith()).getByText('meet-retry'))
		await vi.waitFor(() => expect(blocks()).toHaveLength(1), { timeout: 3000 })
		expect(h.getFreeBusy).toHaveBeenCalledTimes(2)
	})

	it('asks for nothing in the month view, which has no time grid to draw on', async () => {
		render(<CalendarRouteScreen view="month" data={monthData()} />)
		expect(meetWith().dataset.shownOnGrid).toBe('false')
		fireEvent.click(within(meetWith()).getByText('meet-add-mina'))
		await new Promise((resolve) => setTimeout(resolve, 600))
		expect(h.getFreeBusy).not.toHaveBeenCalled()
		expect(meetWith().dataset.people).toBe('mina@example.com')
	})

	it('does not carry the chosen people into another inbox', async () => {
		const view = renderControlsWeek()
		fireEvent.click(within(meetWith()).getByText('meet-add-mina'))
		await vi.waitFor(() => expect(blocks()).toHaveLength(1), { timeout: 3000 })
		view.rerender(
			<QueryClientProvider client={new QueryClient()}>
				<CalendarRouteScreen
					view="week"
					data={{ ...richData(), info: { ...info, email: 'other@ownmail.local' } }}
				/>
			</QueryClientProvider>,
		)
		// On that very render: nobody chosen, nothing overlaid.
		expect(meetWith().dataset.people).toBe('')
		expect(blocks()).toHaveLength(0)
	})

	it('offers the same panel in the mobile sheet, with the people already chosen', () => {
		renderControlsWeek()
		fireEvent.click(within(meetWith()).getByText('meet-add-mina'))
		fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
		const panels = screen.getAllByTestId('meet-with')
		expect(panels).toHaveLength(2)
		expect(panels.map((panel) => panel.dataset.people)).toEqual(['mina@example.com', 'mina@example.com'])
	})
})

describe('context menus', () => {
	const invited: Event = {
		id: 'inv1',
		calendar_id: 'cal2',
		title: 'Planning',
		when: { start_time: e('2024-06-15T16:00:00'), end_time: e('2024-06-15T17:00:00') },
		participants: [{ email: info.email, status: 'noreply' }],
		organizer: { email: 'boss@example.com' },
	} as Event
	const shared: Event = {
		id: 'ro1',
		title: 'Company holiday',
		when: { start_time: e('2024-06-15T18:00:00'), end_time: e('2024-06-15T19:00:00') },
		participants: [{ email: info.email, status: 'yes' }],
		organizer: { email: 'hr@example.com' },
		read_only: true,
	} as Event
	const data = () => ({ ...richData(), events: [...richEvents(), invited, shared] })
	const renderWeek = () => render(<CalendarRouteScreen view="week" data={data()} />)
	const pane = () => screen.queryByRole('complementary', { name: 'Event details' })
	const chip = (name: RegExp) => screen.getByRole('button', { name })
	const mobile = () =>
		vi.stubGlobal(
			'matchMedia',
			vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
		)

	function openMenu(trigger: HTMLElement, name: string) {
		fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 })
		return screen.getByRole('menu', { name })
	}
	const item = (name: string) => screen.getByRole('menuitem', { name })
	const names = () => screen.getAllByRole('menuitem').map((element) => element.textContent)

	beforeEach(() => {
		h.rsvpEvent.mockResolvedValue({ ok: true })
	})

	it('opens on an event without selecting it or opening it in the pane', async () => {
		renderWeek()
		chip(/^Standup/).focus()
		const menu = openMenu(chip(/^Standup/), 'Actions for Standup')
		expect(names()).toEqual(['Open', 'Edit', 'Accept', 'Maybe', 'Decline', 'Delete…'])
		// Over the grid the menu is the one glass layer.
		expect(menu).toHaveClass('glass-panel')
		expect(menu).not.toHaveAttribute('data-glass')
		expect(pane()).toBeNull()
		expect(screen.queryByTestId('event-modal')).toBeNull()
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
		expect(chip(/^Standup/)).not.toHaveAttribute('aria-current')
		expect(pane()).toBeNull()
		// Dismissed without a choice: focus is back on the event.
		await vi.waitFor(() => expect(chip(/^Standup/)).toHaveFocus())
	})

	it('keeps a menu opened on an all-day event solid, because the day header it sits in is glass', () => {
		renderWeek()
		const holiday = chip(/^Holiday, All day/)
		expect(holiday.closest('.glass-bar')).toBe(screen.getByTestId('calendar-time-grid-header'))
		const menu = openMenu(holiday, 'Actions for Holiday')
		// One layer deep: the menu opens over the glass bar, so it is opaque.
		expect(menu).toHaveClass('glass-panel')
		expect(menu).toHaveAttribute('data-glass', 'solid')
	})

	it('opens the event the way a click does: in the pane on desktop', async () => {
		renderWeek()
		chip(/^Standup/).focus()
		openMenu(chip(/^Standup/), 'Actions for Standup')
		fireEvent.click(item('Open'))
		// Focus goes to the pane and stays there: the closing menu does not take it back to the event.
		await vi.waitFor(() => expect(pane()).toHaveFocus())
		await new Promise((resolve) => setTimeout(resolve, 30))
		expect(pane()).toHaveFocus()
		expect(screen.getByTestId('event-details').dataset).toMatchObject({
			event: 't1',
			variant: 'panel',
			startOnDelete: 'false',
		})
		expect(chip(/^Standup/)).toHaveAttribute('aria-current', 'true')
		expect(screen.queryByTestId('event-modal')).toBeNull()
	})

	it('opens the editor from Edit without changing what the pane shows', () => {
		renderWeek()
		fireEvent.click(chip(/^Night/))
		openMenu(chip(/^Standup/), 'Actions for Standup')
		fireEvent.click(item('Edit'))
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({
			event: 't1',
			startInEdit: 'true',
			startOnDelete: 'false',
		})
		// The pane still shows the event that was selected before.
		expect(screen.getByTestId('event-details').dataset.event).toBe('t3')
	})

	it('sends Delete to the confirmation in the event view, and deletes nothing itself', () => {
		renderWeek()
		openMenu(chip(/^Standup/), 'Actions for Standup')
		expect(item('Delete…')).toHaveAttribute('data-variant', 'destructive')
		expect(item('Delete…').querySelector('svg')).not.toBeNull()
		fireEvent.click(item('Delete…'))
		expect(screen.getByTestId('event-details').dataset).toMatchObject({ event: 't1', startOnDelete: 'true' })
		expect(screen.queryByTestId('event-modal')).toBeNull()

		// The request names one event: another event, and the same one opened again, show no confirmation.
		fireEvent.click(chip(/^Night/))
		expect(screen.getByTestId('event-details').dataset).toMatchObject({ event: 't3', startOnDelete: 'false' })
		fireEvent.click(chip(/^Standup/))
		expect(screen.getByTestId('event-details').dataset).toMatchObject({ event: 't1', startOnDelete: 'false' })

		// Asking again while it is shown starts its view again on the confirmation.
		openMenu(chip(/^Standup/), 'Actions for Standup')
		fireEvent.click(item('Delete…'))
		expect(screen.getByTestId('event-details').dataset.startOnDelete).toBe('true')
		fireEvent.click(screen.getByText('details-close'))
		fireEvent.click(chip(/^Standup/))
		expect(screen.getByTestId('event-details').dataset.startOnDelete).toBe('false')

		// A confirmed deletion ends the request too.
		openMenu(chip(/^Standup/), 'Actions for Standup')
		fireEvent.click(item('Delete…'))
		fireEvent.click(screen.getByText('details-deleted'))
		openMenu(chip(/^Standup/), 'Actions for Standup')
		fireEvent.click(item('Edit'))
		expect(screen.getByTestId('event-modal').dataset.startOnDelete).toBe('false')
	})

	it('uses the dialog for Open, Edit and Delete on mobile layouts', () => {
		mobile()
		render(<CalendarRouteScreen view="day" data={richData()} />)
		const row = () => screen.getByRole('button', { name: /Standup/ })

		openMenu(row(), 'Actions for Standup')
		// 44px floor for touch.
		expect(item('Open')).toHaveClass('max-md:min-h-11', '[@media(any-pointer:coarse)]:min-h-11')
		fireEvent.click(item('Delete…'))
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({
			event: 't1',
			startInEdit: 'false',
			startOnDelete: 'true',
		})
		fireEvent.click(screen.getByRole('button', { name: 'close-unchanged' }))

		// The request ended with the dialog: a tap opens the plain view.
		fireEvent.click(row())
		expect(screen.getByTestId('event-modal').dataset.startOnDelete).toBe('false')
		fireEvent.click(screen.getByRole('button', { name: 'close-unchanged' }))

		openMenu(row(), 'Actions for Standup')
		fireEvent.click(item('Open'))
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({
			startInEdit: 'false',
			startOnDelete: 'false',
		})
		fireEvent.click(screen.getByRole('button', { name: 'close-unchanged' }))

		openMenu(row(), 'Actions for Standup')
		fireEvent.click(item('Edit'))
		expect(screen.getByTestId('event-modal').dataset.startInEdit).toBe('true')
	})

	it('does not carry a delete request into an event opened from the mobile sheet', () => {
		mobile()
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T08:00:00'))
		try {
			render(<CalendarRouteScreen view="day" data={richData()} />)
			// With events still ahead today, the sidebar agenda lists Standup too; the agenda row is the one with a menu.
			const row = screen
				.getAllByRole('button', { name: /Standup/ })
				.find((button) => button.dataset.slot === 'context-menu-trigger') as HTMLElement
			openMenu(row, 'Actions for Standup')
			fireEvent.click(item('Delete…'))
			fireEvent.click(screen.getByRole('button', { name: 'close-unchanged' }))
			fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
			const sheet = within(screen.getByTestId('sheet'))
			fireEvent.click(sheet.getAllByRole('button', { name: /Standup/ })[0] as HTMLElement)
			expect(screen.getByTestId('event-modal').dataset.startOnDelete).toBe('false')
		} finally {
			vi.useRealTimers()
		}
	})

	it('answers an invitation for the event the menu was opened on', async () => {
		renderWeek()
		openMenu(chip(/^Planning/), 'Actions for Planning')
		fireEvent.click(item('Maybe'))
		await vi.waitFor(() =>
			expect(h.rsvpEvent).toHaveBeenCalledWith({
				data: { eventId: 'inv1', calendarId: 'cal2', status: 'maybe' },
			}),
		)
		// Answering is not opening, and a saved answer needs no message.
		expect(pane()).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('says which event could not be answered when the answer is rolled back', async () => {
		h.rsvpEvent.mockRejectedValue(new Error('provider detail'))
		renderWeek()
		openMenu(chip(/^Planning/), 'Actions for Planning')
		fireEvent.click(item('Decline'))
		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Could not save your answer to “Planning”. It was put back.')
		expect(alert).not.toHaveTextContent('provider detail')
	})

	it('names an untitled event in the failure message', async () => {
		h.rsvpEvent.mockRejectedValue(new Error('offline'))
		render(
			<CalendarRouteScreen
				view="week"
				data={{ ...richData(), events: [{ ...invited, id: 'inv2', title: '' } as Event] }}
			/>,
		)
		openMenu(chip(/^\(untitled\)/), 'Actions for (untitled)')
		fireEvent.click(item('Accept'))
		expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your answer to “(untitled)”.')
	})

	it('shows what an event does not allow as unavailable, by the rule that also blocks dragging it', async () => {
		render(
			<CalendarRouteScreen
				view="week"
				data={{
					...data(),
					calendars: [...calendars, { id: 'cal3', name: 'Holidays', read_only: true }] as Calendar[],
					events: [
						...data().events,
						{
							id: 'h1',
							calendar_id: 'cal3',
							title: 'Bank holiday',
							when: { start_time: e('2024-06-15T20:00:00'), end_time: e('2024-06-15T21:00:00') },
						} as Event,
					],
				}}
			/>,
		)
		// No guests: nothing to answer.
		openMenu(chip(/^Standup/), 'Actions for Standup')
		for (const name of ['Accept', 'Maybe', 'Decline'])
			expect(item(name)).toHaveAttribute('aria-disabled', 'true')
		expect(item('Edit')).not.toHaveAttribute('aria-disabled')
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

		// On a read-only calendar: it cannot be changed.
		openMenu(chip(/^Bank holiday/), 'Actions for Bank holiday')
		expect(item('Edit')).toHaveAttribute('aria-disabled', 'true')
		expect(item('Delete…')).toHaveAttribute('aria-disabled', 'true')
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

		// Read-only itself: it can be answered but not changed. It names no calendar, so the default one is used.
		openMenu(chip(/^Company holiday/), 'Actions for Company holiday')
		expect(item('Edit')).toHaveAttribute('aria-disabled', 'true')
		expect(item('Delete…')).toHaveAttribute('aria-disabled', 'true')
		fireEvent.click(item('Accept'))
		await vi.waitFor(() =>
			expect(h.rsvpEvent).toHaveBeenCalledWith({
				data: { eventId: 'ro1', calendarId: 'cal1', status: 'yes' },
			}),
		)
	})

	it('covers all-day chips', () => {
		renderWeek()
		openMenu(chip(/^Trip/), 'Actions for Trip')
		fireEvent.click(item('Open'))
		expect(screen.getByTestId('event-details').dataset.event).toBe('a2')
	})

	it('gives a draft preview no menu: there is nothing saved to act on', () => {
		renderWeek()
		fireEvent.click(sidebarNewEvent())
		fireEvent.click(screen.getByRole('button', { name: 'show-live-preview' }))
		const preview = screen.getByRole('button', { name: /Live draft/ })
		expect(fireEvent.contextMenu(preview, { clientX: 10, clientY: 10 })).toBe(true)
		expect(screen.queryByRole('menu')).toBeNull()
	})

	it('never starts a drag from a right-click or a Control-click on an event', () => {
		renderWeek()
		const standup = chip(/^Standup/)
		for (const press of [{ button: 2 }, { button: 0, ctrlKey: true }]) {
			fireEvent.pointerDown(standup, { pointerType: 'mouse', clientX: 750, clientY: 500, ...press })
			fireEvent(window, new MouseEvent('pointermove', { clientX: 750, clientY: 560 }))
			expect(standup).not.toHaveAttribute('data-dragging')
			fireEvent(window, new MouseEvent('pointerup', { clientX: 750, clientY: 560 }))
		}
		openMenu(standup, 'Actions for Standup')
		expect(h.updateEvent).not.toHaveBeenCalled()
	})

	it('starts a new event in the empty slot that was right-clicked', async () => {
		renderWeek()
		const slot = screen.getAllByRole('button', { name: /Create event at 9 AM/ })[0] as HTMLElement
		slot.focus()
		openMenu(slot, 'Time slot actions')
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
		await vi.waitFor(() => expect(slot).toHaveFocus())
		openMenu(slot, 'Time slot actions')
		fireEvent.click(item('New event here'))
		// The composer opens once the menu has closed, and the menu does not take focus back.
		const modal = await screen.findByTestId('event-modal')
		expect(modal.dataset.event).toBe('new')
		expect(new Date(modal.dataset.defaultStart as string).getHours()).toBe(9)
		expect(modal.dataset.preserveDefaultStartTime).toBe('true')
	})

	it('leaves the browser menu alone when the press did not land on a slot or an event', () => {
		renderWeek()
		const slot = screen.getAllByRole('button', { name: /Create event at 9 AM/ })[0] as HTMLElement
		const column = slot.parentElement as HTMLElement
		expect(fireEvent.contextMenu(column, { clientX: 10, clientY: 10 })).toBe(true)
		expect(screen.queryByRole('menu')).toBeNull()
		// A touch that starts there never arms the long press; one on a slot does.
		vi.useFakeTimers()
		try {
			fireEvent.pointerDown(column, { pointerType: 'touch' })
			act(() => void vi.advanceTimersByTime(800))
			expect(screen.queryByRole('menu')).toBeNull()
			fireEvent.pointerDown(slot, { pointerType: 'touch' })
			act(() => void vi.advanceTimersByTime(800))
			expect(screen.getByRole('menu', { name: 'Time slot actions' })).toBeInTheDocument()
		} finally {
			vi.useRealTimers()
		}
	})

	it('gives a colleague busy block no menu of its own', async () => {
		h.getFreeBusy.mockResolvedValue({
			people: [
				{
					email: 'mina@example.com',
					busy: [{ start: e('2024-06-15T13:00:00'), end: e('2024-06-15T14:00:00') }],
					unavailable: false,
				},
			],
		})
		renderWeek()
		fireEvent.click(within(screen.getByTestId('meet-with')).getByText('meet-add-mina'))
		await vi.waitFor(() => expect(document.querySelector('[data-busy-block]')).not.toBeNull(), {
			timeout: 3000,
		})
		const block = document.querySelector('[data-busy-block]') as HTMLElement
		// It takes no pointer events, so a right-click lands on the slot beneath it.
		expect(block).toHaveClass('pointer-events-none')
		expect(block).not.toHaveAttribute('data-slot', 'context-menu-trigger')
		expect(block.closest('[data-slot="context-menu-trigger"]')).toHaveAttribute('data-calendar-day-column')
	})

	it('opens the same event menu from a month chip without drilling into the day', () => {
		render(<CalendarRouteScreen view="month" data={monthData()} />)
		openMenu(screen.getByRole('button', { name: /Meeting/ }), 'Actions for Meeting')
		fireEvent.click(item('Edit'))
		expect(screen.getByTestId('event-modal').dataset).toMatchObject({ event: 'm2', startInEdit: 'true' })
		expect(h.navigate).not.toHaveBeenCalled()
	})

	it('hides and shows a calendar from its row, and manages it through the calendar manager', () => {
		renderWeek()
		const row = () => screen.getByRole('button', { name: /^Calendar/ })
		openMenu(row(), 'Actions for Calendar')
		fireEvent.click(item('Hide calendar'))
		expect(row()).toHaveAttribute('aria-pressed', 'false')

		openMenu(row(), 'Actions for Calendar')
		fireEvent.click(item('Show calendar'))
		expect(row()).toHaveAttribute('aria-pressed', 'true')

		openMenu(row(), 'Actions for Calendar')
		fireEvent.click(item('Delete…'))
		expect(screen.getByRole('dialog', { name: 'Calendar manager' })).toHaveAttribute(
			'data-initial-action',
			JSON.stringify({ kind: 'delete', id: 'cal2' }),
		)
		fireEvent.click(screen.getByRole('button', { name: 'close-calendar-manager' }))

		openMenu(row(), 'Actions for Calendar')
		fireEvent.click(item('Rename…'))
		expect(screen.getByRole('dialog', { name: 'Calendar manager' })).toHaveAttribute(
			'data-initial-action',
			JSON.stringify({ kind: 'edit', id: 'cal2' }),
		)
		fireEvent.click(screen.getByRole('button', { name: 'close-calendar-manager' }))

		// The toolbar button still opens the plain list.
		fireEvent.click(screen.getByRole('button', { name: 'Manage calendars' }))
		expect(screen.getByRole('dialog', { name: 'Calendar manager' })).toHaveAttribute(
			'data-initial-action',
			'null',
		)
	})

	it('shows what the calendar manager forbids as unavailable: the primary and read-only calendars', () => {
		render(
			<CalendarRouteScreen
				view="week"
				data={{
					...richData(),
					calendars: [...calendars, { id: 'cal3', name: 'Holidays', read_only: true }] as Calendar[],
				}}
			/>,
		)
		openMenu(screen.getByRole('button', { name: /^Work/ }), 'Actions for Work')
		expect(item('Rename…')).not.toHaveAttribute('aria-disabled')
		expect(item('Delete…')).toHaveAttribute('aria-disabled', 'true')
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

		openMenu(screen.getByRole('button', { name: /^Holidays/ }), 'Actions for Holidays')
		expect(item('Rename…')).toHaveAttribute('aria-disabled', 'true')
		expect(item('Delete…')).toHaveAttribute('aria-disabled', 'true')
		expect(item('Hide calendar')).not.toHaveAttribute('aria-disabled')
	})

	it('keeps calendar shortcuts out of an open menu', () => {
		renderWeek()
		openMenu(chip(/^Standup/), 'Actions for Standup')
		// Typeahead letters inside the menu must not switch the view or start an event.
		for (const key of ['m', 'd', 'n', 't']) fireEvent.keyDown(item('Open'), { key })
		// The same holds for any other menu on the page.
		const otherMenu = document.body.appendChild(document.createElement('div'))
		otherMenu.setAttribute('role', 'menu')
		for (const key of ['m', 'd', 'n', 't']) fireEvent.keyDown(otherMenu, { key })
		otherMenu.remove()
		expect(h.navigate).not.toHaveBeenCalled()
		expect(screen.queryByTestId('event-modal')).toBeNull()
	})
})
