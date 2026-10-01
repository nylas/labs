// @vitest-environment jsdom
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, render as testingRender, waitFor } from '@testing-library/react'
import { createRef, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventDetails, type EventDetailsHandle } from './EventDetails.js'

const { deleteEvent, rsvpEvent } = vi.hoisted(() => ({ deleteEvent: vi.fn(), rsvpEvent: vi.fn() }))

vi.mock('#features/calendar/server/calendar-fns', () => ({ deleteEvent, rsvpEvent }))

function render(ui: ReactElement) {
	return testingRender(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			{ui}
		</QueryClientProvider>,
	)
}

beforeEach(() => {
	deleteEvent.mockReset().mockResolvedValue({ ok: true })
	rsvpEvent.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

const calendars = [{ id: 'cal1', name: 'Work', hex_color: '#2563eb' }] as Calendar[]
const start = Math.floor(new Date(2026, 6, 8, 10, 0, 0).getTime() / 1000)

function invitation(overrides: Partial<Event> = {}): Event {
	return {
		id: 'evt1',
		title: 'Team Sync',
		calendar_id: 'cal1',
		when: { start_time: start, end_time: start + 3600 },
		participants: [
			{ email: 'bob@x.com', status: 'yes' },
			{ email: 'me@x.com', status: 'maybe' },
		],
		organizer: { email: 'bob@x.com' },
		...overrides,
	} as Event
}

function renderPanel(event = invitation(), props: Partial<Parameters<typeof EventDetails>[0]> = {}) {
	const handlers = { onEdit: vi.fn(), onClose: vi.fn(), onRsvped: vi.fn(), onDeleted: vi.fn() }
	const ref = createRef<EventDetailsHandle>()
	const view = render(
		<EventDetails
			ref={ref}
			event={event}
			calendarId="cal1"
			calendarName="Work"
			calendars={calendars}
			email="me@x.com"
			variant="panel"
			{...handlers}
			{...props}
		/>,
	)
	return { ...handlers, ref, ...view }
}

describe('EventDetails in the desktop pane', () => {
	it('shows the event with the pane gutter and no Done button, since the pane has its own close', () => {
		const { container } = renderPanel()
		expect(screen.getByRole('heading', { name: 'Team Sync' })).toBeInTheDocument()
		expect(screen.getByText('10 AM – 11 AM')).toBeInTheDocument()
		// A pane uses the 16px region gutter; the 20px gutter is reserved for dialogs.
		expect(container.querySelector('.px-5')).toBeNull()
		expect(screen.getByRole('heading', { name: 'Team Sync' }).closest('.px-region')).not.toBeNull()
		expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
	})

	it("marks the signed-in person's current answer by state, not by tint alone", () => {
		renderPanel()
		expect(screen.getByRole('button', { name: '? Maybe' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: '? Maybe' })).toHaveClass('font-semibold')
		expect(screen.getByRole('button', { name: '✓ Yes' })).toHaveAttribute('aria-pressed', 'false')
		expect(screen.getByRole('button', { name: '✗ No' })).toHaveAttribute('aria-pressed', 'false')
	})

	it('claims no answer when the mailbox is unknown, rather than guessing one', () => {
		renderPanel(invitation(), { email: undefined })
		for (const name of ['✓ Yes', '? Maybe', '✗ No']) {
			expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-pressed')
		}
	})

	it('stays open after an RSVP, because the pane is where the result is shown', async () => {
		const { onRsvped, onClose } = renderPanel()
		fireEvent.click(screen.getByRole('button', { name: '✓ Yes' }))
		await waitFor(() => expect(onRsvped).toHaveBeenCalledOnce())
		expect(rsvpEvent.mock.calls[0]?.[0].data).toEqual({ eventId: 'evt1', calendarId: 'cal1', status: 'yes' })
		expect(onClose).not.toHaveBeenCalled()
		// The actions are usable again for a change of mind.
		expect(screen.getByRole('button', { name: '✗ No' })).toBeEnabled()
	})

	it('works without an RSVP listener', async () => {
		renderPanel(invitation(), { onRsvped: undefined })
		fireEvent.click(screen.getByRole('button', { name: '✓ Yes' }))
		await waitFor(() => expect(screen.getByRole('button', { name: '✓ Yes' })).toBeEnabled())
		expect(rsvpEvent).toHaveBeenCalledOnce()
	})

	it('announces a failed RSVP in the pane and clears it on the next attempt', async () => {
		rsvpEvent.mockRejectedValueOnce(new Error('offline'))
		renderPanel()
		fireEvent.click(screen.getByRole('button', { name: '✓ Yes' }))
		// The message is generic: nothing from the provider error is shown.
		expect(await screen.findByRole('alert')).toHaveTextContent('RSVP failed')
		fireEvent.click(screen.getByRole('button', { name: '✓ Yes' }))
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
	})

	it('hands editing to the editor instead of editing in place', () => {
		const { onEdit } = renderPanel()
		fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
		expect(onEdit).toHaveBeenCalledOnce()
		expect(screen.queryByLabelText('Title')).toBeNull()
	})

	it('reports a confirmed deletion so the pane can clear its selection', async () => {
		const { onDeleted } = renderPanel()
		fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
		fireEvent.click(screen.getByRole('button', { name: /Delete event/ }))
		await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
		expect(deleteEvent.mock.calls[0]?.[0].data).toEqual({ eventId: 'evt1', calendarId: 'cal1' })
	})

	it('offers no edit or delete for a read-only event', () => {
		renderPanel(invitation({ read_only: true }))
		expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
		expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
	})

	it('returns focus to Edit when the editor hands back to this view', () => {
		renderPanel(invitation(), { focusEditOnMount: true })
		expect(screen.getByRole('button', { name: /Edit/ })).toHaveFocus()
	})

	it('renders nothing for an event whose times cannot be read', () => {
		const { container } = renderPanel(invitation({ when: { start_time: 5, end_time: 1 } }))
		expect(container).toBeEmptyDOMElement()
	})
})

describe('a dismissal request from the surrounding surface', () => {
	it('closes the view when nothing is pending', () => {
		const { ref, onClose } = renderPanel()
		act(() => ref.current?.requestClose())
		expect(onClose).toHaveBeenCalledOnce()
	})

	it('first backs out of a delete confirmation instead of closing the event', () => {
		const { ref, onClose } = renderPanel()
		fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
		act(() => ref.current?.requestClose())
		expect(onClose).not.toHaveBeenCalled()
		expect(screen.queryByText('Delete this event?')).toBeNull()
		expect(screen.getByRole('button', { name: /Delete/ })).toHaveFocus()
	})

	it('is ignored while a change is being saved, so the result is not lost', async () => {
		let finish: (value: unknown) => void = () => {}
		rsvpEvent.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve
			}),
		)
		const { ref, onClose, onRsvped } = renderPanel()
		fireEvent.click(screen.getByRole('button', { name: '✓ Yes' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled())
		act(() => ref.current?.requestClose())
		expect(onClose).not.toHaveBeenCalled()
		await act(async () => finish({ ok: true }))
		await waitFor(() => expect(onRsvped).toHaveBeenCalledOnce())
	})
})

describe('opened on the delete confirmation from the event context menu', () => {
	it('shows the confirmation at once with focus on the safe choice, and deletes only once confirmed', async () => {
		const { onDeleted } = renderPanel(invitation(), { startOnDeleteConfirmation: true })
		expect(screen.getByRole('group', { name: /Delete this event\?/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
		// The menu that asked for it is still closing; the safe choice takes focus again once it is gone.
		screen.getByRole('button', { name: 'Close' }).focus()
		await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
		expect(deleteEvent).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: 'Delete event' }))
		await waitFor(() => expect(onDeleted).toHaveBeenCalled())
		expect(deleteEvent).toHaveBeenCalledWith({ data: { eventId: 'evt1', calendarId: 'cal1' } })
	})

	it('shows a read-only event as it is', () => {
		renderPanel(invitation({ read_only: true }), { startOnDeleteConfirmation: true })
		expect(screen.queryByRole('group', { name: /Delete this event\?/ })).not.toBeInTheDocument()
	})
})
