// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markdownToDraftBody } from '../lib/html-to-markdown.js'
import type { MailMessage } from '../state/mail-queries.js'
import { DraftInThread, draftAnchorId } from './DraftInThread.js'

afterEach(cleanup)

const NOW = Date.UTC(2026, 9, 17, 12) / 1000

describe('DraftInThread', () => {
	it('labels the draft with glyph and word, who it answers and when it was edited', async () => {
		const onResume = vi.fn()
		const onDiscard = vi.fn()
		render(
			<DraftInThread
				draft={
					{
						id: 'draft-1',
						date: NOW - 2 * 3600,
						body: '<p>Legal said the 20th is fine as long as the terms page ships the same week.</p>',
					} as MailMessage
				}
				replyToFirstName="Mary"
				onResume={onResume}
				onDiscard={onDiscard}
				now={NOW}
				tz="UTC"
			/>,
		)
		const section = screen.getByRole('region', { name: 'Your draft reply to Mary' })
		expect(section).toHaveAttribute('id', draftAnchorId('draft-1'))
		expect(screen.getByText('Draft')).toHaveClass('bg-danger-soft', 'text-danger-soft-foreground')
		expect(screen.getByText('reply to Mary · edited 2 h ago')).toBeInTheDocument()
		expect(screen.getByText(/Legal said the 20th is fine/)).toHaveClass('truncate')
		await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
		await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
		expect(onResume).toHaveBeenCalledOnce()
		expect(onDiscard).toHaveBeenCalledOnce()
	})

	it('shows an OwnMail draft’s words without Markdown marks, and leaves out what it does not know', () => {
		render(
			<DraftInThread
				draft={
					{
						id: 'draft-2',
						ownmailDraft: true,
						body: markdownToDraftBody('# **Ready** to send'),
					} as MailMessage
				}
				onResume={() => {}}
				onDiscard={() => {}}
			/>,
		)
		expect(screen.getByRole('region', { name: 'Your draft' })).toBeInTheDocument()
		expect(screen.getByText('Ready to send')).toBeInTheDocument()
		expect(screen.queryByText(/edited/)).toBeNull()
	})

	it('shows only the edit time when the reply has no addressee, and no preview without text', () => {
		render(
			<DraftInThread
				draft={{ id: 'draft-3', date: NOW - 30, body: '' } as MailMessage}
				onResume={() => {}}
				onDiscard={() => {}}
				now={NOW}
				tz="UTC"
			/>,
		)
		expect(screen.getByText('edited just now')).toBeInTheDocument()
		expect(screen.getByRole('region').querySelector('p')).toBeNull()
	})

	it('builds the anchor id the reader scrolls to', () => {
		expect(draftAnchorId('abc')).toBe('draft-abc')
	})
})
