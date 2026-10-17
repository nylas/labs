// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailThread } from '../state/mail-queries.js'
import { ThreadBundleRow } from './ThreadBundleRow.js'

afterEach(cleanup)

const from = (name: string, extra: Partial<MailThread> = {}) =>
	({
		id: name,
		participants: [{ name, email: `${name.toLowerCase().replace(/\W/g, '')}@x.com` }],
		...extra,
	}) as MailThread

describe('ThreadBundleRow', () => {
	it('folds newsletters into one row that opens in place', () => {
		const onToggle = vi.fn()
		const { container } = render(
			<ThreadBundleRow
				bundleKey="bundle:This week:newsletter"
				bundle="newsletter"
				threads={[
					from('The Dispatch', { unread: true }),
					from('Lenny’s'),
					from('Stratechery'),
					from('Figma'),
				]}
				expanded={false}
				navActive
				onToggle={onToggle}
			/>,
		)
		const row = screen.getByRole('button', { name: /Newsletters/ })
		expect(row).toHaveAttribute('aria-expanded', 'false')
		expect(row).toHaveAttribute('data-nav-row')
		expect(row).toHaveAttribute('data-nav-cursor', 'true')
		// Focus shows the ring a thread row's link shows, not only a faint tint.
		expect(row).toHaveClass('focus-visible:ring-[3px]', 'focus-visible:ring-inset', 'focus-visible:ring-ring')
		expect(row).toHaveAccessibleName(
			'Newsletters, 4 conversations: The Dispatch, Lenny’s, Stratechery, Figma',
		)
		expect(screen.getByText('Newsletters')).toHaveClass('font-semibold')
		// The count pill reads in the control colour, a step darker than a file pill.
		expect(screen.getByText('4')).toHaveClass('thread-signal-count')
		expect(container.querySelector('[data-bundle="newsletter"] svg.lucide-newspaper')).not.toBeNull()
		fireEvent.click(row)
		expect(onToggle).toHaveBeenCalledWith('bundle:This week:newsletter')
	})

	it('lists who was paid how much on a receipts row', () => {
		const { container } = render(
			<ThreadBundleRow
				bundleKey="bundle:This week:receipt"
				bundle="receipt"
				threads={[
					from('Stripe', { subject: 'Invoice #2041 has been paid', snippet: '$4,200.00' }),
					from('Apple', { subject: 'Your receipt', snippet: '$2.99' }),
				]}
				expanded
				navActive={false}
				onToggle={vi.fn()}
			/>,
		)
		expect(screen.getByRole('button', { expanded: true })).not.toHaveAttribute('data-nav-cursor')
		expect(screen.getByText('Receipts')).toHaveClass('font-normal')
		expect(screen.getByText('Stripe $4,200.00 · Apple $2.99')).toBeInTheDocument()
		expect(container.querySelector('svg.lucide-credit-card')).not.toBeNull()
	})
})
