// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'
import { SenderContactCard } from './SenderContactCard.js'

const { mutate, mutation, openCompose } = vi.hoisted(() => {
	const mutate = vi.fn()
	return {
		mutate,
		mutation: { mutate, isPending: false, isSuccess: false, isError: false },
		openCompose: vi.fn(async () => {}),
	}
})

vi.mock('#features/contacts/state/contacts-state', () => ({ useCreateContactMutation: () => mutation }))
vi.mock('./ComposeProvider.js', () => ({ useCompose: () => ({ openCompose }) }))

const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const signed: MailMessage = {
	id: 'm12',
	from: [ALAN],
	to: [{ email: 'ada@ownmail.com' }],
	body: '<div><p>Otherwise this is ready.</p><div class="gmail_signature">Alan Turing<br>Principal Engineer, Bletchley<br>alan@bletchley.dev<br>+44 20 7946 0958</div></div>',
} as MailMessage

function renderCard(message: MailMessage = signed) {
	return render(
		<h2>
			<SenderContactCard message={message}>Alan Turing</SenderContactCard>
		</h2>,
	)
}

const trigger = () => screen.getByRole('button', { name: 'Alan Turing' })
const card = () => screen.queryByRole('dialog')

beforeEach(() => {
	Object.assign(mutation, { isPending: false, isSuccess: false, isError: false })
	mutate.mockReset()
	openCompose.mockClear()
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe('SenderContactCard', () => {
	it('opens on click with the sender’s signature details and closes on a second click', () => {
		renderCard()
		expect(trigger()).toHaveAttribute('aria-expanded', 'false')
		fireEvent.click(trigger())
		expect(trigger()).toHaveAttribute('aria-expanded', 'true')
		expect(trigger()).toHaveAttribute('aria-controls', card()?.id)
		expect(card()).toHaveAccessibleName('Alan Turing')
		expect(card()).toHaveTextContent('Principal Engineer, Bletchley')
		expect(card()).toHaveTextContent('alan@bletchley.dev')
		expect(card()).toHaveTextContent('+44 20 7946 0958')
		expect(card()).toHaveTextContent('From their signature.')
		fireEvent.click(trigger())
		expect(card()).toBeNull()
	})

	it('opens after a mouse rests on the name and closes after it leaves; touch hover does nothing', () => {
		vi.useFakeTimers()
		renderCard()
		const root = trigger().parentElement as HTMLElement
		fireEvent.pointerEnter(root, { pointerType: 'touch' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).toBeNull()
		fireEvent.pointerEnter(root, { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(349))
		expect(card()).toBeNull()
		act(() => vi.advanceTimersByTime(1))
		expect(card()).not.toBeNull()
		fireEvent.pointerLeave(root, { pointerType: 'touch' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).not.toBeNull()
		fireEvent.pointerLeave(root, { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(200))
		expect(card()).toBeNull()
	})

	it('opens on keyboard focus, not on a pointer focus, and Escape returns to the name', () => {
		renderCard()
		const button = trigger()
		const matches = vi.spyOn(button, 'matches')
		matches.mockReturnValueOnce(false)
		fireEvent.focus(button)
		expect(card()).toBeNull()
		matches.mockReturnValueOnce(true)
		fireEvent.focus(button)
		expect(card()).not.toBeNull()
		fireEvent.keyDown(screen.getByRole('button', { name: 'Save to contacts' }), { key: 'Escape' })
		expect(card()).toBeNull()
		expect(button).toHaveFocus()
		fireEvent.keyDown(button, { key: 'Escape' })
		fireEvent.keyDown(button, { key: 'Enter' })
		expect(card()).toBeNull()
	})

	it('closes when focus leaves the name and its card, not when it moves into the card', () => {
		renderCard()
		fireEvent.click(trigger())
		const save = screen.getByRole('button', { name: 'Save to contacts' })
		fireEvent.blur(trigger(), { relatedTarget: save })
		expect(card()).not.toBeNull()
		fireEvent.blur(save, { relatedTarget: document.body })
		expect(card()).toBeNull()
	})

	it('saves the sender to contacts from their signature', () => {
		renderCard()
		fireEvent.click(trigger())
		fireEvent.click(screen.getByRole('button', { name: 'Save to contacts' }))
		expect(mutate).toHaveBeenCalledWith({
			givenName: 'Alan',
			surname: 'Turing',
			jobTitle: 'Principal Engineer',
			companyName: 'Bletchley',
			emails: [{ email: 'alan@bletchley.dev', type: 'work' }],
			phoneNumbers: [{ number: '+44 20 7946 0958', type: 'work' }],
		})
	})

	it('says when saving is under way, done or failed', () => {
		mutation.isSuccess = true
		const { unmount } = renderCard()
		fireEvent.click(trigger())
		expect(screen.getByRole('button', { name: 'Saved to contacts' })).toBeDisabled()
		unmount()
		Object.assign(mutation, { isSuccess: false, isError: true })
		renderCard()
		fireEvent.click(trigger())
		expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save Alan to contacts.')
	})

	it('starts a new email to the sender', () => {
		renderCard()
		fireEvent.click(trigger())
		fireEvent.click(screen.getByRole('button', { name: 'New email' }))
		expect(openCompose).toHaveBeenCalledWith({ kind: 'new', to: 'alan@bletchley.dev' })
	})

	it('shows just the name and address without a signature, and saves what it knows', () => {
		renderCard({ id: 'm1', from: [{ name: 'Cher', email: 'cher@example.com' }], body: 'Hi.' } as MailMessage)
		fireEvent.click(screen.getByRole('button', { name: 'Alan Turing' }))
		expect(card()).toHaveTextContent('cher@example.com')
		expect(card()).not.toHaveTextContent('From their signature.')
		fireEvent.click(screen.getByRole('button', { name: 'Save to contacts' }))
		expect(mutate).toHaveBeenCalledWith({
			givenName: 'Cher',
			emails: [{ email: 'cher@example.com', type: 'work' }],
		})
	})

	it('falls back to the signature’s address and offers no email without one', () => {
		const { unmount } = renderCard({
			id: 'm2',
			from: [{ name: 'Alan Turing', email: '' }],
			body: 'Ok.\n\n-- \nAlan Turing\nalan@home.dev',
		} as MailMessage)
		fireEvent.click(trigger())
		expect(card()).toHaveTextContent('alan@home.dev')
		fireEvent.click(screen.getByRole('button', { name: 'Save to contacts' }))
		expect(mutate).toHaveBeenCalledWith({
			givenName: 'Alan',
			surname: 'Turing',
			emails: [{ email: 'alan@home.dev', type: 'work' }],
		})
		unmount()
		renderCard({ id: 'm3', body: 'Ok.\n\n-- \nAcme Corp' } as MailMessage)
		fireEvent.click(trigger())
		expect(card()).toHaveTextContent('Acme Corp')
		expect(screen.queryByRole('button', { name: 'New email' })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Save to contacts' }))
		expect(mutate).toHaveBeenLastCalledWith({ jobTitle: 'Acme Corp' })
	})
})
