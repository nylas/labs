// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JumpToNewPill } from './JumpToNewPill.js'

afterEach(cleanup)

describe('JumpToNewPill', () => {
	it('is the glass "{n} more new" pill of board 03 with a 44px target', async () => {
		const user = userEvent.setup()
		const onJump = vi.fn()
		render(<JumpToNewPill count={2} onJump={onJump} />)
		const pill = screen.getByRole('button', { name: '2 more new' })
		// The button is the 36px glass pill, fixed 20px above the reply bar (76px at least), phone only.
		expect(pill).toHaveClass(
			'glass-panel',
			'[--glass-radius:9999px]',
			'fixed',
			'left-1/2',
			'-translate-x-1/2',
			'h-9',
			'px-hairline',
			'text-[13px]',
			'font-semibold',
			'md:hidden',
			'bottom-[calc(max(4.75rem,var(--mobile-tab-bar-height)+1px+var(--safe-area-bottom))+1.25rem)]',
		)
		// A transparent layer 4px past each edge makes the touch target 44px tall.
		expect(pill).toHaveClass('after:absolute', 'after:-inset-1')
		expect(pill.querySelector('svg')).toHaveClass('size-4', 'text-cta-icon')
		await user.click(pill)
		expect(onJump).toHaveBeenCalledOnce()
	})

	it('shows keyboard focus as an outline on the pill, which panel glass does not override', async () => {
		const user = userEvent.setup()
		render(<JumpToNewPill count={1} onJump={vi.fn()} />)
		const pill = screen.getByRole('button', { name: '1 more new' })
		// `.glass-panel` owns box-shadow outside the utilities layer, so a ring would never paint.
		expect(pill.className).not.toMatch(/\bring-|outline-none/)
		expect(pill).toHaveClass(
			'focus-visible:outline-2',
			'focus-visible:outline-offset-2',
			'focus-visible:outline-solid',
			'focus-visible:outline-ring',
		)
		await user.tab()
		expect(pill).toHaveFocus()
	})

	it('renders nothing when nothing new is below', () => {
		const { rerender } = render(<JumpToNewPill count={0} onJump={vi.fn()} />)
		expect(screen.queryByRole('button')).toBeNull()
		rerender(<JumpToNewPill count={-1} onJump={vi.fn()} />)
		expect(screen.queryByRole('button')).toBeNull()
	})
})
