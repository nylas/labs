// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_ELEMENT_TAG, EMAIL_LAYOUT_STATUS_EVENT } from '../lib/email-render'
import type { MailMessage, MailThread } from '../state/mail-queries'
import { ThreadConversation } from './ThreadConversation'

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
})

beforeEach(() => {
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
			document.querySelector('[data-slot="message-toggle"]')?.getAttribute('aria-expanded') ?? null,
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

		expect(layoutStates).toEqual(['true', 'true'])
	})

	it('keeps the mobile timestamp on a dedicated one-line row', () => {
		const datedMessage = { ...message('m1'), date: 1_700_000_000 }
		const { container } = render(<ThreadConversation thread={thread('t1')} messages={[datedMessage]} />)
		const timestamps = container.querySelectorAll('time')

		expect(timestamps).toHaveLength(2)
		expect(timestamps[0]).toHaveClass('hidden', 'sm:inline-block', 'order-3')
		expect(timestamps[1]).toHaveClass('basis-full', 'whitespace-nowrap', 'pl-12', 'sm:hidden')
	})

	it('makes multi-message display controls descriptive, touch-friendly, and stateful', () => {
		render(
			<ThreadConversation thread={thread('t1')} messages={[message('m1'), message('m2'), message('m3')]} />,
		)
		const expand = screen.getByRole('button', { name: 'Expand all 3 messages' })
		const collapse = screen.getByRole('button', { name: 'Collapse all 3 messages' })

		expect(expand).toHaveTextContent('')
		expect(expand).toHaveAttribute('title', 'Expand all messages')
		expect(expand).toHaveClass(
			'h-11',
			'w-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'forced-colors:focus-visible:outline-2',
			'forced-colors:focus-visible:outline-offset-2',
			'forced-colors:focus-visible:outline-solid',
		)
		expect(collapse).toHaveTextContent('')
		expect(collapse).toHaveAttribute('title', 'Collapse all messages')
		expect(collapse).toHaveClass(
			'h-11',
			'w-11',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'forced-colors:focus-visible:outline-2',
			'forced-colors:focus-visible:outline-offset-2',
			'forced-colors:focus-visible:outline-solid',
		)

		fireEvent.click(expand)
		expect(expand).toBeDisabled()
		expect(screen.getAllByRole('button', { name: /Collapse message from/ })).toHaveLength(3)

		fireEvent.click(collapse)
		expect(collapse).toBeDisabled()
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
		expect(trigger).toHaveClass('h-11', 'w-11', 'focus-visible:ring-[3px]')
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

		await waitFor(() => expect(trustSenderImagesMock).toHaveBeenCalledWith('sender@example.com'))
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

		expect(summary).toHaveClass('py-3', 'xl:sticky', 'xl:top-0', 'xl:py-5')
		expect(summary).not.toHaveClass('sticky', 'top-0')
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
		expect(messageSurfaces[0]?.parentElement).toHaveAttribute('data-slot', 'thread-messages')
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

		await waitFor(() => expect(setSenderOriginalColorsMock).toHaveBeenCalledWith('sender@example.com', true))
		await waitFor(() => expect(colorModes()).toEqual(['original', 'original']))
		expect(toggle).toHaveAttribute('aria-pressed', 'true')

		fireEvent.click(toggle)
		await waitFor(() => expect(setSenderOriginalColorsMock).toHaveBeenCalledWith('sender@example.com', false))
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

	it('ignores remembered color choices that arrive after the thread closes', async () => {
		let resolveSenders: (senders: string[]) => void = () => {}
		originalColorSendersMock.mockReturnValue(new Promise<string[]>((resolve) => (resolveSenders = resolve)))
		const rendered = render(<ThreadConversation thread={thread('closing')} messages={[htmlMessage('m1')]} />)
		rendered.unmount()
		await act(async () => resolveSenders(['sender@example.com']))
		expect(originalColorSendersMock).toHaveBeenCalledOnce()
	})
})
