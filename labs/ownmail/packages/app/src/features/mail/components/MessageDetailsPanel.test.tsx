// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'
import { MessageDetailsPanel } from './MessageDetailsPanel.js'

const { getMessageRawHeaders } = vi.hoisted(() => ({ getMessageRawHeaders: vi.fn() }))
vi.mock('../server/mail-functions.js', () => ({ getMessageRawHeaders }))

const OWNER = 'ada@ownmail.com'
/** Wednesday 14 October 2026, 4:12 PM in Berlin (2:12 PM UTC). */
const WED = Date.UTC(2026, 9, 14, 14, 12) / 1000

const alan: MailMessage = {
	id: 'msg-12',
	from: [{ name: 'Alan Turing', email: 'alan@bletchley.dev' }],
	to: [
		{ name: 'Ada Lovelace', email: 'ada@ownmail.com' },
		{ name: 'Grace Hopper', email: 'grace@vercel.com' },
	],
	cc: [{ name: 'Katherine Johnson', email: 'katherine@vercel.com' }, { email: 'pm-leads@vercel.com' }],
	date: WED,
} as MailMessage

const facts = (extra: Partial<MessageHeaderFacts> = {}): MessageHeaderFacts => ({
	verified: true,
	authFailed: false,
	listUnsubscribe: false,
	dateOffsetMinutes: -420,
	...extra,
})

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderPanel(
	message: MailMessage = alan,
	headerFacts: MessageHeaderFacts | null = facts(),
	listSizes?: Record<string, number>,
) {
	return render(
		<MessageDetailsPanel
			id="details"
			message={message}
			owner={OWNER}
			facts={headerFacts ?? undefined}
			viewerTz="Europe/Berlin"
			listSizes={listSizes}
		/>,
		{ wrapper },
	)
}

const panel = () => screen.getByRole('region', { name: 'Message details' })
const row = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement

beforeEach(() => {
	getMessageRawHeaders.mockReset()
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe('MessageDetailsPanel', () => {
	it('shows the sender, verification, recipients as people and both clocks', () => {
		renderPanel()
		expect(panel()).toHaveAttribute('id', 'details')
		expect(row('From')).toHaveTextContent('Alan Turing alan@bletchley.dev')
		expect(within(row('From')).getByText('Verified sender')).toBeInTheDocument()
		expect(
			within(row('To'))
				.getAllByRole('listitem')
				.map((item) => item.textContent),
		).toEqual(['ALYou', 'GHGrace Hoppergrace@vercel.com'])
		expect(
			within(row('Cc'))
				.getAllByRole('listitem')
				.map((item) => item.textContent),
		).toEqual(['KJKatherine Johnsonkatherine@vercel.com', 'PMpm-leads@vercel.com'])
		expect(screen.queryByText('Bcc', { selector: 'dt' })).toBeNull()
		expect(row('Date')).toHaveTextContent('Wed, Oct 14, 2026, 4:12 PM7:12 AM where Alan is (PDT)')
	})

	it('shows a list by its local part and member count when the count is known', () => {
		renderPanel(alan, facts(), { 'pm-leads@vercel.com': 12 })
		const [, list] = within(row('Cc')).getAllByRole('listitem')
		expect(list).toHaveAttribute('data-list', 'true')
		expect(list).toHaveTextContent(/^PMpm-leads@ · 12 memberspm-leads@vercel\.com$/)
		expect(within(list as HTMLElement).getByText('12')).toHaveClass('font-data', 'tabular-nums')
	})

	it('shows a List-Id list by its local part, without a count it does not know', () => {
		renderPanel({ ...alan, cc: [{ email: 'design@vercel.com' }] }, facts({ listId: 'design.vercel.com' }), {
			'design@vercel.com': 1,
		})
		expect(row('Cc')).toHaveTextContent(/^DEdesign@ · 1 memberdesign@vercel\.com$/)
		cleanup()
		renderPanel({ ...alan, cc: [{ email: 'design@vercel.com' }] }, facts({ listId: 'design.vercel.com' }))
		expect(row('Cc')).toHaveTextContent(/^DEdesign@design@vercel\.com$/)
	})

	it('leaves out what it does not know', () => {
		const bare = {
			id: 'm',
			from: [{ email: 'alan@bletchley.dev' }],
			bcc: [{ email: 'x@y.dev' }],
		} as MailMessage
		renderPanel(bare, null)
		expect(row('From')).toHaveTextContent('alan@bletchley.dev')
		expect(screen.queryByText('Verified sender')).toBeNull()
		expect(screen.queryByText('To', { selector: 'dt' })).toBeNull()
		expect(row('Bcc')).toHaveTextContent('x@y.dev')
		expect(screen.queryByText('Date', { selector: 'dt' })).toBeNull()
	})

	it('names the owner as the sender "You" and skips the sender’s clock when it matches', () => {
		renderPanel(
			{ ...alan, from: [{ name: 'Ada Lovelace', email: OWNER }] },
			facts({ verified: false, dateOffsetMinutes: 120 }),
		)
		expect(row('From')).toHaveTextContent('You ada@ownmail.com')
		expect(row('Date')).toHaveTextContent(/^Wed, Oct 14, 2026, 4:12 PM$/)
	})

	it('folds a long recipient line into a count that shows everyone', () => {
		const cc = Array.from({ length: 12 }, (_, index) => ({ email: `p${index}@vercel.com` }))
		renderPanel({ ...alan, cc })
		expect(within(row('Cc')).getAllByRole('listitem')).toHaveLength(8)
		fireEvent.click(screen.getByRole('button', { name: '+5 more' }))
		expect(within(row('Cc')).getAllByRole('listitem')).toHaveLength(12)
		expect(screen.queryByRole('button', { name: /more$/ })).toBeNull()
	})

	it('copies every address but the owner’s and says so for a moment', async () => {
		vi.useFakeTimers()
		const writeText = vi.fn(async () => {})
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		renderPanel()
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Copy addresses' }))
		})
		expect(writeText).toHaveBeenCalledWith(
			'Alan Turing <alan@bletchley.dev>, Grace Hopper <grace@vercel.com>, Katherine Johnson <katherine@vercel.com>, pm-leads@vercel.com',
		)
		expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
		act(() => vi.advanceTimersByTime(2000))
		expect(screen.getByRole('button', { name: 'Copy addresses' })).toBeInTheDocument()
	})

	it('stays as it was when the clipboard refuses, and cannot copy nothing', async () => {
		const writeText = vi.fn(async () => {
			throw new Error('denied')
		})
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
		const { unmount } = renderPanel()
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Copy addresses' }))
		})
		expect(screen.getByRole('button', { name: 'Copy addresses' })).toBeInTheDocument()
		unmount()
		renderPanel({ id: 'm', from: [{ email: OWNER }] } as MailMessage)
		expect(screen.getByRole('button', { name: 'Copy addresses' })).toBeDisabled()
	})

	it('shows the raw headers as plain text in a dialog', async () => {
		getMessageRawHeaders.mockResolvedValue({
			text: 'From: Alan Turing <alan@bletchley.dev>\r\nSubject: <b>hi</b>',
		})
		renderPanel()
		fireEvent.click(screen.getByRole('button', { name: 'Show raw headers' }))
		const dialog = await screen.findByRole('dialog', { name: 'Raw headers' })
		expect(dialog).toHaveClass('glass-panel')
		expect(within(dialog).getByText('Loading headers…')).toBeInTheDocument()
		const text = await within(dialog).findByText(/Subject: <b>hi<\/b>/)
		expect(text.tagName).toBe('PRE')
		expect(getMessageRawHeaders).toHaveBeenCalledWith({ data: { messageId: 'msg-12' } })
		fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('says when the raw headers cannot be read, and offers none for a draft', async () => {
		getMessageRawHeaders.mockRejectedValue(new Error('nope'))
		const { unmount } = renderPanel()
		fireEvent.click(screen.getByRole('button', { name: 'Show raw headers' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the raw headers.')
		fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
		expect(screen.queryByRole('dialog')).toBeNull()
		unmount()
		renderPanel({ ...alan, ownmailDraft: true })
		expect(screen.queryByRole('button', { name: 'Show raw headers' })).toBeNull()
	})
})
