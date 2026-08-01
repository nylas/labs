// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MailMessage, MailThread } from '../state/mail-queries'
import { ThreadConversation } from './ThreadConversation'

afterEach(cleanup)

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

		expect(expand).toHaveTextContent('Expand all')
		expect(expand).toHaveClass('min-h-11', 'focus-visible:ring-[3px]', 'focus-visible:ring-ring/40')
		expect(collapse).toHaveTextContent('Collapse all')
		expect(collapse).toHaveClass('min-h-11', 'focus-visible:ring-[3px]', 'focus-visible:ring-ring/40')

		fireEvent.click(expand)
		expect(expand).toBeDisabled()
		expect(screen.getAllByRole('button', { name: /Collapse message from/ })).toHaveLength(3)

		fireEvent.click(collapse)
		expect(collapse).toBeDisabled()
		expect(screen.getAllByRole('button', { name: /Expand message from/ })).toHaveLength(3)
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

		expect(links).toHaveLength(2)
		for (const link of links) {
			expect(link).toHaveClass(
				'min-h-11',
				'focus-visible:outline-none',
				'focus-visible:ring-[3px]',
				'focus-visible:ring-ring',
			)
			expect(link).toHaveAttribute('href', '/attachments/attachment-1?message_id=m1')
			expect(link).toHaveAttribute('download', 'project-plan.pdf')
			expect(link).toHaveTextContent('project-plan.pdf')
			expect(link).toHaveTextContent('2 KB')
		}
	})
})
