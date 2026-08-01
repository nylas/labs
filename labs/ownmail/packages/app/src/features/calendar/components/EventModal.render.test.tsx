// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, render as testingRender, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventModal } from './EventModal.js'

const { createEvent, deleteEvent, rsvpEvent, updateEvent } = vi.hoisted(() => ({
	createEvent: vi.fn(),
	deleteEvent: vi.fn(),
	rsvpEvent: vi.fn(),
	updateEvent: vi.fn(),
}))

vi.mock('#features/calendar/server/calendar-fns', () => ({
	createEvent,
	deleteEvent,
	rsvpEvent,
	updateEvent,
}))

// The guest field's contact lookup is a server fn; stub it so rendering the
// composer never reaches the network. Guest tests commit addresses directly.
vi.mock('#server/fns', () => ({ searchContacts: vi.fn().mockResolvedValue([]) }))

function render(ui: ReactElement) {
	return testingRender(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			{ui}
		</QueryClientProvider>,
	)
}

// The composer's time pickers are Radix Selects, which need pointer-capture,
// ResizeObserver, and scrollIntoView — none implemented by jsdom.
beforeAll(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	Element.prototype.scrollIntoView = vi.fn()
	Element.prototype.hasPointerCapture = vi.fn(() => false)
	Element.prototype.setPointerCapture = vi.fn()
	Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
	createEvent.mockReset().mockResolvedValue({ eventId: 'new-1' })
	deleteEvent.mockReset().mockResolvedValue({ ok: true })
	rsvpEvent.mockReset().mockResolvedValue({ ok: true })
	updateEvent.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

const defaultStart = new Date(2026, 6, 8, 9, 0, 0)

const calendars = [
	{ id: 'cal1', name: 'Work', hex_color: '#2563eb', is_primary: true },
	{ id: 'cal2', name: '', hex_color: undefined },
] as unknown as Calendar[]

const timedStart = Math.floor(new Date(2026, 6, 8, 10, 0, 0).getTime() / 1000)
const timedEnd = Math.floor(new Date(2026, 6, 8, 11, 0, 0).getTime() / 1000)

function timedEvent(overrides: Partial<Event> = {}): Event {
	return {
		id: 'evt1',
		title: 'Team Sync',
		calendar_id: 'cal1',
		location: 'Room 5',
		description: 'Weekly sync',
		when: { start_time: timedStart, end_time: timedEnd },
		participants: [{ name: 'Bob', email: 'bob@x.com' }, { email: 'no-name@x.com' }],
		organizer: { email: 'org@x.com' },
		read_only: false,
		...overrides,
	} as unknown as Event
}

describe('EventModal — new event', () => {
	it('renders the new-event form and focuses the title field', async () => {
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByRole('heading', { name: 'New event' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
			'h-11',
			'w-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'focus-visible:ring-offset-2',
			'focus-visible:ring-offset-background',
		)
		const cancel = screen.getByRole('button', { name: 'Cancel' })
		const save = screen.getByRole('button', { name: 'Save event' })
		for (const action of [cancel, save, screen.getByRole('button', { name: 'Work' })]) {
			expect(action).toHaveClass(
				'min-h-11',
				'focus-visible:ring-[3px]',
				'focus-visible:ring-ring',
				'focus-visible:ring-offset-2',
				'focus-visible:ring-offset-background',
			)
		}
		expect(save.parentElement).toHaveClass('flex-wrap')
		await waitFor(() => expect(screen.getByPlaceholderText('Add title')).toHaveFocus())
	})

	it('groups the creation flow into clearly labelled, keyboard-accessible sections', () => {
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)

		expect(screen.getByLabelText('Title')).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'When' })).toBeInTheDocument()
		expect(screen.getByRole('checkbox', { name: 'All day' })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Guests' })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument()
	})

	it('saves a new event with the chosen calendar, title, and location', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.type(screen.getByPlaceholderText('Add title'), '  Lunch  ')
		await user.type(screen.getByPlaceholderText('Add location'), 'Cafe')
		// The unnamed calendar falls back to the "Calendar" label; select it.
		await user.click(screen.getByRole('button', { name: 'Calendar' }))
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		expect(createEvent).toHaveBeenCalledTimes(1)
		const payload = createEvent.mock.calls[0][0].data
		expect(payload).toMatchObject({ calendarId: 'cal2', title: 'Lunch', location: 'Cafe' })
	})

	it('includes typed guests as participants and a description when provided', async () => {
		const onClose = vi.fn()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		const user = userEvent.setup()
		await user.type(screen.getByPlaceholderText('Add title'), 'Planning')
		await user.type(screen.getByPlaceholderText('Add description'), 'Agenda: roadmap')
		// A trailing comma commits every address before it as a chip.
		fireEvent.change(screen.getByLabelText('Guests'), {
			target: { value: 'mina@example.com, alex@acme.com,' },
		})
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		const payload = createEvent.mock.calls[0][0].data
		expect(payload).toMatchObject({
			title: 'Planning',
			description: 'Agenda: roadmap',
			participants: ['mina@example.com', 'alex@acme.com'],
		})
	})

	it('defaults an empty title to "Untitled event" and omits an empty location', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="missing"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		const payload = createEvent.mock.calls[0][0].data
		// calendarId "missing" is not in the list -> falls back to the first calendar.
		expect(payload).toMatchObject({ calendarId: 'cal1', title: 'Untitled event' })
		expect(payload).not.toHaveProperty('location')
	})

	it('updates the start and end times from the Select pickers', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		// Pick 11 PM as the start and midnight as the end via the Radix listboxes.
		await user.click(screen.getByRole('combobox', { name: 'Start time' }))
		await user.click(await screen.findByRole('option', { name: '11 PM' }))
		await user.click(screen.getByRole('combobox', { name: 'End time' }))
		await user.click(await screen.findByRole('option', { name: '12 AM' }))
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		const { startTime, endTime } = createEvent.mock.calls[0][0].data
		// 11 PM start, midnight end -> one hour across the date boundary.
		expect(endTime - startTime).toBe(60 * 60)
	})

	it('uses the selected event date when saving a timed event', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2026-07-11' } })
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		const { startTime, endTime } = createEvent.mock.calls[0][0].data
		expect(startTime).toBe(Math.floor(new Date(2026, 6, 11, 9, 0, 0).getTime() / 1000))
		expect(endTime).toBe(Math.floor(new Date(2026, 6, 11, 10, 0, 0).getTime() / 1000))
	})

	it('saves an all-day event with its selected date instead of a timed payload', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('checkbox', { name: 'All day' }))
		fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2026-08-12' } })
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		const payload = createEvent.mock.calls[0][0].data
		expect(payload).toMatchObject({ allDayDate: '2026-08-12' })
		expect(payload).not.toHaveProperty('startTime')
		expect(payload).not.toHaveProperty('endTime')
	})

	it('creates weekly and biweekly recurrences from the repeat controls', async () => {
		const user = userEvent.setup()
		const { unmount } = render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly')
		const monday = screen.getByRole('button', { name: 'Mon' })
		expect(monday).toHaveClass(
			'min-h-11',
			'min-w-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'focus-visible:ring-offset-2',
			'focus-visible:ring-offset-background',
		)
		await user.click(monday)
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		expect(createEvent.mock.calls[0][0].data.recurrence).toMatchObject({
			frequency: 'weekly',
			interval: 1,
			weekdays: expect.arrayContaining(['MO']),
		})

		createEvent.mockClear()
		unmount()
		render(
			<EventModal
				event={null}
				defaultStart={new Date(2026, 6, 8, 10, 0, 0)}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.selectOptions(screen.getByLabelText('Repeat'), 'biweekly')
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		expect(createEvent.mock.calls[0][0].data.recurrence).toMatchObject({
			frequency: 'weekly',
			interval: 2,
		})
	})

	it('requires a weekday before saving a weekly recurrence', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly')
		await user.click(screen.getByRole('button', { name: 'Wed' }))
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		expect(screen.getByText('Choose at least one weekday for a repeating event.')).toBeInTheDocument()
		expect(createEvent).not.toHaveBeenCalled()
	})

	it('uses Sunday as the default weekday for a Sunday recurring event', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={new Date(2026, 6, 12, 10, 0, 0)}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly')
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		expect(createEvent.mock.calls[0][0].data.recurrence).toMatchObject({ weekdays: ['SU'] })
	})

	it('updates an untouched default recurrence weekday when the event date changes', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2026-07-10' } })
		await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly')
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		expect(createEvent.mock.calls[0][0].data.recurrence).toMatchObject({ weekdays: ['FR'] })
	})

	it('requires an explicitly selected recurrence schedule to include the event date weekday', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly')
		await user.click(screen.getByRole('button', { name: 'Wed' }))
		await user.click(screen.getByRole('button', { name: 'Mon' }))
		fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2026-07-10' } })
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		expect(screen.getByText('Include the event date weekday in the repeating schedule.')).toBeInTheDocument()
		expect(createEvent).not.toHaveBeenCalled()
	})

	it('requires a valid event date before saving', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '' } })
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		expect(screen.getByText('Choose a valid event date.')).toBeInTheDocument()
		expect(createEvent).not.toHaveBeenCalled()
	})

	it('creates a yearly recurrence and hides weekday controls', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.selectOptions(screen.getByLabelText('Repeat'), 'yearly')
		expect(screen.queryByRole('button', { name: 'Mon' })).toBeNull()
		await user.click(screen.getByRole('button', { name: 'Save event' }))

		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		expect(createEvent.mock.calls[0][0].data.recurrence).toEqual({ frequency: 'yearly', interval: 1 })
	})

	it('warns when the event draft overlaps an existing event', () => {
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				events={[
					{ id: 'invalid', when: {} } as Event,
					timedEvent({
						id: '__new-event-preview__',
						when: { start_time: timedStart - 30 * 60, end_time: timedStart + 30 * 60 },
					}),
					timedEvent({
						id: 'overlap-one',
						when: { start_time: timedStart - 30 * 60, end_time: timedStart + 30 * 60 },
					}),
					timedEvent({
						id: 'overlap-two',
						when: { start_time: timedStart - 15 * 60, end_time: timedStart + 45 * 60 },
					}),
				]}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByText('May conflict with 2 existing events.')).toBeInTheDocument()
	})

	it('uses singular conflict copy for one overlapping event', () => {
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				events={[
					timedEvent({
						id: 'overlap',
						when: { start_time: timedStart - 30 * 60, end_time: timedStart + 30 * 60 },
					}),
				]}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByText('May conflict with 1 existing event.')).toBeInTheDocument()
	})

	it('publishes the new-event draft and clears it on unmount', async () => {
		const onDraftChange = vi.fn()
		const { unmount } = render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onDraftChange={onDraftChange}
				onClose={vi.fn()}
			/>,
		)
		await waitFor(() => expect(onDraftChange).toHaveBeenCalled())
		expect(onDraftChange.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Untitled event' })

		fireEvent.change(screen.getByPlaceholderText('Add title'), { target: { value: 'Draft title' } })
		await waitFor(() => expect(onDraftChange.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Draft title' }))
		unmount()
		expect(onDraftChange.mock.calls.at(-1)).toEqual([null])
	})

	it('falls back to the passed calendarId when there are no calendars', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="fallback-cal"
				calendarName="Work"
				calendars={[]}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		expect(createEvent.mock.calls[0][0].data.calendarId).toBe('fallback-cal')
	})

	it('shows the error message from a thrown Error and re-enables the form', async () => {
		const user = userEvent.setup()
		createEvent.mockRejectedValueOnce(new Error('server exploded'))
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		expect(
			await screen.findByText('Could not save the event. Check your connection, then try again.'),
		).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Save event' })).not.toBeDisabled()
	})

	it('shows a generic message when a non-Error is thrown', async () => {
		const user = userEvent.setup()
		createEvent.mockRejectedValueOnce('nope')
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		expect(
			await screen.findByText('Could not save the event. Check your connection, then try again.'),
		).toBeInTheDocument()
	})

	it('shows a busy label while the save is in flight', async () => {
		const user = userEvent.setup()
		let resolveSave: (value: unknown) => void = () => {}
		createEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		const saving = await screen.findByRole('button', { name: 'Saving...' })
		expect(saving).toBeDisabled()
		resolveSave({ eventId: 'x' })
	})

	it('does not dismiss the composer with Escape while a save is in flight', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		let resolveSave: (value: unknown) => void = () => {}
		createEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSave = resolve
			}),
		)
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)

		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await screen.findByRole('button', { name: 'Saving...' })
		fireEvent.keyDown(window, { key: 'Escape' })
		expect(onClose).not.toHaveBeenCalled()

		resolveSave({ eventId: 'x' })
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
	})

	it('closes without saving via Cancel', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(onClose).toHaveBeenCalledWith(false)
		expect(createEvent).not.toHaveBeenCalled()
	})

	it('renders the composer as a floating panel (no backdrop) and closes via the X button', () => {
		const onClose = vi.fn()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		const dialog = screen.getByRole('dialog', { name: 'New event' })
		// The composer floats: it positions itself with inline left/top instead of a dimmed backdrop.
		expect(dialog.className).toContain('fixed')
		expect(dialog.style.left).not.toBe('')
		expect(dialog.style.top).not.toBe('')

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it('positions the composer to the right of the anchor slot when one is given', () => {
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				anchorRect={{ top: 100, left: 50, width: 60, height: 40 }}
				onClose={vi.fn()}
			/>,
		)
		const dialog = screen.getByRole('dialog', { name: 'New event' })
		// Anchor right edge (50 + 60) + gap (12) = 122; top aligns with the slot.
		expect(dialog.style.left).toBe('122px')
		expect(dialog.style.top).toBe('100px')
		expect(dialog.style.maxHeight).toBe('calc(100dvh - 108px)')
		expect(dialog.firstElementChild?.nextElementSibling?.nextElementSibling).toHaveClass(
			'overflow-y-auto',
			'overscroll-contain',
		)
	})

	it('keeps the composer within the viewport after a resize', () => {
		const originalWidth = window.innerWidth
		const originalHeight = window.innerHeight
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })
		Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
		try {
			render(
				<EventModal
					event={null}
					defaultStart={defaultStart}
					calendarId="cal1"
					calendarName="Work"
					calendars={calendars}
					anchorRect={{ top: 100, left: 50, width: 60, height: 40 }}
					onClose={vi.fn()}
				/>,
			)
			const dialog = screen.getByRole('dialog', { name: 'New event' })
			fireEvent(window, new Event('resize'))

			expect(dialog.style.left).toBe('12px')
			expect(dialog.style.top).toBe('8px')
			expect(dialog.style.maxHeight).toBe('calc(100dvh - 16px)')
		} finally {
			Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
			Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
		}
	})

	it('closes the floating composer on Escape but ignores other keys', () => {
		const onClose = vi.fn()
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		fireEvent.keyDown(window, { key: 'a' })
		expect(onClose).not.toHaveBeenCalled()
		fireEvent.keyDown(window, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it('drags the composer by its header and stops tracking on pointer up', () => {
		render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				anchorRect={{ top: 100, left: 50, width: 60, height: 40 }}
				onClose={vi.fn()}
			/>,
		)
		const dialog = screen.getByRole('dialog', { name: 'New event' })
		// Grab the header (the heading bubbles the pointerdown to the draggable row).
		fireEvent.pointerDown(screen.getByRole('heading', { name: 'New event' }), { clientX: 200, clientY: 200 })
		fireEvent.pointerMove(window, { clientX: 240, clientY: 230 })
		// Started at 122,100; moved by (+40, +30), with the taller composer
		// clamped to the viewport's bottom margin.
		expect(dialog.style.left).toBe('162px')
		expect(dialog.style.top).toBe('120px')

		fireEvent.pointerUp(window)
		// After release the move listeners are detached, so further motion is ignored.
		fireEvent.pointerMove(window, { clientX: 900, clientY: 900 })
		expect(dialog.style.left).toBe('162px')
		expect(dialog.style.top).toBe('120px')
	})

	it('tears down an in-flight drag when the composer unmounts', () => {
		const { unmount } = render(
			<EventModal
				event={null}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		fireEvent.pointerDown(screen.getByRole('heading', { name: 'New event' }), { clientX: 100, clientY: 100 })
		// Unmounting mid-drag must run cleanup without throwing and detach the window listeners.
		expect(() => unmount()).not.toThrow()
		fireEvent.pointerMove(window, { clientX: 500, clientY: 500 })
	})
})

describe('EventModal — existing event', () => {
	it('renders full event details for a timed event with attendees and description', () => {
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work calendar"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByRole('heading', { name: 'Team Sync' })).toBeInTheDocument()
		expect(screen.getByText('Work calendar')).toBeInTheDocument()
		expect(screen.getByText('Room 5')).toBeInTheDocument()
		expect(screen.getByText('Bob, no-name@x.com')).toBeInTheDocument()
		expect(screen.getByText('Weekly sync')).toBeInTheDocument()
		// Timed events show a start–end range rather than "All day".
		expect(screen.queryByText('All day')).toBeNull()
	})

	it('keeps event actions touch-friendly, focus-visible, and able to wrap', async () => {
		const user = userEvent.setup()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work calendar"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)

		const expectTouchAction = (button: HTMLElement) => {
			expect(button).toHaveClass(
				'min-h-11',
				'focus-visible:outline-none',
				'focus-visible:ring-[3px]',
				'focus-visible:ring-ring',
				'focus-visible:ring-offset-2',
				'focus-visible:ring-offset-background',
			)
		}
		const close = screen.getByRole('button', { name: 'Close' })
		expect(close).toHaveClass(
			'h-11',
			'w-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'focus-visible:ring-offset-2',
			'focus-visible:ring-offset-background',
		)
		for (const name of ['✓ Yes', '? Maybe', '✗ No', 'Edit', 'Delete', 'Done']) {
			expectTouchAction(screen.getByRole('button', { name }))
		}
		expect(screen.getByRole('button', { name: 'Done' }).parentElement).toHaveClass('flex-wrap')

		await user.click(screen.getByRole('button', { name: 'Edit' }))
		expectTouchAction(screen.getByRole('button', { name: 'Cancel' }))
		expectTouchAction(screen.getByRole('button', { name: 'Save changes' }))
		await user.click(screen.getByRole('button', { name: 'Cancel' }))

		await user.click(screen.getByRole('button', { name: 'Delete' }))
		expectTouchAction(screen.getByRole('button', { name: 'Cancel' }))
		expectTouchAction(screen.getByRole('button', { name: 'Delete event' }))
	})

	it('shows "All day" and the untitled fallback for a bare all-day event', () => {
		render(
			<EventModal
				event={
					{
						id: 'evt2',
						title: '',
						calendar_id: 'cal-unknown',
						when: { date: '2026-07-08' },
						read_only: true,
					} as unknown as Event
				}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByText('All day')).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: '(untitled)' })).toBeInTheDocument()
		// Read-only event hides the delete control; no attendees/location/description rows.
		expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
		expect(screen.queryByText('Room 5')).toBeNull()
	})

	it('does not offer RSVP when the event lacks participants or an organizer', () => {
		render(
			<EventModal
				event={timedEvent({ participants: [], organizer: undefined })}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.queryByRole('button', { name: '✓ Yes' })).toBeNull()
	})

	it('sends an RSVP and closes on success', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		expect(screen.getByRole('button', { name: '? Maybe' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: '✗ No' })).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: '✓ Yes' }))
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		expect(rsvpEvent).toHaveBeenCalledWith({
			data: { eventId: 'evt1', calendarId: 'cal1', status: 'yes' },
		})
	})

	it('falls back to the passed calendarId when RSVPing an event without a calendar_id', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent({ calendar_id: undefined })}
				defaultStart={defaultStart}
				calendarId="cal-default"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: '✓ Yes' }))
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		expect(rsvpEvent).toHaveBeenCalledWith({
			data: { eventId: 'evt1', calendarId: 'cal-default', status: 'yes' },
		})
	})

	it('closes the details view via the header close (X) button', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Close' }))
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it('surfaces an RSVP failure without closing', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		rsvpEvent.mockRejectedValueOnce(new Error('rsvp blew up'))
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: '✓ Yes' }))
		expect(await screen.findByText('RSVP failed')).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()
	})

	it('deletes an editable event and closes on success', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent({ calendar_id: undefined })}
				defaultStart={defaultStart}
				calendarId="cal-default"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		expect(deleteEvent).not.toHaveBeenCalled()
		await user.click(screen.getByRole('button', { name: 'Delete event' }))
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		// Missing calendar_id falls back to the passed calendarId.
		expect(deleteEvent).toHaveBeenCalledWith({
			data: { eventId: 'evt1', calendarId: 'cal-default' },
		})
	})

	it('cancels event deletion and returns focus without mutating', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		expect(screen.getByRole('group', { name: /Delete this event\?/ })).toBeInTheDocument()
		expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
		await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
		expect(deleteEvent).not.toHaveBeenCalled()

		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus())
		expect(screen.queryByRole('group', { name: /Delete this event\?/ })).not.toBeInTheDocument()
		expect(deleteEvent).not.toHaveBeenCalled()
		expect(onClose).not.toHaveBeenCalled()
	})

	it('uses Escape to cancel confirmation before dismissing the event', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
		await user.keyboard('{Escape}')
		await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus())
		expect(deleteEvent).not.toHaveBeenCalled()
		expect(onClose).not.toHaveBeenCalled()
	})

	it('locks confirmation while deletion is pending', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		let resolveDelete: (value: { ok: true }) => void = () => {}
		deleteEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveDelete = resolve
			}),
		)
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		const confirmDelete = screen.getByRole('button', { name: 'Delete event' })
		fireEvent.click(confirmDelete)
		fireEvent.click(confirmDelete)
		await waitFor(() => expect(deleteEvent).toHaveBeenCalledTimes(1))
		expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
		await user.keyboard('{Escape}')
		expect(screen.getByRole('group', { name: /Delete this event\?/ })).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()

		resolveDelete({ ok: true })
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		expect(deleteEvent).toHaveBeenCalledTimes(1)
	})

	it('surfaces a delete failure (non-Error) without closing', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		deleteEvent.mockRejectedValueOnce('boom')
		let resolveRetry: (value: { ok: true }) => void = () => {}
		deleteEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRetry = resolve
			}),
		)
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByRole('button', { name: 'Delete event' }))
		expect(await screen.findByRole('alert')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Delete event' })).toBeEnabled()
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
		expect(onClose).not.toHaveBeenCalled()

		await user.click(screen.getByRole('button', { name: 'Delete event' }))
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
		expect(deleteEvent).toHaveBeenCalledTimes(2)
		resolveRetry({ ok: true })
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
	})

	it('surfaces a delete failure message from a thrown Error', async () => {
		const user = userEvent.setup()
		deleteEvent.mockRejectedValueOnce(new Error('delete blew up'))
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByRole('button', { name: 'Delete event' }))
		expect(
			await screen.findByText('Could not delete the event. Check your connection, then try again.'),
		).toBeInTheDocument()
	})

	it('surfaces a generic RSVP failure when a non-Error is thrown', async () => {
		const user = userEvent.setup()
		rsvpEvent.mockRejectedValueOnce('nope')
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={vi.fn()}
			/>,
		)
		await user.click(screen.getByRole('button', { name: '✓ Yes' }))
		expect(await screen.findByText('RSVP failed')).toBeInTheDocument()
	})

	it('closes via the Done button', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		await user.click(screen.getByRole('button', { name: 'Done' }))
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it('closes the details view on Escape via the dialog dismiss layer', () => {
		const onClose = vi.fn()
		render(
			<EventModal
				event={timedEvent()}
				defaultStart={defaultStart}
				calendarId="cal1"
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		fireEvent.keyDown(document.body, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledWith(false)
	})
})

describe('EventModal — editing an existing event', () => {
	function renderEdit(overrides: Partial<Event> = {}, onClose = vi.fn(), calendarId = 'cal1') {
		render(
			<EventModal
				event={timedEvent(overrides)}
				defaultStart={defaultStart}
				calendarId={calendarId}
				calendarName="Work"
				calendars={calendars}
				onClose={onClose}
			/>,
		)
		return onClose
	}

	it('opens the edit form prefilled and saves changes via updateEvent', async () => {
		const user = userEvent.setup()
		const onClose = renderEdit()
		await user.click(screen.getByRole('button', { name: /Edit/ }))

		const titleField = screen.getByLabelText('Title') as HTMLInputElement
		expect(titleField.value).toBe('Team Sync')
		expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('Room 5')
		expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Weekly sync')

		await user.clear(titleField)
		await user.type(titleField, 'Team Sync v2')
		await user.click(screen.getByRole('button', { name: 'Save changes' }))

		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		expect(updateEvent).toHaveBeenCalledTimes(1)
		expect(updateEvent.mock.calls[0][0].data).toMatchObject({
			eventId: 'evt1',
			calendarId: 'cal1',
			title: 'Team Sync v2',
			location: 'Room 5',
			description: 'Weekly sync',
		})
	})

	it('cancels editing and returns to the read view without calling updateEvent', async () => {
		const user = userEvent.setup()
		renderEdit()
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		// Back to the read view: the Edit affordance and event title heading return.
		expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Team Sync' })).toBeInTheDocument()
		expect(updateEvent).not.toHaveBeenCalled()
	})

	it('does not offer editing for a read-only event', () => {
		renderEdit({ read_only: true })
		expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
	})

	it('defaults an emptied title to "Untitled event"', async () => {
		const user = userEvent.setup()
		renderEdit()
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		await user.clear(screen.getByLabelText('Title'))
		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		await waitFor(() => expect(updateEvent).toHaveBeenCalled())
		expect(updateEvent.mock.calls[0][0].data.title).toBe('Untitled event')
	})

	it('falls back to the passed calendarId when the event lacks one', async () => {
		const user = userEvent.setup()
		renderEdit({ calendar_id: undefined }, vi.fn(), 'cal-default')
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		await waitFor(() => expect(updateEvent).toHaveBeenCalled())
		expect(updateEvent.mock.calls[0][0].data.calendarId).toBe('cal-default')
	})

	it('preserves an all-day event when saving its metadata', async () => {
		const user = userEvent.setup()
		renderEdit({ when: { date: '2026-07-09' } as never })
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		expect(screen.queryByRole('combobox', { name: 'Start time' })).toBeNull()
		await user.clear(screen.getByLabelText('Title'))
		await user.type(screen.getByLabelText('Title'), 'Day off')
		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		await waitFor(() => expect(updateEvent).toHaveBeenCalled())
		const payload = updateEvent.mock.calls[0][0].data
		expect(payload).toMatchObject({ eventId: 'evt1', title: 'Day off' })
		expect(payload).not.toHaveProperty('startTime')
		expect(payload).not.toHaveProperty('endTime')
	})

	it('surfaces an update failure from a thrown Error and re-enables the form', async () => {
		const user = userEvent.setup()
		updateEvent.mockRejectedValueOnce(new Error('update failed'))
		renderEdit()
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		expect(
			await screen.findByText('Could not save the event. Check your connection, then try again.'),
		).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled()
	})

	it('shows a generic message when a non-Error is thrown on update', async () => {
		const user = userEvent.setup()
		updateEvent.mockRejectedValueOnce('nope')
		renderEdit()
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		expect(
			await screen.findByText('Could not save the event. Check your connection, then try again.'),
		).toBeInTheDocument()
	})

	it('shows a busy label while the update is in flight', async () => {
		const user = userEvent.setup()
		let resolveUpdate: (value: unknown) => void = () => {}
		updateEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveUpdate = resolve
			}),
		)
		renderEdit()
		await user.click(screen.getByRole('button', { name: /Edit/ }))
		await user.click(screen.getByRole('button', { name: 'Save changes' }))
		const saving = await screen.findByRole('button', { name: 'Saving...' })
		expect(saving).toBeDisabled()
		resolveUpdate({ ok: true })
	})
})
