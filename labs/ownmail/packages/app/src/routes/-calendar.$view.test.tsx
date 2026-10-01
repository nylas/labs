// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, render as testingRender, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ymd } from '#features/calendar/lib/calendar'

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

vi.mock('#features/calendar/components/CalendarManagerDialog', () => ({
	CalendarManagerDialog: (props: any) => (
		<div role="dialog" aria-label="Calendar manager">
			<button type="button" onClick={() => props.onDeleted('cal2')}>
				delete-cal2
			</button>
			<button type="button" onClick={props.onClose}>
				close-calendar-manager
			</button>
		</div>
	),
}))

import { CalendarRouteScreen, loadCalendarRouteData, Route } from './calendar.$view.js'

// ---- fixtures -------------------------------------------------------------

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
		expect(refreshRow?.parentElement).toHaveClass('border-t', 'pt-3')
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

	it('keeps every calendar action available in the 320px mobile header', () => {
		renderWeek()

		const controls = screen.getByTestId('calendar-header-controls')
		expect(controls.closest('.app-chrome-row')).toHaveClass('calendar-chrome-row')
		expect(controls).toHaveClass('grid', 'min-w-0', 'sm:flex')
		expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
		expect(screen.getByRole('button', { name: 'Create' })).toHaveClass(
			'size-11',
			'sm:w-auto',
			'touch-target-square',
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
		expect(screen.getByRole('status')).toHaveTextContent('Some events could not be loaded')
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
		// Short zone names, not the first word of the city ("New" for New York).
		expect(ruler).toHaveTextContent(/E[SD]T/)
		expect(ruler).toHaveTextContent(/GMT|BST/)
		expect(ruler).not.toHaveTextContent('Toronto')
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

	it('opens the editor from a timed event with its calendar name resolved', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /Standup/ }))
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset.event).toBe('t1')
		expect(modal.dataset.calendarName).toBe('Work')
	})

	it('opens the editor from an all-day event', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /^Trip/ }))
		expect(screen.getByTestId('event-modal').dataset.event).toBe('a2')
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
		expect(screen.getByTestId('event-modal').dataset.event).toBe('m2')
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
		expect(screen.getByTestId('event-modal').dataset.event).toBe('m2')
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
		fireEvent.click(screen.getByRole('button', { name: 'Create' }))
		const modal = screen.getByTestId('event-modal')
		expect(modal.dataset.event).toBe('new')
		expect(modal.dataset.calendarName).toBe('Primary Cal')
	})

	it('renders a live composer draft alongside saved events with preview styling', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Create' }))
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
		expect(screen.getByTestId('event-modal').dataset.calendarName).toBe('Primary Cal')
	})

	it('falls back to the primary calendar name for an event with no calendar id', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: /Solo/ }))
		expect(screen.getByTestId('event-modal').dataset.calendarName).toBe('Primary Cal')
	})

	it('closes after the editor reports a cached change', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Create' }))
		fireEvent.click(screen.getByText('close-changed'))
		expect(screen.queryByTestId('event-modal')).toBeNull()
		expect(h.invalidate).not.toHaveBeenCalled()
	})

	it('does not revalidate when the editor closes unchanged', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Create' }))
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
