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

function renderCard(message: MailMessage = signed, suspicious?: boolean) {
	return render(
		<SenderContactCard
			message={message}
			heading={{ id: 'sender', className: 'name' }}
			suspicious={suspicious}
		>
			Alan Turing
		</SenderContactCard>,
	)
}

const trigger = () => screen.getByRole('button', { name: 'Alan Turing' })
const card = () => screen.queryByRole('group')
const root = () => trigger().closest('[data-slot="sender-contact"]') as HTMLElement

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

	it('keeps the heading to the name, with the card beside it', () => {
		renderCard()
		fireEvent.click(trigger())
		const heading = screen.getByRole('heading', { level: 2, name: 'Alan Turing' })
		expect(heading).toHaveAttribute('id', 'sender')
		expect(heading).toHaveClass('name')
		expect(heading).toHaveTextContent(/^Alan Turing$/)
		expect(heading).not.toContainElement(card())
		expect(root()).toContainElement(card())
	})

	it('renders the name button alone without a heading', () => {
		render(<SenderContactCard message={signed}>Alan Turing</SenderContactCard>)
		expect(screen.queryByRole('heading')).toBeNull()
		fireEvent.click(trigger())
		expect(card()).not.toBeNull()
	})

	it('is a hover card, not a dialog, so the reader’s shortcuts still see no dialog', () => {
		renderCard()
		fireEvent.click(trigger())
		expect(card()).toHaveAttribute('data-slot', 'sender-contact-card')
		expect(document.querySelector('[role="dialog"]')).toBeNull()
	})

	it('opens after a mouse rests on the name and closes after it leaves; touch hover does nothing', () => {
		vi.useFakeTimers()
		renderCard()
		fireEvent.pointerEnter(root(), { pointerType: 'touch' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).toBeNull()
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(349))
		expect(card()).toBeNull()
		act(() => vi.advanceTimersByTime(1))
		expect(card()).not.toBeNull()
		fireEvent.pointerLeave(root(), { pointerType: 'touch' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).not.toBeNull()
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(100))
		// Coming back before it closes keeps it open.
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).not.toBeNull()
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(200))
		expect(card()).toBeNull()
		// Leaving before it opens cancels it.
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(100))
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).toBeNull()
	})

	it('keeps a card that keyboard focus opened while a hover was pending', () => {
		vi.useFakeTimers()
		renderCard()
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		const button = trigger()
		vi.spyOn(button, 'matches').mockReturnValueOnce(true)
		fireEvent.focus(button)
		act(() => vi.advanceTimersByTime(350))
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).not.toBeNull()
	})

	it('stays closed when Escape lands while a hover close is pending', () => {
		vi.useFakeTimers()
		renderCard()
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(350))
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		fireEvent.keyDown(document.body, { key: 'Escape' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).toBeNull()
	})

	it('stays closed when focus leaves while a hover close is pending', () => {
		vi.useFakeTimers()
		renderCard()
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(350))
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		fireEvent.blur(trigger(), { relatedTarget: document.body })
		expect(card()).toBeNull()
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).toBeNull()
	})

	it('stays open when a click follows a hover, until a second click', () => {
		vi.useFakeTimers()
		renderCard()
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(350))
		fireEvent.click(trigger())
		expect(card()).not.toBeNull()
		fireEvent.pointerLeave(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(1000))
		expect(card()).not.toBeNull()
		fireEvent.click(trigger())
		expect(card()).toBeNull()
	})

	it('closes on Escape after a hover open without taking focus, and keeps that Escape from the reader', () => {
		vi.useFakeTimers()
		const onWindowKey = vi.fn()
		window.addEventListener('keydown', onWindowKey)
		renderCard()
		const elsewhere = document.createElement('button')
		document.body.append(elsewhere)
		elsewhere.focus()
		fireEvent.pointerEnter(root(), { pointerType: 'mouse' })
		act(() => vi.advanceTimersByTime(350))
		expect(card()).not.toBeNull()
		fireEvent.keyDown(elsewhere, { key: 'e' })
		expect(card()).not.toBeNull()
		expect(onWindowKey).toHaveBeenCalledOnce()
		fireEvent.keyDown(elsewhere, { key: 'Escape' })
		expect(card()).toBeNull()
		expect(elsewhere).toHaveFocus()
		expect(onWindowKey).toHaveBeenCalledOnce()
		fireEvent.keyDown(elsewhere, { key: 'Escape' })
		expect(onWindowKey).toHaveBeenCalledTimes(2)
		window.removeEventListener('keydown', onWindowKey)
		elsewhere.remove()
	})

	it('opens on keyboard focus, not on a pointer focus; Enter keeps it open and Escape returns to the name', () => {
		renderCard()
		const button = trigger()
		const matches = vi.spyOn(button, 'matches')
		matches.mockReturnValueOnce(false)
		fireEvent.focus(button)
		expect(card()).toBeNull()
		matches.mockReturnValueOnce(true)
		fireEvent.focus(button)
		expect(card()).not.toBeNull()
		// Enter on a button is a click: it pins the card rather than closing it.
		fireEvent.click(button)
		expect(card()).not.toBeNull()
		matches.mockReturnValueOnce(true)
		fireEvent.focus(button)
		expect(card()).not.toBeNull()
		const save = screen.getByRole('button', { name: 'Save to contacts' })
		save.focus()
		fireEvent.keyDown(save, { key: 'Escape' })
		expect(card()).toBeNull()
		expect(button).toHaveFocus()
	})

	it('vouches for nothing from a suspicious sender’s signature and offers no save', () => {
		renderCard(signed, true)
		fireEvent.click(trigger())
		expect(card()).toHaveTextContent('alan@bletchley.dev')
		expect(card()).not.toHaveTextContent('Principal Engineer, Bletchley')
		expect(card()).not.toHaveTextContent('+44 20 7946 0958')
		expect(card()).not.toHaveTextContent('From their signature.')
		expect(screen.queryByRole('button', { name: 'Save to contacts' })).toBeNull()
		expect(screen.getByRole('button', { name: 'New email' })).toBeInTheDocument()
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
		fireEvent.click(trigger())
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
