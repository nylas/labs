// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JumpToNewPill, NEW_MESSAGE_ATTR, useNewBelowViewport } from './JumpToNewPill.js'

afterEach(() => {
	cleanup()
	document.body.replaceChildren()
	vi.unstubAllGlobals()
})

describe('JumpToNewPill', () => {
	it('is the glass "{n} more new" pill of board 03 with a 44px target', async () => {
		const user = userEvent.setup()
		const onJump = vi.fn()
		render(<JumpToNewPill count={2} onJump={onJump} />)
		const button = screen.getByRole('button', { name: '2 more new' })
		// Fixed 16px above the mobile bar (the 44px target centres the 36px pill), phone only.
		expect(button).toHaveClass(
			'fixed',
			'left-1/2',
			'-translate-x-1/2',
			'h-11',
			'md:hidden',
			'bottom-[calc(var(--mobile-tab-bar-height)+var(--safe-area-bottom)+0.75rem)]',
		)
		const pill = button.querySelector('span')
		expect(pill).toHaveClass('glass-panel', 'h-9', 'px-hairline', 'text-[13px]', 'font-semibold')
		expect(pill).toHaveStyle({ borderRadius: '999px' })
		expect(button.querySelector('svg')).toHaveClass('size-4', 'text-cta-icon')
		await user.click(button)
		expect(onJump).toHaveBeenCalledOnce()
	})

	it('renders nothing when nothing new is below', () => {
		const { rerender } = render(<JumpToNewPill count={0} onJump={vi.fn()} />)
		expect(screen.queryByRole('button')).toBeNull()
		rerender(<JumpToNewPill count={-1} onJump={vi.fn()} />)
		expect(screen.queryByRole('button')).toBeNull()
	})
})

/** Moves a message so it starts at `top` in the viewport. */
function place(message: HTMLElement | undefined, top: number) {
	if (message) message.getBoundingClientRect = () => ({ top }) as DOMRect
}

/** A 600px scroll region from y=0 whose new messages start at the given tops. */
function scrollRegion(tops: number[], scrollPaddingBottom = '') {
	const root = document.createElement('div')
	root.style.scrollPaddingBottom = scrollPaddingBottom
	root.getBoundingClientRect = () => ({ bottom: 600 }) as DOMRect
	const old = document.createElement('article')
	root.append(old)
	const messages = tops.map((top) => {
		const message = document.createElement('article')
		message.setAttribute(NEW_MESSAGE_ATTR, '')
		message.getBoundingClientRect = () => ({ top }) as DOMRect
		message.scrollIntoView = vi.fn()
		root.append(message)
		return message
	})
	document.body.append(root)
	return { root, messages }
}

describe('useNewBelowViewport', () => {
	it('counts new messages that start below the region, net of what a pinned bar covers', () => {
		// 60px of the region sits under the mobile bar, so a message starting at 560 is not yet seen.
		const { root } = scrollRegion([200, 560, 900], '60px')
		const { result } = renderHook(() => useNewBelowViewport(root))
		expect(result.current.count).toBe(2)
	})

	it('counts again on scroll, resize and a new revision, and stops listening when unmounted', () => {
		const { root, messages } = scrollRegion([200, 700, 900])
		const { result, rerender, unmount } = renderHook(({ revision }) => useNewBelowViewport(root, revision), {
			initialProps: { revision: 0 },
		})
		expect(result.current.count).toBe(2)

		place(messages[1], 300)
		act(() => root.dispatchEvent(new Event('scroll')))
		expect(result.current.count).toBe(1)

		place(messages[2], 400)
		act(() => window.dispatchEvent(new Event('resize')))
		expect(result.current.count).toBe(0)

		const added = document.createElement('article')
		added.setAttribute(NEW_MESSAGE_ATTR, '')
		added.getBoundingClientRect = () => ({ top: 1200 }) as DOMRect
		root.append(added)
		rerender({ revision: 1 })
		expect(result.current.count).toBe(1)

		const remove = vi.spyOn(root, 'removeEventListener')
		unmount()
		expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
	})

	it('scrolls the next new message below to the top, smoothly unless motion is reduced', () => {
		const { root, messages } = scrollRegion([200, 700, 900])
		const { result } = renderHook(() => useNewBelowViewport(root))
		act(() => result.current.jump())
		expect(messages[0]?.scrollIntoView).not.toHaveBeenCalled()
		expect(messages[1]?.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })

		vi.stubGlobal('matchMedia', (query: string) => ({
			matches: query === '(prefers-reduced-motion: reduce)',
		}))
		act(() => result.current.jump())
		expect(messages[1]?.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' })
		expect(messages[2]?.scrollIntoView).not.toHaveBeenCalled()
	})

	it('does nothing without a region or anything new below it', () => {
		const { result, rerender } = renderHook(({ root }) => useNewBelowViewport(root), {
			initialProps: { root: null as HTMLElement | null },
		})
		expect(result.current.count).toBe(0)
		act(() => result.current.jump())

		const { root, messages } = scrollRegion([100])
		rerender({ root })
		expect(result.current.count).toBe(0)
		act(() => result.current.jump())
		expect(messages[0]?.scrollIntoView).not.toHaveBeenCalled()

		// Losing the region clears the count.
		const below = scrollRegion([900])
		rerender({ root: below.root })
		expect(result.current.count).toBe(1)
		rerender({ root: null })
		expect(result.current.count).toBe(0)
	})
})
