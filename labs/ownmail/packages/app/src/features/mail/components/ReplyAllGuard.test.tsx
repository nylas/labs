// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REPLY_ALL_GUARD } from '../lib/thread-reading-model.js'
import { ReplyAllGuard } from './ReplyAllGuard.js'

afterEach(cleanup)

describe('ReplyAllGuard', () => {
	it('renders nothing at or below the guard', () => {
		const { container } = render(
			<ReplyAllGuard count={REPLY_ALL_GUARD} replyOnlyFirstName="Alan" onReplyOnly={() => {}} />,
		)
		expect(container).toBeEmptyDOMElement()
	})

	it('says how many people Reply all reaches and offers the smaller reply first', async () => {
		const onReplyOnly = vi.fn()
		render(<ReplyAllGuard count={240} replyOnlyFirstName="Alan" onReplyOnly={onReplyOnly} />)
		const note = screen.getByRole('note')
		expect(note).toHaveTextContent('Reply all will reach 240 people.')
		expect(note).toHaveClass(
			'border-notice-warning-line',
			'bg-notice-warning',
			'text-notice-warning-foreground',
		)
		await userEvent.click(screen.getByRole('button', { name: 'Reply to Alan only' }))
		expect(onReplyOnly).toHaveBeenCalledOnce()
	})

	it('keeps the notice without a smaller reply when the sender has no name', () => {
		render(<ReplyAllGuard count={30} replyOnlyFirstName="" onReplyOnly={() => {}} />)
		expect(screen.getByRole('note')).toHaveTextContent('Reply all will reach 30 people.')
		expect(screen.queryByRole('button')).toBeNull()
	})
})
