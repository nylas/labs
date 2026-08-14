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
		expect(expand).toHaveClass(
			'h-11',
			'w-11',
			'xl:w-auto',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring',
			'forced-colors:focus-visible:outline-2',
			'forced-colors:focus-visible:outline-offset-2',
			'forced-colors:focus-visible:outline-solid',
		)
		expect(collapse).toHaveTextContent('Collapse all')
		expect(collapse).toHaveClass(
			'h-11',
			'w-11',
			'xl:w-auto',
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

		expect(summary).toHaveClass('px-4', 'py-3', 'xl:sticky', 'xl:top-0', 'xl:py-5')
		expect(summary).not.toHaveClass('sticky', 'top-0')
		expect(attachmentSummary).toHaveTextContent('1 thread attachment')
		expect(attachmentSummary).toHaveClass('min-h-11', 'max-w-full')
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
			expect(surface).toHaveClass('rounded-xl', 'border', 'bg-background', 'shadow-xs')
		}
		expect(messageSurfaces[0]?.parentElement).toHaveClass('space-y-3')
		expect(screen.getAllByRole('heading', { level: 2, name: 'sender@example.com' })).toHaveLength(2)
		expect(screen.getAllByRole('article', { name: 'sender@example.com' })).toHaveLength(2)
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
})
