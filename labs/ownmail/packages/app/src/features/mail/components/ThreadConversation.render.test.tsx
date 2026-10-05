// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAccountScope, setAccountScope } from '#app/lib/account-scope'
import { EMAIL_ELEMENT_TAG, EMAIL_LAYOUT_STATUS_EVENT } from '../lib/email-render'
import type { MailMessage, MailThread } from '../state/mail-queries'
import { THREAD_TOOLBAR_ACTIONS_ID, ThreadConversation } from './ThreadConversation'

const { trustSenderImagesMock, originalColorSendersMock, setSenderOriginalColorsMock } = vi.hoisted(() => ({
	trustSenderImagesMock: vi.fn(),
	originalColorSendersMock: vi.fn(),
	setSenderOriginalColorsMock: vi.fn(),
}))
vi.mock('../lib/image-sender-trust', async (importOriginal) => ({
	...(await importOriginal<typeof import('../lib/image-sender-trust')>()),
	trustSenderImages: trustSenderImagesMock,
	originalColorSenders: originalColorSendersMock,
	setSenderOriginalColors: setSenderOriginalColorsMock,
}))

afterEach(() => {
	cleanup()
	document.documentElement.classList.remove('dark')
	localStorage.clear()
	resetAccountScope()
})

beforeEach(() => {
	setAccountScope('ada@ownmail.com')
	trustSenderImagesMock.mockReset()
	originalColorSendersMock.mockReset()
	originalColorSendersMock.mockResolvedValue([])
	setSenderOriginalColorsMock.mockReset()
	setSenderOriginalColorsMock.mockResolvedValue(true)
})

const CONTROLLED_IMAGE = `/email-images/${'a'.repeat(20)}.${'b'.repeat(20)}?mode=automatic&theme=light`

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

	it('keeps the mobile timestamp on a dedicated one-line row', () => {
		const datedMessage = { ...message('m1'), date: 1_700_000_000 }
		const { container } = render(<ThreadConversation thread={thread('t1')} messages={[datedMessage]} />)
		const timestamps = container.querySelectorAll('time')

		expect(timestamps).toHaveLength(2)
		expect(timestamps[0]).toHaveClass('hidden', 'sm:inline-block', 'order-3')
		expect(timestamps[1]).toHaveClass('basis-full', 'whitespace-nowrap', 'pl-10', 'sm:hidden')
		// Item 7 of the reading change: metadata is 13px, one step up from the 12px it was.
		for (const timestamp of timestamps) {
			expect(timestamp).toHaveClass('text-[13px]')
			expect(timestamp).not.toHaveClass('text-xs')
		}
		expect(container.querySelector('[data-slot="message-details"]')).toHaveClass('text-[13px]')
	})

	it('makes multi-message display controls descriptive, touch-friendly, and stateful', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2'), message('m3')]} />,
		)
		const expand = screen.getByRole('button', { name: 'Expand all 3 messages' })
		const collapse = screen.getByRole('button', { name: 'Collapse all 3 messages' })

		expect(expand).toHaveTextContent('')
		expect(expand).toHaveAttribute('title', 'Expand all messages')
		// The shared icon button: 36px with a fine pointer, 44px on narrow and touch screens.
		const touchFriendly = [
			'size-9',
			'max-md:size-11',
			'[@media(any-pointer:coarse)]:size-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'forced-colors:focus-visible:outline-2',
			'forced-colors:focus-visible:outline-offset-2',
			'forced-colors:focus-visible:outline-solid',
		]
		expect(expand).toHaveClass(...touchFriendly)
		expect(collapse).toHaveTextContent('')
		expect(collapse).toHaveAttribute('title', 'Collapse all messages')
		expect(collapse).toHaveClass(...touchFriendly)
		const states = () =>
			[...document.querySelectorAll('[data-slot="thread-message"]')].map((node) =>
				node.getAttribute('data-state'),
			)

		fireEvent.click(expand)
		expect(expand).toBeDisabled()
		expect(states()).toEqual(['open', 'open', 'open'])
		expect(screen.queryByRole('button', { name: /Expand message from/ })).not.toBeInTheDocument()

		fireEvent.click(collapse)
		expect(collapse).toBeDisabled()
		expect(states()).toEqual(['collapsed', 'collapsed', 'collapsed'])
		// A collapsed message opens from its own summary, without going through a menu.
		expect(screen.getAllByRole('button', { name: /Expand message from/ })).toHaveLength(3)
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
		expect(trigger).toHaveClass(
			'size-9',
			'max-md:size-11',
			'[@media(any-pointer:coarse)]:size-11',
			'focus-visible:ring-[3px]',
		)
		expect(trigger.closest('[data-slot="thread-message"]')).toBeNull()

		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))
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

		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))
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
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))
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
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))
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

	it('uses a compact, scroll-away summary without duplicating attachment links', () => {
		const firstMessage = {
			...message('m1'),
			attachments: [{ id: 'a1', filename: 'roadmap.pdf', size: 2048, is_inline: false }],
		}
		const { container } = render(
			<ThreadConversation
				thread={{ ...thread('t1'), folders: ['work'] }}
				messages={[firstMessage, message('m2')]}
			/>,
		)
		const summary = container.querySelector('[data-slot="thread-summary"]')
		const attachmentSummary = container.querySelector('[data-slot="thread-attachment-summary"]')

		// The subject scrolls away with the conversation at every width: nothing in
		// the summary is pinned, and no separator stands between it and the first message.
		expect(summary?.className).not.toMatch(/sticky|top-0|border-b/)
		expect(summary).toHaveClass('pt-3')
		const subject = screen.getByRole('heading', { level: 1 })
		// Body size in the body face, so it reads as the first line and not a banner.
		expect(subject).toHaveClass('font-sans', 'text-base', 'leading-6', 'font-semibold')
		expect(subject.className).not.toMatch(/font-display|text-balance|text-(?:lg|xl|2xl)/)
		// Labels sit inline after the subject, in the same wrapping line.
		expect(screen.getByText('Work').parentElement).toBe(subject.parentElement)
		expect(summary?.firstElementChild).toHaveAttribute('data-slot', 'thread-column')
		expect(attachmentSummary).toHaveTextContent('1 thread attachment')
		expect(attachmentSummary).toHaveClass('min-h-11', 'max-w-full')
		// No inline padding of its own, so it starts on the same edge as the subject above it.
		expect(attachmentSummary?.className).not.toMatch(/\bp[xlrse]-/)
		expect(container.querySelectorAll('[data-slot="thread-attachment"]')).toHaveLength(0)
	})

	it('gives attachment downloads a touch-friendly target and visible keyboard focus', () => {
		const messageWithAttachment = {
			...message('m1'),
			attachments: [
				{
					id: 'attachment-1',
					filename: 'project-plan.pdf',
					size: 2048,
					is_inline: false,
				},
			],
		}
		const { container } = render(
			<ThreadConversation thread={thread('t1')} messages={[messageWithAttachment]} />,
		)
		const links = container.querySelectorAll<HTMLAnchorElement>('[data-slot="thread-attachment"]')

		expect(links).toHaveLength(1)
		for (const link of links) {
			expect(link).toHaveClass(
				'min-h-11',
				'focus-visible:outline-none',
				'focus-visible:ring-[3px]',
				'focus-visible:ring-ring',
				'forced-colors:focus-visible:outline-2',
				'forced-colors:focus-visible:outline-offset-2',
				'forced-colors:focus-visible:outline-solid',
			)
			expect(link).toHaveAttribute('href', '/attachments/attachment-1?message_id=m1')
			expect(link).toHaveAttribute('download', 'project-plan.pdf')
			expect(link).toHaveTextContent('project-plan.pdf')
			expect(link).toHaveTextContent('2 KB')
			expect(link).toHaveAccessibleName('project-plan.pdf, 2 KB, attached to message from sender@example.com')
		}
	})

	it('keeps downloads solely with their attributed message in a multi-message thread', () => {
		const fromAlex = {
			...message('m1'),
			from: [{ name: 'Alex', email: 'alex@example.com' }],
			attachments: [{ id: 'a1', filename: 'plan.pdf', is_inline: false }],
		}
		const fromSam = {
			...message('m2'),
			from: [{ email: 'sam@example.com' }],
			attachments: [{ id: 'a2', filename: 'notes.txt', is_inline: false }],
		}
		const { container } = render(<ThreadConversation thread={thread('t1')} messages={[fromAlex, fromSam]} />)
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))

		expect(screen.getByText('2 thread attachments')).toBeInTheDocument()
		expect(container.querySelectorAll('[data-slot="thread-attachment"]')).toHaveLength(2)
		expect(
			container.querySelector('[aria-label="plan.pdf, attached to message from Alex"]'),
		).toBeInTheDocument()
		expect(
			container.querySelector('[aria-label="notes.txt, attached to message from sam@example.com"]'),
		).toBeInTheDocument()
		expect(screen.getByRole('region', { name: 'Attachments from sam@example.com' })).toBeInTheDocument()
	})

	it('separates messages as distinct reader surfaces', () => {
		const { container } = render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />,
		)
		const messageSurfaces = container.querySelectorAll('[data-slot="thread-message"]')

		expect(messageSurfaces).toHaveLength(2)
		for (const surface of messageSurfaces) {
			expect(surface).not.toHaveClass('rounded-xl', 'border', 'shadow-xs')
		}
		const headers = container.querySelectorAll('[data-slot="message-header"]')
		expect(headers[0]).not.toHaveClass('border-t')
		expect(headers[1]).toHaveClass('border-t', 'border-border')
		expect(messageSurfaces[0]?.parentElement).toHaveAttribute('data-slot', 'thread-message-stream')
		expect(messageSurfaces[0]?.parentElement).toHaveAttribute('data-navigation-content')
		expect(messageSurfaces[0]?.parentElement?.parentElement).toHaveAttribute('data-slot', 'thread-messages')
		expect(screen.getAllByRole('heading', { level: 2, name: 'sender@example.com' })).toHaveLength(2)
		expect(screen.getAllByRole('article', { name: 'sender@example.com' })).toHaveLength(2)
	})

	it('keeps the same clearance above the next separator whether a message is open or collapsed', () => {
		const withAttachment = {
			...message('m2'),
			attachments: [{ id: 'a1', filename: 'agenda.pdf', size: 2048, is_inline: false }],
		}
		const { container } = render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), withAttachment]} />,
		)
		const collapsedEnd = container.querySelector('[data-slot="collapsed-message-end"]')
		const openEnd = container.querySelector('[data-slot="expanded-message-content"]')
		const bottomPadding = (element: Element | null) =>
			[...(element?.classList ?? [])].filter((name) => name.startsWith('pb-'))

		// The attachment pills are the last thing in an open message; they must not sit on the line.
		expect(openEnd?.querySelector('[data-slot="thread-attachment"]')).not.toBeNull()
		expect(openEnd).toBe(openEnd?.closest('[data-slot="thread-message"]')?.lastElementChild)
		expect(bottomPadding(openEnd)).toEqual(['pb-4'])
		expect(bottomPadding(collapsedEnd)).toEqual(bottomPadding(openEnd))
	})

	it('names an anonymous message and attributes its attachments without duplicating them', () => {
		const anonymous = {
			...message('m1'),
			from: undefined,
			attachments: [{ id: 'a1', filename: 'anonymous.txt', is_inline: false }],
		}
		const { container } = render(<ThreadConversation thread={thread('t1')} messages={[anonymous]} />)

		expect(screen.getByRole('article', { name: '(unknown sender)' })).toBeInTheDocument()
		expect(screen.getByRole('heading', { level: 2, name: '(unknown sender)' })).toBeInTheDocument()
		expect(
			container.querySelector('[aria-label="anonymous.txt, attached to message from (unknown sender)"]'),
		).toBeInTheDocument()
		expect(container.querySelectorAll('[data-slot="thread-attachment"]')).toHaveLength(1)
	})

	it('remembers a sender color choice and renders their messages in original colors', async () => {
		const rendered = render(
			<ThreadConversation thread={thread('colors')} messages={[htmlMessage('m1'), htmlMessage('m2')]} />,
		)
		const colorModes = () =>
			[...rendered.container.querySelectorAll(EMAIL_ELEMENT_TAG)].map((element) =>
				element.getAttribute('data-color-mode'),
			)
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))
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

describe('message header', () => {
	it('is one compact row: a 28px avatar and a single overflow control', () => {
		const { container } = render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)
		const row = container.querySelector('[data-slot="message-header-row"]') as HTMLElement

		// The height contract (40px fine pointer, 44px touch) lives in styles.css.
		expect(row).toHaveClass('message-header-row', 'items-center')
		expect(container.querySelector('[data-slot="sender-avatar"]')).toHaveClass('h-7', 'w-7')
		// Download and collapse no longer cost the row two 44px buttons: one
		// overflow control holds both, and nothing in the row is a direct link.
		expect(row.querySelectorAll('a')).toHaveLength(0)
		expect(row.querySelectorAll('[data-slot="message-actions"] button')).toHaveLength(1)
		const overflow = screen.getByRole('button', { name: 'Actions for message from sender@example.com' })
		expect(overflow).toHaveClass('size-9', 'max-md:size-11', '[@media(any-pointer:coarse)]:size-11')
		expect(overflow).toHaveAttribute('aria-haspopup', 'menu')
		expect(overflow).toHaveAttribute('aria-expanded', 'false')
	})

	it('keeps the separator clearance outside the row so every header row is the same height', () => {
		const { container } = render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />,
		)
		const headers = container.querySelectorAll('[data-slot="message-header"]')
		// The first message follows the subject directly; later ones are divided by a line.
		expect(headers[0]?.className).not.toMatch(/border-t|pt-/)
		expect(headers[1]).toHaveClass('border-t', 'border-border', 'pt-4')
		for (const header of headers) {
			expect(header.firstElementChild?.className).not.toMatch(/\bp[tby]-|border/)
		}
	})

	it('collapses and re-expands a message through the overflow menu', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)
		const article = screen.getByRole('article', { name: 'sender@example.com' })
		const overflow = screen.getByRole('button', { name: 'Actions for message from sender@example.com' })

		fireEvent.click(overflow)
		expect(overflow).toHaveAttribute('aria-expanded', 'true')
		const menu = screen.getByRole('menu', { name: 'Actions for message from sender@example.com' })
		expect(overflow).toHaveAttribute('aria-controls', menu.id)
		// The menu floats over the message: panel glass, one layer deep.
		expect(menu).toHaveClass('glass-panel')
		expect(menu.parentElement?.closest('.glass-panel')).toBeNull()
		const items = screen.getAllByRole('menuitem')
		expect(items.map((item) => item.textContent)).toEqual(['Collapse message', 'Download raw email'])
		for (const item of items) expect(item).toHaveClass('min-h-11')
		expect(items[0]).toHaveFocus()
		expect(items[0]).toHaveAttribute('aria-expanded', 'true')

		fireEvent.click(items[0] as HTMLElement)
		expect(article).toHaveAttribute('data-state', 'collapsed')
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		expect(overflow).toHaveFocus()

		fireEvent.click(overflow)
		const expand = screen.getByRole('menuitem', { name: 'Expand message' })
		expect(expand).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(expand)
		expect(article).toHaveAttribute('data-state', 'open')
	})

	it('offers the overflow actions on right-click of the header, for that message only', async () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />)
		const [first, second] = screen.getAllByRole('article', { name: 'sender@example.com' }) as HTMLElement[]
		expect(first).toHaveAttribute('data-state', 'collapsed')
		expect(second).toHaveAttribute('data-state', 'open')

		const header = second.querySelector('[data-slot="message-header-row"]') as HTMLElement
		expect(fireEvent.contextMenu(header, { clientX: 10, clientY: 10 })).toBe(false)
		const menu = await screen.findByRole('menu', { name: 'Actions for message from sender@example.com' })
		expect(menu).toHaveAttribute('data-slot', 'context-menu-content')
		const items = screen.getAllByRole('menuitem')
		expect(items.map((item) => item.textContent)).toEqual(['Collapse message', 'Download raw email'])
		expect(items[1]).toHaveAttribute('href', '/messages/m2/download')
		expect(items[1]).toHaveAttribute('download')

		fireEvent.click(items[0] as HTMLElement)
		expect(second).toHaveAttribute('data-state', 'collapsed')
		expect(first).toHaveAttribute('data-state', 'collapsed')
		await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

		fireEvent.contextMenu(header, { clientX: 10, clientY: 10 })
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand message' }))
		expect(second).toHaveAttribute('data-state', 'open')
	})

	it('offers no raw download for a draft that has not been sent', async () => {
		render(<ThreadConversation thread={thread('t1')} messages={[{ ...message('m1'), ownmailDraft: true }]} />)
		fireEvent.contextMenu(document.querySelector('[data-slot="message-header-row"]') as HTMLElement)
		await screen.findByRole('menu')
		expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Collapse message'])
	})

	it('keeps the browser menu on the message body, where links, images and text live', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)
		const body = document.querySelector('[data-slot="expanded-message-content"]') as HTMLElement
		expect(fireEvent.contextMenu(body.firstElementChild ?? body, { clientX: 10, clientY: 10 })).toBe(true)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
	})

	it('opens a collapsed message from its summary line', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2')]} />)
		const article = screen.getAllByRole('article')[0] as HTMLElement
		expect(article).toHaveAttribute('data-state', 'collapsed')

		const summary = screen.getByRole('button', { name: 'Expand message from sender@example.com' })
		expect(summary).toHaveTextContent('Message m1')
		// The hit area stretches over the sender and preview lines.
		expect(summary).toHaveClass('before:absolute', 'before:inset-0')
		expect(summary.parentElement).toHaveClass('relative')
		fireEvent.click(summary)

		expect(article).toHaveAttribute('data-state', 'open')
		expect(screen.queryByRole('button', { name: /Expand message from/ })).not.toBeInTheDocument()
	})

	it('moves through the overflow menu with the keyboard and returns focus on dismissal', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)
		const overflow = screen.getByRole('button', { name: 'Actions for message from sender@example.com' })
		fireEvent.click(overflow)
		const menu = screen.getByRole('menu')
		const [toggle, download] = screen.getAllByRole('menuitem') as [HTMLElement, HTMLElement]

		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(download).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowDown' })
		expect(toggle).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'ArrowUp' })
		expect(download).toHaveFocus()
		fireEvent.keyDown(menu, { key: 'a' })
		expect(download).toHaveFocus()

		// Escape is handled by the menu: it must not reach the reader's "back to list" shortcut.
		const onWindowKeyDown = vi.fn()
		window.addEventListener('keydown', onWindowKeyDown)
		fireEvent.keyDown(menu, { key: 'Escape' })
		window.removeEventListener('keydown', onWindowKeyDown)
		expect(onWindowKeyDown).not.toHaveBeenCalled()
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		expect(overflow).toHaveFocus()
		expect(overflow).not.toHaveAttribute('aria-controls')

		fireEvent.click(overflow)
		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		expect(overflow).toHaveFocus()
	})

	it('closes the overflow menu on an outside press, a second trigger press, and after a download', () => {
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)
		const overflow = screen.getByRole('button', { name: 'Actions for message from sender@example.com' })

		fireEvent.click(overflow)
		fireEvent.pointerDown(screen.getByRole('menu'))
		expect(screen.getByRole('menu')).toBeInTheDocument()
		fireEvent.pointerDown(document.body)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()

		fireEvent.click(overflow)
		fireEvent.click(overflow)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()

		fireEvent.click(overflow)
		const download = screen.getByRole('menuitem', { name: 'Download raw email' })
		expect(download).toHaveAttribute('href', '/messages/m1/download')
		download.addEventListener('click', (event) => event.preventDefault())
		fireEvent.click(download)
		expect(screen.queryByRole('menu')).not.toBeInTheDocument()
	})
})

describe('thread actions placement', () => {
	function toolbarSlot() {
		const slot = document.createElement('div')
		slot.id = THREAD_TOOLBAR_ACTIONS_ID
		document.body.append(slot)
		return slot
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
			vi.fn(() => media),
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
		document.getElementById(THREAD_TOOLBAR_ACTIONS_ID)?.remove()
		vi.unstubAllGlobals()
	})

	const conversation = (
		<ThreadConversation thread={thread('t1')} messages={[htmlMessage('m1'), htmlMessage('m2')]} />
	)

	it('moves the display menu and expand/collapse-all into the pane toolbar on desktop', () => {
		const slot = toolbarSlot()
		const viewport = stubViewport(true)
		const { container } = render(conversation)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement

		expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)')
		// The subject row holds the subject only, so no 44px control sets its height.
		expect(summary.querySelector('button')).toBeNull()
		for (const name of ['Thread display', 'Expand all 2 messages', 'Collapse all 2 messages']) {
			expect(slot).toContainElement(screen.getByRole('button', { name }))
		}

		// The actions keep working from the toolbar: state stays with the conversation.
		fireEvent.click(screen.getByRole('button', { name: 'Expand all 2 messages' }))
		expect(container.querySelectorAll('[data-state="open"]')).toHaveLength(2)
		expect(viewport.listeners.size).toBe(1)
	})

	it('keeps the actions in the subject row on narrow screens, where the toolbar is already full', () => {
		const slot = toolbarSlot()
		const viewport = stubViewport(false)
		const { container, unmount } = render(conversation)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement

		expect(slot).toBeEmptyDOMElement()
		expect(summary).toContainElement(screen.getByRole('button', { name: 'Thread display' }))

		// Crossing the breakpoint moves the same actions, without duplicating them.
		viewport.resize(true)
		expect(screen.getAllByRole('button', { name: 'Thread display' })).toHaveLength(1)
		expect(slot).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		viewport.resize(false)
		expect(summary).toContainElement(screen.getByRole('button', { name: 'Thread display' }))

		unmount()
		expect(viewport.listeners.size).toBe(0)
	})

	it('keeps the actions in the subject row for a pane without a toolbar', () => {
		stubViewport(true)
		const { container } = render(conversation)
		const summary = container.querySelector('[data-slot="thread-summary"]') as HTMLElement

		expect(summary).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
		expect(summary).toContainElement(screen.getByRole('button', { name: 'Expand all 2 messages' }))
	})

	it('uses the toolbar when the environment cannot report the viewport', () => {
		const slot = toolbarSlot()
		vi.stubGlobal('matchMedia', undefined)
		render(conversation)

		expect(slot).toContainElement(screen.getByRole('button', { name: 'Thread display' }))
	})

	it('renders no action row for a single plain-text message', () => {
		toolbarSlot()
		render(<ThreadConversation thread={thread('t1')} messages={[message('m1')]} />)

		expect(document.querySelector('[data-slot="thread-actions"]')).toBeNull()
	})
})
