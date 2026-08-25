// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { MobileThreadResponseActions } from './ThreadResponseActions.js'

afterEach(cleanup)

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
