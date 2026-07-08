// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventModal } from './EventModal.js'

const { createEvent, deleteEvent, rsvpEvent } = vi.hoisted(() => ({
	createEvent: vi.fn(),
	deleteEvent: vi.fn(),
	rsvpEvent: vi.fn(),
}))

vi.mock('../server/calendar-fns.js', () => ({ createEvent, deleteEvent, rsvpEvent }))

beforeEach(() => {
	createEvent.mockReset().mockResolvedValue({ eventId: 'new-1' })
	deleteEvent.mockReset().mockResolvedValue({ ok: true })
	rsvpEvent.mockReset().mockResolvedValue({ ok: true })
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
		await waitFor(() => expect(screen.getByPlaceholderText('Add title')).toHaveFocus())
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

	it('updates the start and end times from the selects', async () => {
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
		const selects = screen.getAllByRole('combobox')
		await user.selectOptions(selects[0], '8')
		await user.selectOptions(selects[1], '9.5')
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		const { startTime, endTime } = createEvent.mock.calls[0][0].data
		expect(endTime).toBeGreaterThan(startTime)
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
		expect(await screen.findByText('server exploded')).toBeInTheDocument()
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
		expect(await screen.findByText('Failed to save')).toBeInTheDocument()
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

	it('closes on the X button and on a backdrop click, but not on an in-dialog click', () => {
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
		const dialog = screen.getByRole('dialog')
		const backdrop = dialog.parentElement as HTMLElement

		// Clicking inside the dialog (target !== backdrop) must not close.
		fireEvent.click(dialog)
		expect(onClose).not.toHaveBeenCalled()

		// Clicking the backdrop itself closes.
		fireEvent.click(backdrop)
		expect(onClose).toHaveBeenCalledWith(false)

		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(onClose).toHaveBeenCalledTimes(2)
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
		expect(await screen.findByText('rsvp blew up')).toBeInTheDocument()
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
		await user.click(screen.getByRole('button', { name: /Delete/ }))
		await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
		// Missing calendar_id falls back to the passed calendarId.
		expect(deleteEvent).toHaveBeenCalledWith({
			data: { eventId: 'evt1', calendarId: 'cal-default' },
		})
	})

	it('surfaces a delete failure (non-Error) without closing', async () => {
		const user = userEvent.setup()
		const onClose = vi.fn()
		deleteEvent.mockRejectedValueOnce('boom')
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
		await user.click(screen.getByRole('button', { name: /Delete/ }))
		expect(await screen.findByText('Failed to delete')).toBeInTheDocument()
		expect(onClose).not.toHaveBeenCalled()
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
		await user.click(screen.getByRole('button', { name: /Delete/ }))
		expect(await screen.findByText('delete blew up')).toBeInTheDocument()
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

	it('closes on a backdrop click for the details view', () => {
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
		const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
		fireEvent.click(backdrop)
		expect(onClose).toHaveBeenCalledWith(false)
	})
})
