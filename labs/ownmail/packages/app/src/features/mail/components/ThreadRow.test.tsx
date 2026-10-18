// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadListEnv } from '../lib/thread-list-model.js'
import type { MailMessage, MailThread } from '../state/mail-queries.js'

const {
	getThreadMessages,
	getThreadUnreadSummary,
	getCalendarInvitation,
	respondCalendarInvitation,
	openCompose,
	createResendDraft,
} = vi.hoisted(() => ({
	getThreadMessages: vi.fn(),
	getThreadUnreadSummary: vi.fn(),
	getCalendarInvitation: vi.fn(),
	respondCalendarInvitation: vi.fn(),
	openCompose: vi.fn(async () => {}),
	createResendDraft: vi.fn(),
}))
vi.mock('#server/fns', () => ({
	getThreadMessages: (input: unknown) => getThreadMessages(input),
	createResendDraft: (input: unknown) => createResendDraft(input),
}))
vi.mock('../server/thread-list-functions.js', () => ({
	getThreadUnreadSummary: (input: unknown) => getThreadUnreadSummary(input),
}))
vi.mock('#features/calendar/server/calendar-invitation-fns', () => ({
	getCalendarInvitation: (input: unknown) => getCalendarInvitation(input),
	respondCalendarInvitation: (input: unknown) => respondCalendarInvitation(input),
}))
vi.mock('./ComposeProvider.js', () => ({ useCompose: () => ({ openCompose }) }))

const { ThreadRowContent, ThreadRowError, ThreadRowLayout, THREAD_ROW_CLASS, threadRowLinkLabel } =
	await import('./ThreadRow.js')
const { ThreadListEnvironment } = await import('./ThreadListGroups.js')
const { unreadSummary } = await import('../lib/thread-list-model.js')

/** Thursday 15 October 2026, noon UTC. */
const NOW = Date.UTC(2026, 9, 15, 12, 0)
const at = (dayOffset: number, hour: number, minute = 0) =>
	Date.UTC(2026, 9, 15 + dayOffset, hour, minute) / 1000

const ADA = { name: 'Ada Lovelace', email: 'ada@ownmail.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const MARY = { name: 'Mary Jackson', email: 'mary@vercel.com' }

const ENV: ThreadListEnv = {
	owner: ADA.email,
	ownerFirstName: 'Ada',
	now: NOW,
	tz: 'UTC',
	mutedIds: new Set(),
	grouped: true,
}

const message = (over: Partial<MailMessage> & { id: string }): MailMessage =>
	({ from: [GRACE], to: [ADA], subject: 'Subject', date: at(0, 9), ...over }) as MailMessage

const thread = (over: Partial<MailThread> & { id: string }): MailThread =>
	({
		subject: 'Subject',
		snippet: 'snippet',
		participants: [GRACE, ADA],
		message_ids: ['m1'],
		folders: ['inbox'],
		latest_message_received_date: at(0, 9, 41),
		...over,
	}) as MailThread

/** Rows load what they show once on screen; tests choose whether they are. */
let onScreen = true
class TestIntersectionObserver {
	constructor(private readonly callback: IntersectionObserverCallback) {}
	observe(target: Element) {
		this.callback([{ isIntersecting: onScreen, target } as IntersectionObserverEntry], this as never)
	}
	disconnect() {}
	unobserve() {}
}

function renderRow(
	value: MailThread,
	{
		env = ENV,
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
		onToggleStar = vi.fn(),
		selection,
		starPending,
		heldUnread,
		labelId,
	}: {
		env?: ThreadListEnv
		client?: QueryClient | null
		onToggleStar?: () => void
		selection?: { checked: boolean; disabled: boolean; onToggle: () => void }
		starPending?: boolean
		heldUnread?: boolean
		labelId?: string
	} = {},
) {
	const row = (
		<ThreadListEnvironment value={env}>
			<div className={THREAD_ROW_CLASS} data-testid="row">
				<ThreadRowContent
					thread={value}
					folderId="inbox"
					onToggleStar={onToggleStar}
					selection={selection}
					starPending={starPending}
					heldUnread={heldUnread}
					labelId={labelId}
				/>
			</div>
		</ThreadListEnvironment>
	)
	const wrap = (children: ReactNode) =>
		client ? <QueryClientProvider client={client}>{children}</QueryClientProvider> : children
	return { ...render(wrap(row)), client }
}

const roadmapMessages = [
	message({ id: 'm1', unread: false, date: at(-2, 9) }),
	message({
		id: 'v4',
		from: [GRACE],
		unread: true,
		date: at(0, 9, 30),
		attachments: [
			{ id: 'a4', filename: 'Q3-roadmap-v4.pdf', size: 2_100_000, content_type: 'application/pdf' },
		] as never,
	}),
	message({
		id: 'm14',
		from: [MARY],
		to: [GRACE, ALAN, ADA],
		unread: true,
		date: at(0, 9, 41),
		body: '<p>Ada, can you confirm that date with legal?</p>',
	}),
]
const roadmap = thread({
	id: 'thread-roadmap',
	unread: true,
	subject: 'Q3 product roadmap: final review before Friday',
	snippet: 'Ada, can you confirm that date with legal?',
	participants: [GRACE, ADA, ALAN, { name: 'Katherine Johnson', email: 'kj@vercel.com' }, MARY],
	message_ids: ['m1', 'v4', 'm14'],
	latest_draft_or_message: roadmapMessages[2],
})

beforeEach(() => {
	onScreen = true
	vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
	getThreadMessages.mockReset()
	getThreadUnreadSummary.mockReset()
	getCalendarInvitation.mockReset()
	respondCalendarInvitation.mockReset()
	openCompose.mockReset().mockResolvedValue(undefined)
	createResendDraft.mockReset()
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('ThreadRowContent', () => {
	it('reads a group conversation as the board does: people, what is new, a question, the newest file', async () => {
		getThreadUnreadSummary.mockResolvedValue(unreadSummary(roadmapMessages, ADA.email))
		renderRow(roadmap)
		const row = screen.getByTestId('row')
		expect(row.querySelector('.thread-row-sender')).toHaveTextContent('Mary, Grace, Alan, you +1')
		expect(row.querySelector('.thread-row-sender')).toHaveClass('font-semibold')
		expect(row.querySelector('.thread-row-sender')).toHaveAttribute('data-tone', 'asks')
		expect(row.querySelector('.thread-row-snippet')).toHaveTextContent(
			'Mary: Ada, can you confirm that date with legal?',
		)
		await waitFor(() => expect(row.querySelector('.thread-row-signals')).not.toBeNull())
		const signals = row.querySelector('.thread-row-signals') as HTMLElement
		expect(getThreadUnreadSummary).toHaveBeenCalledWith({ data: { threadId: 'thread-roadmap' } })
		expect(getThreadMessages).not.toHaveBeenCalled()
		expect([...signals.children].map((signal) => signal.textContent)).toEqual([
			'2 new',
			'Asks you',
			'Q3-roadmap-v4.pdf',
		])
		expect(within(signals).getByText('2 new')).toHaveClass(
			'bg-primary',
			'text-primary-foreground',
			'font-data',
		)
		expect(within(signals).getByText('Asks you')).toHaveClass('bg-signal-ask')
		// The narrower densities keep only the first signal, at the end of the snippet line.
		expect(row.querySelector('.thread-row-labels .thread-row-signal-collapsed')).toHaveTextContent('2 new')
		expect(row.querySelector('time')).toHaveClass('font-semibold', 'text-cta-icon')
		// The paperclip gives way to the named file.
		expect(screen.queryByRole('img', { name: 'Has attachments' })).toBeNull()
	})

	it('sets a lone signal at the end of the snippet line', () => {
		renderRow(
			thread({
				id: 'invoice',
				has_attachments: true,
				latest_draft_or_message: message({
					id: 'i',
					attachments: [
						{ id: 'a', filename: 'invoice-2041.pdf', content_type: 'application/pdf', size: 1 },
					] as never,
				}),
			}),
		)
		const row = screen.getByTestId('row')
		expect(row.querySelector('.thread-row-signals')).toBeNull()
		expect(row.querySelector('.thread-row-labels')).toHaveTextContent('invoice-2041.pdf')
		expect(row.querySelector('.thread-row-signal-collapsed')).toBeNull()
		// The snippet stops short of the signal; without one it runs the full width.
		expect(row.querySelector('.thread-row-text')).toHaveAttribute('data-end-signal', '')
	})

	it('loads nothing for a row off screen, or outside a query client', () => {
		onScreen = false
		renderRow(roadmap)
		cleanup()
		vi.stubGlobal('IntersectionObserver', undefined)
		onScreen = true
		renderRow(roadmap)
		cleanup()
		renderRow(roadmap, { client: null })
		expect(getThreadUnreadSummary).not.toHaveBeenCalled()
		expect(screen.getByTestId('row').querySelector('.thread-row-labels')).toHaveTextContent('Asks you')
	})

	it('marks a reply the owner wrote last with the reply glyph and "You:"', () => {
		const { container } = renderRow(
			thread({
				id: 'hiking',
				participants: [ALAN, ADA],
				snippet: 'Saturday works, I’ll bring the map.',
				starred: true,
				latest_draft_or_message: message({ id: 'h2', from: [ADA], to: [ALAN] }),
			}),
		)
		expect(container.querySelector('.thread-row-sender')).toHaveTextContent('Alan Turing, you')
		expect(container.querySelector('.thread-row-snippet')).toHaveTextContent(
			'You: Saturday works, I’ll bring the map.',
		)
		expect(container.querySelector('.thread-row-snippet svg.thread-row-snippet-icon')).not.toBeNull()
		expect(screen.getByRole('button', { name: 'Unstar' })).toHaveAttribute('data-starred', 'true')
	})

	it('names a draft and its recipient in red', () => {
		const { container } = renderRow(
			thread({
				id: 'dentist',
				latest_draft_or_message: message({
					id: 'd',
					ownmailDraft: true,
					to: [{ name: 'Bright Smile Dental', email: 'hello@brightsmile.com' }],
					subject: 'Re: Reminder: appointment Thursday 2:30 PM',
					snippet: 'Could we move this to Friday morning instead?',
				}),
			}),
		)
		expect(container.querySelector('.thread-row-sender')).toHaveTextContent('Draft · to Bright Smile Dental')
		expect(screen.getByText('Draft')).toHaveClass('text-danger-soft-foreground', 'font-semibold')
		expect(container.querySelector('.thread-row-subject')).toHaveTextContent(
			'Re: Reminder: appointment Thursday 2:30 PM',
		)
	})

	it('quiets a muted list conversation and says what it spares you', () => {
		const { container } = renderRow(
			thread({
				id: 'thread-staging',
				unread: true,
				participants: [{ email: 'eng-all@vercel.com' }, GRACE, ALAN, ADA],
				message_ids: ['a', 'b', 'c'],
				has_attachments: true,
				latest_draft_or_message: message({ id: 'c', to: [{ email: 'eng-all@vercel.com' }] }),
			}),
			{ env: { ...ENV, mutedIds: new Set(['thread-staging']) } },
		)
		const sender = container.querySelector('.thread-row-sender') as HTMLElement
		expect(sender).toHaveAttribute('data-tone', 'muted')
		expect(sender).toHaveClass('text-muted-foreground', 'font-normal')
		expect(sender).toHaveTextContent('Muted: eng-all@ · 4 people')
		expect(container.querySelector('.thread-row-subject')).toHaveClass('thread-row-subject-quiet')
		expect(container.querySelector('.thread-row-snippet')).toHaveTextContent(
			'Muted · 2 replies you don’t need to read',
		)
		expect(container.querySelector('.thread-signal')).toBeNull()
		expect(screen.queryByRole('img', { name: 'Has attachments' })).toBeNull()
		// It shows no signals, so it looks nothing up.
		expect(getThreadUnreadSummary).not.toHaveBeenCalled()
		expect(sender.querySelector('.thread-row-list-who')).not.toHaveClass('gap-1')
	})

	it('leads any muted conversation with the bell, not only a list’s', () => {
		const { container } = renderRow(
			thread({
				id: 'thread-hiking',
				participants: [ALAN, ADA],
				message_ids: ['a', 'b'],
				latest_draft_or_message: message({ id: 'b', from: [ADA], to: [ALAN] }),
			}),
			{ env: { ...ENV, mutedIds: new Set(['thread-hiking']) } },
		)
		const sender = container.querySelector('.thread-row-sender') as HTMLElement
		expect(sender.querySelector('.thread-row-list-who svg')).not.toBeNull()
		expect(sender).toHaveTextContent(/^Muted: Alan Turing, you$/)
		expect(container.querySelector('.thread-row-snippet')).toHaveTextContent(
			'Muted · 1 reply you don’t need to read',
		)
	})

	it('says when a scheduled send goes out instead of the time', () => {
		const { container } = renderRow(
			thread({
				id: 'offsite',
				latest_draft_or_message: {
					...message({ id: 's', from: [ADA], to: [GRACE], subject: 'Re: Q3 offsite agenda' }),
					send_at: at(4, 9),
				} as MailMessage,
			}),
		)
		expect(container.querySelector('.thread-row-sender')).toHaveTextContent('To Grace Hopper')
		expect(container.querySelector('.thread-row-when')).toHaveTextContent(/Sends Mon 9:00\sAM/)
		expect(container.querySelector('.thread-row-when time')).toBeNull()
	})

	it('shows a paperclip for an attachment it cannot name, and the sender fallback for nobody', () => {
		const { container } = renderRow(
			thread({ id: 'x', has_attachments: true, participants: [], folders: ['inbox', 'work'] }),
		)
		expect(screen.getByRole('img', { name: 'Has attachments' })).toBeInTheDocument()
		// Labels stay in the reader: the board's rows carry none.
		expect(container.querySelector('.thread-row-labels')).toBeNull()
		expect(container.querySelector('.thread-row-text')).not.toHaveAttribute('data-end-signal')
		expect(container).not.toHaveTextContent('Work')
		expect(container.querySelector('.thread-row-sender')).toHaveTextContent('(unknown sender)')
	})

	it('names its link with every state it shows', async () => {
		getThreadUnreadSummary.mockResolvedValue({ unreadCount: 2, newestFile: 'Q3-roadmap-v4.pdf' })
		renderRow(roadmap, { labelId: 'roadmap-label' })
		const label = document.getElementById('roadmap-label') as HTMLElement
		expect(label).not.toBeVisible()
		await waitFor(() =>
			expect(label).toHaveTextContent(
				'Open Q3 product roadmap: final review before Friday from Mary, Grace, Alan, you +1, unread, 2 new, asks you',
			),
		)
		cleanup()
		renderRow(
			thread({
				id: 'offsite',
				latest_draft_or_message: {
					...message({ id: 's', from: [ADA], to: [GRACE], subject: 'Re: Q3 offsite agenda' }),
					send_at: at(4, 9),
				} as MailMessage,
			}),
			{ labelId: 'offsite-label' },
		)
		expect(document.getElementById('offsite-label')?.textContent).toMatch(
			/^Open Re: Q3 offsite agenda, to Grace Hopper, Sends Mon 9:00\sAM$/,
		)
	})

	it('keeps reading as unread, with what was new, while it is held open', async () => {
		getThreadUnreadSummary.mockResolvedValue({ unreadCount: 3 })
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const tree = (value: MailThread, heldUnread: boolean) => (
			<QueryClientProvider client={client}>
				<ThreadListEnvironment value={ENV}>
					<div data-testid="row">
						<ThreadRowContent
							thread={value}
							folderId="inbox"
							onToggleStar={vi.fn()}
							heldUnread={heldUnread}
						/>
					</div>
				</ThreadListEnvironment>
			</QueryClientProvider>
		)
		const { rerender } = render(tree(roadmap, false))
		const row = screen.getByTestId('row')
		await waitFor(() => expect(row.querySelector('.thread-row-labels')).toHaveTextContent('3 new'))
		// Opening marks it read; the provider then reports nothing unread. The row holds.
		client.setQueryData(['mail', 'unknown', 'thread-unread-summary', 'thread-roadmap', 'm14'], {
			unreadCount: 0,
		})
		rerender(tree({ ...roadmap, unread: false }, true))
		expect(row.querySelector('.thread-row-sender')).toHaveClass('font-semibold')
		expect(row.querySelector('.thread-signal[data-signal="new"]')).toHaveTextContent('3 new')
		// Once another conversation opens, the row reads as it is.
		rerender(tree({ ...roadmap, unread: false }, false))
		expect(row.querySelector('.thread-row-sender')).toHaveClass('font-normal')
		expect(row.querySelector('.thread-signal[data-signal="new"]')).toBeNull()
		// Held again with nothing remembered, it is unread without a count.
		rerender(tree({ ...roadmap, unread: false }, true))
		expect(row.querySelector('.thread-row-sender')).toHaveClass('font-semibold')
		expect(row.querySelector('.thread-signal[data-signal="new"]')).toBeNull()
	})

	it('counts what the reader loaded unread for a conversation opened before its row looked, in the browser only', () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		client.setQueryData(['mail', 'unknown', 'thread', 'thread-roadmap'], {
			thread: roadmap,
			messages: roadmapMessages,
			mailboxEmail: ADA.email,
		})
		const tree = (
			<QueryClientProvider client={client}>
				<ThreadListEnvironment value={ENV}>
					<div data-testid="row">
						<ThreadRowContent
							thread={{ ...roadmap, unread: false }}
							folderId="inbox"
							onToggleStar={vi.fn()}
							heldUnread
						/>
					</div>
				</ThreadListEnvironment>
			</QueryClientProvider>
		)
		// The server's cache may hold the conversation before the browser's does: it counts nothing.
		expect(renderToString(tree)).not.toContain('2 new')
		render(tree)
		expect(screen.getByTestId('row').querySelector('.thread-signal[data-signal="new"]')).toHaveTextContent(
			'2 new',
		)
	})

	it('toggles the star without opening the row, and gives way to a checkbox while selecting', () => {
		const onToggleStar = vi.fn()
		const { container } = renderRow(thread({ id: 'x' }), { onToggleStar, starPending: false })
		const star = screen.getByRole('button', { name: 'Star' })
		expect(star).not.toHaveAttribute('data-starred')
		const click = new MouseEvent('click', { bubbles: true, cancelable: true })
		star.dispatchEvent(click)
		expect(click.defaultPrevented).toBe(true)
		expect(onToggleStar).toHaveBeenCalledTimes(1)
		expect(container.querySelector('.thread-row-lead')).toBeNull()
		cleanup()

		const onToggle = vi.fn()
		renderRow(thread({ id: 'x', subject: '', snippet: '' }), {
			selection: { checked: false, disabled: false, onToggle },
		})
		expect(screen.queryByRole('button', { name: 'Star' })).toBeNull()
		fireEvent.click(screen.getByRole('checkbox', { name: 'Select (no subject)' }))
		expect(onToggle).toHaveBeenCalled()
	})

	it('lets the first line stand in for a missing subject, styled as a stand-in', () => {
		const { container } = renderRow(
			thread({
				id: 'x',
				subject: '',
				snippet: 'Can you send me the Lisbon hotel confirmation before Friday?',
			}),
		)
		const subject = container.querySelector('.thread-row-subject') as HTMLElement
		expect(subject).toHaveTextContent(/^Can you send me the Lisbon hotel.*…$/)
		expect(subject).toHaveAttribute('data-stand-in', 'true')
	})
})

describe('a send that failed', () => {
	const bounce = message({
		id: 'b',
		from: [{ name: 'Mail Delivery Subsystem', email: 'mailer-daemon@ownmail.com' }],
	})
	const original = message({
		id: 'o',
		from: [ADA],
		to: [{ name: 'Meridian Bank', email: 'support@meridianbank.com' }],
		subject: 'Question about the June statement',
		body: '<p>Hi, my June statement shows a fee.</p><p>Thanks, Ada</p>',
	})
	const failed = thread({
		id: 'failed',
		subject: 'Question about the June statement',
		participants: [
			ADA,
			{ name: 'Meridian Bank', email: 'support@meridianbank.com' },
			bounce.from?.[0] as never,
		],
		latest_message_sent_date: at(-1, 17, 12),
		latest_draft_or_message: bounce,
	})
	const detail = { thread: failed, messages: [original, bounce], mailboxEmail: ADA.email }

	it('says so on a red row and reopens the message, files and all, as a draft to the address that bounced', async () => {
		getThreadMessages.mockResolvedValue(detail)
		createResendDraft.mockResolvedValue({ draftId: 'd-resend' })
		const { container } = renderRow(failed)
		expect(container.querySelector('.thread-row-sender')).toHaveAttribute('data-tone', 'failed')
		expect(container.querySelector('.thread-row-sender')).toHaveTextContent('To Meridian Bank')
		expect(container.querySelector('.thread-row-failed')).toHaveTextContent('Not sent. The address bounced.')
		// Compact and Condensed keep the failure as a pill, with its glyph, not only the red tint.
		const collapsed = container.querySelector('.thread-row-signal-collapsed [data-signal="failed"]')
		expect(collapsed).toHaveTextContent('Not sent')
		expect(collapsed).toHaveClass('bg-danger-soft', 'text-danger-soft-foreground')
		expect(collapsed?.querySelector('svg')).not.toBeNull()
		// The snippet line is replaced in the Default density, and kept for the narrower ones.
		expect(container.querySelector('.thread-row-snippet')).toHaveAttribute('data-replaced', '')
		fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		await waitFor(() => expect(openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd-resend' }))
		// The server copies the original, with its files, into a draft to the one address that bounced.
		expect(createResendDraft).toHaveBeenCalledWith({
			data: { messageId: 'o', to: 'support@meridianbank.com' },
		})
		expect(screen.getByRole('button', { name: 'Edit and resend' })).not.toBeDisabled()
	})

	it('loads the conversation itself outside a query client', async () => {
		getThreadMessages.mockResolvedValue(detail)
		createResendDraft.mockResolvedValue({ draftId: 'd-resend' })
		renderRow(failed, { client: null })
		fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		await waitFor(() => expect(openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd-resend' }))
	})

	it('says it could not open the message when the draft copy cannot be made', async () => {
		getThreadMessages.mockResolvedValue(detail)
		createResendDraft.mockRejectedValue(new Error('Something went wrong'))
		renderRow(failed)
		fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		expect(await screen.findByText('Couldn’t open the message. Try again.')).toBeInTheDocument()
		expect(openCompose).not.toHaveBeenCalled()
	})

	it('says it could not open the message when there is nothing to resend', async () => {
		getThreadMessages.mockResolvedValue({ ...detail, messages: [bounce] })
		renderRow(failed)
		fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		expect(await screen.findByText('Couldn’t open the message. Try again.')).toBeInTheDocument()
		expect(openCompose).not.toHaveBeenCalled()
	})
})

describe('an invitation row', () => {
	const invitation = message({
		id: 'invite',
		from: [{ name: 'Katherine Johnson', email: 'kj@vercel.com' }],
		attachments: [{ id: 'ics', filename: 'invite.ics', content_type: 'text/calendar', size: 512 }] as never,
	})
	const invite = thread({
		id: 'thread-calendar-invite',
		unread: true,
		subject: 'Design review: token migration',
		has_attachments: true,
		latest_draft_or_message: invitation,
	})
	const ready = {
		state: 'ready',
		title: 'Design review: token migration',
		organizer: 'Katherine Johnson',
		when: { kind: 'timed', start: at(7, 14), end: at(7, 14, 45) },
		status: 'noreply',
		conflicts: { state: 'clear' },
	}

	it('says when, and answers Accept through the calendar', async () => {
		getCalendarInvitation.mockResolvedValue(ready)
		respondCalendarInvitation.mockResolvedValue({ status: 'yes' })
		const { container, client } = renderRow(invite)
		const accept = screen.getByRole('button', { name: 'Accept' })
		// Until the invitation is known the answers wait.
		expect(accept).toBeDisabled()
		expect(await screen.findByText(/Thu, Oct 22 · 2:00–2:45\sPM/)).toBeInTheDocument()
		expect(getCalendarInvitation).toHaveBeenCalledWith({ data: { messageId: 'invite', attachmentId: 'ics' } })
		await waitFor(() => expect(accept).not.toBeDisabled())
		expect(screen.getByRole('button', { name: 'Decline' })).toHaveClass('text-muted-foreground')
		const invalidate = vi.spyOn(client as QueryClient, 'invalidateQueries')
		fireEvent.click(accept)
		await waitFor(() => expect(accept).toHaveAttribute('aria-pressed', 'true'))
		expect(respondCalendarInvitation).toHaveBeenCalledWith({
			data: { messageId: 'invite', attachmentId: 'ics', status: 'yes' },
		})
		expect(invalidate).toHaveBeenCalled()
		// No signal pills on an invitation; the narrower densities say "Invite".
		expect(container.querySelector('.thread-row-signals')).toBeNull()
		expect(container.querySelector('.thread-row-signal-collapsed')).toHaveTextContent('Invite')
	})

	it('says when an answer was not saved, and leaves a cache that moved on alone', async () => {
		getCalendarInvitation.mockResolvedValue({ ...ready, status: 'no' })
		respondCalendarInvitation.mockRejectedValueOnce(new Error('offline'))
		renderRow(invite)
		const decline = await screen.findByRole('button', { name: 'Decline', pressed: true })
		await waitFor(() => expect(decline).not.toBeDisabled())
		expect(decline).not.toHaveClass('text-muted-foreground')
		fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Not saved')
	})

	it('keeps a cache entry that is no longer ready when an answer lands', async () => {
		getCalendarInvitation.mockResolvedValue(ready)
		let land!: (value: { status: string }) => void
		respondCalendarInvitation.mockReturnValue(
			new Promise((resolve) => {
				land = resolve
			}),
		)
		const { client } = renderRow(invite)
		const accept = screen.getByRole('button', { name: 'Accept' })
		await waitFor(() => expect(accept).not.toBeDisabled())
		fireEvent.click(accept)
		const key = ['calendar', 'unknown', 'invitation', 'invite', 'ics']
		act(() => {
			;(client as QueryClient).setQueryData(key, { state: 'cancelled', removed: true, manualReview: false })
		})
		await act(async () => land({ status: 'yes' }))
		expect((client as QueryClient).getQueryData(key)).toEqual({
			state: 'cancelled',
			removed: true,
			manualReview: false,
		})
		expect(await screen.findByText('Invitation cancelled')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
	})

	it('offers no answers where the calendar cannot take one', async () => {
		getCalendarInvitation.mockResolvedValue({ ...ready, canRespond: false })
		renderRow(invite)
		expect(await screen.findByText(/Thu, Oct 22/)).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
		cleanup()
		getCalendarInvitation.mockResolvedValue({ state: 'syncing' })
		renderRow(invite)
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull())
		expect(screen.getByText('Calendar invitation')).toBeInTheDocument()
	})

	it('offers no answers it could never send when the lookup fails', async () => {
		getCalendarInvitation.mockRejectedValue(new Error('offline'))
		renderRow(invite)
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull())
		expect(screen.getByText('Calendar invitation')).toBeInTheDocument()
		expect(getCalendarInvitation).toHaveBeenCalledTimes(1)
	})

	it('checks again while the calendar is still syncing the event, as the invitation card does', async () => {
		getCalendarInvitation.mockResolvedValueOnce({ state: 'syncing' }).mockResolvedValue(ready)
		renderRow(invite)
		// Syncing offers no answers yet; the recheck two seconds on finds the event.
		await waitFor(() => expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull())
		await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).not.toBeDisabled(), {
			timeout: 4000,
		})
		expect(getCalendarInvitation).toHaveBeenCalledTimes(2)
	})

	it('waits, unanswered, outside a query client', () => {
		renderRow(invite, { client: null })
		expect(screen.getByText('Calendar invitation')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
		expect(getCalendarInvitation).not.toHaveBeenCalled()
	})
})

describe('row cells', () => {
	it('names the row link after the subject and sender', () => {
		expect(threadRowLinkLabel(thread({ id: 'x', subject: '' }), 'inbox')).toBe(
			'Open (no subject) from Grace Hopper',
		)
	})

	it('lays out a bare row: no lead, no time, no labels', () => {
		const { container } = render(<ThreadRowLayout sender="Grace" subject={undefined} snippet={undefined} />)
		expect(container.querySelector('.thread-row-lead')).toBeNull()
		expect(container.querySelector('time')).toBeNull()
		expect(container.querySelector('.thread-row-labels')).toBeNull()
		expect(container.querySelector('.thread-row-subject')).toHaveTextContent('(no subject)')
	})

	it('reports a failed action inside its row only when there is one', () => {
		const { container, rerender } = render(<ThreadRowError message={null} />)
		expect(container).toBeEmptyDOMElement()
		rerender(<ThreadRowError message="Action failed" />)
		expect(screen.getByRole('alert')).toHaveTextContent('Action failed')
	})
})
