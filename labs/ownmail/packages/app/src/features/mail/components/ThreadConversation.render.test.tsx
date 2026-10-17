// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	act,
	cleanup,
	fireEvent,
	type RenderOptions,
	render as renderInDom,
	screen,
	waitFor,
	within,
} from '@testing-library/react'
import { type ReactElement, type ReactNode, useLayoutEffect } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAccountScope, setAccountScope } from '#app/lib/account-scope'
import { defaultUserPreferences, UserPreferencesProvider } from '#app/preferences/user-preferences'
import { EMAIL_ELEMENT_TAG, EMAIL_LAYOUT_STATUS_EVENT } from '../lib/email-render'
import type { MailMessage, MailThread } from '../state/mail-queries'
import {
	THREAD_MAP_DOCK_ID,
	THREAD_MOBILE_MORE_ID,
	THREAD_TOOLBAR_ACTIONS_ID,
	THREAD_TOOLBAR_MORE_ID,
	ThreadConversation,
} from './ThreadConversation'
import { ThreadSummaryProvider } from './thread-summary'

const { trustSenderImagesMock, originalColorSendersMock, setSenderOriginalColorsMock, compose } = vi.hoisted(
	() => ({
		trustSenderImagesMock: vi.fn(),
		originalColorSendersMock: vi.fn(),
		setSenderOriginalColorsMock: vi.fn(),
		compose: {
			openCompose: vi.fn(async () => {}),
			composing: null,
			registerInlineSlot: vi.fn(),
		},
	}),
)
vi.mock('../lib/image-sender-trust', async (importOriginal) => ({
	...(await importOriginal<typeof import('../lib/image-sender-trust')>()),
	trustSenderImages: trustSenderImagesMock,
	originalColorSenders: originalColorSendersMock,
	setSenderOriginalColors: setSenderOriginalColorsMock,
}))
vi.mock('./ComposeProvider', () => ({ useCompose: () => compose }))
// The side-thread lookup searches the mailbox; here it finds nothing unless a test says so.
const { getThreadsMock } = vi.hoisted(() => ({ getThreadsMock: vi.fn() }))
vi.mock('#server/fns', async (importOriginal) => ({
	...(await importOriginal<typeof import('#server/fns')>()),
	getThreads: getThreadsMock,
}))

/** The reader always sits inside the app's query client; every render here gets a fresh one. */
let queryClient: QueryClient
function Providers({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
const render = (ui: ReactElement, options?: RenderOptions) =>
	renderInDom(ui, { wrapper: Providers, ...options })
// The invitation card is the real one; its event and its earlier file come from these.
const { getCalendarInvitationMock, getInvitationFileTimeMock } = vi.hoisted(() => ({
	getCalendarInvitationMock: vi.fn(),
	getInvitationFileTimeMock: vi.fn(),
}))
vi.mock('#features/calendar/server/calendar-invitation-fns', () => ({
	getCalendarInvitation: getCalendarInvitationMock,
	respondCalendarInvitation: vi.fn(),
	addCalendarInvitation: vi.fn(),
}))
vi.mock('../server/invitation-file-time.js', () => ({ getInvitationFileTime: getInvitationFileTimeMock }))

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
	localStorage.clear()
	resetAccountScope()
	window.location.hash = ''
	vi.unstubAllGlobals()
})

beforeEach(() => {
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	getThreadsMock.mockReset()
	getThreadsMock.mockResolvedValue({ threads: [] })
	getCalendarInvitationMock.mockReset().mockResolvedValue({
		state: 'ready',
		title: 'Design review',
		organizer: 'Grace Hopper',
		when: { kind: 'timed', start: NOW + DAY, end: NOW + DAY + 2700 },
		status: 'noreply',
		conflicts: { state: 'clear' },
	})
	getInvitationFileTimeMock.mockReset().mockResolvedValue({ start: NOW + DAY - 3600, end: NOW + DAY - 900 })
	setAccountScope('ada@ownmail.com')
	trustSenderImagesMock.mockReset()
	originalColorSendersMock.mockReset()
	originalColorSendersMock.mockResolvedValue([])
	setSenderOriginalColorsMock.mockReset()
	setSenderOriginalColorsMock.mockResolvedValue(true)
	compose.openCompose.mockClear()
})

const CONTROLLED_IMAGE = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`
const DAY = 86_400
const NOW = Math.floor(Date.now() / 1000)

function thread(id: string): MailThread {
	return { id, subject: `Thread ${id}`, starred: false }
}

function message(id: string): MailMessage {
	return {
		id,
		from: [{ email: 'sender@example.com' }],
		to: [{ email: 'reader@example.com' }],
		body: `Message ${id}`,
	}
}

function htmlMessage(id: string, sender = 'sender@example.com'): MailMessage {
	return {
		...message(id),
		from: [{ email: sender }],
		body: `<img class="remote-${id}" src="${CONTROLLED_IMAGE}" width="600" height="200"><table width="800"><tr><td>${id}</td></tr></table>`,
	}
}

const GRACE = { name: 'Grace Hopper', email: 'grace@example.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@example.com' }
const ADA = { name: 'Ada Lovelace', email: 'ada@ownmail.com' }

/** A thread of `count` messages between Grace, Alan and Ada, a day apart, the last `unread` of them unread. */
function longThread(count: number, unread = 0): MailMessage[] {
	return Array.from({ length: count }, (_, index) => {
		const from = [GRACE, ALAN, ADA][index % 3] as typeof GRACE
		return {
			id: `m${index + 1}`,
			from: [from],
			to: [GRACE, ALAN, ADA].filter((person) => person !== from),
			date: NOW - (count - index) * DAY,
			body: `Note ${index + 1} about the plan.`,
			...(index >= count - unread ? { unread: true } : {}),
		}
	})
}

const states = () =>
	[...document.querySelectorAll('[data-slot="thread-message"]')].map((node) =>
		node.getAttribute('aria-label'),
	)

function openMore() {
	fireEvent.click(screen.getByRole('button', { name: 'More' }))
	return screen.getByRole('menu', { name: 'Thread actions' })
}

function expandAll(count: number) {
	openMore()
	fireEvent.click(screen.getByRole('menuitem', { name: `Expand all ${count} messages` }))
}

function ConversationProbe({
	threadId,
	messageId,
	onLayout,
}: {
	threadId: string
	messageId: string
	onLayout: (threadId: string, expanded: string | null) => void
}) {
	useLayoutEffect(() => {
		onLayout(
			threadId,
			document.querySelector('[data-slot="thread-message"]')?.getAttribute('data-state') ?? null,
		)
	}, [onLayout, threadId])

	return <ThreadConversation thread={thread(threadId)} messages={[message(messageId)]} />
}

describe('ThreadConversation rendering', () => {
	it('opens the latest message before layout when the conversation changes', () => {
		const layoutStates: Array<string | null> = []
		const onLayout = (_threadId: string, expanded: string | null) => layoutStates.push(expanded)
		const rendered = render(<ConversationProbe threadId="t1" messageId="m1" onLayout={onLayout} />)

		rendered.rerender(<ConversationProbe threadId="t2" messageId="m2" onLayout={onLayout} />)

		expect(layoutStates).toEqual(['open', 'open'])
	})

	it('hands each open message to the message header, with the message above only when it is open above it', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(3)} mailboxEmail="ada@ownmail.com" />,
		)
		expandAll(3)
		const headers = screen.getAllByRole('heading', { level: 2 })
		expect(headers.map((heading) => heading.textContent)).toEqual(['Grace Hopper', 'Alan Turing', 'You'])
		// The first message has nothing open above it, so its recipients are named.
		const summaries = document.querySelectorAll('[data-slot="recipient-summary"]')
		expect(summaries[0]).toHaveTextContent('to you, Alan')
		// Alan replied to everyone Grace's message involved.
		expect(summaries[1]).toHaveTextContent('to everyone')
	})

	it('expands and collapses every message from the More menu, which says when nothing is left to do', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2'), message('m3')]} />,
		)
		const menu = openMore()
		// The menu floats over the reader: panel glass, one layer deep.
		expect(menu).toHaveClass('glass-panel')
		const expand = within(menu).getByRole('menuitem', { name: 'Expand all 3 messages' })
		expect(expand).toBeEnabled()
		fireEvent.click(expand)
		expect(document.querySelectorAll('[data-slot="thread-message"][data-state="open"]')).toHaveLength(3)
		expect(screen.queryByRole('menu')).toBeNull()

		openMore()
		expect(screen.getByRole('menuitem', { name: 'Expand all 3 messages' })).toBeDisabled()
		fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse all 3 messages' }))
		expect(document.querySelectorAll('[data-slot="thread-message"][data-state="open"]')).toHaveLength(0)
		// Each collapsed message is a one-line row that opens with one click.
		const rows = document.querySelectorAll<HTMLButtonElement>('[data-slot="message-expand"]')
		expect(rows).toHaveLength(3)
		openMore()
		expect(screen.getByRole('menuitem', { name: 'Collapse all 3 messages' })).toBeDisabled()
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
		fireEvent.click(rows[1] as HTMLButtonElement)
		expect(document.querySelectorAll('[data-slot="thread-message"][data-state="open"]')).toHaveLength(1)
	})

	it('renders one thread display menu and applies layout and color choices to every message', async () => {
		document.documentElement.classList.add('dark')
		const { container } = render(
			<ThreadConversation
				thread={thread('display-thread')}
				messages={[htmlMessage('m1'), htmlMessage('m2')]}
			/>,
		)
		const trigger = screen.getByRole('button', { name: 'Thread display' })
		expect(screen.getAllByRole('button', { name: 'Thread display' })).toHaveLength(1)
		expect(trigger.closest('[data-slot="thread-message"]')).toBeNull()

		expandAll(2)
		const emailElements = [...container.querySelectorAll<HTMLElement>(EMAIL_ELEMENT_TAG)]
		expect(emailElements).toHaveLength(2)
		act(() => {
			emailElements[0]?.dispatchEvent(
				new CustomEvent(EMAIL_LAYOUT_STATUS_EVENT, {
					detail: {
						mode: 'readable',
						naturalWidth: 800,
						containerWidth: 320,
						scale: 1,
						reflowed: true,
						needsFit: false,
					},
				}),
			)
		})

		fireEvent.click(trigger)
		expect(screen.getByRole('dialog', { name: 'Thread display' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Original' }))
		fireEvent.click(screen.getByRole('button', { name: 'Original message colors' }))
		await waitFor(() => {
			for (const element of emailElements) {
				expect(element).toHaveAttribute('data-layout-mode', 'original')
				expect(element).toHaveAttribute('data-color-mode', 'original')
			}
		})
		expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
			emailLayoutMode: 'original',
			emailColorMode: 'original',
		})

		fireEvent.keyDown(document, { key: 'Escape' })
		expect(screen.queryByRole('dialog', { name: 'Thread display' })).toBeNull()
		expect(trigger).toHaveFocus()
	})

	it('loads remote images for the current thread, including messages expanded later', async () => {
		const rendered = render(
			<ThreadConversation
				thread={thread('image-thread')}
				messages={[htmlMessage('m1'), htmlMessage('m2')]}
			/>,
		)
		const latestImage = () =>
			rendered.container
				.querySelector<HTMLElement>(EMAIL_ELEMENT_TAG)
				?.shadowRoot?.querySelector<HTMLImageElement>('.remote-m2')
		expect(latestImage()).not.toHaveAttribute('src')

		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Show images in this thread' }))
		await waitFor(() => expect(latestImage()).toHaveAttribute('src', CONTROLLED_IMAGE))

		expandAll(2)
		await waitFor(() => {
			const images = [...rendered.container.querySelectorAll<HTMLElement>(EMAIL_ELEMENT_TAG)].map((element) =>
				element.shadowRoot?.querySelector<HTMLImageElement>('img'),
			)
			expect(images).toHaveLength(2)
			for (const image of images) expect(image).toHaveAttribute('src', CONTROLLED_IMAGE)
		})

		rendered.rerender(<ThreadConversation thread={thread('another-thread')} messages={[htmlMessage('m3')]} />)
		await waitFor(() =>
			expect(
				rendered.container.querySelector<HTMLElement>(EMAIL_ELEMENT_TAG)?.shadowRoot?.querySelector('img'),
			).not.toHaveAttribute('src'),
		)
	})

	it('keeps persistent sender trust unavailable when blocked images have multiple senders', async () => {
		render(
			<ThreadConversation
				thread={thread('multi-sender')}
				messages={[htmlMessage('m1', 'alex@example.com'), htmlMessage('m2', 'sam@example.com')]}
			/>,
		)
		expandAll(2)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))

		expect(await screen.findByRole('button', { name: 'Show images in this thread' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Always show from/ })).toBeNull()
	})

	it('persists a single sender image choice and applies it across the current thread', async () => {
		trustSenderImagesMock.mockResolvedValue(true)
		const rendered = render(
			<ThreadConversation
				thread={thread('trusted-sender')}
				messages={[htmlMessage('m1'), htmlMessage('m2')]}
			/>,
		)
		expandAll(2)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Always show from sender@example.com' }))

		// The choice is saved for this inbox only.
		await waitFor(() =>
			expect(trustSenderImagesMock).toHaveBeenCalledWith('sender@example.com', 'ada@ownmail.com'),
		)
		await waitFor(() => {
			const images = [...rendered.container.querySelectorAll<HTMLElement>(EMAIL_ELEMENT_TAG)].map((element) =>
				element.shadowRoot?.querySelector<HTMLImageElement>('img'),
			)
			for (const image of images) expect(image).toHaveAttribute('src', CONTROLLED_IMAGE)
		})
	})

	it('fails closed with a generic error when sender image trust cannot be saved', async () => {
		trustSenderImagesMock.mockResolvedValue(false)
		render(<ThreadConversation thread={thread('trust-error')} messages={[htmlMessage('m1')]} />)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Always show from sender@example.com' }))

		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that image choice. Try again.')
	})

	it('applies the global image choice and retries failed images from the thread menu', async () => {
		const rendered = render(
			<ThreadConversation thread={thread('global-images')} messages={[htmlMessage('m1')]} />,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Always show all' }))
		await waitFor(() =>
			expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}')).toMatchObject({
				remoteImagePolicy: 'always',
			}),
		)

		const image = rendered.container
			.querySelector<HTMLElement>(EMAIL_ELEMENT_TAG)
			?.shadowRoot?.querySelector<HTMLImageElement>('img') as HTMLImageElement
		await waitFor(() => expect(image).toHaveAttribute('src', CONTROLLED_IMAGE))
		fireEvent.error(image)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Retry images' }))
		await waitFor(() => expect(image.src).toContain('retry=1'))
	})

	it('leads with the subject, then who is on the thread, how long it is, its span and its files', () => {
		const withFile = {
			...longThread(3)[0],
			attachments: [{ id: 'a1', filename: 'roadmap.pdf', size: 2048, is_inline: false }],
		} as MailMessage
		const { container } = render(
			<ThreadConversation
				thread={{ ...thread('t1'), subject: 'Q3 roadmap', folders: ['work'] }}
				messages={[withFile, ...longThread(3).slice(1)]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement
		// The subject scrolls away with the conversation: nothing in the summary is pinned.
		expect(summary.className).not.toMatch(/sticky|top-0|border-b/)
		expect(summary.firstElementChild).toHaveAttribute('data-slot', 'thread-column')
		const subject = screen.getByRole('heading', { level: 1, name: 'Q3 roadmap' })
		expect(subject).toHaveClass('reader-title')
		expect(container.querySelector('[data-slot="subject-stand-in"]')).toBeNull()

		const meta = container.querySelector('[data-slot="thread-meta"]') as HTMLElement
		expect(within(meta).getByText('Grace, Alan, you')).toHaveClass('font-medium', 'text-foreground')
		expect(meta).toHaveTextContent('3 messages')
		expect(container.querySelector('[data-slot="thread-span"]')).toHaveTextContent(/–\s*yesterday$/)
		// Labels follow the meta line.
		expect(screen.getByText('Work').closest('.reader-labels')).not.toBeNull()

		const files = within(meta).getByRole('button', { name: '1 file' })
		expect(files).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(files)
		expect(files).toHaveAttribute('aria-expanded', 'true')
		const shelf = screen.getByRole('region', { name: 'Files in this thread' })
		expect(files).toHaveAttribute('aria-controls', shelf.parentElement?.id)
		const open = vi.spyOn(window, 'open').mockReturnValue(null)
		fireEvent.click(within(shelf).getByRole('button', { name: /^Open roadmap\.pdf/ }))
		expect(open).toHaveBeenCalledWith('/attachments/a1?message_id=m1', '_blank', 'noopener')
		const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
		fireEvent.click(within(shelf).getByRole('button', { name: 'Download all' }))
		expect(clicks).toHaveBeenCalledTimes(1)
		fireEvent.click(files)
		expect(screen.queryByRole('region', { name: 'Files in this thread' })).toBeNull()
	})

	it('names four people and counts the rest', () => {
		const people = ['Grace', 'Alan', 'Katherine', 'Mary', 'Dorothy'].map((name) => ({
			name: `${name} Example`,
			email: `${name.toLowerCase()}@example.com`,
		}))
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[
					{ ...message('m1'), from: [people[0] as (typeof people)[0]], to: [ADA, ...people.slice(1)] },
				]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		expect(document.querySelector('[data-slot="thread-participants"]')).toHaveTextContent(
			'Grace, Alan, Katherine, you +2',
		)
	})

	it('stands the first line in for a missing subject and says so', () => {
		render(
			<ThreadConversation
				thread={{ ...thread('t1'), subject: '' }}
				messages={[{ ...message('m1'), body: 'Can you send me the Lisbon hotel confirmation number?' }]}
			/>,
		)
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Can you send me the Lisbon hotel…')
		expect(screen.getByText('No subject. Showing the first line instead.')).toBeInTheDocument()
	})

	it('shows each file of an open message as a chip with its size and the version it replaces', async () => {
		const v1 = {
			...longThread(2)[0],
			attachments: [{ id: 'a1', filename: 'plan-v1.pdf', size: 1024, is_inline: false }],
		} as MailMessage
		const v2 = {
			...longThread(2)[1],
			attachments: [
				{ id: 'a2', filename: 'plan-v2.pdf', size: 2048, is_inline: false },
				{ id: 'inline', filename: 'logo.png', size: 10, is_inline: true },
				{ id: 'ics', filename: 'invite.ics', content_type: 'text/calendar', is_inline: false },
			],
		} as MailMessage
		render(<ThreadConversation thread={thread('t1')} messages={[v1, v2]} mailboxEmail="ada@ownmail.com" />)
		expandAll(2)

		const latest = screen.getByRole('region', { name: 'Attachments from Alan Turing' })
		// Inline images and invitations are not chips; the invitation is a card.
		const chips = latest.querySelectorAll('[data-slot="attachment-chip"]')
		expect(chips).toHaveLength(1)
		expect(chips[0]).toHaveTextContent(/plan-v2\.pdf2 KB · replaces v1 from /)
		expect(
			screen
				.getByRole('region', { name: 'Attachments from Grace Hopper' })
				.querySelector('[data-slot="attachment-chip"]'),
		).toHaveTextContent('plan-v1.pdf1 KB')
		expect(await screen.findByText('Design review')).toBeInTheDocument()
	})

	it('separates rows with one line each, and lets the divider stand in for the line after it', () => {
		const { container } = render(
			<ThreadConversation thread={thread('t1')} messages={longThread(4, 2)} mailboxEmail="ada@ownmail.com" />,
		)
		const stream = container.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		const sequence = [...stream.children].map((child) =>
			child.getAttribute('data-slot') === 'stream-rule' ? 'rule' : child.getAttribute('data-kind'),
		)
		expect(sequence).toEqual(['rule', 'line', 'rule', 'line', 'divider', 'open', 'rule', 'open'])
		expect(
			screen.getByRole('separator', { name: /^New since you last read, (?:yesterday|[A-Z][a-z]+day)$/ }),
		).toBeInTheDocument()
		// The subject and the stream fade on navigation; nothing nests a second fade.
		const fades = container.querySelectorAll('[data-navigation-content]')
		expect(fades).toHaveLength(2)
		for (const fade of fades) expect(fade.querySelector('[data-navigation-content]')).toBeNull()
		expect(stream.parentElement).toHaveAttribute('data-slot', 'thread-messages')
		expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual([
			'Message from you',
			'Message from Grace Hopper',
		])
	})

	it('names an anonymous message without inventing a sender', () => {
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[
					{ ...message('m1'), from: undefined, attachments: [{ id: 'a1', filename: 'anonymous.txt' }] },
				]}
			/>,
		)
		expect(screen.getByRole('article', { name: 'Message from Unknown sender' })).toBeInTheDocument()
		expect(screen.getByRole('region', { name: 'Attachments from Unknown sender' })).toHaveTextContent(
			'anonymous.txt',
		)
	})

	it('remembers a sender color choice and renders their messages in original colors', async () => {
		const rendered = render(
			<ThreadConversation thread={thread('colors')} messages={[htmlMessage('m1'), htmlMessage('m2')]} />,
		)
		const colorModes = () =>
			[...rendered.container.querySelectorAll(EMAIL_ELEMENT_TAG)].map((element) =>
				element.getAttribute('data-color-mode'),
			)
		expandAll(2)
		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		const toggle = await screen.findByRole('button', {
			name: 'Always use original colors from sender@example.com',
		})
		expect(toggle).toHaveAttribute('aria-pressed', 'false')
		fireEvent.click(toggle)

		await waitFor(() =>
			expect(setSenderOriginalColorsMock).toHaveBeenCalledWith('sender@example.com', true, 'ada@ownmail.com'),
		)
		await waitFor(() => expect(colorModes()).toEqual(['original', 'original']))
		expect(toggle).toHaveAttribute('aria-pressed', 'true')

		fireEvent.click(toggle)
		await waitFor(() =>
			expect(setSenderOriginalColorsMock).toHaveBeenCalledWith(
				'sender@example.com',
				false,
				'ada@ownmail.com',
			),
		)
		await waitFor(() => expect(colorModes()).toEqual(['automatic', 'automatic']))
	})

	it('applies remembered sender color choices and reverts a choice that cannot be saved', async () => {
		originalColorSendersMock.mockResolvedValue(['sender@example.com'])
		setSenderOriginalColorsMock.mockResolvedValue(false)
		const rendered = render(
			<ThreadConversation thread={thread('colors-saved')} messages={[htmlMessage('m1')]} />,
		)
		const colorMode = () =>
			rendered.container.querySelector(EMAIL_ELEMENT_TAG)?.getAttribute('data-color-mode')
		await waitFor(() => expect(colorMode()).toBe('original'))

		fireEvent.click(screen.getByRole('button', { name: 'Thread display' }))
		fireEvent.click(
			await screen.findByRole('button', { name: 'Always use original colors from sender@example.com' }),
		)
		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that color choice. Try again.')
		expect(colorMode()).toBe('original')
	})

	it('renders its children after the last message, inside the conversation flow', () => {
		const { container } = render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]}>
				<div data-testid="after-messages" />
			</ThreadConversation>,
		)
		const messages = container.querySelector('[data-slot="thread-messages"]')
		expect(messages?.lastElementChild).toBe(screen.getByTestId('after-messages'))
	})

	it('ignores remembered color choices that arrive after the thread closes', async () => {
		let resolveSenders: (senders: string[]) => void = () => {}
		originalColorSendersMock.mockReturnValue(new Promise<string[]>((resolve) => (resolveSenders = resolve)))
		const rendered = render(<ThreadConversation thread={thread('closing')} messages={[htmlMessage('m1')]} />)
		rendered.unmount()
		await act(async () => resolveSenders(['sender@example.com']))
		expect(originalColorSendersMock).toHaveBeenCalledExactlyOnceWith('ada@ownmail.com')
	})
})

describe('folding a long thread', () => {
	it('folds three or more read messages into one row that names who wrote them, and unfolds it into lines', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(8)} mailboxEmail="ada@ownmail.com" />,
		)
		const folded = screen.getByRole('button', { name: /5 earlier messages/ })
		expect(folded).toHaveAttribute('aria-expanded', 'false')
		expect(folded).toHaveTextContent('Alan, you, Grace')
		// The first message (it sets context) and the one next to the open latest are lines.
		expect(document.querySelectorAll('[data-slot="message-expand"]')).toHaveLength(2)
		expect(states()).toEqual(['Message from Alan Turing'])

		fireEvent.click(folded)
		expect(screen.queryByRole('button', { name: /earlier messages/ })).toBeNull()
		const lines = document.querySelectorAll<HTMLButtonElement>('[data-slot="message-expand"]')
		expect(lines).toHaveLength(7)
		expect(lines[1]).toHaveTextContent('Alan Turing')
		expect(lines[1]).toHaveTextContent('Note 2 about the plan.')
		fireEvent.click(lines[1] as HTMLButtonElement)
		expect(states()).toEqual(['Message from Alan Turing', 'Message from Alan Turing'])
	})

	it('opens what was unread, puts the divider before it and keeps the snapshot after the thread is read', () => {
		const messages = longThread(5, 2)
		const rendered = render(
			<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />,
		)
		expect(states()).toEqual(['Message from Grace Hopper', 'Message from Alan Turing'])
		const divider = screen.getByRole('separator', {
			name: /^New since you last read, (?:yesterday|[A-Z][a-z]+day)$/,
		})
		// The label is drawn between two neutral lines and announced on the separator itself.
		expect(divider.closest('[data-slot="new-since-divider"]')).toHaveTextContent(
			/^2 new since (?:yesterday|[A-Z][a-z]+day)$/,
		)

		// Opening the thread marked it read; what was new when it opened stays new.
		const read = messages.map((entry) => ({ ...entry, unread: false }))
		rendered.rerender(
			<ThreadConversation thread={thread('t1')} messages={read} mailboxEmail="ada@ownmail.com" />,
		)
		expect(
			screen.getByRole('separator', { name: /^New since you last read, (?:yesterday|[A-Z][a-z]+day)$/ }),
		).toBeInTheDocument()
	})

	it('shows no divider when every message is new', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(3, 3)} mailboxEmail="ada@ownmail.com" />,
		)
		expect(screen.queryByRole('separator')).toBeNull()
		expect(states()).toHaveLength(3)
	})

	it('puts a system line between two rows, where the change happened', () => {
		const [first, second] = longThread(2)
		const added = {
			...(second as MailMessage),
			to: [...((second as MailMessage).to ?? []), { name: 'Mary Jackson', email: 'mary@example.com' }],
		}
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[first as MailMessage, added]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		const line = screen.getByText('Alan added Mary Jackson')
		expect(line).toHaveClass('reader-system-line')
		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		expect([...stream.children].map((child) => child.getAttribute('data-kind') ?? 'rule')).toEqual([
			'rule',
			'line',
			'system',
			'rule',
			'open',
		])
	})

	it('offers a catch-up card above what is new on a long thread', async () => {
		const messages = longThread(7, 1)
		const last = messages.at(-1) as MailMessage
		messages[messages.length - 1] = { ...last, body: 'Ada, can you confirm the date?' }
		// A summary provider is what offers Answer and Show sources.
		const summarize = vi.fn(async () => ['Grace asks Ada to confirm the date.'])
		render(
			<ThreadSummaryProvider provider={{ summarize }}>
				<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />
			</ThreadSummaryProvider>,
		)
		const card = screen.getByRole('region', { name: /^Since you last read, (?:yesterday|[A-Z][a-z]+day)$/ })
		expect(card).toHaveTextContent('1 new message')
		expect(card).toHaveTextContent('1 question to you')
		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		expect([...stream.children].map((child) => child.getAttribute('data-kind') ?? 'rule').slice(-4)).toEqual([
			'rule',
			'catch-up',
			'divider',
			'open',
		])
		// The summary is made from the new messages only.
		await within(card).findByText('Grace asks Ada to confirm the date.')
		expect(summarize).toHaveBeenCalledWith([expect.objectContaining({ id: 'm7' })])

		fireEvent.click(within(card).getByRole('button', { name: 'Answer Grace' }))
		expect(compose.openCompose).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'reply', threadId: 't1', replyToMessageId: 'm7' }),
		)
		const sources = within(card).getByRole('button', { name: 'Show sources' })
		fireEvent.click(sources)
		expect(sources).toHaveAttribute('aria-pressed', 'true')
		expect(document.querySelectorAll('[data-source="true"]')).toHaveLength(1)
		fireEvent.click(sources)
		expect(document.querySelectorAll('[data-source="true"]')).toHaveLength(0)
		fireEvent.click(within(card).getByRole('button', { name: 'Jump to first new' }))
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute(
			'aria-label',
			'Message from Grace Hopper',
		)
	})

	it('mounts every row while the thread is short, and only the rows near the viewport past 50', () => {
		const observers: Array<{
			callback: IntersectionObserverCallback
			options: IntersectionObserverInit | undefined
			elements: Set<Element>
			disconnected: boolean
		}> = []
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				record: (typeof observers)[number]
				constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
					this.record = { callback, options, elements: new Set(), disconnected: false }
					observers.push(this.record)
				}
				observe(element: Element) {
					this.record.elements.add(element)
				}
				unobserve(element: Element) {
					this.record.elements.delete(element)
				}
				disconnect() {
					this.record.disconnected = true
				}
			},
		)
		const { unmount } = render(
			<div data-testid="viewport" style={{ overflowY: 'auto' }}>
				<ThreadConversation
					thread={thread('long')}
					messages={longThread(60)}
					mailboxEmail="ada@ownmail.com"
				/>
			</div>,
		)
		expandAll(60)
		const items = document.querySelectorAll('[data-slot="stream-item"]')
		expect(items).toHaveLength(60)
		// The message in focus stays mounted; the rest wait to come near the viewport.
		expect(document.querySelectorAll('[data-virtual="held"]')).toHaveLength(59)
		// One observer watches every row, measured against the reader's own scroll viewport.
		expect(observers).toHaveLength(1)
		const [observer] = observers as [(typeof observers)[number]]
		expect(observer.options).toEqual({ root: screen.getByTestId('viewport'), rootMargin: '1200px 0px' })
		expect(observer.elements.size).toBe(60)
		const row = document.getElementById('message-m10') as HTMLElement
		act(() =>
			observer.callback(
				[
					{ isIntersecting: true, target: row },
					{ isIntersecting: true, target: document.createElement('div') },
				] as unknown as IntersectionObserverEntry[],
				{} as IntersectionObserver,
			),
		)
		expect(row).toHaveAttribute('data-virtual', 'mounted')
		act(() =>
			observer.callback(
				[{ isIntersecting: false, target: row }] as unknown as IntersectionObserverEntry[],
				{} as IntersectionObserver,
			),
		)
		expect(row).toHaveAttribute('data-virtual', 'held')
		unmount()
		expect(observer.elements.size).toBe(0)
		expect(observer.disconnected).toBe(true)
	})
})

describe('opening a thread', () => {
	/** A scroll viewport 500px tall whose last 60px sit under the phone's bottom bar. */
	function stubLayout(tops: Record<string, number>) {
		// jsdom lays nothing out and has no scrollIntoView of its own.
		Element.prototype.scrollIntoView ??= () => {}
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			const top =
				this.getAttribute('data-testid') === 'viewport'
					? 0
					: (tops[this.id] ?? tops[this.getAttribute('data-slot') ?? ''] ?? 0)
			return { top, bottom: this.getAttribute('data-testid') === 'viewport' ? 500 : top + 40 } as DOMRect
		})
	}

	const inViewport = (node: React.ReactNode) => (
		<div data-testid="viewport" style={{ overflowY: 'auto', paddingBottom: '60px' }}>
			{node}
		</div>
	)

	afterEach(() => vi.restoreAllMocks())

	it('scrolls to where the reader left off when that is below the first screen', () => {
		stubLayout({ 'new-since-divider': 800 })
		const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
		render(
			inViewport(
				<ThreadConversation
					thread={thread('t1')}
					messages={longThread(8, 2)}
					mailboxEmail="ada@ownmail.com"
				/>,
			),
		)
		expect(scrolled.mock.contexts[0]).toHaveAttribute('data-slot', 'new-since-divider')
	})

	it('scrolls to your draft first, and leaves a divider already in view where it is', () => {
		stubLayout({ 'draft-d1': 900, 'new-since-divider': 100 })
		const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
		const draft = { ...message('d1'), ownmailDraft: true as const, from: [ADA], to: undefined, date: NOW }
		const { unmount } = render(
			inViewport(
				<ThreadConversation
					thread={thread('t1')}
					messages={[...longThread(4, 1), draft]}
					mailboxEmail="ada@ownmail.com"
				/>,
			),
		)
		expect(scrolled.mock.contexts[0]).toHaveAttribute('id', 'draft-d1')
		// The draft has no one it answers yet.
		expect(screen.getByRole('region', { name: 'Your draft' })).toHaveAttribute('id', 'draft-d1')
		unmount()
		scrolled.mockClear()
		render(
			inViewport(
				<ThreadConversation
					thread={thread('t2')}
					messages={longThread(4, 1)}
					mailboxEmail="ada@ownmail.com"
				/>,
			),
		)
		expect(scrolled).not.toHaveBeenCalled()
	})

	it('scrolls a draft out from under the pinned reply card, and leaves one in clear view', () => {
		stubLayout({ 'draft-d1': 420, 'reply-dock': 440 })
		const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
		const draft = { ...message('d1'), ownmailDraft: true as const, from: [ADA], to: undefined, date: NOW }
		const dock = () => (
			<div
				data-slot="reply-dock"
				className="reader-reply-dock"
				ref={(node) => {
					if (node) node.getClientRects = () => [{}] as unknown as DOMRectList
				}}
			/>
		)
		const { unmount } = render(
			inViewport(
				<ThreadConversation
					thread={thread('t1')}
					messages={[...longThread(4, 1), draft]}
					mailboxEmail="ada@ownmail.com"
				>
					{dock()}
				</ThreadConversation>,
			),
		)
		// Its foot (460) is under the card's top (440), though above the viewport's bottom.
		expect(scrolled.mock.contexts[0]).toHaveAttribute('id', 'draft-d1')
		expect(scrolled).toHaveBeenCalledWith({ block: 'center' })
		unmount()
		scrolled.mockClear()
		stubLayout({ 'draft-d1': 100, 'reply-dock': 440 })
		render(
			inViewport(
				<ThreadConversation
					thread={thread('t2')}
					messages={[...longThread(4, 1), draft]}
					mailboxEmail="ada@ownmail.com"
				>
					{dock()}
				</ThreadConversation>,
			),
		)
		expect(scrolled).not.toHaveBeenCalled()
	})

	it('names a draft saved with an address only by the name the thread knows', () => {
		const draft = {
			...message('d1'),
			ownmailDraft: true as const,
			from: [ADA],
			to: [{ email: 'GRACE@example.com' }],
			date: NOW,
		}
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[...longThread(3), draft]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		expect(screen.getByRole('region', { name: 'Your draft reply to Grace' })).toBeInTheDocument()
	})

	it('keeps the place a reader had already scrolled to', () => {
		stubLayout({ 'new-since-divider': 800 })
		vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(120)
		const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
		render(
			inViewport(
				<ThreadConversation
					thread={thread('t1')}
					messages={longThread(8, 2)}
					mailboxEmail="ada@ownmail.com"
				/>,
			),
		)
		expect(scrolled).not.toHaveBeenCalled()
	})

	it('counts the new messages below the fold again when the stream settles its height', () => {
		vi.stubGlobal(
			'matchMedia',
			vi.fn((query: string) => ({
				matches: query.includes('max-width'),
				addEventListener: () => {},
				removeEventListener: () => {},
			})),
		)
		const observers: Array<{ callback: () => void; observed: Element[]; disconnected: boolean }> = []
		vi.stubGlobal(
			'ResizeObserver',
			class {
				record: (typeof observers)[number]
				constructor(callback: () => void) {
					this.record = { callback, observed: [], disconnected: false }
					observers.push(this.record)
				}
				observe(element: Element) {
					this.record.observed.push(element)
				}
				unobserve() {}
				disconnect() {
					this.record.disconnected = true
				}
			},
		)
		// Nothing is below the fold until the messages above grow.
		stubLayout({})
		const { unmount } = render(
			inViewport(
				<ThreadConversation
					thread={thread('t1')}
					messages={longThread(8, 3)}
					mailboxEmail="ada@ownmail.com"
				/>,
			),
		)
		expect(screen.queryByRole('button', { name: /more new/ })).toBeNull()
		const stream = observers.find((observer) =>
			observer.observed.some((element) => element.getAttribute('data-slot') === 'thread-conversation'),
		)
		expect(stream).toBeDefined()
		stubLayout({ 'message-m6': 100, 'message-m7': 600, 'message-m8': 900 })
		act(() => stream?.callback())
		expect(screen.getByRole('button', { name: '2 more new' })).toBeInTheDocument()
		unmount()
		expect(stream?.disconnected).toBe(true)
	})

	it('points a phone at the new messages still below the fold, and goes to the next one', () => {
		// Without ResizeObserver the count still follows the scroll.
		vi.stubGlobal('ResizeObserver', undefined)
		vi.stubGlobal(
			'matchMedia',
			vi.fn((query: string) => ({
				matches: query.includes('max-width'),
				addEventListener: () => {},
				removeEventListener: () => {},
			})),
		)
		stubLayout({ 'message-m6': 100, 'message-m7': 600, 'message-m8': 900 })
		vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
		render(
			inViewport(
				<ThreadConversation
					thread={thread('t1')}
					messages={longThread(8, 3)}
					mailboxEmail="ada@ownmail.com"
				/>,
			),
		)
		const viewport = screen.getByTestId('viewport')
		fireEvent.scroll(viewport)
		const pill = screen.getByRole('button', { name: '2 more new' })
		fireEvent.click(pill)
		expect(document.getElementById('message-m7')?.querySelector('[data-current="true"]')).not.toBeNull()
		// Once nothing new is below the fold, a late tap goes nowhere and the pill leaves.
		stubLayout({})
		fireEvent.click(screen.getByRole('button', { name: '2 more new' }))
		expect(document.getElementById('message-m7')?.querySelector('[data-current="true"]')).not.toBeNull()
		viewport.style.paddingBottom = ''
		fireEvent.scroll(viewport)
		expect(screen.queryByRole('button', { name: /more new/ })).toBeNull()
		// Outside a scrolling pane there is nothing to point at.
		cleanup()
		render(
			<ThreadConversation thread={thread('t2')} messages={longThread(8, 3)} mailboxEmail="ada@ownmail.com" />,
		)
		expect(screen.queryByRole('button', { name: /more new/ })).toBeNull()
		// Bodies are set a step larger on a phone.
		expect(document.querySelector('[data-slot="message-header"]')).not.toBeNull()
	})

	it("writes no day of its own on the server, where the reader's clock is unknown", () => {
		const html = renderToString(
			<Providers>
				<UserPreferencesProvider initialPreferences={defaultUserPreferences()}>
					<ThreadConversation
						thread={thread('t1')}
						messages={longThread(8, 2)}
						mailboxEmail="ada@ownmail.com"
					/>
				</UserPreferencesProvider>
			</Providers>,
		)
		expect(html).toContain('aria-label="2 new"')
		expect(html).not.toContain('new since')
		expect(html).toContain('4<!-- --> earlier messages')
		expect(html).not.toMatch(/earlier messages<\/span><span class="reader-folded-meta">[^<]*·/)
		expect(html).toContain('data-slot="thread-map-dots"')
	})

	it('opens your own mail that is waiting to be sent, so its state is on screen', () => {
		const scheduled = {
			...message('later'),
			from: [ADA],
			to: [GRACE],
			date: NOW - DAY,
			send_at: NOW + DAY,
		} as MailMessage
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[scheduled, ...longThread(2)]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		expect(
			document.getElementById('message-later')?.querySelector('[data-slot="thread-message"]'),
		).not.toBeNull()
	})
})

describe('moving through a thread', () => {
	it('steps with j and k, and the stepper says where the reader is', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(8, 2)} mailboxEmail="ada@ownmail.com" />,
		)
		const scrolled = vi.fn()
		Element.prototype.scrollIntoView = scrolled
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		// The thread opens on the first new message.
		expect(position()).toBe('7 of 8')

		fireEvent.keyDown(document.body, { key: 'k' })
		expect(position()).toBe('6 of 8')
		fireEvent.keyDown(document.body, { key: 'k' })
		// Message 5 was folded: stepping to it unfolds its run and opens it.
		expect(position()).toBe('5 of 8')
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute(
			'aria-label',
			'Message from Alan Turing',
		)
		expect(screen.queryByRole('button', { name: /earlier messages/ })).toBeNull()
		expect(scrolled).toHaveBeenCalled()
		fireEvent.keyDown(document.body, { key: 'j' })
		expect(position()).toBe('6 of 8')

		fireEvent.click(screen.getByRole('button', { name: 'Next message (j)' }))
		expect(position()).toBe('7 of 8')
		fireEvent.keyDown(document.body, { key: 'j' })
		fireEvent.keyDown(document.body, { key: 'j' })
		// The last message is as far as j goes.
		expect(position()).toBe('8 of 8')
		expect(screen.getByRole('button', { name: 'Next message (j)' })).toBeDisabled()
		fireEvent.keyDown(document.body, { key: 'k' })
		fireEvent.click(screen.getByRole('button', { name: 'Previous message (k)' }))
		expect(position()).toBe('6 of 8')

		// Typing, modified keys and open menus keep their own keys.
		const input = document.createElement('input')
		document.body.append(input)
		fireEvent.keyDown(input, { key: 'j' })
		fireEvent.keyDown(document.body, { key: 'j', metaKey: true })
		expect(position()).toBe('6 of 8')
		input.remove()
	})

	it('leaves j and k to a list row that has focus, and steps messages with nothing focused', () => {
		const row = document.createElement('button')
		row.setAttribute('data-nav-row', '')
		document.body.append(row)
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(4, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		fireEvent.keyDown(row, { key: 'k' })
		expect(position()).toBe('4 of 4')
		// Board 01: with the thread open and nothing focused, j / k step its messages.
		fireEvent.keyDown(document.body, { key: 'k' })
		expect(position()).toBe('3 of 4')
		fireEvent.keyDown(screen.getByRole('heading', { level: 1 }), { key: 'k' })
		expect(position()).toBe('2 of 4')
		fireEvent.keyDown(document.body, { key: 'j' })
		expect(position()).toBe('3 of 4')
		row.remove()
	})

	it('keeps focus in the reader when a row opens, so j and k stay with it beside a list', () => {
		const row = document.createElement('button')
		row.setAttribute('data-nav-row', '')
		row.checkVisibility = () => true
		document.body.append(row)
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(8, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		// Opening a one-line row moves focus to that message, not to the page.
		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		fireEvent.click(within(stream).getAllByRole('button', { name: /^Grace Hopper/ })[0] as HTMLElement)
		expect(document.activeElement).toBe(document.getElementById('message-m1'))
		expect(position()).toBe('1 of 8')
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'j' })
		expect(position()).toBe('2 of 8')
		expect(document.activeElement).toBe(document.getElementById('message-m2'))
		// Unfolding a run moves focus to its first message.
		cleanup()
		render(
			<ThreadConversation thread={thread('t2')} messages={longThread(8, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		fireEvent.click(screen.getByRole('button', { name: /earlier messages/ }))
		expect(document.activeElement).toBe(document.getElementById('message-m2'))
		row.remove()
	})

	it('follows focus into another message: the stepper and the map start from it', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(3)} mailboxEmail="ada@ownmail.com" />,
		)
		expandAll(3)
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		expect(position()).toBe('3 of 3')
		fireEvent.focus(screen.getByRole('button', { name: 'Reply to Grace' }))
		expect(position()).toBe('1 of 3')
		expect(
			screen.getByRole('complementary', { name: 'Thread map' }).querySelector('[aria-current="true"]'),
		).toHaveAccessibleName(/^Grace Hopper/)
		// Focus outside any message (the subject) leaves the stepper where it is.
		fireEvent.focus(screen.getByRole('heading', { level: 1 }))
		expect(position()).toBe('1 of 3')
	})

	it('docks the map from xl, moving the stream aside only where the pane has room for both', () => {
		const dock = document.createElement('div')
		dock.id = THREAD_MAP_DOCK_ID
		document.body.append(dock)
		let width = 1288
		dock.getBoundingClientRect = () => ({ width }) as DOMRect
		let xl = true
		vi.stubGlobal(
			'matchMedia',
			vi.fn((query: string) => ({
				matches: query.includes('80rem') ? xl : !query.includes('max-width'),
				addEventListener: () => {},
				removeEventListener: () => {},
			})),
		)
		const { container, unmount } = render(
			<ThreadConversation thread={thread('t1')} messages={longThread(8, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		const root = container.querySelector('[data-slot="thread-conversation"]') as HTMLElement
		expect(root).not.toHaveAttribute('data-map-docked')
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		// A wide pane: the panel docks and the stream keeps clear of it.
		expect(within(dock).getByRole('complementary', { name: 'Thread map' })).toBeInTheDocument()
		expect(root).toHaveAttribute('data-map-docked', 'true')
		// A split view at 1440 (a 808px pane): still the docked glass panel, over the stream's right side.
		width = 808
		act(() => {
			window.dispatchEvent(new Event('resize'))
		})
		expect(within(dock).getByRole('complementary', { name: 'Thread map' })).toBeInTheDocument()
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(root).not.toHaveAttribute('data-map-docked')
		unmount()
		// Below xl the map is a sheet over the stream.
		xl = false
		render(
			<ThreadConversation thread={thread('t2')} messages={longThread(8, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		expect(screen.getByRole('dialog')).toHaveAttribute('data-slot', 'thread-map-panel')
		dock.remove()
	})

	it('opens the thread map with g m, from the dots, and from the More menu', () => {
		const dock = document.createElement('div')
		dock.id = THREAD_MAP_DOCK_ID
		document.body.append(dock)
		// A wide desktop: the toolbar has the actions and the map docks.
		vi.stubGlobal(
			'matchMedia',
			vi.fn((query: string) => ({
				matches: !query.includes('max-width'),
				addEventListener: () => {},
				removeEventListener: () => {},
			})),
		)
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(8, 1)} mailboxEmail="ada@ownmail.com" />,
		)

		const dots = screen.getByRole('complementary', { name: 'Thread map' })
		const buttons = within(dots).getAllByRole('button', { name: /^(?:Grace Hopper|Alan Turing|You),/ })
		expect(buttons).toHaveLength(8)
		expect(buttons[0]).toHaveClass('reader-map-dot-first')
		expect(buttons[7]).toHaveClass('reader-map-dot-new')
		expect(buttons[7]).toHaveAttribute('aria-current', 'true')
		expect(buttons[7]).toHaveAccessibleName(/, new$/)
		expect(dots.querySelector('[data-slot="thread-map-stopped"]')?.nextElementSibling).toBe(buttons[7])

		// A dot scrolls to its message and opens it, unfolding its run.
		fireEvent.click(buttons[2] as HTMLElement)
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute('aria-label', 'Message from you')

		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		// From xl the map docks in the pane, beside the stream.
		const panel = within(dock).getByRole('complementary', { name: 'Thread map' })
		const mapPanel = () => dock.querySelector('[data-slot="thread-map-panel"]')
		expect(panel.querySelector('[aria-current="true"]')).toHaveAttribute('data-message-id', 'm3')
		fireEvent.click(panel.querySelector('[data-message-id="m5"]') as HTMLElement)
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute(
			'aria-label',
			'Message from Alan Turing',
		)
		// Focus has moved to that message: Escape closes the docked map, and only the map.
		const closing = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		act(() => {
			document.getElementById('message-m5')?.dispatchEvent(closing)
		})
		expect(closing.defaultPrevented).toBe(true)
		expect(mapPanel()).toBeNull()
		// With the map closed, Escape is left to the route.
		const spare = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		document.body.dispatchEvent(spare)
		expect(spare.defaultPrevented).toBe(false)
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		fireEvent.click(
			within(dock.querySelector('aside') as HTMLElement).getByRole('button', { name: 'Close thread map' }),
		)
		expect(mapPanel()).toBeNull()

		fireEvent.click(within(dots).getByRole('button', { name: /^Open thread map/ }))
		expect(mapPanel()).not.toBeNull()
		openMore()
		const item = screen.getByRole('menuitemcheckbox', { name: /^Thread map/ })
		expect(item).toHaveAttribute('aria-checked', 'true')
		expect(item).not.toHaveAttribute('aria-pressed')
		fireEvent.click(item)
		expect(mapPanel()).toBeNull()
		// A g without its m does nothing.
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'x' })
		fireEvent.keyDown(document.body, { key: 'm' })
		expect(mapPanel()).toBeNull()

		// g m works with a list row focused (no list shortcut uses g or m).
		const row = document.createElement('button')
		row.setAttribute('data-nav-row', '')
		document.body.append(row)
		fireEvent.keyDown(row, { key: 'g' })
		fireEvent.keyDown(row, { key: 'm' })
		expect(mapPanel()).not.toBeNull()
		fireEvent.keyDown(row, { key: 'g' })
		fireEvent.keyDown(row, { key: 'm' })
		row.remove()
		// Below xl the map is a sheet (a dialog): g m from inside it closes it,
		// while any other dialog keeps its keys.
		const sheet = document.createElement('div')
		sheet.setAttribute('role', 'dialog')
		sheet.setAttribute('data-slot', 'thread-map-panel')
		const sheetRow = document.createElement('button')
		sheet.append(sheetRow)
		document.body.append(sheet)
		fireEvent.keyDown(sheetRow, { key: 'g' })
		fireEvent.keyDown(sheetRow, { key: 'm' })
		expect(mapPanel()).not.toBeNull()
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		const before = position()
		fireEvent.keyDown(document.body, { key: 'k' })
		expect(position()).toBe(before)
		fireEvent.keyDown(sheetRow, { key: 'g' })
		fireEvent.keyDown(sheetRow, { key: 'm' })
		expect(mapPanel()).toBeNull()
		const other = document.createElement('div')
		other.setAttribute('role', 'dialog')
		document.body.append(other)
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		expect(mapPanel()).toBeNull()
		other.remove()
		sheet.remove()
		dock.remove()
	})

	it('draws your own dots on the green pair, whatever your address hashes to', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(3)} mailboxEmail="ada@ownmail.com" />,
		)
		const dots = within(screen.getByRole('complementary', { name: 'Thread map' }))
		expect(dots.getByRole('button', { name: /^You,/ })).toHaveAttribute('data-hue', '158')
		expect(dots.getByRole('button', { name: /^Grace Hopper,/ })).not.toHaveAttribute('data-hue', '158')
	})

	it('keeps one dot in the tab order and moves between dots with the arrow keys', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(4)} mailboxEmail="ada@ownmail.com" />,
		)
		const dots = within(screen.getByRole('complementary', { name: 'Thread map' })).getAllByRole('button', {
			name: /,/,
		})
		// The message in focus (the latest) is the one tab stop.
		expect(dots.map((dot) => dot.tabIndex)).toEqual([-1, -1, -1, 0])
		const last = dots[3] as HTMLElement
		last.focus()
		fireEvent.keyDown(last, { key: 'ArrowUp' })
		expect(dots[2]).toHaveFocus()
		fireEvent.keyDown(dots[2] as HTMLElement, { key: 'Home' })
		expect(dots[0]).toHaveFocus()
		fireEvent.keyDown(dots[0] as HTMLElement, { key: 'ArrowLeft' })
		expect(dots[0]).toHaveFocus()
		fireEvent.keyDown(dots[0] as HTMLElement, { key: 'ArrowRight' })
		expect(dots[1]).toHaveFocus()
		fireEvent.keyDown(dots[1] as HTMLElement, { key: 'End' })
		expect(dots[3]).toHaveFocus()
		fireEvent.keyDown(dots[3] as HTMLElement, { key: 'ArrowDown' })
		expect(dots[3]).toHaveFocus()
		// Other keys pass through to the reader.
		fireEvent.keyDown(dots[3] as HTMLElement, { key: 'Enter' })
		expect(dots[3]).toHaveFocus()
	})

	it("fits the dots to the reader's viewport, following it as it resizes", () => {
		const observed: Array<() => void> = []
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: () => void) {
					observed.push(callback)
				}
				observe() {}
				disconnect() {}
			},
		)
		let height = 800
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
		render(
			<div style={{ overflowY: 'auto', paddingTop: '44px' }}>
				<ThreadConversation thread={thread('t1')} messages={longThread(3)} mailboxEmail="ada@ownmail.com" />
			</div>,
		)
		const map = screen.getByRole('complementary', { name: 'Thread map' })
		expect(map.style.maxHeight).toBe('756px')
		height = 400
		act(() => observed.at(-1)?.())
		expect(map.style.maxHeight).toBe('356px')
		// A viewport with no height yet sets none.
		height = 0
		act(() => observed.at(-1)?.())
		expect(map.style.maxHeight).toBe('')
	})

	it('opens the message a #message link names', () => {
		window.location.hash = '#message-m2'
		const scrolled = vi.fn()
		Element.prototype.scrollIntoView = scrolled
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(6)} mailboxEmail="ada@ownmail.com" />,
		)
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute(
			'aria-label',
			'Message from Alan Turing',
		)
		expect(scrolled).toHaveBeenCalled()
	})

	it('opens a linked message inside a folded run on its own and folds what is left on either side', () => {
		window.location.hash = '#message-m6'
		Element.prototype.scrollIntoView = vi.fn()
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(14)} mailboxEmail="ada@ownmail.com" />,
		)
		// 1 line, [2–4] folded, 5 line, 6 open, 7 line, [8–12] folded, 13 line, 14 open.
		expect(screen.getByRole('button', { name: /^3 earlier messages/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /^5 earlier messages/ })).toBeInTheDocument()
		expect(document.querySelectorAll('[data-slot="message-expand"]')).toHaveLength(4)
		expect(document.querySelectorAll('[data-slot="thread-message"]')).toHaveLength(2)
	})
})

describe('what the reader keeps', () => {
	it('folds the thread again on Collapse all after Expand all', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(8, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		expect(screen.getByRole('button', { name: /earlier messages/ })).toBeInTheDocument()
		expandAll(8)
		expect(screen.queryByRole('button', { name: /earlier messages/ })).toBeNull()
		openMore()
		fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse all 8 messages' }))
		expect(states()).toEqual([])
		expect(screen.getByRole('button', { name: /earlier messages/ })).toBeInTheDocument()
	})

	it('offers the catch-up card at the top of a long thread whose every message is new', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(7, 7)} mailboxEmail="ada@ownmail.com" />,
		)
		expect(screen.getByRole('region', { name: /^Since you last read/ })).toBeInTheDocument()
		// There is no "new since" divider when everything is new.
		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		const kinds = [...stream.children].map((child) => child.getAttribute('data-kind') ?? 'rule')
		expect(kinds.slice(0, 3)).toEqual(['rule', 'catch-up', 'rule'])
		expect(kinds).not.toContain('divider')
	})

	it('keeps the map, the files shelf, trashed messages shown and its place when a reply arrives', () => {
		const dock = document.createElement('div')
		dock.id = THREAD_MAP_DOCK_ID
		document.body.append(dock)
		window.location.hash = '#message-m2'
		Element.prototype.scrollIntoView ??= () => {}
		// A wide desktop, where the map docks beside the stream.
		vi.stubGlobal(
			'matchMedia',
			vi.fn((query: string) => ({
				matches: !query.includes('max-width'),
				addEventListener: () => {},
				removeEventListener: () => {},
			})),
		)
		const withFile = {
			...(longThread(6)[0] as MailMessage),
			attachments: [{ id: 'a1', filename: 'plan.pdf', size: 2048, content_type: 'application/pdf' }],
		}
		const binned = { ...message('binned'), folders: ['trash'], date: NOW - DAY }
		const first = [withFile, ...longThread(6).slice(1), binned]
		const { rerender } = render(
			<ThreadConversation thread={thread('t1')} messages={first} mailboxEmail="ada@ownmail.com" />,
		)
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		// The link opened message 2; the reader moves on from there.
		expect(position()).toBe('2 of 6')
		fireEvent.keyDown(document.body, { key: 'j' })
		expect(position()).toBe('3 of 6')
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		fireEvent.click(screen.getByRole('button', { name: /1 file/ }))
		fireEvent.click(screen.getByRole('button', { name: 'Show' }))
		expect(position()).toBe('3 of 7')

		const reply = { ...message('m7'), from: [GRACE], date: NOW }
		rerender(
			<ThreadConversation
				thread={thread('t1')}
				messages={[...first, reply]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		expect(within(dock).getByRole('complementary', { name: 'Thread map' })).toBeInTheDocument()
		expect(screen.getByRole('region', { name: 'Files in this thread' })).toBeInTheDocument()
		expect(document.getElementById('message-binned')).not.toBeNull()
		// Still on message 3: the link is not followed again.
		expect(position()).toBe('3 of 8')
		window.location.hash = ''
		dock.remove()
	})

	it('disables the links of a message from a lookalike sender', () => {
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[message('m1'), { ...message('m2'), from: [GRACE] }]}
				mailboxEmail="ada@ownmail.com"
				knownSenders={[{ name: 'Grace Hopper', email: 'grace@navy.mil', isOwner: false }]}
			/>,
		)
		const content = document.querySelector('[data-slot="expanded-message-content"]')
		expect(content).toHaveAttribute('data-links-disabled', 'true')
	})
})

describe('message actions', () => {
	it('counts a list’s members in the details panel when the header facts know them', () => {
		const list = { email: 'pm-leads@vercel.com' }
		const messages = [{ ...longThread(1)[0], cc: [list] } as MailMessage]
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={messages}
				mailboxEmail="ada@ownmail.com"
				headerFacts={{ byMessage: {}, listSizes: { 'pm-leads@vercel.com': 12 } }}
			/>,
		)
		fireEvent.click(screen.getByRole('button', { name: /^to / }))
		expect(document.querySelector('[data-slot="message-details"]')).toHaveTextContent(
			'pm-leads@ · 12 members',
		)
	})

	it('replies to, forwards and quotes the message whose header they are on', () => {
		const messages = longThread(3)
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		expandAll(3)
		fireEvent.click(screen.getByRole('button', { name: 'Reply to Grace' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: 'reply',
				threadId: 't1',
				to: 'grace@example.com',
				replyToMessageId: 'm1',
			}),
		)
		const alan = document.getElementById('message-m2') as HTMLElement
		fireEvent.click(within(alan).getByRole('button', { name: 'Forward this message' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'forward', threadId: 't1', subject: 'Fwd: ' }),
		)
		fireEvent.click(within(alan).getByRole('button', { name: 'Quote selection in reply' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: 'reply',
				replyToMessageId: 'm2',
				body: '> Note 2 about the plan.\n\n',
			}),
		)

		// A selection inside the message is what gets quoted.
		const article = document.getElementById('message-m2') as HTMLElement
		const text = within(article).getByText('Note 2 about the plan.').firstChild as Text
		const range = document.createRange()
		range.setStart(text, 0)
		range.setEnd(text, 6)
		window.getSelection()?.removeAllRanges()
		window.getSelection()?.addRange(range)
		fireEvent.click(within(alan).getByRole('button', { name: 'Quote selection in reply' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(expect.objectContaining({ body: '> Note 2\n\n' }))

		// An HTML body's words live in its shadow root; a selection there is inside the message too.
		const host = document.createElement('div')
		article.append(host)
		const shadowText = document.createTextNode('First, the calendar sync milestone')
		host.attachShadow({ mode: 'open' }).append(shadowText)
		// jsdom keeps no ranges inside a shadow tree, so the browser's selection is stood in for.
		const shadowSelection = vi
			.spyOn(window, 'getSelection')
			.mockReturnValue({ anchorNode: shadowText, toString: () => shadowText.data } as unknown as Selection)
		fireEvent.click(within(alan).getByRole('button', { name: 'Quote selection in reply' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ body: '> First, the calendar sync milestone\n\n' }),
		)
		shadowSelection.mockRestore()

		// A selection somewhere else quotes the message's own words.
		const outside = document.createElement('p')
		outside.textContent = 'Elsewhere'
		document.body.append(outside)
		range.setStart(outside.firstChild as Text, 0)
		range.setEnd(outside.firstChild as Text, 9)
		window.getSelection()?.removeAllRanges()
		window.getSelection()?.addRange(range)
		fireEvent.click(within(alan).getByRole('button', { name: 'Quote selection in reply' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ body: '> Note 2 about the plan.\n\n' }),
		)
		outside.remove()
		host.remove()
		window.getSelection()?.removeAllRanges()
	})

	/** A Gmail reply quoting Grace's message under its attribution line. */
	const quotedReply = (text: string, quoted: string) =>
		`<p>${text}</p><div class="gmail_quote"><div class="gmail_attr">On Tue, Oct 13, 2026 at 6:02 PM Grace Hopper &lt;grace@example.com&gt; wrote:<br></div><blockquote class="gmail_quote"><p>${quoted}</p></blockquote></div>`

	it('goes from a quoted message to that message in the thread', async () => {
		const messages: MailMessage[] = [
			{ ...message('m1'), from: [GRACE], to: [ADA], date: NOW - 2 * DAY, body: 'Here is v3.' },
			{ ...message('m2'), from: [ALAN], to: [ADA], date: NOW - DAY, body: 'Unrelated.' },
			{
				...message('m3'),
				from: [ADA],
				to: [GRACE],
				date: NOW,
				body: quotedReply('Thanks!', 'Here is v3.'),
			},
		]
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		const latest = document.getElementById('message-m3') as HTMLElement
		fireEvent.click(await within(latest).findByRole('button', { name: /^Quoted/ }))
		Element.prototype.scrollIntoView ??= () => {}
		fireEvent.click(within(latest).getByRole('button', { name: 'Go to Grace’s message' }))
		await waitFor(() =>
			expect(document.querySelector('[data-current="true"]')).toHaveAttribute(
				'aria-label',
				'Message from Grace Hopper',
			),
		)
	})

	it('stays where it is when the quoted person wrote nothing earlier in the thread', async () => {
		const messages: MailMessage[] = [
			{ ...message('m1'), from: [ALAN], to: [ADA], date: NOW - DAY, body: 'Hello.' },
			{
				...message('m2'),
				from: [ADA],
				to: [ALAN],
				date: NOW,
				body: quotedReply('Sure.', 'Elsewhere.'),
			},
		]
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		const latest = document.getElementById('message-m2') as HTMLElement
		fireEvent.click(await within(latest).findByRole('button', { name: /^Quoted/ }))
		fireEvent.click(within(latest).getByRole('button', { name: 'Go to Grace’s message' }))
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute('aria-label', 'Message from you')
	})

	it('replies to the first other person on your own message, and to no one on a note to yourself', () => {
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[
					{ ...message('m1'), from: [ADA], to: [ADA, ALAN] },
					{ ...message('m2'), from: [ADA], to: [ADA] },
				]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		expandAll(2)
		const [first, second] = screen.getAllByRole('button', { name: /^Reply to (?:you|Ada)$/i }) as [
			HTMLElement,
			HTMLElement,
		]
		fireEvent.click(first)
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'reply', replyToMessageId: 'm1', to: 'alan@example.com' }),
		)
		fireEvent.click(second)
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'reply', replyToMessageId: 'm2', to: '' }),
		)
	})

	it('collapses an open message from its header, which owns its right-click menu', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />)
		// The reader adds no menu of its own around the header (one long-press, one menu).
		const header = document.querySelector('[data-slot="message-header"]') as HTMLElement
		expect(header.closest('[data-state="closed"]')).toBeNull()
		expect(document.querySelectorAll('[data-slot="message-header"]')).toHaveLength(1)
		fireEvent.click(screen.getByRole('button', { name: 'Collapse message' }))
		expect(states()).toEqual([])
	})

	it('offers no raw download for a draft that has not been sent', () => {
		render(<ThreadConversation thread={thread('t2')} messages={[{ ...message('m1'), ownmailDraft: true }]} />)
		openMore()
		expect(screen.queryByRole('menuitem', { name: 'Download raw email' })).toBeNull()
	})

	it('keeps the browser menu on the message body, where links, images and text live', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)
		const body = document.querySelector('[data-slot="expanded-message-content"]') as HTMLElement
		expect(fireEvent.contextMenu(body.firstElementChild ?? body, { clientX: 10, clientY: 10 })).toBe(true)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
	})

	it('wires the notices, your outgoing mail and the edge states to what they offer', () => {
		const onDiscardDraft = vi.fn()
		const onRetryLoad = vi.fn()
		const sent = {
			id: 'sent',
			from: [ADA],
			to: [{ email: 'mary@nasa.gov' }],
			subject: 'Launch dates',
			date: NOW - 2 * DAY,
			body: 'Here are the dates.',
		}
		const bounce = {
			id: 'bounce',
			from: [{ email: 'mailer-daemon@ownmail.com' }],
			to: [ADA],
			subject: 'Undeliverable: Launch dates',
			date: NOW - 2 * DAY + 60,
			body: 'Delivery to mary@nasa.gov failed.',
		}
		const trashed = { ...message('trashed'), folders: ['trash'], date: NOW - DAY }
		const draft = { ...message('draft'), ownmailDraft: true as const, from: [ADA], to: [GRACE], date: NOW }
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[sent, bounce, trashed, draft]}
				mailboxEmail="ada@ownmail.com"
				failedMessageIds={['lost-1', 'lost-2']}
				onRetryLoad={onRetryLoad}
				onDiscardDraft={onDiscardDraft}
			/>,
		)
		// The bounced message opens and says it was not sent.
		expect(document.querySelector('[data-slot="outgoing-status"]')).toHaveTextContent(
			'Not sent.mary@nasa.gov bounced.',
		)
		fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith({
			kind: 'new',
			to: 'mary@nasa.gov',
			subject: 'Launch dates',
			body: 'Here are the dates.',
		})

		// The draft sits after the message it follows, with Resume and Discard.
		const yourDraft = screen.getByRole('region', { name: 'Your draft reply to Grace' })
		fireEvent.click(within(yourDraft).getByRole('button', { name: 'Resume' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith({ kind: 'draft', draftId: 'draft' })
		fireEvent.click(within(yourDraft).getByRole('button', { name: 'Discard' }))
		expect(onDiscardDraft).toHaveBeenCalledWith('draft')

		// Trash is said, not hidden silently, and can be shown.
		expect(screen.getByText('1 message is in Trash')).toBeInTheDocument()
		expect(document.getElementById('message-trashed')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Show' }))
		expect(document.getElementById('message-trashed')).not.toBeNull()
		// Shown, it still says it is in Trash.
		expect(
			(document.getElementById('message-trashed') as HTMLElement).querySelector('.reader-trash-note'),
		).toHaveTextContent('In Trash')

		// Messages the server could not load are counted, with a retry in place.
		const partial = screen.getByText('Couldn’t load 2 messages. Showing 3 saved on this device.')
		fireEvent.click(
			within(partial.closest('[role="note"]') as HTMLElement).getByRole('button', { name: 'Try again' }),
		)
		expect(onRetryLoad).toHaveBeenCalledTimes(1)
	})

	it('offers Send now and Cancel on your scheduled message only where the reader can act on them', async () => {
		const scheduled: MailMessage = {
			id: 'later',
			from: [ADA],
			to: [GRACE],
			subject: 'Re: Q3 offsite agenda',
			date: NOW - DAY,
			body: 'Thanks for pulling this together.',
			send_at: NOW + DAY,
			schedule_id: 'sched-1',
		}
		const onScheduledSend = vi.fn(async (): Promise<string | undefined> => undefined)
		const { rerender } = render(
			<ThreadConversation thread={thread('t1')} messages={[scheduled]} mailboxEmail="ada@ownmail.com" />,
		)
		// Without a way to act on it, the schedule is only said.
		expect(document.querySelector('[data-slot="outgoing-status"]')).toHaveTextContent(/^Sends/)
		expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull()
		rerender(
			<ThreadConversation
				thread={thread('t1')}
				messages={[scheduled]}
				mailboxEmail="ada@ownmail.com"
				onScheduledSend={onScheduledSend}
			/>,
		)
		// Sent now: nothing to open.
		fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
		expect(onScheduledSend).toHaveBeenLastCalledWith('later', 'send-now')
		await waitFor(() => expect(onScheduledSend).toHaveBeenCalledTimes(1))
		await Promise.resolve()
		expect(compose.openCompose).not.toHaveBeenCalled()
		// Not sent now: the draft that holds it opens.
		onScheduledSend.mockResolvedValueOnce('d-unsent')
		fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
		await waitFor(() =>
			expect(compose.openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd-unsent' }),
		)
		// A cancelled message opens in the composer on the draft that keeps every field.
		compose.openCompose.mockClear()
		onScheduledSend.mockResolvedValueOnce('d-cancelled')
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(onScheduledSend).toHaveBeenLastCalledWith('later', 'cancel')
		await waitFor(() =>
			expect(compose.openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'd-cancelled' }),
		)
		// A cancel that did not happen leaves the composer closed.
		compose.openCompose.mockClear()
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		await waitFor(() => expect(onScheduledSend).toHaveBeenCalledTimes(4))
		await Promise.resolve()
		expect(compose.openCompose).not.toHaveBeenCalled()
	})

	it('wires the notices: mute the list thread from its notice, and add someone back', () => {
		const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@example.com' }
		const messages: MailMessage[] = [
			{ ...message('m1'), from: [GRACE], to: [ADA, ALAN, KATHERINE], date: NOW - 2 * DAY, body: 'Plan?' },
			// Alan replied to all but Katherine.
			{ ...message('m2'), from: [ALAN], to: [GRACE, ADA], date: NOW - DAY, body: 'Looks good.' },
			{
				...message('m3'),
				from: [ALAN],
				to: [{ email: 'eng-all@example.com' }],
				date: NOW - 60,
				body: 'Staging is back.',
			},
		]
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		expandAll(3)
		const muted = () =>
			JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').mutedThreadsByAccount?.[
				'ada@ownmail.com'
			]
		fireEvent.click(screen.getByRole('button', { name: 'Mute thread' }))
		expect(muted()).toEqual(['t1'])
		// The notice now says the state, and toggles it back.
		fireEvent.click(screen.getByRole('button', { name: 'Unmute thread' }))
		expect(muted()).toBeUndefined()

		fireEvent.click(screen.getByRole('button', { name: 'Add Katherine back to yours' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: 'reply',
				threadId: 't1',
				replyToMessageId: 'm2',
				to: expect.stringContaining('katherine@example.com'),
			}),
		)
	})

	it('marks where messages that could not load were, and tries again from there', () => {
		const onRetryLoad = vi.fn()
		const messages = longThread(8)
		const ids = messages.map((entry) => entry.id)
		render(
			<ThreadConversation
				thread={{ ...thread('t1'), message_ids: [...ids.slice(0, 4), 'lost', ...ids.slice(4)] }}
				messages={messages}
				mailboxEmail="ada@ownmail.com"
				failedMessageIds={['lost']}
				onRetryLoad={onRetryLoad}
			/>,
		)
		const marker = document.querySelector('[data-slot="missing-messages"]') as HTMLElement
		expect(marker).toHaveTextContent('Couldn’t load 1 message here.')
		// The run before it folds only up to the gap; the gap follows its folded row.
		expect(marker.closest('[data-slot="stream-item"]')?.previousElementSibling).not.toBeNull()
		fireEvent.click(within(marker).getByRole('button', { name: 'Try again' }))
		expect(onRetryLoad).toHaveBeenCalledOnce()
	})

	it('says who a reply dropped even when the message before it is a one-line row', () => {
		const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@example.com' }
		const messages: MailMessage[] = [
			{ ...message('m1'), from: [GRACE], to: [ADA, ALAN, KATHERINE], date: NOW - 2 * DAY, body: 'Plan?' },
			{ ...message('m2'), from: [ALAN], to: [GRACE, ADA], date: NOW - DAY, body: 'Looks good.' },
		]
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		// Grace's message is a one-line row; Alan's open reply still says Katherine was dropped.
		expect(document.querySelectorAll('[data-slot="thread-message"]')).toHaveLength(1)
		expect(screen.getByRole('button', { name: 'Add Katherine back to yours' })).toBeInTheDocument()
	})

	it('says once that a thread came through a list, on its first open message from the list', () => {
		const ENG_ALL = { email: 'eng-all@example.com' }
		const messages: MailMessage[] = [1, 2, 3].map((n) => ({
			...message(`m${n}`),
			from: [n === 2 ? ADA : ALAN],
			to: [ENG_ALL],
			date: NOW - (4 - n) * 60,
			body: `Update ${n}.`,
			unread: true,
		}))
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		expect(document.querySelectorAll('[data-slot="thread-message"]')).toHaveLength(3)
		expect(screen.getAllByRole('button', { name: 'Mute thread' })).toHaveLength(1)
		expect(document.getElementById('message-m1')).toHaveTextContent('Sent to eng-all@')
	})

	it('shows an invitation that changed once, and notes the earlier version where it was', async () => {
		const invite = (id: string, date: number): MailMessage => ({
			id,
			from: [GRACE],
			to: [ADA],
			subject: 'Invitation: Design review',
			date,
			body: 'Join us.',
			attachments: [{ id: `${id}-ics`, filename: 'invite.ics', content_type: 'text/calendar' }],
		})
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[invite('i1', NOW - 2 * DAY), invite('i2', NOW - DAY)]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		// The newest invitation is the card: changed once, its earlier start (read from the earlier file) struck.
		const card = await screen.findByText('Updated 1 time')
		expect(getCalendarInvitationMock).toHaveBeenCalledWith({
			data: { messageId: 'i2', attachmentId: 'i2-ics' },
		})
		await waitFor(() =>
			expect(getInvitationFileTimeMock).toHaveBeenCalledWith({
				data: { messageId: 'i1', attachmentId: 'i1-ics' },
			}),
		)
		expect(card).toBeInTheDocument()
		expect(
			await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'invitation-previous-time'),
		).toBeInTheDocument()
		expandAll(2)
		const scrolled = vi.fn()
		Element.prototype.scrollIntoView = scrolled
		fireEvent.click(screen.getByRole('button', { name: 'Show latest' }))
		expect(document.getElementById('message-i2')?.querySelector('[data-current="true"]')).not.toBeNull()
		expect(scrolled).toHaveBeenCalled()
	})

	it('mutes and unmutes the thread from the More menu, and offers the raw latest message', () => {
		render(
			<ThreadConversation
				thread={thread('t1')}
				messages={[message('m1'), message('m2')]}
				mailboxEmail="Ada@OwnMail.com"
			/>,
		)
		// Mutes belong to the signed-in mailbox.
		const muted = () =>
			JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').mutedThreadsByAccount?.[
				'ada@ownmail.com'
			]
		openMore()
		const download = screen.getByRole('menuitem', { name: 'Download raw email' })
		expect(download).toHaveAttribute('href', '/messages/m2/download')
		fireEvent.click(screen.getByRole('menuitem', { name: 'Mute thread' }))
		expect(muted()).toEqual(['t1'])
		openMore()
		// The label says the state; it is a plain action, not a pressed toggle.
		const unmute = screen.getByRole('menuitem', { name: 'Unmute thread' })
		expect(unmute).not.toHaveAttribute('aria-pressed')
		fireEvent.click(unmute)
		expect(muted()).toBeUndefined()
	})
})

describe('the More menu', () => {
	it('moves with the keyboard, keeps its keys from the page, and closes on Escape, Tab or an outside press', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />)
		const trigger = screen.getByRole('button', { name: 'More' })
		fireEvent.click(trigger)
		expect(trigger).toHaveAttribute('aria-expanded', 'true')
		const menu = screen.getByRole('menu')
		expect(trigger).toHaveAttribute('aria-controls', menu.id)
		const items = within(menu).getAllByRole('menuitem')
		expect(items[0]).toHaveFocus()
		// Checkbox items (the thread map) are in the arrow-key order too.
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(within(menu).getByRole('menuitemcheckbox', { name: /^Thread map/ })).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(items.at(-1)).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(items[0]).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'a' })
		expect(items[0]).toHaveFocus()

		const onWindowKeyDown = vi.fn()
		window.addEventListener('keydown', onWindowKeyDown)
		fireEvent.keyDown(menu, { key: 'Escape' })
		window.removeEventListener('keydown', onWindowKeyDown)
		expect(onWindowKeyDown).not.toHaveBeenCalled()
		expect(screen.queryByRole('menu')).toBeNull()
		expect(trigger).toHaveFocus()
		expect(trigger).not.toHaveAttribute('aria-controls')

		fireEvent.click(trigger)
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
		expect(screen.queryByRole('menu')).toBeNull()

		fireEvent.click(trigger)
		fireEvent.pointerDown(screen.getByRole('menu'))
		expect(screen.getByRole('menu')).toBeInTheDocument()
		fireEvent.pointerDown(document.body)
		expect(screen.queryByRole('menu')).toBeNull()

		fireEvent.click(trigger)
		fireEvent.click(trigger)
		expect(screen.queryByRole('menu')).toBeNull()

		fireEvent.click(trigger)
		const download = screen.getByRole('menuitem', { name: 'Download raw email' })
		download.addEventListener('click', (event) => event.preventDefault())
		fireEvent.click(download)
		expect(screen.queryByRole('menu')).toBeNull()
	})
})

describe('thread actions placement', () => {
	function slot(id: string) {
		const element = document.createElement('div')
		element.id = id
		document.body.append(element)
		return element
	}

	function stubViewport(desktop: boolean) {
		const listeners = new Set<() => void>()
		const media = {
			matches: desktop,
			addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
			removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
		}
		vi.stubGlobal(
			'matchMedia',
			vi.fn((query: string) => ({
				...media,
				// The phone query is the complement of the desktop one.
				get matches() {
					return query.includes('max-width') ? !media.matches : media.matches
				},
			})),
		)
		return {
			listeners,
			resize(next: boolean) {
				media.matches = next
				act(() => {
					for (const listener of listeners) listener()
				})
			},
		}
	}

	afterEach(() => {
		for (const id of [THREAD_TOOLBAR_ACTIONS_ID, THREAD_TOOLBAR_MORE_ID, THREAD_MOBILE_MORE_ID]) {
			document.getElementById(id)?.remove()
		}
	})

	const conversation = (
		<ThreadConversation thread={thread('t1')} messages={[htmlMessage('m1'), htmlMessage('m2')]} />
	)

	it('puts the view controls and the stepper in the toolbar, and More at its end, on desktop', () => {
		const actions = slot(THREAD_TOOLBAR_ACTIONS_ID)
		const more = slot(THREAD_TOOLBAR_MORE_ID)
		const viewport = stubViewport(true)
		const { container } = render(conversation)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement

		expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)')
		// The subject row holds the subject and its meta line only.
		expect(summary.querySelector('[data-slot="thread-actions"]')).toBeNull()
		expect(actions).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		expect(actions).toContainElement(screen.getByRole('button', { name: 'Previous message (k)' }))
		expect(actions.querySelector('hr')).not.toBeNull()
		expect(more).toContainElement(screen.getByRole('button', { name: 'More' }))
		// The actions keep working from the toolbar: state stays with the conversation.
		expandAll(2)
		expect(container.querySelectorAll('[data-slot="thread-message"][data-state="open"]')).toHaveLength(2)
		expect(viewport.listeners.size).toBeGreaterThan(0)
	})

	it('hands More to the phone top bar on narrow screens, with the view choice inside it', async () => {
		const actions = slot(THREAD_TOOLBAR_ACTIONS_ID)
		const mobile = slot(THREAD_MOBILE_MORE_ID)
		const viewport = stubViewport(false)
		const { unmount } = render(
			<QueryClientProvider client={new QueryClient()}>{conversation}</QueryClientProvider>,
		)

		expect(actions).toBeEmptyDOMElement()
		expect(mobile).toContainElement(screen.getByRole('button', { name: 'More' }))
		// Display options join More on a phone only when they have something to offer:
		// here the messages' remote images are blocked.
		await waitFor(() =>
			expect(mobile).toContainElement(screen.getByRole('button', { name: 'Thread display' })),
		)
		openMore()
		fireEvent.click(screen.getByRole('menuitem', { name: 'Conversation view' }))
		expect(document.querySelector('[data-slot="thread-message"]')).toBeNull()
		openMore()
		fireEvent.click(screen.getByRole('menuitem', { name: 'Messages view' }))

		// Crossing the breakpoint moves the same controls, without duplicating them.
		viewport.resize(true)
		expect(screen.getAllByRole('button', { name: 'Thread display' })).toHaveLength(1)
		expect(actions).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		unmount()
		expect(viewport.listeners.size).toBe(0)
	})

	it('opens the files shelf from the phone More menu, where the header has no files count', () => {
		const mobile = slot(THREAD_MOBILE_MORE_ID)
		stubViewport(false)
		const withFile = {
			...message('m1'),
			attachments: [{ id: 'a1', filename: 'plan.pdf', size: 2048, content_type: 'application/pdf' }],
		}
		render(<ThreadConversation thread={thread('t1')} messages={[withFile, message('m2')]} />)
		expect(mobile).toContainElement(screen.getByRole('button', { name: 'More' }))
		openMore()
		const files = screen.getByRole('menuitemcheckbox', { name: 'Files (1)' })
		expect(files).toHaveAttribute('aria-checked', 'false')
		fireEvent.click(files)
		expect(screen.getByRole('region', { name: 'Files in this thread' })).toBeInTheDocument()
		openMore()
		expect(screen.getByRole('menuitemcheckbox', { name: 'Files (1)' })).toHaveAttribute(
			'aria-checked',
			'true',
		)
	})

	it('keeps the controls beside the subject for a pane without a toolbar', () => {
		stubViewport(true)
		const { container } = render(conversation)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement

		expect(summary).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		expect(summary).toContainElement(screen.getByRole('button', { name: 'More' }))
	})

	it('keeps the view controls beside the subject when the toolbar offers only More', () => {
		const more = slot(THREAD_TOOLBAR_MORE_ID)
		stubViewport(true)
		const { container } = render(conversation)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement

		expect(summary).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		expect(more).toContainElement(screen.getByRole('button', { name: 'More' }))
	})

	it('uses the toolbar when the environment cannot report the viewport', () => {
		const actions = slot(THREAD_TOOLBAR_ACTIONS_ID)
		vi.stubGlobal('matchMedia', undefined)
		render(conversation)

		expect(actions).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
	})

	it('renders no action row for a single plain-text message', () => {
		slot(THREAD_TOOLBAR_ACTIONS_ID)
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)

		expect(document.querySelector('[data-slot="thread-actions"]')).toBeNull()
		expect(document.querySelector('[data-slot="thread-stepper"]')).toBeNull()
	})
})
