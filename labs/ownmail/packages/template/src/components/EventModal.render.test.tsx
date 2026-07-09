// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventModal } from './EventModal.js'

const { createEvent, deleteEvent, rsvpEvent } = vi.hoisted(() => ({
	createEvent: vi.fn(),
	deleteEvent: vi.fn(),
	rsvpEvent: vi.fn(),
}))

vi.mock('../server/calendar-fns.js', () => ({ createEvent, deleteEvent, rsvpEvent }))

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
		// Pick 8 AM as the start and 11 AM as the end via the Radix listboxes.
		await user.click(screen.getByRole('combobox', { name: 'Start time' }))
		await user.click(await screen.findByRole('option', { name: '8 AM' }))
		await user.click(screen.getByRole('combobox', { name: 'End time' }))
		await user.click(await screen.findByRole('option', { name: '11 AM' }))
		await user.click(screen.getByRole('button', { name: 'Save event' }))
		await waitFor(() => expect(createEvent).toHaveBeenCalled())
		const { startTime, endTime } = createEvent.mock.calls[0][0].data
		// 8 AM start, 11 AM end -> 3 hours apart.
		expect(endTime - startTime).toBe(3 * 60 * 60)
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
		// Started at 122,100; moved by (+40, +30).
		expect(dialog.style.left).toBe('162px')
		expect(dialog.style.top).toBe('130px')

		fireEvent.pointerUp(window)
		// After release the move listeners are detached, so further motion is ignored.
		fireEvent.pointerMove(window, { clientX: 900, clientY: 900 })
		expect(dialog.style.left).toBe('162px')
		expect(dialog.style.top).toBe('130px')
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
