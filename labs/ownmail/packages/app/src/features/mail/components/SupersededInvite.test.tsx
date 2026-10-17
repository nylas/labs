// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { invitationTitle, SupersededInviteNote } from './SupersededInvite.js'

afterEach(cleanup)

describe('SupersededInviteNote', () => {
	it('folds a replaced invitation into one line that leads to the newest', async () => {
		const onShowLatest = vi.fn()
		render(
			<SupersededInviteNote
				message={{ id: 'v1', subject: 'Updated invitation: Design review: token migration' } as MailMessage}
				onShowLatest={onShowLatest}
			/>,
		)
		expect(screen.getByRole('note')).toHaveTextContent('Earlier version of “Design review: token migration”')
		// Spaced from the message text below as the notices are.
		expect(screen.getByRole('note')).toHaveClass('superseded-invite')
		await userEvent.click(screen.getByRole('button', { name: 'Show latest' }))
		expect(onShowLatest).toHaveBeenCalledOnce()
	})

	it('says "this invitation" when there is no title', () => {
		render(<SupersededInviteNote message={{ id: 'v1' } as MailMessage} onShowLatest={() => {}} />)
		expect(screen.getByRole('note')).toHaveTextContent('Earlier version of this invitation')
	})
})

describe('invitationTitle', () => {
	it('drops reply prefixes and calendar labels', () => {
		expect(invitationTitle('Re: Fwd: Invitation: Design review')).toBe('Design review')
		expect(invitationTitle('Event updated: Standup')).toBe('Standup')
		expect(invitationTitle('New event: Standup')).toBe('Standup')
		expect(invitationTitle('Design review')).toBe('Design review')
		expect(invitationTitle(undefined)).toBe('')
	})
})
