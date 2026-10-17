// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { EmptyBody } from './EmptyBody.js'

afterEach(cleanup)

const GRACE = { name: 'Grace Hopper', email: 'grace@x.com' }

describe('EmptyBody', () => {
	it('says the body is empty and points to what was sent', () => {
		render(
			<EmptyBody
				owner="ada@ownmail.com"
				message={
					{
						id: 'm1',
						body: '',
						snippet: '',
						from: [GRACE],
						attachments: [
							{ id: 'a1', filename: 'contract-signed.pdf', content_type: 'application/pdf', size: 236_000 },
						],
					} as MailMessage
				}
			/>,
		)
		const note = screen.getByText('No message text. Grace sent 1 file.')
		expect(note).toHaveAttribute('data-slot', 'empty-body')
		expect(note).toHaveClass('italic', 'text-muted-foreground')
	})

	it('renders nothing when the message has text', () => {
		const { container } = render(
			<EmptyBody
				owner="ada@ownmail.com"
				message={{ id: 'm2', body: '<p>Hello</p>', from: [GRACE] } as MailMessage}
			/>,
		)
		expect(container).toBeEmptyDOMElement()
	})
})
