// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { longDateLabel } from '../lib/message-anatomy.js'
import type { MailMessage } from '../state/mail-queries.js'
import { MessageHeader } from './MessageHeader.js'

const OWNER = 'ada@ownmail.com'
const ADA = { name: 'Ada Lovelace', email: OWNER }
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@vercel.com' }
const NOW = Math.floor(Date.now() / 1000)

const alan: MailMessage = {
	id: 'msg-12',
	from: [ALAN],
	to: [ADA, GRACE],
	cc: [KATHERINE, { email: 'pm-leads@vercel.com' }],
	date: NOW - 3600,
} as MailMessage

function setup(props: Partial<Parameters<typeof MessageHeader>[0]> = {}) {
	const actions = { onReply: vi.fn(), onForward: vi.fn(), onQuote: vi.fn() }
	const onToggle = vi.fn()
	const client = new QueryClient()
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
	const view = render(
		<MessageHeader message={alan} owner={OWNER} expanded onToggle={onToggle} actions={actions} {...props} />,
		{ wrapper },
	)
	return { ...view, actions, onToggle }
}

const summary = () => screen.getByRole('button', { name: /^to / })
const details = () => screen.queryByRole('region', { name: 'Message details' })
const row = (container: HTMLElement) =>
	container.querySelector('[data-slot="message-header-row"]') as HTMLElement

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	for (const node of document.querySelectorAll('[data-test-dialog]')) node.remove()
})

describe('MessageHeader', () => {
	it('is one line: avatar, name, recipient summary, actions and time', () => {
		const { container } = setup({ headingId: 'sender-12' })
		expect(container.querySelector('[data-slot="message-header"]')).toHaveAttribute('data-state', 'open')
		expect(container.querySelector('[data-slot="avatar"]')).toHaveTextContent('AT')
		const heading = screen.getByRole('heading', { level: 2 })
		expect(heading).toHaveAttribute('id', 'sender-12')
		expect(within(heading).getByRole('button', { name: 'Alan Turing' })).toHaveAttribute(
			'aria-expanded',
			'false',
		)
		expect(summary()).toHaveTextContent('to you, Grace +2')
		expect(summary()).not.toHaveAttribute('data-changed')
		expect(summary()).not.toHaveClass('text-foreground')
		const time = container.querySelector('time') as HTMLElement
		expect(time.textContent).toMatch(/^\d{1,2}:\d{2} [AP]M$/)
		expect(time).toHaveAttribute('dateTime', new Date((NOW - 3600) * 1000).toISOString())
		expect(time.getAttribute('title')).toMatch(/\d{4}/)
		expect(screen.getByRole('group', { name: 'Message actions' })).toBeInTheDocument()
	})

	it('sets the summary in the normal colour when the recipients changed', () => {
		const prev = { id: 'm11', from: [KATHERINE], to: [ALAN, GRACE, ADA] } as MailMessage
		setup({ message: { ...alan, cc: [] }, prev })
		expect(summary()).toHaveAttribute('data-changed', 'true')
		expect(summary()).toHaveClass('text-foreground')
	})

	it('runs Reply, Forward and Quote without dropping the text selection', () => {
		const { actions } = setup()
		const reply = screen.getByRole('button', { name: 'Reply to Alan' })
		expect(fireEvent.mouseDown(reply)).toBe(false)
		fireEvent.click(reply)
		fireEvent.click(screen.getByRole('button', { name: 'Forward this message' }))
		fireEvent.click(screen.getByRole('button', { name: 'Quote selection in reply' }))
		expect(actions.onReply).toHaveBeenCalledOnce()
		expect(actions.onForward).toHaveBeenCalledOnce()
		expect(actions.onQuote).toHaveBeenCalledOnce()
	})

	it('opens and closes the details from the recipient summary', () => {
		setup({ facts: { verified: true, authFailed: false, listUnsubscribe: false } })
		expect(summary()).toHaveAttribute('aria-expanded', 'false')
		expect(summary()).not.toHaveAttribute('aria-controls')
		fireEvent.click(summary())
		expect(summary()).toHaveAttribute('aria-expanded', 'true')
		expect(summary()).toHaveAttribute('aria-controls', details()?.id)
		expect(details()).toHaveTextContent('Verified sender')
		expect(summary()).toHaveTextContent('Hide message details')
		fireEvent.click(summary())
		expect(details()).toBeNull()
	})

	it('closes the details on a press or focus elsewhere, but not for a press that starts inside', () => {
		vi.useFakeTimers()
		const outside = document.createElement('button')
		document.body.append(outside)
		setup()
		fireEvent.click(summary())
		const panel = details() as HTMLElement
		fireEvent.pointerDown(panel)
		fireEvent.focusIn(outside)
		expect(details()).not.toBeNull()
		fireEvent.pointerUp(panel)
		vi.runAllTimers()
		fireEvent.focusIn(panel)
		expect(details()).not.toBeNull()
		fireEvent.focusIn(outside)
		expect(details()).toBeNull()
		fireEvent.click(summary())
		fireEvent.pointerDown(outside)
		expect(details()).toBeNull()
		outside.remove()
		vi.useRealTimers()
	})

	it('treats the raw-headers dialog as part of the details', () => {
		setup()
		fireEvent.click(summary())
		const dialog = document.createElement('div')
		dialog.dataset.slot = 'dialog-content'
		dialog.setAttribute('data-test-dialog', '')
		document.body.append(dialog)
		fireEvent.pointerDown(dialog)
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(details()).not.toBeNull()
		dialog.remove()
		fireEvent.keyDown(document, { key: 'Enter' })
		expect(details()).not.toBeNull()
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(details()).toBeNull()
		expect(summary()).toHaveFocus()
	})

	it('collapses from a click on its own space, not on a control or over a selection', () => {
		const { container, onToggle } = setup()
		fireEvent.click(summary())
		fireEvent.click(summary())
		const selection = vi.spyOn(window, 'getSelection')
		selection.mockReturnValueOnce({ toString: () => 'went through v3' } as Selection)
		fireEvent.click(row(container))
		expect(onToggle).not.toHaveBeenCalled()
		selection.mockReturnValueOnce(null)
		fireEvent.click(row(container))
		expect(onToggle).toHaveBeenCalledOnce()
	})

	it('is one button that opens a collapsed message', () => {
		const { container, onToggle } = setup({ expanded: false })
		expect(container.querySelector('[data-slot="message-header"]')).toHaveAttribute('data-state', 'collapsed')
		expect(screen.queryByRole('group', { name: 'Message actions' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Alan Turing' })).toBeNull()
		expect(screen.getByText('to you, Grace +2').tagName).toBe('SPAN')
		fireEvent.click(row(container))
		expect(onToggle).not.toHaveBeenCalled()
		const expand = screen.getByRole('button', { name: 'Expand message from Alan Turing' })
		expect(expand).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(expand)
		expect(onToggle).toHaveBeenCalledOnce()
	})

	it('names the owner "You" without a contact card, and shows no time without a date', () => {
		const { container } = setup({ message: { ...alan, from: [ADA], date: undefined } as MailMessage })
		expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('You')
		expect(screen.queryByRole('button', { name: 'You' })).toBeNull()
		expect(container.querySelector('time')).toBeNull()
	})

	it('mirrors its actions in the right-click menu, with the raw download', async () => {
		const { container, actions, onToggle } = setup()
		fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 })
		const menu = await screen.findByRole('menu', { name: 'Actions for message from Alan Turing' })
		expect(within(menu).getByRole('menuitem', { name: 'Download raw email' })).toHaveAttribute(
			'href',
			'/messages/msg-12/download',
		)
		fireEvent.click(within(menu).getByRole('menuitem', { name: 'Collapse message' }))
		expect(onToggle).toHaveBeenCalledOnce()
		fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 })
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Reply' }))
		fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 })
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Forward' }))
		expect(actions.onReply).toHaveBeenCalledOnce()
		expect(actions.onForward).toHaveBeenCalledOnce()
	})

	it('offers no raw download for a draft and says Expand when collapsed', async () => {
		const { container } = setup({ message: { ...alan, ownmailDraft: true }, expanded: false })
		fireEvent.contextMenu(row(container), { clientX: 20, clientY: 20 })
		const menu = await screen.findByRole('menu')
		expect(within(menu).getByRole('menuitem', { name: 'Expand message' })).toBeInTheDocument()
		expect(within(menu).queryByRole('menuitem', { name: 'Download raw email' })).toBeNull()
	})

	it('lets Tab move from the recipient summary into the details', async () => {
		const user = userEvent.setup()
		setup()
		await user.click(summary())
		expect(details()).not.toBeNull()
		await user.tab()
		expect(screen.getByRole('button', { name: 'Copy addresses' })).toHaveFocus()
		expect(details()).not.toBeNull()
		await user.tab()
		expect(screen.getByRole('button', { name: 'Show raw headers' })).toHaveFocus()
		await user.tab()
		expect(screen.getByRole('button', { name: 'Reply to Alan' })).toHaveFocus()
		expect(details()).toBeNull()
	})

	it('keeps clicks and right-clicks in the details to the details', () => {
		const { container, onToggle } = setup()
		fireEvent.click(summary())
		const panel = details() as HTMLElement
		fireEvent.click(panel)
		expect(onToggle).not.toHaveBeenCalled()
		expect(details()).not.toBeNull()
		fireEvent.contextMenu(panel, { clientX: 20, clientY: 20 })
		expect(screen.queryByRole('menu')).toBeNull()
		expect(container.querySelector('[data-slot="message-details-popover"]')).toContainElement(panel)
	})

	it('shows list sizes in the details', () => {
		setup({ listSizes: { 'pm-leads@vercel.com': 12 } })
		fireEvent.click(summary())
		expect(details()).toHaveTextContent('pm-leads@ · 12 members')
	})

	it('has a keyboard collapse control tied to the message body', async () => {
		const user = userEvent.setup()
		const { onToggle } = setup({ contentId: 'body-12' })
		const collapse = screen.getByRole('button', { name: 'Collapse message' })
		expect(collapse).toHaveAttribute('aria-expanded', 'true')
		expect(collapse).toHaveAttribute('aria-controls', 'body-12')
		expect(collapse).toHaveClass('sr-only', 'focus-visible:not-sr-only')
		collapse.focus()
		await user.keyboard('{Enter}')
		expect(onToggle).toHaveBeenCalledOnce()
		cleanup()
		setup({ expanded: false })
		expect(screen.queryByRole('button', { name: 'Collapse message' })).toBeNull()
	})

	it('keeps the heading to the sender’s name while the card is open', () => {
		setup({ headingId: 'sender-12' })
		fireEvent.click(screen.getByRole('button', { name: 'Alan Turing' }))
		const heading = screen.getByRole('heading', { level: 2, name: 'Alan Turing' })
		expect(heading).toHaveTextContent(/^Alan Turing$/)
		const card = document.querySelector('[data-slot="sender-contact-card"]') as HTMLElement
		expect(card).not.toBeNull()
		expect(heading).not.toContainElement(card)
		expect(screen.getByRole('button', { name: 'Save to contacts' })).toBeInTheDocument()
	})

	it('offers no save from the card for a sender who failed checks or is flagged as a lookalike', () => {
		setup({ facts: { verified: false, authFailed: true, listUnsubscribe: false } })
		fireEvent.click(screen.getByRole('button', { name: 'Alan Turing' }))
		expect(screen.queryByRole('button', { name: 'Save to contacts' })).toBeNull()
		cleanup()
		setup({ senderFlagged: true })
		fireEvent.click(screen.getByRole('button', { name: 'Alan Turing' }))
		expect(screen.queryByRole('button', { name: 'Save to contacts' })).toBeNull()
	})

	it('falls back to UTC when the runtime has no time zone', () => {
		vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			timeZone: '',
		} as Intl.ResolvedDateTimeFormatOptions)
		const { container } = setup()
		expect(container.querySelector('time')).toHaveAttribute('title', longDateLabel(NOW - 3600, 'UTC'))
	})

	it('renders no time on the server, so hydration never shows a guess', () => {
		const html = renderToString(
			<MessageHeader
				message={alan}
				owner={OWNER}
				expanded
				onToggle={() => {}}
				actions={{ onReply() {}, onForward() {}, onQuote() {} }}
			/>,
		)
		expect(html).toContain('<time')
		expect(html).not.toMatch(/<time[^>]*title=/)
		expect(html).toContain(' </time>')
	})
})
