// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileTabBar } from '#app/components/MobileTabBar'
import { MobileReplyBar } from './MobileReplyBar.js'

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}))

afterEach(cleanup)

function renderInThreadBar(handlers = { onReplyAll: vi.fn(), onReply: vi.fn(), onForward: vi.fn() }) {
	// The mail layout's bar is on screen before a thread opens into it.
	render(<MobileTabBar active="mail" context="thread" />)
	render(<MobileReplyBar {...handlers} />)
	return handlers
}

describe('MobileReplyBar', () => {
	it('fills the thread slot of the one mobile bottom bar (board 03)', () => {
		renderInThreadBar()
		const toolbar = screen.getByRole('toolbar', { name: 'Thread actions' })
		const bar = toolbar.querySelector('[data-slot="mobile-reply-bar"]')
		// One row across the slot's grid: Reply all takes the width, Reply and Forward sit square beside it.
		expect(bar).toHaveClass('col-span-full', 'flex', 'gap-cluster', 'px-hairline', 'py-cluster')
		const buttons = screen.getAllByRole('button')
		expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
			'Reply all',
			'Reply',
			'Forward',
		])
		for (const button of buttons) expect(toolbar).toContainElement(button)
		// The bar is still the shared glass bar, so there is exactly one bottom surface.
		expect(toolbar.parentElement).toHaveClass('mobile-tab-bar', 'glass-bar')
	})

	it('labels Reply all and keeps Reply and Forward as named 44px icons', () => {
		renderInThreadBar()
		const replyAll = screen.getByRole('button', { name: 'Reply all' })
		expect(replyAll).toHaveTextContent('Reply all')
		expect(replyAll).toHaveClass(
			'h-11',
			'flex-1',
			'border-cta-line',
			'text-[15px]',
			'font-semibold',
			'shadow-none',
		)
		// The accent is only on Reply all's icon (design.md "CTA voice").
		expect(replyAll.querySelector('svg')).toHaveClass('size-[18px]', 'text-cta-icon')
		for (const name of ['Reply', 'Forward']) {
			const button = screen.getByRole('button', { name })
			expect(button).toHaveAttribute('title', name)
			expect(button).toHaveTextContent('')
			expect(button).toHaveClass('size-11', 'border-cta-line', 'bg-transparent')
			expect(button.querySelector('svg')).not.toHaveClass('text-cta-icon')
		}
	})

	it('answers each tap with its own action', async () => {
		const user = userEvent.setup()
		const handlers = renderInThreadBar()
		await user.click(screen.getByRole('button', { name: 'Reply all' }))
		expect(handlers.onReplyAll).toHaveBeenCalledOnce()
		await user.click(screen.getByRole('button', { name: 'Reply' }))
		expect(handlers.onReply).toHaveBeenCalledOnce()
		await user.click(screen.getByRole('button', { name: 'Forward' }))
		expect(handlers.onForward).toHaveBeenCalledOnce()
		expect(handlers.onReplyAll).toHaveBeenCalledOnce()
	})

	it('renders nothing without the thread slot, and nothing on the server', () => {
		render(<MobileReplyBar onReplyAll={vi.fn()} onReply={vi.fn()} onForward={vi.fn()} />)
		expect(screen.queryByRole('button')).toBeNull()
		expect(
			renderToString(<MobileReplyBar onReplyAll={vi.fn()} onReply={vi.fn()} onForward={vi.fn()} />),
		).toBe('')
	})
})
