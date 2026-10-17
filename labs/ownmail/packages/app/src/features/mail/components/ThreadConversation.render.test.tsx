// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useLayoutEffect } from 'react'
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

// The reader mounts parts that other modules own. These stand-ins (test/reader-contract-mocks)
// keep these tests about what the reader mounts and wires, not how each part looks.
vi.mock('./Avatar', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./MessageHeader', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./MessageNotices', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./AttachmentChip', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./EmptyBody', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./DraftInThread', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./OutgoingStatus', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./ThreadStreamNotices', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./PartialLoadNotice', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./ThreadLoadError', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./LongMessageFrame', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./SupersededInvite', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./ReplyAllGuard', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./CatchUpCard', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./ThreadMapPanel', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./ThreadFilesShelf', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./MobileThreadTopBar', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./JumpToNewPill', () => import('../../../../test/reader-contract-mocks'))
vi.mock('./MobileReplyBar', () => import('../../../../test/reader-contract-mocks'))

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
// The invitation card loads its event; here it only reports what the reader hands it.
vi.mock('./CalendarInvitationCard', () => ({
	CalendarInvitationCard: ({ message, updateCount }: { message: MailMessage; updateCount?: number }) =>
		message.attachments?.some((attachment) => attachment.content_type === 'text/calendar') ? (
			<p data-slot="invitation-stub">
				Invitation {message.id}
				{updateCount ? `, updated ${updateCount} times` : ''}
			</p>
		) : null,
}))

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
	localStorage.clear()
	resetAccountScope()
	window.location.hash = ''
	vi.unstubAllGlobals()
})

beforeEach(() => {
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
		expect(headers.map((heading) => heading.textContent)).toEqual(['Grace Hopper', 'Alan Turing', 'you'])
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
		expect(document.querySelectorAll('[data-state="open"]')).toHaveLength(3)
		expect(screen.queryByRole('menu')).toBeNull()

		openMore()
		expect(screen.getByRole('menuitem', { name: 'Expand all 3 messages' })).toBeDisabled()
		fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse all 3 messages' }))
		expect(document.querySelectorAll('[data-state="open"]')).toHaveLength(0)
		// Each collapsed message is a one-line row that opens with one click.
		const rows = document.querySelectorAll<HTMLButtonElement>('[data-slot="message-expand"]')
		expect(rows).toHaveLength(3)
		openMore()
		expect(screen.getByRole('menuitem', { name: 'Collapse all 3 messages' })).toBeDisabled()
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
		fireEvent.click(rows[1] as HTMLButtonElement)
		expect(document.querySelectorAll('[data-state="open"]')).toHaveLength(1)
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
		fireEvent.click(within(shelf).getByRole('button', { name: 'Open roadmap.pdf' }))
		expect(open).toHaveBeenCalledWith('/attachments/a1?message_id=m1', '_blank', 'noopener')
		vi.useFakeTimers()
		const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
		fireEvent.click(within(shelf).getByRole('button', { name: 'Download all' }))
		vi.runAllTimers()
		vi.useRealTimers()
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

	it('shows each file of an open message as a chip with its size and the version it replaces', () => {
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
		expect(within(latest).getAllByText(/plan-v2\.pdf/)).toHaveLength(1)
		expect(within(latest).getByText(/plan-v2\.pdf/)).toHaveTextContent(/2 KB · replaces v1 from /)
		expect(
			within(screen.getByRole('region', { name: 'Attachments from Grace Hopper' })).getByText(/plan-v1/),
		).toHaveTextContent('plan-v1.pdf · 1 KB')
		expect(screen.getByText('Invitation m2')).toBeInTheDocument()
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
		expect(screen.getByRole('separator', { name: /^2 new since / })).toBeInTheDocument()
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
		expect(folded).toHaveTextContent('Alan, Grace, you')
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
		const divider = screen.getByRole('separator', { name: /^2 new since / })
		// The label is drawn between two neutral lines and announced on the separator itself.
		expect(divider.closest('[data-slot="new-since-divider"]')).toHaveTextContent(
			/^2 new since (?:yesterday|[A-Z][a-z]+day)$/,
		)

		// Opening the thread marked it read; what was new when it opened stays new.
		const read = messages.map((entry) => ({ ...entry, unread: false }))
		rendered.rerender(
			<ThreadConversation thread={thread('t1')} messages={read} mailboxEmail="ada@ownmail.com" />,
		)
		expect(screen.getByRole('separator', { name: /^2 new since / })).toBeInTheDocument()
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

	it('offers a catch-up card above what is new on a long thread', () => {
		const messages = longThread(7, 1)
		const last = messages.at(-1) as MailMessage
		messages[messages.length - 1] = { ...last, body: 'Ada, can you confirm the date?' }
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		const card = screen.getByRole('region', { name: 'Catch up' })
		expect(card).toHaveTextContent(/Since you last read, (?:yesterday|[A-Z][a-z]+day): 1 new/)
		const stream = document.querySelector('[data-slot="thread-message-stream"]') as HTMLElement
		expect([...stream.children].map((child) => child.getAttribute('data-kind') ?? 'rule').slice(-4)).toEqual([
			'rule',
			'catch-up',
			'divider',
			'open',
		])

		fireEvent.click(within(card).getByRole('button', { name: 'Answer Grace' }))
		expect(compose.openCompose).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'reply', threadId: 't1', replyToMessageId: 'm7' }),
		)
		fireEvent.click(within(card).getByRole('button', { name: 'Show sources' }))
		expect(document.querySelectorAll('[data-source="true"]')).toHaveLength(1)
		fireEvent.click(within(card).getByRole('button', { name: 'Hide sources' }))
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
		expect(screen.getByText('Draft reply to nobody')).toBeInTheDocument()
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

	it('points a phone at the new messages still below the fold, and goes to the next one', () => {
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
			<UserPreferencesProvider initialPreferences={defaultUserPreferences()}>
				<ThreadConversation
					thread={thread('t1')}
					messages={longThread(8, 2)}
					mailboxEmail="ada@ownmail.com"
				/>
			</UserPreferencesProvider>,
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

	it('leaves j and k to a list beside the reader while the list has focus', () => {
		const row = document.createElement('button')
		row.setAttribute('data-nav-row', '')
		// jsdom lays nothing out: the list is on screen until the test hides it.
		let listShown = true
		row.checkVisibility = () => listShown
		document.body.append(row)
		render(
			<ThreadConversation thread={thread('t1')} messages={longThread(4, 1)} mailboxEmail="ada@ownmail.com" />,
		)
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		fireEvent.keyDown(row, { key: 'k' })
		fireEvent.keyDown(document.body, { key: 'k' })
		expect(position()).toBe('4 of 4')
		fireEvent.keyDown(screen.getByRole('heading', { level: 1 }), { key: 'k' })
		expect(position()).toBe('3 of 4')
		// A list the layout hides (below xl, or with the reading pane off) is not beside the reader.
		listShown = false
		fireEvent.keyDown(document.body, { key: 'k' })
		expect(position()).toBe('2 of 4')
		// Without checkVisibility, a list with no boxes is hidden too.
		;(row as { checkVisibility?: unknown }).checkVisibility = undefined
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
		fireEvent.focus(screen.getByRole('button', { name: 'Reply to Grace Hopper' }))
		expect(position()).toBe('1 of 3')
		expect(
			screen.getByRole('complementary', { name: 'Thread map' }).querySelector('[aria-current="true"]'),
		).toHaveAccessibleName(/^Grace Hopper/)
		// Focus outside any message (the subject) leaves the stepper where it is.
		fireEvent.focus(screen.getByRole('heading', { level: 1 }))
		expect(position()).toBe('1 of 3')
	})

	it('opens the thread map with g m, from the dots, and from the More menu', () => {
		const dock = document.createElement('div')
		dock.id = THREAD_MAP_DOCK_ID
		document.body.append(dock)
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
		const panel = within(dock).getByRole('complementary', { name: 'Thread map panel' })
		expect(panel).toHaveAttribute('data-selected', 'm3')
		fireEvent.click(within(panel).getByRole('button', { name: 'Map row m5' }))
		expect(document.querySelector('[data-current="true"]')).toHaveAttribute(
			'aria-label',
			'Message from Alan Turing',
		)
		fireEvent.click(within(panel).getByRole('button', { name: 'Close thread map' }))
		expect(screen.queryByRole('complementary', { name: 'Thread map panel' })).toBeNull()

		fireEvent.click(within(dots).getByRole('button', { name: /^Open thread map/ }))
		expect(screen.getByRole('complementary', { name: 'Thread map panel' })).toBeInTheDocument()
		openMore()
		const item = screen.getByRole('menuitemcheckbox', { name: /^Thread map/ })
		expect(item).toHaveAttribute('aria-checked', 'true')
		expect(item).not.toHaveAttribute('aria-pressed')
		fireEvent.click(item)
		expect(screen.queryByRole('complementary', { name: 'Thread map panel' })).toBeNull()
		// A g without its m does nothing.
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'x' })
		fireEvent.keyDown(document.body, { key: 'm' })
		expect(screen.queryByRole('complementary', { name: 'Thread map panel' })).toBeNull()

		// g m works with a list row focused (no list shortcut uses g or m).
		const row = document.createElement('button')
		row.setAttribute('data-nav-row', '')
		document.body.append(row)
		fireEvent.keyDown(row, { key: 'g' })
		fireEvent.keyDown(row, { key: 'm' })
		expect(screen.getByRole('complementary', { name: 'Thread map panel' })).toBeInTheDocument()
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
		expect(screen.getByRole('complementary', { name: 'Thread map panel' })).toBeInTheDocument()
		const position = () => document.querySelector('[data-slot="thread-stepper"] span')?.textContent
		const before = position()
		fireEvent.keyDown(document.body, { key: 'k' })
		expect(position()).toBe(before)
		fireEvent.keyDown(sheetRow, { key: 'g' })
		fireEvent.keyDown(sheetRow, { key: 'm' })
		expect(screen.queryByRole('complementary', { name: 'Thread map panel' })).toBeNull()
		const other = document.createElement('div')
		other.setAttribute('role', 'dialog')
		document.body.append(other)
		fireEvent.keyDown(document.body, { key: 'g' })
		fireEvent.keyDown(document.body, { key: 'm' })
		expect(screen.queryByRole('complementary', { name: 'Thread map panel' })).toBeNull()
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
		expect(screen.getByRole('region', { name: 'Catch up' })).toBeInTheDocument()
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
		fireEvent.click(screen.getByRole('button', { name: 'Show trashed' }))
		expect(position()).toBe('3 of 7')

		const reply = { ...message('m7'), from: [GRACE], date: NOW }
		rerender(
			<ThreadConversation
				thread={thread('t1')}
				messages={[...first, reply]}
				mailboxEmail="ada@ownmail.com"
			/>,
		)
		expect(within(dock).getByRole('complementary', { name: 'Thread map panel' })).toBeInTheDocument()
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
	it('replies to, forwards and quotes the message whose header they are on', () => {
		const messages = longThread(3)
		render(<ThreadConversation thread={thread('t1')} messages={messages} mailboxEmail="ada@ownmail.com" />)
		expandAll(3)
		fireEvent.click(screen.getByRole('button', { name: 'Reply to Grace Hopper' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: 'reply',
				threadId: 't1',
				to: 'grace@example.com',
				replyToMessageId: 'm1',
			}),
		)
		fireEvent.click(screen.getByRole('button', { name: 'Forward message from Alan Turing' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'forward', threadId: 't1', subject: 'Fwd: ' }),
		)
		fireEvent.click(screen.getByRole('button', { name: 'Quote message from Alan Turing' }))
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
		fireEvent.click(screen.getByRole('button', { name: 'Quote message from Alan Turing' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith(expect.objectContaining({ body: '> Note 2\n\n' }))
		window.getSelection()?.removeAllRanges()
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
		const [first, second] = screen.getAllByRole('button', { name: 'Reply to you' }) as [
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
		fireEvent.click(screen.getByRole('button', { name: 'Collapse message from sender@example.com' }))
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
		expect(screen.getByText(/Not sent\. mary@nasa\.gov bounced\./)).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith({
			kind: 'new',
			to: 'mary@nasa.gov',
			subject: 'Launch dates',
			body: 'Here are the dates.',
		})
		// Send now and Cancel need a provider call OwnMail does not have: none is offered.
		expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Cancel scheduled send' })).toBeNull()

		// The draft sits after the message it follows, with Resume and Discard.
		expect(screen.getByText('Draft reply to Grace')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
		expect(compose.openCompose).toHaveBeenLastCalledWith({ kind: 'draft', draftId: 'draft' })
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
		expect(onDiscardDraft).toHaveBeenCalledWith('draft')

		// Trash is said, not hidden silently, and can be shown.
		expect(screen.getByText(/1 in Trash/)).toBeInTheDocument()
		expect(document.getElementById('message-trashed')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Show trashed' }))
		expect(document.getElementById('message-trashed')).not.toBeNull()

		// Messages the server could not load are counted, with a retry in place.
		expect(screen.getByText(/2 failed, 3 shown/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
		expect(onRetryLoad).toHaveBeenCalledTimes(1)

		// Notices: muting from a notice mutes the thread; adding someone back replies to all of them.
		fireEvent.click(screen.getAllByRole('button', { name: /^Mute from notice/ })[0] as HTMLElement)
		expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').mutedThreadIds).toEqual([
			't1',
		])
		fireEvent.click(screen.getAllByRole('button', { name: /^Mute from notice/ })[0] as HTMLElement)
		expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').mutedThreadIds).toEqual([
			't1',
		])
		fireEvent.click(screen.getAllByRole('button', { name: /^Add back from notice/ })[0] as HTMLElement)
		expect(compose.openCompose).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: 'reply', threadId: 't1', replyToMessageId: expect.any(String) }),
		)
	})

	it('shows an invitation that changed once, and notes the earlier version where it was', () => {
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
		expect(screen.getByText('Invitation i2, updated 1 times')).toBeInTheDocument()
		expandAll(2)
		const scrolled = vi.fn()
		Element.prototype.scrollIntoView = scrolled
		fireEvent.click(screen.getByRole('button', { name: 'Show the latest invitation' }))
		expect(document.getElementById('message-i2')?.querySelector('[data-current="true"]')).not.toBeNull()
		expect(scrolled).toHaveBeenCalled()
	})

	it('mutes and unmutes the thread from the More menu, and offers the raw latest message', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />)
		openMore()
		const download = screen.getByRole('menuitem', { name: 'Download raw email' })
		expect(download).toHaveAttribute('href', '/messages/m2/download')
		fireEvent.click(screen.getByRole('menuitem', { name: 'Mute thread' }))
		expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').mutedThreadIds).toEqual([
			't1',
		])
		openMore()
		// The label says the state; it is a plain action, not a pressed toggle.
		const unmute = screen.getByRole('menuitem', { name: 'Unmute thread' })
		expect(unmute).not.toHaveAttribute('aria-pressed')
		fireEvent.click(unmute)
		expect(JSON.parse(localStorage.getItem('ownmail:user-preferences:v1') ?? '{}').mutedThreadIds).toEqual([])
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
		expect(container.querySelectorAll('[data-state="open"]')).toHaveLength(2)
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
