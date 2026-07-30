// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, expect, it } from 'vitest'
import type { MailMessage, MailThread } from '../state/mail-queries'
import { ThreadConversation } from './ThreadConversation'

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
})
