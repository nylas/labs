// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries'
import { InlineReplyCard } from './InlineReplyCard'

// The reply-all guard belongs to the body's edge states; its stand-in shows when it asks.
vi.mock('./ReplyAllGuard', () => import('../../../../test/reader-contract-mocks'))

afterEach(cleanup)

const OWNER = 'ada@ownmail.com'

function latest(recipients: number): MailMessage {
	return {
		id: 'm14',
		from: [{ name: 'Mary Jackson', email: 'mary@example.com' }],
		to: [
			{ name: 'Ada Lovelace', email: OWNER },
			...Array.from({ length: recipients }, (_, index) => ({
				name: `Person${index} Example`,
				email: `person${index}@example.com`,
			})),
		],
		body: 'Ada, can you confirm?',
	}
}

describe('InlineReplyCard', () => {
	it('names who Reply all reaches, offers the plain reply, and opens the composer from the field or Send', () => {
		const onReply = vi.fn()
		const onReplyAll = vi.fn()
		const field = createRef<HTMLButtonElement>()
		render(
			<InlineReplyCard
				latest={latest(4)}
				owner={OWNER}
				onReply={onReply}
				onReplyAll={onReplyAll}
				fieldRef={field}
			/>,
		)

		const card = screen.getByRole('region', { name: 'Reply' })
		expect(card).toHaveClass('reader-reply-card')
		expect(card).toHaveTextContent('Reply all to Mary, Person0, Person1 +2')
		expect(screen.getByText('Mary, Person0, Person1')).toHaveClass('font-medium', 'text-foreground')
		expect(screen.getByText('⌘↵')).toHaveAttribute('aria-hidden', 'true')
		expect(field.current).toBe(screen.getByRole('button', { name: 'Write a reply…' }))

		fireEvent.click(screen.getByRole('button', { name: 'Write a reply…' }))
		fireEvent.click(screen.getByRole('button', { name: 'Send' }))
		expect(onReplyAll).toHaveBeenCalledTimes(2)
		fireEvent.click(screen.getByRole('button', { name: 'Reply only to Mary' }))
		expect(onReply).toHaveBeenCalledTimes(1)
		// Five people is no reason to ask.
		expect(screen.queryByRole('note')).toBeNull()
	})

	it('asks once before Reply all reaches more than 25 people, offering the smaller reply first', () => {
		const onReply = vi.fn()
		render(<InlineReplyCard latest={latest(30)} owner={OWNER} onReply={onReply} onReplyAll={vi.fn()} />)
		expect(screen.getByRole('note')).toHaveTextContent('Reply all will reach 31 people.')
		fireEvent.click(screen.getByRole('button', { name: 'Reply to Mary only' }))
		expect(onReply).toHaveBeenCalledTimes(1)
	})

	it('names nobody it cannot address', () => {
		render(
			<InlineReplyCard
				latest={{ id: 'm1', from: [], to: [{ email: OWNER }] }}
				owner={OWNER}
				onReply={vi.fn()}
				onReplyAll={vi.fn()}
			/>,
		)
		expect(screen.getByRole('region', { name: 'Reply' })).toHaveTextContent(/^Reply all to Write a reply…/)
		expect(screen.queryByRole('button', { name: /Reply only to/ })).toBeNull()
	})
})
