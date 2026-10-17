// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '../lib/thread-reading-model.js'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'
import { isLookalikeSender, linksDisabled, MessageNotices, uncheckedSender } from './MessageNotices.js'

afterEach(cleanup)

const OWNER = 'ada@ownmail.com'
const ADA = { name: 'Ada Lovelace', email: 'ada@ownmail.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com' }
const ALAN = { name: 'Alan Turing', email: 'alan@bletchley.dev' }
const KATHERINE = { name: 'Katherine Johnson', email: 'katherine@vercel.com' }
const MERIDIAN: Person = { name: 'Meridian Bank', email: 'statements@meridianbank.com', isOwner: false }

const facts = (extra: Partial<MessageHeaderFacts> = {}): MessageHeaderFacts => ({
	verified: false,
	authFailed: false,
	listUnsubscribe: false,
	...extra,
})

function renderNotices(
	message: Partial<MailMessage>,
	props: { prev?: MailMessage; facts?: MessageHeaderFacts; knownSenders?: Person[]; muted?: boolean } = {},
) {
	const onMuteThread = vi.fn()
	const onAddBack = vi.fn()
	const view = render(
		<MessageNotices
			message={{ id: 'm', ...message } as MailMessage}
			prev={props.prev}
			owner={OWNER}
			facts={props.facts}
			knownSenders={props.knownSenders ?? []}
			muted={props.muted}
			onMuteThread={onMuteThread}
			onAddBack={onAddBack}
		/>,
	)
	return { ...view, onMuteThread, onAddBack }
}

const notes = () => screen.queryAllByRole('note')

describe('linksDisabled', () => {
	it('disables links for failed sender checks or a lookalike sender', () => {
		expect(linksDisabled(facts({ authFailed: true }))).toBe(true)
		expect(linksDisabled(facts(), true)).toBe(true)
		expect(linksDisabled(facts(), false)).toBe(false)
		expect(linksDisabled(undefined)).toBe(false)
		// Until the checks answer, a message's links wait, disabled.
		expect(linksDisabled(undefined, false, true)).toBe(true)
	})

	it('treats a sender as unchecked only while the lookup holds nothing for that message', () => {
		const grace = { id: 'm', from: [GRACE] } as MailMessage
		expect(uncheckedSender(grace, OWNER, undefined, 'pending')).toBe('pending')
		expect(uncheckedSender(grace, OWNER, undefined, 'failed')).toBe('failed')
		expect(uncheckedSender(grace, OWNER, undefined, 'settled')).toBeUndefined()
		expect(uncheckedSender(grace, OWNER, facts(), 'pending')).toBeUndefined()
		expect(
			uncheckedSender({ id: 'm', from: [ADA] } as MailMessage, OWNER, undefined, 'failed'),
		).toBeUndefined()
	})

	it('tells whether a sender only looks like someone known', () => {
		const fake = { id: 'm', from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }], to: [ADA] }
		expect(isLookalikeSender(fake as MailMessage, [MERIDIAN], OWNER)).toBe(true)
		expect(isLookalikeSender({ ...fake, from: [GRACE] } as MailMessage, [MERIDIAN], OWNER)).toBe(false)
	})

	it('trusts the same address, the same domain, unknown names, nameless senders and the owner', () => {
		const from = (sender: { name?: string; email: string }) => ({ id: 'm', from: [sender] }) as MailMessage
		const known: Person = { name: 'meridian bank', email: 'Statements@MeridianBank.com', isOwner: false }
		expect(isLookalikeSender(from(MERIDIAN), [known], OWNER)).toBe(false)
		expect(
			isLookalikeSender(from({ name: 'Meridian Bank', email: 'help@meridianbank.com' }), [MERIDIAN], OWNER),
		).toBe(false)
		expect(isLookalikeSender(from(GRACE), [MERIDIAN], OWNER)).toBe(false)
		expect(isLookalikeSender(from({ email: 'x@y.z' }), [MERIDIAN], OWNER)).toBe(false)
		expect(isLookalikeSender(from({ name: 'Meridian Bank', email: OWNER }), [MERIDIAN], OWNER)).toBe(false)
		expect(isLookalikeSender(from({ name: 'Meridian Bank', email: 'nodomain' }), [MERIDIAN], OWNER)).toBe(
			true,
		)
	})
})

describe('MessageNotices', () => {
	it('renders nothing for an ordinary message', () => {
		const { container } = renderNotices({ from: [GRACE], to: [ADA] }, { facts: facts({ verified: true }) })
		expect(container).toBeEmptyDOMElement()
	})

	it('warns in amber when replies go to another address', () => {
		renderNotices({ from: [GRACE], to: [ADA] }, { facts: facts({ replyTo: 'grace.personal@fastmail.com' }) })
		const [note] = notes()
		expect(note).toHaveTextContent(
			'Replies go to grace.personal@fastmail.com, not the address this came from.',
		)
		expect(note).toHaveAttribute('data-tone', 'warning')
		expect(note?.className).toContain('border-notice-warning-line')
		expect(note?.className).toContain('bg-notice-warning')
		expect(note?.querySelector('strong')).toHaveTextContent('grace.personal@fastmail.com')
	})

	it('warns in red about a lookalike that failed sender checks, and says links are disabled', () => {
		renderNotices(
			{ from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }], to: [ADA] },
			{ facts: facts({ authFailed: true }), knownSenders: [MERIDIAN] },
		)
		const [note] = notes()
		expect(note).toHaveTextContent(
			'“Meridian Bank” usually writes from meridianbank.com. This came from meridian-secure.co and failed sender checks. Links are disabled.',
		)
		expect(note).toHaveAttribute('data-tone', 'danger')
		expect(note?.querySelector('strong')).toHaveTextContent('meridian-secure.co')
	})

	it('words a lookalike that passed checks, and a failed check from an unknown name', () => {
		const { unmount } = renderNotices(
			{ from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }], to: [ADA] },
			{ knownSenders: [MERIDIAN] },
		)
		expect(notes()[0]).toHaveTextContent(
			'“Meridian Bank” usually writes from meridianbank.com. This came from meridian-secure.co. Links are disabled.',
		)
		unmount()
		renderNotices(
			{ from: [{ name: 'Billing', email: 'billing@Pay-Now.io' }], to: [ADA] },
			{ facts: facts({ authFailed: true }) },
		)
		expect(notes()[0]).toHaveTextContent(
			'This came from pay-now.io and failed sender checks. Links are disabled.',
		)
	})

	it('warns exactly when links are made inert, for siblings on a plain domain and under co.uk', () => {
		const cases: Array<[known: string, sender: string, warns: boolean]> = [
			['digest@mail.example.com', 'hello@news.example.com', false],
			['digest@mail.example.co.uk', 'hello@news.example.co.uk', true],
			['digest@example.co.uk', 'hello@news.example.co.uk', false],
		]
		for (const [known, sender, warns] of cases) {
			const knownSenders: Person[] = [{ name: 'Example', email: known, isOwner: false }]
			const message = { from: [{ name: 'Example', email: sender }], to: [ADA] }
			const { unmount } = renderNotices(message, { facts: facts({ verified: true }), knownSenders })
			expect(notes()).toHaveLength(warns ? 1 : 0)
			expect(isLookalikeSender({ id: 'm', ...message } as MailMessage, knownSenders, OWNER)).toBe(warns)
			unmount()
		}
		renderNotices(
			{ from: [{ name: 'Example', email: 'hello@news.example.co.uk' }], to: [ADA] },
			{ knownSenders: [{ name: 'Example', email: 'digest@mail.example.co.uk', isOwner: false }] },
		)
		expect(notes()[0]).toHaveTextContent(
			'“Example” usually writes from mail.example.co.uk. This came from news.example.co.uk. Links are disabled.',
		)
	})

	it('names who the sender dropped and offers to add each back', () => {
		const prev = { id: 'm1', from: [KATHERINE], to: [ALAN, GRACE, ADA] } as MailMessage
		const { onAddBack } = renderNotices({ from: [ALAN], to: [ADA, GRACE] }, { prev })
		const [note] = notes()
		expect(note).toHaveTextContent('Alan removed Katherine from this reply. Add Katherine back to yours')
		expect(note).toHaveAttribute('data-tone', 'neutral')
		fireEvent.click(screen.getByRole('button', { name: 'Add Katherine back to yours' }))
		expect(onAddBack).toHaveBeenCalledWith({
			name: 'Katherine Johnson',
			email: 'katherine@vercel.com',
			isOwner: false,
		})
	})

	it('says a list message came through a list of a known size, with Mute thread and Leave list', () => {
		const copied = Array.from({ length: 1238 }, (_, index) => ({ email: `p${index}@vercel.com` }))
		const { onMuteThread } = renderNotices(
			{ from: [ALAN], to: [{ email: 'eng-all@vercel.com' }], cc: copied },
			{ facts: facts({ listId: 'eng-all.vercel.com', unsubscribeUrl: 'https://vercel.com/leave' }) },
		)
		const [note] = notes()
		expect(note).toHaveTextContent('Sent to eng-all@, a list of 1,240. Mute thread · Leave list')
		fireEvent.click(screen.getByRole('button', { name: 'Mute thread' }))
		expect(onMuteThread).toHaveBeenCalledOnce()
		const leave = screen.getByRole('link', { name: 'Leave list' })
		expect(leave).toHaveAttribute('href', 'https://vercel.com/leave')
		expect(leave).toHaveAttribute('target', '_blank')
		expect(leave).toHaveAttribute('rel', 'noopener noreferrer')
	})

	it('leaves a list by mail when that is all it offers, and only mutes when it offers nothing', () => {
		const { unmount } = renderNotices(
			{ from: [ALAN], to: [{ email: 'eng-all@vercel.com' }] },
			{ facts: facts({ unsubscribeMailto: 'mailto:leave@vercel.com?subject=unsubscribe' }) },
		)
		expect(notes()[0]).toHaveTextContent('Sent to eng-all@, a mailing list. Mute thread · Leave list')
		const leave = screen.getByRole('link', { name: 'Leave list' })
		expect(leave).toHaveAttribute('href', 'mailto:leave@vercel.com?subject=unsubscribe')
		expect(leave).not.toHaveAttribute('target')
		unmount()
		renderNotices({ from: [ALAN], to: [{ email: 'eng-all@vercel.com' }] })
		expect(notes()[0]).toHaveTextContent('Sent to eng-all@, a mailing list. Mute thread')
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('offers Unmute thread on a muted thread, toggling the same way', () => {
		const { onMuteThread } = renderNotices(
			{ from: [ALAN], to: [{ email: 'eng-all@vercel.com' }] },
			{ facts: facts({ listId: 'eng-all.vercel.com' }), muted: true },
		)
		expect(notes()[0]).toHaveTextContent('Sent to eng-all@, a mailing list. Unmute thread')
		expect(screen.queryByRole('button', { name: 'Mute thread' })).toBeNull()
		const unmute = screen.getByRole('button', { name: 'Unmute thread' })
		expect(unmute).not.toHaveAttribute('aria-pressed')
		fireEvent.click(unmute)
		expect(onMuteThread).toHaveBeenCalledOnce()
	})

	it('says a list carried the message without making up its address when no recipient is the list', () => {
		renderNotices(
			{ from: [{ name: 'GitHub', email: 'notifications@github.com' }], to: [ADA] },
			{ facts: facts({ listId: 'labs.nylas.github.com' }) },
		)
		expect(notes()[0]).toHaveTextContent('Sent through a mailing list. Mute thread')
		expect(notes()[0]).not.toHaveTextContent('@')
	})

	it('says nothing about the owner’s own mail', () => {
		renderNotices(
			{ from: [ADA], to: [{ email: 'eng-all@vercel.com' }], reply_to: [{ email: 'other@ownmail.com' }] },
			{ facts: facts({ authFailed: true, listId: 'eng-all.vercel.com' }) },
		)
		expect(notes()).toHaveLength(0)
	})

	it('stacks several notices in order', () => {
		renderNotices(
			{
				from: [{ name: 'Meridian Bank', email: 'alerts@meridian-secure.co' }],
				to: [{ email: 'all@vercel.com' }],
			},
			{ facts: facts({ authFailed: true, replyTo: 'x@meridian-secure.co' }), knownSenders: [MERIDIAN] },
		)
		expect(notes().map((note) => note.getAttribute('data-kind'))).toEqual([
			'reply-to',
			'sender-check',
			'mailing-list',
		])
	})
})
