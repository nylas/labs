// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountScope } from '#app/lib/account-scope'
import {
	defaultUserPreferences,
	USER_PREFERENCES_STORAGE_KEY,
	writeUserPreferences,
} from '#app/preferences/user-preferences'
import { replyAllDraftSearch } from '../lib/mail-ui-model'
import { type MailMessage, type MailThread, mailKeys } from '../state/mail-queries'
import { ThreadConversation } from './ThreadConversation'

const { senderImagesTrustedMock, trustSenderImagesMock, getThreadListUnsubscribeMock } = vi.hoisted(() => ({
	senderImagesTrustedMock: vi.fn(),
	trustSenderImagesMock: vi.fn(),
	getThreadListUnsubscribeMock: vi.fn(),
}))
vi.mock('../server/mail-functions', () => ({ getThreadListUnsubscribe: getThreadListUnsubscribeMock }))
vi.mock('../lib/image-sender-trust', async (importOriginal) => ({
	...(await importOriginal<typeof import('../lib/image-sender-trust')>()),
	originalColorSenders: vi.fn().mockResolvedValue([]),
	senderImagesTrusted: senderImagesTrustedMock,
	trustSenderImages: trustSenderImagesMock,
}))
// The real card loads the invitation through the query client; the stream only
// needs to place it.
vi.mock('./CalendarInvitationCard', () => ({
	CalendarInvitationCard: ({ message }: { message: MailMessage }) =>
		message.attachments?.some((attachment) => attachment.content_type === 'text/calendar') ? (
			<div data-testid="invitation-card">Invitation in {message.id}</div>
		) : null,
}))

const CONTROLLED_IMAGE = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`
const MONDAY = 1_790_596_800 // 2026-09-28T12:00:00Z
const TUESDAY = MONDAY + 2 * 86_400

const INES = { name: 'Ines Carvalho', email: 'ines@example.com' }
const TOMAS = { name: 'Tomas Reyes', email: 'tomas@example.com' }
const SAM = { name: 'Sam Reader', email: 'sam@example.com' }

const thread: MailThread = { id: 'thread-1', subject: 'Offsite agenda draft', starred: false }

function email(id: string, from: { name?: string; email: string }, date: number, body: string): MailMessage {
	return { id, from: [from], to: [SAM, INES, TOMAS].filter((person) => person !== from), date, body }
}

const groupMessages: MailMessage[] = [
	{
		...email('m1', INES, MONDAY, 'Here is the first draft of the offsite agenda.'),
		attachments: [{ id: 'a1', filename: 'offsite-agenda-v1.pdf', size: 86_016 }],
	},
	email('m2', TOMAS, MONDAY + 1680, 'Could we use Thursday afternoon for the planning session?'),
	email(
		'm3',
		TOMAS,
		MONDAY + 1740,
		'<div>Also, the retro fits better on <a href="https://rooms.example.com/friday">Friday</a>.</div><div class="gmail_quote">On Mon, Ines wrote:<blockquote>Here is the first draft of the offsite agenda.</blockquote></div>',
	),
	email('m4', SAM, MONDAY + 3000, "Both work for me. I'll check the room."),
	email('m5', INES, TUESDAY, 'Updated and sent the invite. Retro is Friday at 9.'),
]

/**
 * Renders the reader inside a query client. By default the client already
 * holds the header lookup for the test threads ("no bulk mail"), as it would
 * on a second visit, so the transcript is there on the first render. Tests of
 * the lookup itself pass `lookup: 'live'`.
 */
function renderThread(
	messages: MailMessage[] = groupMessages,
	props: Partial<Parameters<typeof ThreadConversation>[0]> = {},
	{
		lookup = 'cached',
		queryClient = new QueryClient(),
	}: { lookup?: 'cached' | 'live'; queryClient?: QueryClient } = {},
) {
	if (lookup === 'cached') {
		for (const id of ['thread-1', 'thread-2'])
			queryClient.setQueryData(mailKeys.threadListUnsubscribe(id), [])
	}
	return render(
		<ThreadConversation thread={thread} messages={messages} mailboxEmail="sam@example.com" {...props} />,
		{ wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
	)
}

function openConversation() {
	fireEvent.click(screen.getByRole('button', { name: 'Conversation view' }))
}

const runs = () => [...document.querySelectorAll<HTMLElement>('[data-slot="conversation-run"]')]
const bubbles = () => [...document.querySelectorAll<HTMLElement>('[data-slot="conversation-bubble"]')]

beforeEach(() => {
	senderImagesTrustedMock.mockReset()
	senderImagesTrustedMock.mockResolvedValue(false)
	trustSenderImagesMock.mockReset()
	trustSenderImagesMock.mockResolvedValue(true)
	getThreadListUnsubscribeMock.mockReset()
	getThreadListUnsubscribeMock.mockResolvedValue({ messageIds: [] })
})

afterEach(() => {
	cleanup()
	localStorage.clear()
})

describe('choosing the Conversation view', () => {
	it('is off by default and flips one thread without changing the saved preference', () => {
		renderThread()
		expect(document.querySelector('[data-slot="thread-messages"]')).not.toBeNull()
		expect(screen.getByRole('button', { name: 'Messages view' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.getByRole('button', { name: 'Conversation view' })).toHaveAttribute('aria-pressed', 'false')

		openConversation()

		expect(document.querySelector('[data-slot="thread-messages"]')).toBeNull()
		expect(document.querySelector('[data-slot="conversation-transcript"]')).not.toBeNull()
		expect(screen.getByRole('button', { name: 'Conversation view' })).toHaveAttribute('aria-pressed', 'true')
		// Expanding and collapsing has no meaning in a transcript.
		expect(screen.queryByRole('button', { name: /Expand all/ })).toBeNull()
		// Only this thread flipped: nothing was written for other threads to pick up.
		expect(localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Messages view' }))
		expect(document.querySelector('[data-slot="thread-messages"]')).not.toBeNull()
	})

	it('opens threads as a conversation once that is the saved preference', async () => {
		writeUserPreferences({ ...defaultUserPreferences(), threadView: 'conversation' })
		renderThread()
		await waitFor(() =>
			expect(document.querySelector('[data-slot="conversation-transcript"]')).not.toBeNull(),
		)
	})

	it('lets a newly chosen default win over an earlier per-thread flip', async () => {
		renderThread()
		openConversation()
		// Choosing "Thread view: Messages" in the command palette re-saves the default
		// the flip was made against, so the flip stands.
		act(() => void writeUserPreferences({ ...defaultUserPreferences(), threadView: 'messages' }))
		expect(document.querySelector('[data-slot="conversation-transcript"]')).not.toBeNull()

		act(() => void writeUserPreferences({ ...defaultUserPreferences(), threadView: 'conversation' }))
		fireEvent.click(screen.getByRole('button', { name: 'Messages view' }))
		expect(document.querySelector('[data-slot="thread-messages"]')).not.toBeNull()
		act(() => void writeUserPreferences({ ...defaultUserPreferences(), threadView: 'messages' }))
		act(() => void writeUserPreferences({ ...defaultUserPreferences(), threadView: 'conversation' }))
		await waitFor(() =>
			expect(document.querySelector('[data-slot="conversation-transcript"]')).not.toBeNull(),
		)
	})

	it('offers the switch on a single plain message, where the reader has no other thread actions', () => {
		renderThread([email('only', INES, MONDAY, 'Just one line.')])
		expect(document.querySelector('[data-slot="thread-actions"]')).toBeNull()
		openConversation()
		expect(bubbles()).toHaveLength(1)
	})
})

describe('first render and identity', () => {
	it('shows a neutral placeholder, not the standard reader, while the saved view is unknown', () => {
		// On the server and while hydrating, nobody knows whether this person reads
		// threads as messages or as a conversation. Painting either would be a guess
		// that flips a frame later.
		const html = renderToString(
			<QueryClientProvider client={new QueryClient()}>
				<ThreadConversation thread={thread} messages={groupMessages} mailboxEmail="sam@example.com" />
			</QueryClientProvider>,
		)
		expect(html).toContain('data-slot="thread-messages-pending"')
		expect(html).toContain('Offsite agenda draft')
		expect(html).not.toContain('data-slot="thread-messages"')
		expect(html).not.toContain('Here is the first draft')
	})

	it('opens straight into the saved view on the first client render', () => {
		writeUserPreferences({ ...defaultUserPreferences(), threadView: 'conversation' })
		renderThread()
		// No waiting: the first committed render is already the transcript.
		expect(document.querySelector('[data-slot="conversation-transcript"]')).not.toBeNull()
		expect(document.querySelector('[data-slot="thread-messages"]')).toBeNull()
	})

	it('never carries one thread\'s flip or "Show original" over to another thread', () => {
		const { rerender } = renderThread()
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Show original message from You' }))
		expect(document.querySelectorAll('[data-slot="conversation-card"]')).toHaveLength(1)

		rerender(
			<ThreadConversation
				thread={{ ...thread, id: 'thread-2', subject: 'Another thread' }}
				messages={groupMessages}
				mailboxEmail="sam@example.com"
			/>,
		)
		expect(document.querySelector('[data-slot="thread-messages"]')).not.toBeNull()
		openConversation()
		expect(document.querySelectorAll('[data-slot="conversation-card"]')).toHaveLength(0)
	})
})

describe('the transcript', () => {
	it('reads as a group chat: sides, names, initials, runs and day separators', () => {
		renderThread()
		openConversation()

		expect(screen.getByText('Ines, Tomas and you · 5 emails')).toBeInTheDocument()
		expect(runs().map((run) => [run.dataset.side, run.getAttribute('aria-label')])).toEqual([
			['them', 'Ines Carvalho, 1 email'],
			['them', 'Tomas Reyes, 2 emails'],
			['me', 'You, 1 email'],
			['them', 'Ines Carvalho, 1 email'],
		])
		// Two emails a minute apart are one run with one name and one time line.
		const tomas = runs()[1] as HTMLElement
		expect(within(tomas).getAllByRole('heading', { name: 'Tomas Reyes' })).toHaveLength(1)
		expect(within(tomas).getByRole('heading', { name: 'Tomas Reyes' })).not.toHaveClass('sr-only')
		expect(tomas.querySelector('[data-slot="sender-avatar"]')).toHaveTextContent('TR')
		expect(tomas.querySelectorAll('[data-slot="conversation-bubble"]')).toHaveLength(2)
		expect(tomas).toHaveTextContent('2 emails')
		// My own run needs no avatar or visible name, but is still named for screen readers.
		const mine = runs()[2] as HTMLElement
		expect(mine.querySelector('[data-slot="sender-avatar"]')).toBeNull()
		expect(within(mine).getByRole('heading', { name: 'You' })).toHaveClass('sr-only')
		expect(mine).toHaveClass('flex-row-reverse')
		expect(document.querySelectorAll('[data-slot="conversation-day"]')).toHaveLength(2)
	})

	it('holds only the newly written text in a bubble; the quote stays behind "Show original"', () => {
		renderThread()
		openConversation()
		const reply = bubbles()[2] as HTMLElement
		expect(reply).toHaveTextContent('Also, the retro fits better on Friday.')
		expect(reply).not.toHaveTextContent('On Mon, Ines wrote')
		expect(reply.querySelector('details')).toBeNull()

		const link = within(reply).getByRole('link', { name: 'Friday' })
		expect(link).toHaveAttribute('href', 'https://rooms.example.com/friday')
		expect(link).toHaveAttribute('target', '_blank')
		expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
	})

	it("tints the reader's own bubbles and keeps everyone else's neutral, with the side as a second signal", () => {
		renderThread()
		openConversation()
		for (const run of runs()) {
			const mine = run.dataset.side === 'me'
			for (const bubble of run.querySelectorAll('[data-slot="conversation-bubble"]')) {
				// Own: the quiet green surface and its own text colour, which links inherit.
				if (mine) expect(bubble).toHaveClass('bg-bubble-own', 'text-bubble-own-foreground')
				else expect(bubble).toHaveClass('bg-muted', 'text-foreground')
				expect(bubble.classList.contains('bg-bubble-own')).toBe(mine)
			}
			// Colour is never the only signal: own runs also sit on the right.
			expect(run.classList.contains('flex-row-reverse')).toBe(mine)
		}
		expect(runs().some((run) => run.dataset.side === 'me')).toBe(true)
	})

	it('draws bubbles as fills, never with a side rail', () => {
		renderThread()
		openConversation()
		for (const bubble of bubbles()) {
			expect(bubble.className).toMatch(/\bbg-(?:muted|bubble-own)\b/)
			expect(bubble.className).not.toMatch(/\bborder|shadow|before:|after:/)
		}
	})

	it('shows participant and subject changes as system lines in the stream', () => {
		const MARA = { name: 'Mara Lindqvist', email: 'mara@example.com' }
		renderThread([
			{
				id: 'a',
				from: [INES],
				to: [SAM, TOMAS],
				date: MONDAY,
				subject: 'Offsite agenda draft',
				body: 'Draft attached.',
			},
			{
				id: 'b',
				from: [INES],
				to: [MARA, SAM],
				cc: [TOMAS],
				date: MONDAY + 60,
				subject: 'Re: Offsite agenda, final',
				body: 'Adding Mara.',
			},
		])
		openConversation()
		const event = document.querySelector('[data-slot="conversation-event"]') as HTMLElement
		expect(event).toHaveTextContent(
			'Ines added Mara Lindqvist · Tomas Reyes moved to Cc · Ines changed the subject to “Offsite agenda, final”',
		)
		// The line sits between the two emails, so they are two runs although a minute apart.
		expect(
			event.compareDocumentPosition(runs()[1] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		expect(runs()).toHaveLength(2)
	})

	it('answers a quoted line under a short reference to it, credited to who wrote it', () => {
		renderThread([
			email('q', TOMAS, MONDAY, 'Could we use Thursday afternoon for the planning session?'),
			email(
				'a',
				INES,
				MONDAY + 3600,
				'<div class="moz-cite-prefix">On 28/09/2026, Tomas wrote:</div><blockquote type="cite">Could we use Thursday afternoon for the planning session?</blockquote><div>Yes, from one.</div>',
			),
		])
		openConversation()
		const answer = bubbles()[1] as HTMLElement
		expect(answer.querySelector('[data-slot="clean-reference"]')).toHaveTextContent(
			'Tomas: Could we use Thursday afternoon for the planning session?',
		)
		expect(answer).toHaveTextContent('Yes, from one.')
		expect(answer).not.toHaveTextContent('wrote:')
		expect(answer.querySelector('details')).toBeNull()
	})

	it('leaves the signature out of the bubble', () => {
		renderThread([email('s', TOMAS, MONDAY, 'See you Thursday.\n\n-- \nTomas Reyes\n+1 555 0100')])
		openConversation()
		expect(bubbles()[0]).toHaveTextContent(/^See you Thursday\.$/)
	})

	it('names nobody in a two-person chat', () => {
		renderThread([
			{ ...email('a', INES, MONDAY, 'Lunch?'), to: [SAM] },
			{ ...email('b', SAM, MONDAY + 3600, 'Yes.'), to: [INES] },
		])
		openConversation()
		expect(screen.getByText('Ines and you · 2 emails')).toBeInTheDocument()
		expect(document.querySelector('[data-slot="sender-avatar"]')).toBeNull()
		for (const heading of screen.getAllByRole('heading', { level: 2 })) expect(heading).toHaveClass('sr-only')
	})

	it('shows a message in full, with a quoted-text disclosure, when it cannot tell what is new', () => {
		renderThread([
			email(
				'fwd',
				INES,
				MONDAY,
				'<div>FYI</div><div class="gmail_quote">---------- Forwarded message ---------<br>From: Desk<br><div>Door code 482913</div></div>',
			),
		])
		openConversation()
		const bubble = bubbles()[0] as HTMLElement
		expect(bubble).toHaveAttribute('data-unsure', 'true')
		// The disclosure starts open: nothing the sender wrote is behind a closed fold.
		expect(within(bubble).getByText('Quoted text').closest('details')).toHaveAttribute('open')
		expect(bubble).toHaveTextContent('Door code 482913')
	})

	it('keeps attachments as chips in the bubble, and says so when a message has no text', () => {
		renderThread([
			groupMessages[0] as MailMessage,
			{
				id: 'files',
				from: [TOMAS],
				date: MONDAY + 3600,
				attachments: [
					{ id: 'a2', filename: 'notes.txt', size: 12 },
					{ id: 'inline', filename: 'logo.png', is_inline: true },
				],
			},
			{ id: 'empty', from: [INES], date: MONDAY + 7200 },
			{ id: 'undated', from: [INES], body: 'No date on this one.' },
		])
		openConversation()

		const first = bubbles()[0] as HTMLElement
		expect(within(first).getByRole('link', { name: /offsite-agenda-v1\.pdf, 84 KB/ })).toHaveAttribute(
			'href',
			'/attachments/a1?message_id=m1',
		)
		const filesOnly = bubbles()[1] as HTMLElement
		expect(within(filesOnly).getAllByRole('link')).toHaveLength(1)
		expect(filesOnly).not.toHaveTextContent('No message text')
		expect(bubbles()[2]).toHaveTextContent('No message text')
		// A message without a date still gets a bubble, just no time.
		expect((runs().at(-1) as HTMLElement).querySelector('time')).toBeNull()
	})

	it('places a calendar invitation in the stream as a card with its actions', () => {
		renderThread([
			{
				...email('invite', INES, MONDAY, 'Invite attached.'),
				attachments: [{ id: 'ics', filename: 'invite.ics', content_type: 'text/calendar' }],
			},
		])
		openConversation()
		const run = runs()[0] as HTMLElement
		expect(within(run).getByTestId('invitation-card')).toHaveTextContent('Invitation in invite')
	})
})

describe('Show original', () => {
	it('switches every email of a run to the standard reader, and each one back on its own', () => {
		renderThread()
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Show original messages from Tomas Reyes' }))

		const cards = [...document.querySelectorAll<HTMLElement>('[data-slot="conversation-card"]')]
		expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
			'Message from Tomas Reyes',
			'Message from Tomas Reyes',
		])
		expect(cards[0]?.querySelector('[data-slot="plain-email-content"]')).toHaveTextContent(
			'Could we use Thursday afternoon',
		)
		expect(runs()).toHaveLength(3)

		fireEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Show in conversation' }))
		expect(document.querySelectorAll('[data-slot="conversation-card"]')).toHaveLength(1)
		expect(runs()).toHaveLength(4)
	})

	it('is never persisted: reopening the thread starts from the transcript again', () => {
		const { unmount } = renderThread()
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Show original message from You' }))
		expect(document.querySelectorAll('[data-slot="conversation-card"]')).toHaveLength(1)
		expect(JSON.stringify({ ...localStorage })).not.toContain('m4')
		unmount()

		renderThread()
		openConversation()
		expect(document.querySelectorAll('[data-slot="conversation-card"]')).toHaveLength(0)
	})

	it('keeps mail the clean view is unsure about in the standard reader, with its attachments', async () => {
		renderThread([
			{
				id: 'receipt',
				from: [{ email: 'billing@shop.example' }],
				body: '<table width="600"><tr><td><img alt="Order 1042" width="600" height="400"></td></tr></table>',
				attachments: [{ id: 'pdf', filename: 'receipt.pdf' }],
			},
		])
		openConversation()
		const card = document.querySelector('[data-slot="conversation-card"]') as HTMLElement
		expect(card).toHaveAttribute('aria-label', 'Message from billing@shop.example')
		expect(await within(card).findByTitle('Email content receipt')).toBeInTheDocument()
		// There is no bubble form of designed mail to go back to.
		expect(within(card).queryByRole('button', { name: /Show (?:in conversation|clean view)/ })).toBeNull()
		expect(within(card).getByRole('link', { name: /receipt\.pdf/ })).toBeInTheDocument()
		expect(card.querySelector('time')).toBeNull()
	})
})

describe('a message shown by the standard reader inside the stream', () => {
	const designed = (id: string, from?: { email: string }): MailMessage => ({
		id,
		...(from ? { from: [from] } : {}),
		body: `<table width="600"><tr><td><img alt="${id}" width="600" height="400"></td></tr></table>`,
	})

	it('keeps the colour choice the reader made for the thread or for that sender', async () => {
		writeUserPreferences({ ...defaultUserPreferences(), threadView: 'conversation' })
		renderThread([designed('auto', { email: 'news@example.com' }), designed('anonymous')])
		expect(await screen.findByTitle('Email content auto')).toHaveAttribute('data-color-mode', 'automatic')
		expect(await screen.findByTitle('Email content anonymous')).toHaveAttribute(
			'data-color-mode',
			'automatic',
		)
		cleanup()

		writeUserPreferences({
			...defaultUserPreferences(),
			threadView: 'conversation',
			emailColorMode: 'original',
		})
		renderThread([designed('original', { email: 'news@example.com' })])
		expect(await screen.findByTitle('Email content original')).toHaveAttribute('data-color-mode', 'original')
	})

	it('still gets a place and a reply line when it has no sender', () => {
		renderThread([{ id: 'anonymous', body: 'No sender on this one.' }], {
			reply: { onReply: vi.fn(), onReplyAll: vi.fn() },
		})
		openConversation()
		expect(runs()[0]).toHaveAttribute('aria-label', '(unknown sender), 1 email')
		expect(document.querySelector('[data-slot="conversation-reply-recipients"]')).toHaveTextContent(
			'To no recipients yet',
		)
	})
})

describe('designed mail', () => {
	const NEWSLETTER = `<table role="presentation" width="600"><tr><td style="font-size:26px">Issue 112</td></tr>
		<tr><td>Three small utilities we kept using all month, and one we stopped. ${'More body copy. '.repeat(12)}</td></tr>
		<tr><td><img src="${CONTROLLED_IMAGE}" alt="Desk" width="600" height="200"></td></tr>
		<tr><td bgcolor="#1f5c3d"><a href="https://fieldnotes.example/112">Read the issue</a></td></tr>
		<tr><td><a href="https://fieldnotes.example/unsubscribe">Unsubscribe</a></td></tr></table>`
	const newsletter = (id: string, date?: number): MailMessage => ({
		id,
		from: [{ name: 'Fieldnotes Weekly', email: 'news@fieldnotes.example' }],
		to: [SAM],
		...(date ? { date } : {}),
		body: NEWSLETTER,
		attachments: [{ id: `${id}-pdf`, filename: 'issue.pdf' }],
	})
	const articles = () => [...document.querySelectorAll<HTMLElement>('[data-slot="conversation-article"]')]

	it('appears in a chat as a full-width article card in app typography', () => {
		renderThread([email('m1', INES, MONDAY, 'Did you see this?'), newsletter('news', MONDAY + 60)])
		openConversation()

		const article = articles()[0] as HTMLElement
		expect(article).toHaveAttribute('aria-label', 'Message from Fieldnotes Weekly')
		expect(within(article).getByRole('heading', { level: 2, name: 'Issue 112' })).toBeInTheDocument()
		expect(within(article).getByRole('link', { name: 'Read the issue' })).toHaveAttribute('data-cta', 'true')
		expect(within(article).getByRole('link', { name: 'Unsubscribe' })).toHaveAttribute(
			'href',
			'https://fieldnotes.example/unsubscribe',
		)
		expect(within(article).getByRole('link', { name: /issue\.pdf/ })).toBeInTheDocument()
		// The sender's table never reaches the app DOM, and the text keeps the 72ch measure.
		expect(article.querySelector('table')).toBeNull()
		const card = article.querySelector('[data-slot="clean-blocks"]')?.parentElement as HTMLElement
		expect(card).toHaveClass('max-w-[72ch]', 'border', 'border-border')
		expect(card.className).not.toMatch(/border-[lrtbsexy]-/)
		expect(runs()).toHaveLength(1)
	})

	it('opens as an article, not a chat, when the thread is only designed mail', () => {
		renderThread([newsletter('one', MONDAY), newsletter('two')], {
			reply: { onReply: vi.fn(), onReplyAll: vi.fn() },
			children: <p>standard reply field</p>,
		})
		openConversation()

		expect(articles()).toHaveLength(2)
		expect(document.querySelector('[data-slot="conversation-participants"]')).toBeNull()
		expect(document.querySelector('[data-slot="conversation-day"]')).toBeNull()
		// No chat input under an article; the standard reply control stays.
		expect(document.querySelector('[data-slot="conversation-reply"]')).toBeNull()
		expect(screen.getByText('standard reply field')).toBeInTheDocument()
		// On its own the article is the page, not a card.
		const page = articles()[0]?.querySelector('[data-slot="clean-blocks"]')?.parentElement as HTMLElement
		expect(page).toHaveClass('max-w-[72ch]')
		expect(page).not.toHaveClass('border')
		expect(articles()[0]?.querySelector('time')).not.toBeNull()
		expect(articles()[1]?.querySelector('time')).toBeNull()
	})

	it('shows the original on request and returns to the clean view', async () => {
		renderThread([newsletter('news', MONDAY)])
		openConversation()
		fireEvent.click(within(articles()[0] as HTMLElement).getByRole('button', { name: 'Show original' }))

		expect(await screen.findByTitle('Email content news')).toBeInTheDocument()
		expect(articles()).toHaveLength(0)
		fireEvent.click(screen.getByRole('button', { name: 'Show clean view' }))
		expect(articles()).toHaveLength(1)
	})

	it('offers Clean or Original layouts in the thread display menu, and remembers the choice', async () => {
		renderThread([email('m1', INES, MONDAY, 'Did you see this?'), newsletter('news', MONDAY + 60)])
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))

		expect(await screen.findByRole('button', { name: 'Clean' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.queryByRole('button', { name: 'Readable' })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Original' }))

		expect(await screen.findByTitle('Email content news')).toHaveAttribute('data-layout-mode', 'original')
		expect(articles()).toHaveLength(0)
		expect(JSON.parse(localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? '{}').emailLayoutMode).toBe(
			'original',
		)

		fireEvent.click(screen.getByRole('button', { name: 'Clean' }))
		await waitFor(() => expect(articles()).toHaveLength(1))
		expect(JSON.parse(localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? '{}').emailLayoutMode).toBe(
			'clean',
		)
	})

	it('offers the layout choice for an article that has no images to load', async () => {
		renderThread([
			{
				id: 'notice',
				from: [{ email: 'desk@venue.example' }],
				body: `<table width="600"><tr><td>Room 4B is confirmed. ${'Details follow. '.repeat(12)}</td></tr></table>`,
			},
		])
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		expect(await screen.findByRole('button', { name: 'Clean' })).toHaveAttribute('aria-pressed', 'true')
		expect(screen.queryByRole('button', { name: 'Show images in this thread' })).toBeNull()
	})

	it('uses the List-Unsubscribe header, looked up only for this view, as one more sign of bulk mail', async () => {
		const letter: MailMessage = {
			id: 'list-mail',
			from: [{ name: 'Harbor Residents List', email: 'residents@lists.example' }],
			to: [SAM],
			body: '<p>Hello all, the residents meeting moved to Thursday at seven.</p>',
		}
		getThreadListUnsubscribeMock.mockResolvedValue({ messageIds: ['list-mail'] })
		const queryClient = new QueryClient()
		const first = renderThread(
			[email('m1', INES, MONDAY, 'Did you see this?'), letter],
			{},
			{ lookup: 'live', queryClient },
		)
		// The standard reader never asks for headers.
		expect(getThreadListUnsubscribeMock).not.toHaveBeenCalled()

		openConversation()
		// Until the answer is in, the transcript is the skeleton block: the letter is
		// never painted as a bubble and then re-drawn as an article.
		expect(document.querySelector('[data-slot="thread-messages-pending"]')).not.toBeNull()
		expect(bubbles()).toHaveLength(0)
		await waitFor(() => expect(articles()).toHaveLength(1))
		expect(getThreadListUnsubscribeMock).toHaveBeenCalledWith({ data: { threadId: 'thread-1' } })
		expect(articles()[0]).toHaveTextContent('the residents meeting moved to Thursday')
		first.unmount()

		// The answer is kept per account and thread: coming back asks nothing and shows no skeleton.
		expect(queryClient.getQueryData(['mail', accountScope(), 'thread-list-unsubscribe', 'thread-1'])).toEqual(
			['list-mail'],
		)
		renderThread(
			[email('m1', INES, MONDAY, 'Did you see this?'), letter],
			{},
			{ lookup: 'live', queryClient },
		)
		openConversation()
		expect(articles()).toHaveLength(1)
		expect(getThreadListUnsubscribeMock).toHaveBeenCalledTimes(1)
	})

	it('classifies on the message bodies alone when the header lookup fails', async () => {
		const letter: MailMessage = {
			id: 'list-mail',
			from: [INES],
			body: '<p>Hello all, the meeting moved.</p>',
		}
		getThreadListUnsubscribeMock.mockRejectedValue(new Error('offline'))
		renderThread([letter], {}, { lookup: 'live' })
		openConversation()
		await waitFor(() => expect(bubbles()).toHaveLength(1))
		expect(articles()).toHaveLength(0)
	})

	it('folds navigation and the footer of an article into one disclosure, and keeps a receipt table', () => {
		renderThread([
			{
				id: 'receipt',
				from: [{ email: 'billing@shop.example' }],
				body: `<table role="presentation" width="600"><tr><td>Thanks for your order, Sam. ${'It is on its way. '.repeat(10)}</td></tr>
					<tr><td><table><tr><th>Item</th><th>Price</th></tr><tr><td>Notebook</td><td>$18.00</td></tr></table></td></tr>
					<tr><td>Questions about this order are answered within a day.</td></tr>
					<tr><td>© Harbor &amp; Pine · <a href="https://shop.example/unsubscribe">Unsubscribe</a></td></tr></table>`,
			},
		])
		openConversation()
		const article = articles()[0] as HTMLElement
		expect(within(article).getByRole('columnheader', { name: 'Price' })).toBeInTheDocument()
		expect(within(article).getByRole('cell', { name: '$18.00' })).toBeInTheDocument()
		const footer = article.querySelector('[data-slot="clean-footer"]') as HTMLElement
		expect(footer.querySelector('summary')).toHaveTextContent('Footer, 1 link including Unsubscribe')
		expect(within(footer).getByRole('link', { name: 'Unsubscribe', hidden: true })).toHaveAttribute(
			'href',
			'https://shop.example/unsubscribe',
		)
	})

	it('lays a stored clean layout out as readable in the standard reader', async () => {
		writeUserPreferences({ ...defaultUserPreferences(), emailLayoutMode: 'clean' })
		renderThread([newsletter('news', MONDAY)])
		// The standard reader has no clean layout: it shows the email as Readable.
		expect(await screen.findByTitle('Email content news')).toHaveAttribute('data-layout-mode', 'readable')
		expect(articles()).toHaveLength(0)
	})

	it('keeps article images behind the same consent as the standard reader', async () => {
		renderThread([newsletter('news', MONDAY)])
		openConversation()
		expect(within(articles()[0] as HTMLElement).getByText('Image: Desk')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Show images in this thread' }))
		expect(screen.getByRole('img', { name: 'Desk' })).toHaveAttribute('src', CONTROLLED_IMAGE)
	})
})

describe('remote images in bubbles', () => {
	const withImage = [
		email('pic', INES, MONDAY, `<p>See the chart</p><img src="${CONTROLLED_IMAGE}" alt="Q3 chart">`),
	]

	it('stay blocked until the reader allows them from the thread display menu', async () => {
		renderThread(withImage)
		openConversation()
		expect(screen.getByText('Image: Q3 chart')).toBeInTheDocument()
		expect(document.querySelector('[data-slot="conversation-bubble"] img')).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Show images in this thread' }))

		expect(screen.getByRole('img', { name: 'Q3 chart' })).toHaveAttribute('src', CONTROLLED_IMAGE)
	})

	it('load for a sender the reader trusts now, or trusted before', async () => {
		renderThread(withImage)
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: /Always show from ines@example\.com/ }))
		expect(await screen.findByRole('img', { name: 'Q3 chart' })).toBeInTheDocument()
		cleanup()

		senderImagesTrustedMock.mockResolvedValue(true)
		renderThread(withImage)
		openConversation()
		expect(await screen.findByRole('img', { name: 'Q3 chart' })).toBeInTheDocument()
	})

	it('load at once when the reader always shows images', async () => {
		writeUserPreferences({
			...defaultUserPreferences(),
			remoteImagePolicy: 'always',
			threadView: 'conversation',
		})
		renderThread(withImage)
		expect(await screen.findByRole('img', { name: 'Q3 chart' })).toBeInTheDocument()
	})

	it('stop being reported once the message is shown by the standard reader instead', async () => {
		const { unmount } = renderThread(withImage)
		openConversation()
		fireEvent.click(screen.getByRole('button', { name: 'Show original message from Ines Carvalho' }))
		expect(await screen.findByTitle('Email content pic')).toBeInTheDocument()
		unmount()
	})

	it('ignore a trust lookup that answers after the thread was closed', async () => {
		let answer: (trusted: boolean) => void = () => {}
		senderImagesTrustedMock.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)))
		const { unmount } = renderThread(withImage)
		openConversation()
		unmount()
		await act(async () => answer(true))
		expect(document.querySelector('img')).toBeNull()
	})
})

describe('link preview', () => {
	it('shows where a link really goes while it is hovered or focused', () => {
		renderThread()
		openConversation()
		const link = screen.getByRole('link', { name: 'Friday' })

		fireEvent.mouseOver(link, { clientX: 10, clientY: 20 })
		expect(document.querySelector('[data-slot="link-preview"]')).toHaveTextContent(
			'https://rooms.example.com/friday',
		)
		fireEvent.mouseOut(link)
		expect(document.querySelector('[data-slot="link-preview"]')).toBeNull()

		fireEvent.focus(link)
		expect(document.querySelector('[data-slot="link-preview"]')).not.toBeNull()
		fireEvent.blur(link)
		expect(document.querySelector('[data-slot="link-preview"]')).toBeNull()

		fireEvent.mouseOver(screen.getByText("Both work for me. I'll check the room."))
		expect(document.querySelector('[data-slot="link-preview"]')).toBeNull()
	})
})

describe('replying', () => {
	const reply = () => ({ onReply: vi.fn(), onReplyAll: vi.fn() })

	it('defaults to reply-all in a group and always names who will receive the reply', () => {
		const handlers = reply()
		renderThread(groupMessages, { reply: handlers, children: <p>inline reply field</p> })
		openConversation()

		// The pinned input replaces the standard reader's inline reply field.
		expect(screen.queryByText('inline reply field')).toBeNull()
		expect(document.querySelector('[data-slot="conversation-reply-recipients"]')).toHaveTextContent(
			/^To Ines Carvalho, Tomas Reyes$/,
		)
		// The reply-all flow addresses everyone in To and sends no Cc; the bar says so.
		expect(document.querySelector('[data-slot="conversation-reply"]')).toHaveTextContent(
			'No Cc or Bcc · add them in the composer',
		)
		fireEvent.click(screen.getByRole('button', { name: /Reply to all…/ }))
		expect(handlers.onReplyAll).toHaveBeenCalledTimes(1)
		expect(handlers.onReply).not.toHaveBeenCalled()
	})

	it('replies to one person only after an explicit, visible choice', () => {
		const handlers = reply()
		renderThread(groupMessages, { reply: handlers })
		openConversation()

		const only = screen.getByRole('button', { name: 'Reply only to Ines Carvalho' })
		expect(only).toHaveAttribute('aria-pressed', 'false')
		fireEvent.click(only)

		expect(document.querySelector('[data-slot="conversation-reply-recipients"]')).toHaveTextContent(
			/^To Ines Carvalho$/,
		)
		fireEvent.click(screen.getByRole('button', { name: /Reply to Ines Carvalho…/ }))
		expect(handlers.onReply).toHaveBeenCalledTimes(1)
		expect(handlers.onReplyAll).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: 'Reply to all' }))
		expect(screen.getByRole('button', { name: /Reply to all…/ })).toBeInTheDocument()
	})

	it('offers a plain reply in a two-person chat, addressed to the other person', () => {
		const handlers = reply()
		renderThread(
			[
				{ ...email('a', { email: 'ines@example.com' }, MONDAY, 'Lunch?'), to: [SAM] },
				{ ...email('b', SAM, MONDAY + 3600, 'Yes.'), to: [{ email: 'ines@example.com' }] },
			],
			{ reply: handlers },
		)
		openConversation()
		expect(screen.queryByRole('button', { name: /Reply only to/ })).toBeNull()
		expect(document.querySelector('[data-slot="conversation-reply-recipients"]')).toHaveTextContent(
			/^To ines@example.com$/,
		)
		fireEvent.click(screen.getByRole('button', { name: /Reply…/ }))
		expect(handlers.onReplyAll).toHaveBeenCalledTimes(1)
	})

	it('says so when a reply has nobody to go to yet', () => {
		renderThread([{ id: 'note', from: [SAM], body: 'Note to self.' }], {
			reply: reply(),
			mailboxEmail: undefined,
		})
		openConversation()
		expect(document.querySelector('[data-slot="conversation-reply-recipients"]')).toHaveTextContent(
			/^To Sam Reader$/,
		)
		cleanup()

		renderThread([{ id: 'note', from: [SAM], body: 'Note to self.' }], { reply: reply() })
		openConversation()
		expect(document.querySelector('[data-slot="conversation-reply-recipients"]')).toHaveTextContent(
			'To no recipients yet',
		)
	})

	it('names exactly the recipients the composer will be opened with, and expands a long list', () => {
		const people = ['ana', 'ben', 'cy', 'dee', 'eli'].map((name) => ({ email: `${name}@example.com` }))
		const last: MailMessage = {
			id: 'big',
			from: [INES],
			to: [SAM, ...people.slice(0, 3)],
			cc: people.slice(3),
			reply_to: [{ email: 'list@example.com' }],
			date: MONDAY,
			body: 'To the whole group.',
		}
		renderThread([last], { reply: reply() })
		openConversation()
		const line = () => document.querySelector('[data-slot="conversation-reply-recipients"]')
		// The same function the composer hand-off uses decides the set: everyone
		// but the reader, all in To, with the Reply-To address first.
		const everyone = replyAllDraftSearch(last, 'sam@example.com').to.split(', ')
		expect(everyone).toHaveLength(7)

		expect(line()).toHaveTextContent(/^To list@example\.com, Ines Carvalho, ana@example\.com$/)
		const more = screen.getByRole('button', { name: 'and 4 more' })
		expect(more).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(more)
		for (const email of everyone.slice(2)) expect(line()).toHaveTextContent(email)
		expect(line()).not.toHaveTextContent('sam@example.com')
		expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')

		// Choosing to reply to one person starts again from the short list.
		// The one person is whoever a reply actually reaches: here the Reply-To address.
		fireEvent.click(screen.getByRole('button', { name: 'Reply only to list@example.com' }))
		expect(line()).toHaveTextContent(/^To list@example\.com$/)
		expect(screen.queryByRole('button', { name: /more|fewer/ })).toBeNull()
	})

	it('keeps whatever follows the thread when no reply entry points are supplied', () => {
		renderThread(groupMessages, { children: <p>after the thread</p> })
		openConversation()
		expect(screen.getByText('after the thread')).toBeInTheDocument()
		expect(document.querySelector('[data-slot="conversation-reply"]')).toBeNull()
	})
})
