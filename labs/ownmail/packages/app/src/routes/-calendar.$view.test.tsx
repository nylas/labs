// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ymd } from '../components/calendar.js'

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
	useNavigate: () => h.navigate,
	useRouter: () => ({ invalidate: h.invalidate }),
}))

vi.mock('../server/calendar-fns.js', () => ({ getEvents: (args: any) => h.getEvents(args) }))
vi.mock('../server/fns.js', () => ({ getMailboxInfo: () => h.getMailboxInfo() }))

// The chrome/dialog children own their own render tests; stub them to observable markers
// so this suite stays focused on the calendar grid + navigation logic.
vi.mock('../components/AppRail.js', () => ({
	AppRailLogo: (props: any) => <div data-testid="app-rail-logo">{props.appName}</div>,
	AppRailNav: (props: any) => (
		<div data-testid="app-rail-nav" data-active={props.active}>
			<button type="button" onClick={props.onOpenCommandPalette}>
				open-palette
			</button>
		</div>
	),
}))

vi.mock('../components/CommandPalette.js', () => ({
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

vi.mock('../components/Sheet.js', () => ({
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

vi.mock('../components/EventModal.js', () => ({
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

import { CalendarRouteScreen, loadCalendarRouteData, Route } from './calendar.$view.js'

// ---- fixtures -------------------------------------------------------------

const e = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

const info = { appName: 'OwnMail', email: 'user@ownmail.local', displayName: 'Test User' }
const calendars: Calendar[] = [
	{ id: 'cal1', name: 'Work', hex_color: '#3b82f6' },
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
})

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	localStorage.clear()
})
beforeEach(() => {
	vi.clearAllMocks()
	h.getEvents.mockResolvedValue({ calendar: primaryCalendar, calendars, events: [] })
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
		h.getEvents.mockResolvedValue({ calendar: primaryCalendar, calendars, events: richEvents() })
		const result = await Route.options.loader({ params: { view: 'week' }, deps: { date: '2024-06-15' } })
		expect(h.getMailboxInfo).toHaveBeenCalledOnce()
		expect(h.getEvents).toHaveBeenCalledOnce()
		expect(result.info).toEqual(info)
		expect(result.anchorIso).toBe('2024-06-15')
		expect(result.events).toHaveLength(7)
	})
})

describe('loadCalendarRouteData', () => {
	it('anchors on the requested date and buffers the fetched range for display timezone boundaries', async () => {
		const data = await loadCalendarRouteData('week', '2024-06-15')
		expect(data.anchorIso).toBe('2024-06-15')
		const arg = h.getEvents.mock.calls[0][0]
		expect(arg.data).toEqual({
			start: Math.floor(new Date('2024-06-08T00:00:00').getTime() / 1000),
			end: Math.floor(new Date('2024-06-17T00:00:00').getTime() / 1000),
		})
	})

	it('falls back to today when no date is supplied', async () => {
		const data = await loadCalendarRouteData('month')
		expect(data.anchorIso).toBe(ymd(new Date()))
		expect(h.getEvents).toHaveBeenCalledOnce()
	})
})

describe('CalendarViewRoutePage wrapper', () => {
	it('feeds the params view + loader data straight into the screen', () => {
		Route.useParams = vi.fn(() => ({ view: 'week' }))
		Route.useLoaderData = vi.fn(() => richData())
		const Page = Route.options.component
		render(<Page />)
		expect(screen.getByTestId('app-rail-logo').textContent).toBe('OwnMail')
		expect(screen.getByRole('button', { name: 'week' })).toHaveAttribute('aria-pressed', 'true')
	})
})

// ---- week view (route navigation) -----------------------------------------

describe('week view + header navigation', () => {
	const renderWeek = (data = richData()) => render(<CalendarRouteScreen view="week" data={data} />)

	it('renders the week title and marks the week view as active', () => {
		renderWeek()
		expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Jun')
		expect(screen.getByRole('button', { name: 'week' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: 'day' })).toHaveAttribute('aria-pressed', 'false')
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

	it('switches to the month and day views from the view toggle', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'month' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'month' },
			search: { date: '2024-06-15' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'day' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-15' },
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
		expect(screen.getByText('June 2024')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
		expect(screen.getByText('May 2024')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
		fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
		expect(screen.getByText('July 2024')).toBeInTheDocument()
		expect(h.navigate).not.toHaveBeenCalled()
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

describe('week view calendar list', () => {
	it('toggles a calendar off and back on, hiding its events in between', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		const workToggle = screen.getByRole('button', { name: 'Work' })
		expect(workToggle).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: /Standup/ })).toBeInTheDocument()
		fireEvent.click(workToggle)
		expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'false')
		expect(screen.queryByRole('button', { name: /Standup/ })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Work' }))
		expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: /Standup/ })).toBeInTheDocument()
	})

	it('labels an unnamed calendar as "Calendar"', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument()
	})
})

describe('week view time grid', () => {
	const renderWeek = () => render(<CalendarRouteScreen view="week" data={richData()} />)

	it('renders an all-day band with single-day and multi-day segments', () => {
		renderWeek()
		expect(screen.getByText('All day')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Holiday' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument()
	})

	it('shows a tall timed event with its time range but drops the range for a short one', () => {
		renderWeek()
		const standup = screen.getByRole('button', { name: /Standup/ })
		expect(standup.textContent).toContain('9 AM')
		expect(standup.textContent).toContain('10 AM')
		// The 5-minute event is too short to show a time range and has no title.
		const untitled = screen.getByRole('button', { name: '(untitled)' })
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
		expect(ruler).toHaveTextContent('Toronto')
		expect(ruler).toHaveTextContent('London')
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
		fireEvent.click(screen.getByRole('button', { name: 'Trip' }))
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

	it('labels an untitled all-day event in the band', () => {
		const data = {
			...richData(),
			events: [{ id: 'ad', calendar_id: 'cal1', title: '', when: { date: '2024-06-15' } }] as Event[],
		}
		render(<CalendarRouteScreen view="day" data={data} />)
		expect(screen.getByRole('button', { name: '(untitled)' })).toBeInTheDocument()
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
		expect(monthTodayCell?.className).toContain('bg-primary')
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

	it('marks today and the anchor date distinctly in the mini calendar', () => {
		renderMonth()
		const miniToday = screen.getAllByText('15').find((el) => el.tagName === 'BUTTON')
		expect(miniToday?.className).toContain('bg-primary')
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

	it('draws the now line on the current day when the hour is in view', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		const { container } = render(<CalendarRouteScreen view="day" data={richData('2024-06-15')} />)
		expect(container.querySelector('.bg-destructive')).not.toBeNull()
	})

	it('draws the now line for an early-morning hour', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T05:00:00'))
		const { container } = render(<CalendarRouteScreen view="day" data={richData('2024-06-15')} />)
		expect(container.querySelector('.bg-destructive')).not.toBeNull()
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
		expect(preview).toHaveClass('border-dashed')
		expect(preview).toBeDisabled()
		expect(saved).not.toHaveClass('border-dashed')
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

	it('revalidates the route only when the editor reports a change', () => {
		renderWeek()
		fireEvent.click(screen.getByRole('button', { name: 'Create' }))
		fireEvent.click(screen.getByText('close-changed'))
		expect(screen.queryByTestId('event-modal')).toBeNull()
		expect(h.invalidate).toHaveBeenCalledOnce()
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
	afterEach(() => {
		vi.useRealTimers()
	})

	it('opens the sheet and re-anchors the grid when a sheet date is picked', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open calendar sidebar' }))
		const sheet = screen.getByTestId('sheet')
		fireEvent.click(within(sheet).getByRole('button', { name: '10' }))
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
		fireEvent.click(screen.getByRole('button', { name: 'Open calendar sidebar' }))
		const sheet = screen.getByTestId('sheet')
		fireEvent.click(within(sheet).getByRole('button', { name: '12' }))
		expect(h.navigate).toHaveBeenCalledWith({
			to: '/calendar/$view',
			params: { view: 'day' },
			search: { date: '2024-06-12' },
		})
	})

	it('dismisses the sheet via its own close control', () => {
		render(<CalendarRouteScreen view="week" data={richData()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open calendar sidebar' }))
		const sheet = screen.getByTestId('sheet')
		fireEvent.click(within(sheet).getByRole('button', { name: 'close-sheet' }))
		expect(screen.queryByTestId('sheet')).toBeNull()
	})

	it('opens an event editor from the sheet agenda and closes the sheet', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2024-06-15T10:30:00'))
		render(<CalendarRouteScreen view="week" data={richData('2024-06-15')} />)
		fireEvent.click(screen.getByRole('button', { name: 'Open calendar sidebar' }))
		const sheet = screen.getByTestId('sheet')
		// The agenda lists the day's timed events; open the first one.
		fireEvent.click(within(sheet).getByRole('button', { name: /Standup/ }))
		expect(screen.getByTestId('event-modal').dataset.event).toBe('t1')
		expect(screen.queryByTestId('sheet')).toBeNull()
	})
})

// ---- week title formatting ------------------------------------------------

describe('week title formatting', () => {
	const titleFor = (anchorIso: string) => {
		render(<CalendarRouteScreen view="week" data={richData(anchorIso)} />)
		return screen.getByRole('heading', { level: 1 }).textContent ?? ''
	}

	it('collapses a same-month week to a single month label', () => {
		expect(titleFor('2024-06-15')).toMatch(/Jun 9 – 15, 2024/)
		cleanup()
	})

	it('spells out both months for a week that crosses a month boundary', () => {
		expect(titleFor('2024-05-30')).toMatch(/May 26 – Jun 1, 2024/)
		cleanup()
	})

	it('spells out both years for a week that crosses a year boundary', () => {
		expect(titleFor('2024-12-31')).toMatch(/Dec 29, 2024 – Jan 4, 2025/)
		cleanup()
	})
})
