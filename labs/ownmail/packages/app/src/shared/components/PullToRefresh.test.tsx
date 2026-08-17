// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PullToRefresh, RefreshButton } from './PullToRefresh.js'

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

function touch(clientX: number, clientY: number) {
	return { clientX, clientY, identifier: 1, target: document.body }
}

function renderPull(
	onRefresh = vi.fn().mockResolvedValue(undefined),
	options: { scrollTop?: number; interactive?: boolean; label?: string } = {},
) {
	const scroller = document.createElement('div')
	scroller.scrollTop = options.scrollTop ?? 0
	const scrollRef = { current: scroller }
	const view = render(
		<PullToRefresh onRefresh={onRefresh} scrollRef={scrollRef} label={options.label}>
			<div data-testid="content">
				{options.interactive ? <button type="button">Child action</button> : 'Content'}
			</div>
		</PullToRefresh>,
	)
	const root = view.getByTestId('content').parentElement as HTMLElement
	return { ...view, root, onRefresh, scroller }
}

function gesture(root: HTMLElement, endX: number, endY: number) {
	fireEvent.touchStart(root, { touches: [touch(10, 10)] })
	fireEvent.touchMove(root, { touches: [touch(endX, endY)], cancelable: true })
	fireEvent.touchEnd(root, { touches: [] })
}

describe('PullToRefresh', () => {
	it('refreshes once after a vertical pull crosses the threshold', async () => {
		const { root, onRefresh } = renderPull()
		gesture(root, 12, 150)

		expect(root).toHaveAttribute('aria-busy', 'true')
		expect(screen.getByRole('status')).toHaveTextContent('Refreshing…')
		await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Updated'))
		expect(root).not.toHaveAttribute('aria-busy')
	})

	it('shows pull progress, caps resistance, and does not refresh below the threshold', () => {
		const { root, onRefresh } = renderPull()
		fireEvent.touchStart(root, { touches: [touch(10, 10)] })
		fireEvent.touchMove(root, { touches: [touch(10, 14)], cancelable: true })
		expect(screen.getByText('Pull to refresh')).toBeInTheDocument()
		fireEvent.touchMove(root, { touches: [touch(10, 110)], cancelable: true })
		expect(screen.getByText('Pull to refresh')).toHaveAttribute('aria-hidden', 'true')
		fireEvent.touchMove(root, { touches: [touch(10, 500)], cancelable: true })
		expect(screen.getByText('Release to refresh')).toHaveStyle({ '--pull-distance': '88px' })
		fireEvent.touchCancel(root)
		expect(onRefresh).not.toHaveBeenCalled()
	})

	it('ignores horizontal, upward, incomplete, and multi-touch gestures', () => {
		const { root, onRefresh } = renderPull()
		gesture(root, 150, 12)
		gesture(root, 10, -100)
		fireEvent.touchStart(root, { touches: [] })
		fireEvent.touchMove(root, { touches: [] })
		fireEvent.touchEnd(root)
		fireEvent.touchStart(root, { touches: [touch(10, 10), touch(20, 20)] })
		fireEvent.touchMove(root, { touches: [touch(10, 160), touch(20, 170)] })
		fireEvent.touchEnd(root)
		expect(onRefresh).not.toHaveBeenCalled()
	})

	it('uses its own surface as the scroller and leaves non-cancelable moves alone', () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined)
		const { getByTestId } = render(
			<PullToRefresh onRefresh={onRefresh}>
				<div data-testid="fallback-content">Content</div>
			</PullToRefresh>,
		)
		const root = getByTestId('fallback-content').parentElement as HTMLElement
		fireEvent.touchStart(root, { touches: [touch(10, 10)] })
		fireEvent.touchMove(root, { touches: [touch(10, 40)], cancelable: false })
		fireEvent.touchMove(root, { touches: [touch(10, 5)], cancelable: true })
		fireEvent.touchEnd(root)
		expect(onRefresh).not.toHaveBeenCalled()
	})

	it('does not claim touches away from the scroll top', () => {
		const scrolled = renderPull(undefined, { scrollTop: 1 })
		gesture(scrolled.root, 10, 160)
		expect(scrolled.onRefresh).not.toHaveBeenCalled()
	})

	it('allows a pull to start on an interactive row but preserves ordinary taps', async () => {
		const interactive = renderPull(undefined, { interactive: true })
		const button = screen.getByRole('button', { name: 'Child action' })
		gesture(button, 10, 160)
		await waitFor(() => expect(interactive.onRefresh).toHaveBeenCalledOnce())

		const onClick = vi.fn()
		button.addEventListener('click', onClick)
		fireEvent.touchStart(button, { touches: [touch(10, 10)] })
		fireEvent.touchEnd(button, { touches: [] })
		fireEvent.click(button)
		expect(onClick).toHaveBeenCalledOnce()
	})

	it('suppresses the synthetic click after an interactive row becomes a vertical drag', () => {
		const onClick = vi.fn()
		render(
			<PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)}>
				<a href="/message" onClick={onClick}>
					Message row
				</a>
			</PullToRefresh>,
		)
		const link = screen.getByRole('link', { name: 'Message row' })
		fireEvent.touchStart(link, { touches: [touch(10, 10)] })
		fireEvent.touchMove(link, { touches: [touch(10, 40)], cancelable: true })
		fireEvent.touchEnd(link, { touches: [] })
		fireEvent.click(link)
		expect(onClick).not.toHaveBeenCalled()
	})

	it('does not claim a pull while the user has selected text', () => {
		vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected text' } as Selection)
		const { root, onRefresh } = renderPull()
		gesture(root, 10, 160)
		expect(onRefresh).not.toHaveBeenCalled()
	})

	it('does not claim text-entry gestures', () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined)
		render(
			<PullToRefresh onRefresh={onRefresh}>
				<input aria-label="Editable value" />
			</PullToRefresh>,
		)
		gesture(screen.getByRole('textbox', { name: 'Editable value' }), 10, 160)
		expect(onRefresh).not.toHaveBeenCalled()
	})

	it('reports a generic refresh failure and supports the keyboard action', async () => {
		const onRefresh = vi.fn().mockRejectedValue(new Error('sensitive upstream detail'))
		renderPull(onRefresh, { label: 'Refresh mailbox' })
		fireEvent.click(screen.getByRole('button', { name: 'Refresh mailbox' }))

		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent(
				'Could not refresh. Check your connection, then try again.',
			),
		)
		expect(screen.getByRole('status')).not.toHaveTextContent('sensitive upstream detail')
	})

	it('coalesces refresh attempts while a request is in flight', async () => {
		let resolveRefresh: (() => void) | undefined
		const onRefresh = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveRefresh = resolve
				}),
		)
		renderPull(onRefresh)
		const action = screen.getByRole('button', { name: 'Refresh' })
		fireEvent.click(action)
		fireEvent.click(action)
		expect(onRefresh).toHaveBeenCalledTimes(1)
		resolveRefresh?.()
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Updated'))
	})
})

describe('RefreshButton', () => {
	it('exposes an app-sized refresh action and its busy state', () => {
		const onRefresh = vi.fn()
		const { rerender } = render(<RefreshButton onRefresh={onRefresh} label="Refresh contacts" />)
		const button = screen.getByRole('button', { name: 'Refresh contacts' })
		fireEvent.click(button)
		expect(onRefresh).toHaveBeenCalledOnce()
		expect(button).toHaveClass('h-11', 'w-11')

		rerender(<RefreshButton onRefresh={onRefresh} label="Refresh contacts" refreshing />)
		expect(screen.getByRole('button', { name: 'Refreshing refresh contacts' })).toBeDisabled()
	})

	it('uses the default accessible label', () => {
		render(<RefreshButton onRefresh={() => undefined} />)
		expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
	})

	it('announces async refresh failures without exposing provider details', async () => {
		render(<RefreshButton onRefresh={() => Promise.reject(new Error('provider detail'))} />)
		fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
		expect(screen.getByRole('status')).toHaveTextContent('Refreshing…')
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent(
				'Could not refresh. Check your connection, then try again.',
			),
		)
		expect(screen.getByRole('status')).not.toHaveTextContent('provider detail')
	})

	it('disables and spins while its own refresh promise is pending', async () => {
		let resolveRefresh: (() => void) | undefined
		const onRefresh = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveRefresh = resolve
				}),
		)
		render(<RefreshButton onRefresh={onRefresh} label="Refresh contacts" />)
		fireEvent.click(screen.getByRole('button', { name: 'Refresh contacts' }))
		const pendingButton = screen.getByRole('button', { name: 'Refreshing refresh contacts' })
		expect(pendingButton).toBeDisabled()
		expect(pendingButton.querySelector('svg')).toHaveClass('animate-spin')
		fireEvent.click(pendingButton)
		expect(onRefresh).toHaveBeenCalledOnce()

		resolveRefresh?.()
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Updated'))
		expect(screen.getByRole('button', { name: 'Refresh contacts' })).toBeEnabled()
	})
})
