// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BodyDisclosure } from '../lib/body-disclosure.js'
import { BodyDisclosures, disclosureLabel, QuotedDisclosure, quotedHeader } from './QuotedDisclosure.js'

afterEach(cleanup)

// Saturday, October 17 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 9, 17, 12) / 1000
const local = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute)
const dateText = (date: Date) =>
	`${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

const disclosure: BodyDisclosure = {
	quoted: [
		{
			name: 'Grace Hopper',
			email: 'grace@x.com',
			dateText: dateText(local(13, 18, 2)),
			text: 'Here is v3. I tightened the intro and moved billing to its own section. Please flag anything before Friday.',
		},
		{ name: 'Alan Turing', text: 'Signed off.' },
	],
	signature: ['Alan Turing', 'Principal Engineer, Bletchley'],
}

describe('disclosureLabel', () => {
	it('names what a pill holds', () => {
		expect(disclosureLabel('both')).toBe('Quoted text and signature')
		expect(disclosureLabel('signature')).toBe('Signature')
		expect(disclosureLabel('quoted', 2)).toBe('Quoted: 2 earlier messages')
		expect(disclosureLabel('quoted', 1)).toBe('Quoted: 1 earlier message')
		expect(disclosureLabel('quoted')).toBe('Quoted text')
	})
})

describe('QuotedDisclosure', () => {
	it('is a 26px quiet pill for history (a "more" glyph) or the signature (none), split from the 24px muted one', async () => {
		const onToggle = vi.fn()
		const view = render(
			<QuotedDisclosure kind="quoted" count={2} expanded={false} onToggle={onToggle} controls="x" />,
		)
		const pill = screen.getByRole('button', { name: 'Quoted: 2 earlier messages' })
		expect(pill).toHaveClass(
			'quoted-pill-split',
			'h-[26px]',
			'rounded-md',
			'bg-muted',
			'text-xs',
			'text-quiet-foreground',
		)
		expect(pill).not.toHaveClass('h-6', 'px-2', 'text-muted-foreground')
		expect(pill).toHaveAttribute('aria-expanded', 'false')
		expect(pill).toHaveAttribute('aria-controls', 'x')
		expect(pill.querySelector('svg')).not.toBeNull()
		await userEvent.click(pill)
		expect(onToggle).toHaveBeenCalledOnce()
		// Open, it keeps the quiet tone of the pill beside it; what opens below says it is open.
		view.rerender(<QuotedDisclosure kind="quoted" count={2} expanded onToggle={onToggle} />)
		expect(pill).toHaveClass('text-quiet-foreground')
		expect(pill.className).not.toMatch(/aria-expanded:text-/)
		view.rerender(<QuotedDisclosure kind="signature" expanded onToggle={onToggle} />)
		const signature = screen.getByRole('button', { name: 'Signature' })
		expect(signature.querySelector('svg')).toBeNull()
		expect(signature).toHaveClass('h-[26px]', 'text-quiet-foreground')
		view.rerender(<QuotedDisclosure kind="both" expanded={false} onToggle={onToggle} />)
		const both = screen.getByRole('button', { name: 'Quoted text and signature' })
		expect(both).toHaveClass('h-6', 'px-2', 'text-muted-foreground')
		expect(both).not.toHaveClass('quoted-pill-split')
	})
})

describe('quotedHeader', () => {
	it('names who wrote and when, as the reader names days', () => {
		expect(quotedHeader(disclosure.quoted[0] as never, NOW, tz)).toBe('Grace, Tue 6:02 PM')
		expect(quotedHeader({ name: 'Grace', dateText: dateText(local(17, 9, 5)), text: '' }, NOW, tz)).toBe(
			'Grace, 9:05 AM',
		)
		expect(quotedHeader({ name: 'Grace', dateText: dateText(local(16, 9, 5)), text: '' }, NOW, tz)).toBe(
			'Grace, yesterday 9:05 AM',
		)
		expect(quotedHeader({ name: 'Grace', dateText: dateText(local(3, 9, 5)), text: '' }, NOW, tz)).toBe(
			'Grace, Oct 3, 9:05 AM',
		)
		expect(quotedHeader({ name: '', email: 'sam@x.com', dateText: 'Friday', text: '' }, NOW, tz)).toBe(
			'Sam, Friday',
		)
		expect(quotedHeader({ name: '', text: '' }, NOW, tz)).toBe('')
	})
})

describe('BodyDisclosures', () => {
	it('renders nothing without history or signature', () => {
		const { container } = render(<BodyDisclosures disclosure={{ quoted: [], signature: [] }} />)
		expect(container).toBeEmptyDOMElement()
	})

	it('shows one pill for both, then splits into history (open) and signature (closed)', async () => {
		const onGoToQuoted = vi.fn()
		render(<BodyDisclosures disclosure={disclosure} onGoToQuoted={onGoToQuoted} now={NOW} tz={tz} />)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted text and signature' }))

		const quoted = screen.getByRole('button', { name: 'Quoted: 2 earlier messages' })
		expect(quoted).toHaveAttribute('aria-expanded', 'true')
		expect(quoted).toHaveFocus()
		expect(screen.getByRole('button', { name: 'Signature' })).toHaveAttribute('aria-expanded', 'false')
		expect(screen.getByText('Grace, Tue 6:02 PM')).toBeInTheDocument()
		expect(
			screen.getByText('Here is v3. I tightened the intro and moved billing to its own section…'),
		).toBeInTheDocument()
		// The second entry has no address to go to, so it shows in full with no link.
		expect(screen.getByText('Signed off.')).toBeInTheDocument()
		expect(screen.getAllByRole('button', { name: /Go to/ })).toHaveLength(1)

		await userEvent.click(screen.getByRole('button', { name: 'Go to Grace’s message' }))
		expect(onGoToQuoted).toHaveBeenCalledWith({
			name: 'Grace Hopper',
			email: 'grace@x.com',
			date: Math.floor(local(13, 18, 2).getTime() / 1000),
		})

		await userEvent.click(screen.getByRole('button', { name: 'Signature' }))
		expect(screen.getByText(/Principal Engineer, Bletchley/)).toBeInTheDocument()
		await userEvent.click(quoted)
		expect(screen.queryByText('Signed off.')).toBeNull()
	})

	it('shows quotes in full without a way to their messages, and links an undated quote without a date', async () => {
		const view = render(<BodyDisclosures disclosure={{ quoted: disclosure.quoted, signature: [] }} />)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted: 2 earlier messages' }))
		expect(screen.getByText(/Please flag anything before Friday\./)).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Go to/ })).toBeNull()
		view.unmount()

		const onGoToQuoted = vi.fn()
		render(
			<BodyDisclosures
				disclosure={{ quoted: [{ name: 'Sam', email: 'sam@x.com', text: '' }], signature: [] }}
				onGoToQuoted={onGoToQuoted}
			/>,
		)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted: 1 earlier message' }))
		expect(screen.getByText('Sam')).toBeInTheDocument()
		await userEvent.click(screen.getByRole('button', { name: 'Go to Sam’s message' }))
		expect(onGoToQuoted).toHaveBeenCalledWith({ name: 'Sam', email: 'sam@x.com' })
	})

	it('shows a quote with no attribution as its words alone', async () => {
		render(
			<BodyDisclosures disclosure={{ quoted: [{ name: '', text: 'Anonymous words' }], signature: [] }} />,
		)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted: 1 earlier message' }))
		const card = screen.getByText('Anonymous words').parentElement as HTMLElement
		expect(card.querySelector('.font-semibold')).toBeNull()
	})

	it('shows a signature alone behind its own pill', async () => {
		render(<BodyDisclosures disclosure={{ quoted: [], signature: ['Grace'] }} />)
		await userEvent.click(screen.getByRole('button', { name: 'Signature' }))
		expect(screen.getByText('Grace')).toBeInTheDocument()
	})

	it('sets quoted cards in the quiet board colour and keeps their paragraphs', async () => {
		render(
			<BodyDisclosures
				disclosure={{ quoted: [{ name: 'Sam', text: 'First.\n\nSecond.' }], signature: [] }}
				now={NOW}
				tz={tz}
			/>,
		)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted: 1 earlier message' }))
		const words = screen.getByText(/First\./)
		expect(words).toHaveClass('whitespace-pre-line')
		expect(words.textContent).toBe('First.\n\nSecond.')
		expect(words.parentElement).toHaveClass('text-quiet-foreground', 'leading-[1.55]', 'px-4', 'py-3')
	})

	it('never links a forwarded message to the thread', async () => {
		render(
			<BodyDisclosures
				disclosure={{
					quoted: [{ name: 'Voyage', email: 'trips@voyage.com', text: 'Your trip.', forwarded: true }],
					signature: [],
				}}
				onGoToQuoted={vi.fn()}
				now={NOW}
				tz={tz}
			/>,
		)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted: 1 earlier message' }))
		expect(screen.getByText('Your trip.')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /Go to/ })).toBeNull()
	})

	it('offers the history’s original and renders a rich signature as sent, when it can render HTML', async () => {
		const renderHtml = vi.fn((html: string, part: string) => <div data-part={part}>{html}</div>)
		const rich: BodyDisclosure = {
			quoted: [{ name: 'Sam', text: 'See the plan.' }],
			signature: ['Grace', 'Book a time'],
			quotedHtml: '<p>quoted original</p>',
			signatureHtml: '<p>signature original</p>',
		}
		const view = render(<BodyDisclosures disclosure={rich} renderHtml={renderHtml} now={NOW} tz={tz} />)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted text and signature' }))
		const original = screen.getByRole('button', { name: 'Show original' })
		expect(original).toHaveAttribute('aria-expanded', 'false')
		await userEvent.click(original)
		expect(screen.getByText('<p>quoted original</p>')).toHaveAttribute('data-part', 'quoted')
		await userEvent.click(screen.getByRole('button', { name: 'Hide original' }))
		expect(screen.queryByText('<p>quoted original</p>')).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Signature' }))
		expect(screen.getByText('<p>signature original</p>')).toHaveAttribute('data-part', 'signature')
		view.unmount()

		// Without a renderer, the words stand alone.
		render(<BodyDisclosures disclosure={rich} now={NOW} tz={tz} />)
		await userEvent.click(screen.getByRole('button', { name: 'Quoted text and signature' }))
		expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Signature' }))
		expect(screen.getByText(/Book a time/)).toBeInTheDocument()
	})
})
