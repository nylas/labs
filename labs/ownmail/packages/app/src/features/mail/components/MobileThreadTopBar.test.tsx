// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileThreadTopBar, topBarSubject } from './MobileThreadTopBar.js'

afterEach(cleanup)

describe('topBarSubject', () => {
	it('keeps the topic of a "topic: detail" subject', () => {
		expect(topBarSubject('Q3 product roadmap: final review before Friday')).toBe('Q3 product roadmap')
		expect(topBarSubject('Re: Fwd: Design review: token migration')).toBe('Design review')
		expect(topBarSubject('RE[2]: Q3 offsite agenda')).toBe('Q3 offsite agenda')
	})

	it('shows any other subject whole', () => {
		// A one-word topic says too little; a colon without a space is not a topic.
		expect(topBarSubject('Invoice: #1042 is paid')).toBe('Invoice: #1042 is paid')
		expect(topBarSubject('Standup at 10:30')).toBe('Standup at 10:30')
		expect(topBarSubject(': nothing before')).toBe(': nothing before')
		expect(topBarSubject('Weekend hiking plans?')).toBe('Weekend hiking plans?')
		expect(topBarSubject('Re:')).toBe('Re:')
		expect(topBarSubject('  ')).toBe('')
	})
})

describe('MobileThreadTopBar', () => {
	function renderBar(overrides: Partial<React.ComponentProps<typeof MobileThreadTopBar>> = {}) {
		const props = {
			subject: 'Q3 product roadmap: final review before Friday',
			messageCount: 14,
			peopleCount: 5,
			onBack: vi.fn(),
			onArchive: vi.fn(),
			moreMenu: (
				<button type="button" aria-label="More">
					…
				</button>
			),
			...overrides,
		}
		render(<MobileThreadTopBar {...props} />)
		return props
	}

	it('is the pinned phone toolbar exactly as board 03 draws it', () => {
		renderBar()
		const bar = document.querySelector('[data-slot="mobile-thread-top-bar"]')
		// The pane toolbar (56px on a phone) pinned as bar glass, hidden from md where the desktop toolbar takes over.
		expect(bar).toHaveClass(
			'h-(--toolbar-height)',
			'absolute',
			'top-0',
			'glass-bar',
			'gap-control',
			'px-control',
			'md:hidden',
		)
		const subject = screen.getByText('Q3 product roadmap')
		expect(subject).toHaveClass('truncate', 'text-[15px]', 'font-semibold')
		expect(subject).toHaveAttribute('title', 'Q3 product roadmap: final review before Friday')
		const size = screen.getByText('14 messages · 5 people')
		expect(size).toHaveClass('font-data', 'tabular-nums', 'text-xs', 'text-muted-foreground')
		const buttons = [...(bar?.querySelectorAll('button') ?? [])].map((button) =>
			button.getAttribute('aria-label'),
		)
		expect(buttons).toEqual(['Back to list', 'Archive', 'More'])
		for (const name of ['Back to list', 'Archive']) {
			expect(screen.getByRole('button', { name })).toHaveClass('size-11')
		}
	})

	it('counts one message and one person in the singular', () => {
		renderBar({ subject: 'Lunch', messageCount: 1, peopleCount: 1, backLabel: 'Back to Inbox' })
		expect(screen.getByText('1 message · 1 person')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Back to Inbox' })).toBeInTheDocument()
	})

	it('goes back and archives on tap', async () => {
		const user = userEvent.setup()
		const props = renderBar()
		await user.click(screen.getByRole('button', { name: 'Back to list' }))
		expect(props.onBack).toHaveBeenCalledOnce()
		await user.click(screen.getByRole('button', { name: 'Archive' }))
		expect(props.onArchive).toHaveBeenCalledOnce()
	})
})
