// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { OutgoingStatus } from './OutgoingStatus.js'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

// Saturday, October 17 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 9, 17, 12) / 1000
const MONDAY_NINE = Date.UTC(2026, 9, 19, 9) / 1000
const sent = { id: 'm1', body: '<p>Hi Mary,</p><p>The 20th works.</p><p>Thanks,<br>Ada</p>' } as MailMessage
const handlers = () => ({
	onEditResend: vi.fn(async (_address: string) => {}),
	onSendNow: vi.fn(),
	onCancelSchedule: vi.fn(),
})

describe('OutgoingStatus', () => {
	it('renders nothing for a message that went out', () => {
		const { container } = render(<OutgoingStatus message={sent} {...handlers()} now={NOW} tz="UTC" />)
		expect(container).toBeEmptyDOMElement()
	})

	it('says a bounced message was not sent and offers Edit and resend and Copy text', async () => {
		const actions = handlers()
		const writeText = vi.fn(async () => {})
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		render(<OutgoingStatus message={sent} bounce={{ address: 'mary@nasa.gov' }} {...actions} />)
		expect(screen.getByRole('note')).toHaveTextContent('Not sent.mary@nasa.gov bounced.')
		await userEvent.click(screen.getByRole('button', { name: 'Edit and resend' }))
		expect(actions.onEditResend).toHaveBeenCalledExactlyOnceWith('mary@nasa.gov')
		expect(screen.getByRole('button', { name: 'Edit and resend' })).not.toBeDisabled()
		await userEvent.click(screen.getByRole('button', { name: 'Copy text' }))
		expect(writeText).toHaveBeenCalledWith('Hi Mary,\n\nThe 20th works.\n\nThanks,\nAda')
		expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
	})

	it('waits while Edit and resend opens the draft, and says when it could not', async () => {
		let reject: (error: Error) => void = () => {}
		const onEditResend = vi.fn(() => new Promise<void>((_, fail) => (reject = fail)))
		render(
			<OutgoingStatus message={sent} bounce={{ address: 'mary@nasa.gov' }} onEditResend={onEditResend} />,
		)
		const button = screen.getByRole('button', { name: 'Edit and resend' })
		await userEvent.click(button)
		expect(button).toBeDisabled()
		expect(button).toHaveAttribute('aria-busy', 'true')
		reject(new Error('offline'))
		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open the message. Try again.')
		expect(button).not.toBeDisabled()
	})

	it('says a copy failed and how to get the text instead', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
			configurable: true,
		})
		render(<OutgoingStatus message={sent} bounce={{ address: '' }} {...handlers()} />)
		expect(screen.getByRole('note')).toHaveTextContent('Not sent.The address bounced.')
		await userEvent.click(screen.getByRole('button', { name: 'Copy text' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t copy. Select the text instead.')
	})

	it('says when a scheduled message sends, with Send now and Cancel', async () => {
		const actions = handlers()
		const scheduled = { ...sent, send_at: MONDAY_NINE } as MailMessage
		render(<OutgoingStatus message={scheduled} {...actions} now={NOW} tz="UTC" />)
		expect(screen.getByRole('note')).toHaveTextContent('Sends Mon 9:00 AM')
		await userEvent.click(screen.getByRole('button', { name: 'Send now' }))
		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(actions.onSendNow).toHaveBeenCalledOnce()
		expect(actions.onCancelSchedule).toHaveBeenCalledOnce()
	})

	it('offers Send now and Cancel only when the caller can act on them', () => {
		const scheduled = { ...sent, send_at: MONDAY_NINE } as MailMessage
		render(<OutgoingStatus message={scheduled} onEditResend={vi.fn(async () => {})} now={NOW} tz="UTC" />)
		expect(screen.getByRole('note')).toHaveTextContent('Sends Mon 9:00 AM')
		expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
	})

	it('leaves the zone-dependent send time out of the server render', () => {
		const scheduled = { ...sent, send_at: MONDAY_NINE } as MailMessage
		const html = renderToString(<OutgoingStatus message={scheduled} {...handlers()} now={NOW} tz="UTC" />)
		expect(html).toContain('Sends')
		expect(html).not.toContain('9:00')
		expect(html).not.toContain('Mon')
	})

	it('separates a bounce from a schedule when a message has both', () => {
		const scheduled = { ...sent, send_at: MONDAY_NINE } as MailMessage
		const { container } = render(
			<OutgoingStatus
				message={scheduled}
				bounce={{ address: 'mary@nasa.gov' }}
				{...handlers()}
				now={NOW}
				tz="UTC"
			/>,
		)
		expect(screen.getAllByRole('note')).toHaveLength(2)
		expect(container.querySelector('.h-px.bg-border')).not.toBeNull()
	})
})
