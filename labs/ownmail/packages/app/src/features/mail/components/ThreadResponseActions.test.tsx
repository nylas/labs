// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID } from '#app/components/MobileTabBar'
import { MobileThreadResponseActions } from './ThreadResponseActions.js'

afterEach(() => {
	cleanup()
	document.getElementById(MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID)?.remove()
})

it('renders no second mobile action surface when the shared toolbar target is absent', () => {
	render(<MobileThreadResponseActions onReply={vi.fn()} onReplyAll={vi.fn()} onForward={vi.fn()} />)
	expect(screen.queryByRole('button')).toBeNull()
})

it('does not access the client toolbar during server rendering', () => {
	expect(
		renderToString(
			<MobileThreadResponseActions onReply={vi.fn()} onReplyAll={vi.fn()} onForward={vi.fn()} />,
		),
	).toBe('')
})

it('fills the mobile bar thread slot with its icon actions', () => {
	const slot = document.createElement('div')
	slot.id = MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID
	document.body.append(slot)
	const onReply = vi.fn()
	render(<MobileThreadResponseActions onReply={onReply} onReplyAll={vi.fn()} onForward={vi.fn()} />)
	const reply = screen.getByRole('button', { name: 'Reply to thread' })
	expect(slot).toContainElement(reply)
	reply.click()
	expect(onReply).toHaveBeenCalledOnce()
})
