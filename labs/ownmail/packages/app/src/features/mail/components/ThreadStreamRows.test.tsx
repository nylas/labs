// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { MissingMessagesRow, NewSinceDivider, OneLineMessageRow } from './ThreadStreamRows.js'

afterEach(cleanup)

const GRACE = { name: 'Grace Hopper', email: 'grace@example.com' }

describe('NewSinceDivider', () => {
	it('is a separator named for its count and where you left off, or for its count until the day is known', () => {
		const { rerender } = render(<NewSinceDivider label="3 new since Tuesday" count={3} since="Tuesday" />)
		const divider = screen.getByRole('separator', { name: '3 new since you last read, Tuesday' })
		expect(divider.closest('[data-slot="new-since-divider"]')).toHaveTextContent('3 new since Tuesday')
		rerender(<NewSinceDivider label="3 new" count={3} since={null} />)
		expect(screen.getByRole('separator', { name: '3 new' })).toBeInTheDocument()
	})
})

describe('OneLineMessageRow', () => {
	it('says a message shown from Trash is in Trash', () => {
		const onOpen = vi.fn()
		const message: MailMessage = {
			id: 'm1',
			from: [GRACE],
			body: 'Old draft of the plan.',
			folders: ['trash'],
		}
		render(<OneLineMessageRow message={message} owner="ada@ownmail.com" date="Oct 2" onOpen={onOpen} />)
		const row = screen.getByRole('button')
		expect(row).toHaveTextContent('In Trash')
		// The dot is spaced by the row's gap and its own margin: a flex item would drop literal spaces.
		expect(row.querySelector('.reader-in-trash-separator')?.textContent).toBe('·')
		fireEvent.click(row)
		expect(onOpen).toHaveBeenCalledWith('m1')
	})

	it('says nothing about Trash for a message elsewhere', () => {
		const message: MailMessage = { id: 'm2', from: [GRACE], body: 'The plan.', folders: ['inbox'] }
		render(<OneLineMessageRow message={message} owner="ada@ownmail.com" date="Oct 2" onOpen={() => {}} />)
		expect(screen.getByRole('button')).not.toHaveTextContent('In Trash')
	})
})

describe('MissingMessagesRow', () => {
	it('counts what could not load there and tries again', () => {
		const onRetry = vi.fn()
		render(<MissingMessagesRow count={2} onRetry={onRetry} />)
		expect(screen.getByRole('note')).toHaveTextContent('Couldn’t load 2 messages here.')
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
		expect(onRetry).toHaveBeenCalledOnce()
	})
})
