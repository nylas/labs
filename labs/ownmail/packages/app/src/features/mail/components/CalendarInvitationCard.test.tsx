// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries'

const { addCalendarInvitation, getCalendarInvitation, respondCalendarInvitation } = vi.hoisted(() => ({
	addCalendarInvitation: vi.fn(),
	getCalendarInvitation: vi.fn(),
	respondCalendarInvitation: vi.fn(),
}))
vi.mock('#features/calendar/server/calendar-invitation-fns', () => ({
	addCalendarInvitation: (...args: unknown[]) => addCalendarInvitation(...args),
	getCalendarInvitation: (...args: unknown[]) => getCalendarInvitation(...args),
	respondCalendarInvitation: (...args: unknown[]) => respondCalendarInvitation(...args),
}))

const { getInvitationFileTime } = vi.hoisted(() => ({ getInvitationFileTime: vi.fn() }))
vi.mock('../server/invitation-file-time.js', () => ({
	getInvitationFileTime: (...args: unknown[]) => getInvitationFileTime(...args),
}))

const { CalendarInvitationCard } = await import('./CalendarInvitationCard.js')

const message: MailMessage = {
	id: 'message-1',
	from: [{ email: 'grace@example.com' }],
	to: [{ email: 'ada@ownmail.com' }],
	attachments: [
		{
			id: 'attachment-1',
			filename: 'invite.ics',
			content_type: 'text/calendar; method=REQUEST',
		},
	],
}

function renderCard(value: MailMessage = message) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return render(
		<QueryClientProvider client={queryClient}>
			<CalendarInvitationCard message={value} />
		</QueryClientProvider>,
	)
}

describe('CalendarInvitationCard', () => {
	beforeEach(() => {
		addCalendarInvitation.mockReset().mockResolvedValue({
			state: 'ready',
			title: 'Planning review',
			organizer: 'Grace Hopper',
			when: { kind: 'timed', start: 1_817_823_600, end: 1_817_827_200 },
			status: 'noreply',
			canRespond: false,
			conflicts: { state: 'clear' },
		})
		getCalendarInvitation.mockReset().mockResolvedValue({
			state: 'ready',
			title: 'Planning review',
			location: 'Aurora room',
			organizer: 'Grace Hopper',
			when: { kind: 'timed', start: 1_817_823_600, end: 1_817_827_200 },
			status: 'noreply',
			conflicts: { state: 'conflict', count: 2 },
		})
		respondCalendarInvitation.mockReset().mockResolvedValue({ status: 'maybe' })
	})

	afterEach(() => {
		cleanup()
		vi.useRealTimers()
	})

	it('shows invitation details, conflict severity, and all response options', async () => {
		renderCard()

		expect(await screen.findByRole('heading', { name: 'Planning review' })).toBeInTheDocument()
		expect(screen.getByText('From Grace Hopper')).toBeInTheDocument()
		expect(screen.getByText('Aurora room')).toBeInTheDocument()
		expect(screen.getByRole('alert')).toHaveTextContent('overlaps with 2 events')
		expect(screen.getByRole('alert')).toHaveClass(
			'border-notice-warning-line',
			'bg-notice-warning',
			'text-notice-warning-foreground',
		)
		// The label and icon tile identify the app-inserted card; no side has an accent border.
		expect(screen.getByText('Calendar invitation')).toBeInTheDocument()
		const card = document.querySelector('[data-slot="calendar-invitation"]')
		expect(card?.outerHTML).not.toMatch(/\bborder-[lrtbse]-/)
		expect(screen.getByRole('button', { name: 'Accept' })).toHaveAttribute('aria-pressed', 'false')
		expect(screen.getByRole('button', { name: 'Maybe' })).toBeEnabled()
		expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
		expect(getCalendarInvitation).toHaveBeenCalledWith({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})
	})

	it('submits one allow-listed response and reflects the confirmed provider state', async () => {
		const user = userEvent.setup()
		renderCard()

		await user.click(await screen.findByRole('button', { name: 'Maybe' }))

		expect(respondCalendarInvitation).toHaveBeenCalledWith({
			data: { messageId: 'message-1', attachmentId: 'attachment-1', status: 'maybe' },
		})
		expect(await screen.findByText('You replied maybe')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true')
	})

	it('keeps a failed RSVP recoverable without changing the selected response', async () => {
		respondCalendarInvitation.mockRejectedValue(new Error('provider detail'))
		const user = userEvent.setup()
		renderCard()

		await user.click(await screen.findByRole('button', { name: 'Accept' }))

		expect(await screen.findByText(/response wasn’t saved/)).toHaveAttribute('role', 'alert')
		expect(screen.getByText('Awaiting your response')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Accept' })).toHaveAttribute('aria-pressed', 'false')
	})

	it('automatically rechecks while the provider-created event is still syncing', async () => {
		vi.useFakeTimers()
		getCalendarInvitation.mockResolvedValueOnce({ state: 'syncing' }).mockResolvedValueOnce({
			state: 'ready',
			title: 'Planning review',
			organizer: 'Grace Hopper',
			when: { kind: 'timed', start: 1_817_823_600, end: 1_817_827_200 },
			status: 'noreply',
			conflicts: { state: 'clear' },
		})
		renderCard()

		await act(() => vi.advanceTimersByTimeAsync(0))
		expect(screen.getByText('Adding invitation to your calendar')).toBeInTheDocument()
		await act(() => vi.advanceTimersByTimeAsync(2_000))
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})
		await act(() => vi.runOnlyPendingTimersAsync())

		expect(getCalendarInvitation).toHaveBeenCalledTimes(2)
		expect(screen.getByRole('heading', { name: 'Planning review' })).toBeInTheDocument()
		// A clear calendar adds nothing to the compact card.
		expect(screen.queryByText(/conflict/i)).toBeNull()
	})

	it('shows cancellation-specific retry copy while a calendar mutation finishes', async () => {
		vi.useFakeTimers()
		getCalendarInvitation
			.mockResolvedValueOnce({ state: 'cancelling' })
			.mockResolvedValueOnce({ state: 'cancelling' })
			.mockResolvedValueOnce({ state: 'cancelled', removed: true, manualReview: false })
		renderCard()

		await act(() => vi.advanceTimersByTimeAsync(0))
		expect(screen.getByText('Cancelling invitation')).toBeInTheDocument()
		expect(screen.queryByText('Adding invitation to your calendar')).toBeNull()
		expect(screen.getByText(/Another calendar update is finishing/)).toBeInTheDocument()
		await act(async () => {
			screen.getByRole('button', { name: 'Try again' }).click()
			await vi.advanceTimersByTimeAsync(0)
		})
		await act(() => vi.advanceTimersByTimeAsync(2_000))
		await act(() => vi.runOnlyPendingTimersAsync())

		expect(getCalendarInvitation).toHaveBeenCalledTimes(3)
		expect(screen.getByText('Invitation cancelled')).toBeInTheDocument()
	})

	it('bounds automatic sync lookups and keeps repeated manual retries fresh', async () => {
		vi.useFakeTimers()
		getCalendarInvitation.mockResolvedValue({ state: 'syncing' })
		renderCard()

		await act(() => vi.advanceTimersByTimeAsync(0))
		await act(() => vi.advanceTimersByTimeAsync(10_000))
		expect(getCalendarInvitation).toHaveBeenCalledTimes(5)

		const button = screen.getByRole('button', { name: 'Try again' })
		getCalendarInvitation.mockResolvedValueOnce({ state: 'syncing' })
		await act(async () => {
			button.click()
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(getCalendarInvitation).toHaveBeenCalledTimes(6)

		getCalendarInvitation.mockResolvedValueOnce({
			state: 'ready',
			title: 'Planning review',
			organizer: 'Grace Hopper',
			when: { kind: 'timed', start: 1_817_823_600, end: 1_817_827_200 },
			status: 'noreply',
			conflicts: { state: 'clear' },
		})
		await act(async () => {
			button.click()
			await vi.advanceTimersByTimeAsync(0)
		})

		expect(getCalendarInvitation).toHaveBeenCalledTimes(7)
		expect(screen.getByRole('heading', { name: 'Planning review' })).toBeInTheDocument()
	})

	it('stops automatic polling after an interval failure and leaves subsequent checks manual', async () => {
		vi.useFakeTimers()
		getCalendarInvitation
			.mockResolvedValueOnce({ state: 'syncing' })
			.mockRejectedValueOnce(new Error('provider outage'))
			.mockResolvedValue({ state: 'syncing' })
		renderCard()

		await act(() => vi.advanceTimersByTimeAsync(0))
		await act(() => vi.advanceTimersByTimeAsync(20_000))
		expect(getCalendarInvitation).toHaveBeenCalledTimes(2)
		expect(screen.getByText('Calendar invitation unavailable')).toBeInTheDocument()

		await act(async () => {
			screen.getByRole('button', { name: 'Try again' }).click()
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(getCalendarInvitation).toHaveBeenCalledTimes(3)
		expect(screen.getByText('Adding invitation to your calendar')).toBeInTheDocument()

		await act(() => vi.advanceTimersByTimeAsync(20_000))
		expect(getCalendarInvitation).toHaveBeenCalledTimes(3)
	})

	it('shows progress while a manual sync retry is pending', async () => {
		vi.useFakeTimers()
		let finishRetry!: (value: { state: 'ineligible' }) => void
		getCalendarInvitation.mockResolvedValueOnce({ state: 'syncing' }).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishRetry = resolve
				}),
		)
		renderCard()

		await act(() => vi.advanceTimersByTimeAsync(0))
		const button = screen.getByRole('button', { name: 'Try again' })
		await act(async () => {
			button.click()
			await vi.advanceTimersByTimeAsync(0)
		})

		expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
		await act(async () => {
			finishRetry({ state: 'ineligible' })
			await Promise.resolve()
		})
		await act(() => vi.runOnlyPendingTimersAsync())
		expect(screen.getByText('Response unavailable')).toBeInTheDocument()
	})

	it('lets the user explicitly add an invitation that is still missing', async () => {
		getCalendarInvitation.mockResolvedValue({ state: 'syncing' })
		const user = userEvent.setup()
		renderCard()

		await user.click(await screen.findByRole('button', { name: 'Add to calendar' }))

		expect(addCalendarInvitation).toHaveBeenCalledWith({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})
		expect(await screen.findByRole('heading', { name: 'Planning review' })).toBeInTheDocument()
		expect(screen.queryByText(/conflict/i)).toBeNull()
		expect(screen.getByText('Added to your calendar')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
		expect(respondCalendarInvitation).not.toHaveBeenCalled()
	})

	it('does not claim the event is syncing when OwnMail cannot add it', async () => {
		// Some providers never create the event themselves, so "still syncing" would
		// promise an outcome that never arrives. Say plainly that it can't be added here.
		getCalendarInvitation.mockResolvedValue({ state: 'syncing', canAdd: false })
		renderCard()

		expect(await screen.findByText('Invitation not in your calendar yet')).toBeInTheDocument()
		expect(screen.getByText(/OwnMail can’t add it from this message/)).toBeInTheDocument()
		expect(screen.queryByText(/still syncing/)).toBeNull()
		expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull()
		expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
	})

	it('shows progress and a recoverable error for a failed explicit add', async () => {
		getCalendarInvitation.mockResolvedValue({ state: 'syncing' })
		let rejectAdd!: (reason: Error) => void
		addCalendarInvitation.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectAdd = reject
				}),
		)
		const user = userEvent.setup()
		renderCard()

		await user.click(await screen.findByRole('button', { name: 'Add to calendar' }))
		expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()
		rejectAdd(new Error('provider detail'))

		expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t add this invitation')
		expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeEnabled()
	})

	it.each([
		['invalid', 'Unsupported calendar file'],
		['ineligible', 'Response unavailable'],
	] as const)('explains the %s invitation state without response controls', async (state, title) => {
		getCalendarInvitation.mockResolvedValue({ state })
		renderCard()

		expect(await screen.findByText(title)).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
	})

	it.each([
		[true, false, 'has been removed from your calendar'],
		[false, false, 'Check your calendar for the latest event status'],
		[false, true, 'remove it if it is still there'],
	] as const)(
		'describes a cancelled invitation with removal=%s and manual review=%s accurately',
		async (removed, manualReview, message) => {
			getCalendarInvitation.mockResolvedValue({ state: 'cancelled', removed, manualReview })
			renderCard()

			expect(await screen.findByText('Invitation cancelled')).toBeInTheDocument()
			expect(screen.getByText(new RegExp(message))).toBeInTheDocument()
			expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
		},
	)

	it('offers a retry after a safe invitation lookup failure', async () => {
		getCalendarInvitation.mockRejectedValueOnce(new Error('safe error')).mockResolvedValueOnce({
			state: 'ineligible',
		})
		const user = userEvent.setup()
		renderCard()

		expect(await screen.findByText('Calendar invitation unavailable')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Try again' }))
		expect(await screen.findByText('Response unavailable')).toBeInTheDocument()
	})

	it('renders an unknown conflict check, no optional location, and an existing acceptance', async () => {
		getCalendarInvitation.mockResolvedValue({
			state: 'ready',
			title: 'Planning review',
			organizer: 'Grace Hopper',
			when: { kind: 'timed', start: 1_817_823_600, end: 1_817_827_200 },
			status: 'yes',
			conflicts: { state: 'unknown' },
		})
		renderCard()

		expect(await screen.findByText('You accepted')).toBeInTheDocument()
		expect(screen.getByText(/couldn’t check your full schedule/)).toBeInTheDocument()
		expect(screen.queryByText('Aurora room')).toBeNull()
		expect(screen.getByRole('button', { name: 'Accept' })).toHaveAttribute('aria-pressed', 'true')
	})

	it.each([
		[
			{ kind: 'all-day', startDate: '2027-12-25', endDate: '2027-12-26' },
			'All day · Sat, Dec 25',
			'maybe',
			'You replied maybe',
		],
		[
			{ kind: 'all-day', startDate: '2027-12-25', endDate: '2027-12-28' },
			'All day · Sat, Dec 25–Mon, Dec 27',
			'no',
			'You declined',
		],
	] as const)('formats all-day ranges and current RSVP labels', async (when, dateText, status, label) => {
		getCalendarInvitation.mockResolvedValue({
			state: 'ready',
			title: 'Holiday',
			organizer: 'Grace Hopper',
			when,
			status,
			conflicts: { state: 'conflict', count: 1 },
		})
		renderCard()

		expect(await screen.findByText(label)).toBeInTheDocument()
		expect(screen.getByText(new RegExp(dateText))).toBeInTheDocument()
		expect(screen.getByRole('alert')).toHaveTextContent('overlaps with 1 event')
	})

	it('does not mount calendar behavior for ordinary attachments', async () => {
		const { container } = renderCard({
			...message,
			attachments: [{ id: 'pdf', filename: 'agenda.pdf', content_type: 'application/pdf' }],
		})

		await waitFor(() => expect(getCalendarInvitation).not.toHaveBeenCalled())
		expect(container).toBeEmptyDOMElement()
	})
})

describe('CalendarInvitationCard (an invite that changed)', () => {
	const START = 1_817_823_600
	const time = (seconds: number) =>
		new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(seconds * 1_000)
	const version = (id: string, date?: number): MailMessage => ({
		id,
		...(date ? { date } : {}),
		attachments: [{ id: `att-${id}`, filename: 'invite.ics', content_type: 'text/calendar; method=REQUEST' }],
	})

	function renderHistory(props: Record<string, unknown>) {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		return render(
			<QueryClientProvider client={queryClient}>
				<CalendarInvitationCard message={message} {...props} />
			</QueryClientProvider>,
		)
	}

	beforeEach(() => {
		getCalendarInvitation.mockReset().mockResolvedValue({
			state: 'ready',
			title: 'Design review',
			organizer: 'Katherine Johnson',
			when: { kind: 'timed', start: START, end: START + 2_700 },
			status: 'noreply',
			conflicts: { state: 'clear' },
		})
		getInvitationFileTime.mockReset().mockResolvedValue({ start: START - 3_600, end: START - 900 })
		respondCalendarInvitation.mockReset().mockResolvedValue({ status: 'maybe' })
	})

	afterEach(cleanup)

	it('says how often it changed, strikes the earlier time and lists the earlier versions', async () => {
		renderHistory({ updateCount: 3, earlierVersions: [version('v1'), version('v2', START - 86_400)] })
		expect(await screen.findByText('Updated 3 times')).toBeInTheDocument()
		const previous = await screen.findByText(time(START - 3_600))
		expect(previous.closest('s')).toHaveAttribute('data-slot', 'invitation-previous-time')
		expect(getInvitationFileTime).toHaveBeenCalledWith({ data: { messageId: 'v2', attachmentId: 'att-v2' } })

		const toggle = screen.getByRole('button', { name: 'Earlier versions' })
		expect(toggle).toHaveAttribute('aria-expanded', 'false')
		await userEvent.click(toggle)
		const list = screen.getByRole('list')
		expect(list.children).toHaveLength(2)
		expect(list.children[0]).toHaveTextContent(/^.+ · Sent .+$/)
		expect(list.children[1]).toHaveTextContent('Sent earlier')
		expect(list.children[0]?.querySelector('s')).not.toBeNull()
		await userEvent.click(toggle)
		expect(screen.queryByRole('list')).toBeNull()
	})

	it('uses a known earlier time, with its day when the day changed', async () => {
		renderHistory({ updateCount: 1, previousStartTime: START - 86_400, earlierVersions: [] })
		expect(await screen.findByText('Updated 1 time')).toBeInTheDocument()
		expect(
			screen.getByText((_, element) => element?.getAttribute('data-slot') === 'invitation-previous-time'),
		).toHaveTextContent(/was .+ · .+/)
		expect(getInvitationFileTime).not.toHaveBeenCalled()
		expect(screen.queryByRole('button', { name: 'Earlier versions' })).toBeNull()
	})

	it('strikes nothing when the time did not change or the file has no time', async () => {
		getInvitationFileTime.mockResolvedValue(null)
		const view = renderHistory({ updateCount: 2, earlierVersions: [version('v1', START - 7_200)] })
		expect(await screen.findByText('Updated 2 times')).toBeInTheDocument()
		await userEvent.click(screen.getByRole('button', { name: 'Earlier versions' }))
		expect(await screen.findByText(/^Sent /)).toBeInTheDocument()
		expect(document.querySelector('[data-slot="invitation-previous-time"]')).toBeNull()
		view.unmount()

		renderHistory({ previousStartTime: START, earlierVersions: [] })
		expect(await screen.findByRole('heading', { name: 'Design review' })).toBeInTheDocument()
		expect(document.querySelector('[data-slot="invitation-previous-time"]')).toBeNull()
		expect(screen.queryByText(/^Updated/)).toBeNull()
	})

	it('offers Accept as the first choice, then borders the answer given', async () => {
		renderHistory({})
		const accept = await screen.findByRole('button', { name: 'Accept' })
		expect(accept).toHaveClass('border-cta-line')
		expect(screen.getByRole('button', { name: 'Maybe' })).not.toHaveClass('border-cta-line')
		await userEvent.click(screen.getByRole('button', { name: 'Maybe' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Maybe' })).toHaveClass('border-cta-line'))
		expect(screen.getByRole('button', { name: 'Accept' })).not.toHaveClass('border-cta-line')
	})

	it('keeps both periods when a meeting runs from morning into the afternoon', async () => {
		const start = new Date(2027, 7, 10, 11, 0).getTime() / 1000
		getCalendarInvitation.mockResolvedValue({
			state: 'ready',
			title: 'Lunch review',
			organizer: 'Alan Turing',
			when: { kind: 'timed', start, end: start + 5_400 },
			status: 'noreply',
			conflicts: { state: 'clear' },
		})
		renderHistory({})
		expect(await screen.findByText(/11:00\sAM–12:30\sPM/)).toBeInTheDocument()
	})

	it('formats a timed event that crosses midnight with both days', async () => {
		getCalendarInvitation.mockResolvedValue({
			state: 'ready',
			title: 'Overnight deploy',
			organizer: 'Alan Turing',
			when: { kind: 'timed', start: START, end: START + 86_400 },
			status: 'noreply',
			conflicts: { state: 'clear' },
		})
		renderHistory({})
		expect(await screen.findByText(/ – /)).toBeInTheDocument()
	})
})
