// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	TOAST_DURATION_MS,
	TOAST_EXIT_MS,
	TOAST_WITH_ACTION_DURATION_MS,
	ToastProvider,
	useToast,
} from './Toaster.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

function Trigger({ message, onUndo }: { message: string; onUndo?: () => void }) {
	const { showToast } = useToast()
	return (
		<button
			type="button"
			onClick={() =>
				showToast({ message, ...(onUndo ? { action: { label: 'Undo', onAction: onUndo } } : {}) })
			}
		>
			{`show ${message}`}
		</button>
	)
}

describe('ToastProvider', () => {
	it('announces a confirmation politely on floating glass and clears it after a short while', () => {
		render(
			<ToastProvider>
				<Trigger message="Saved" />
			</ToastProvider>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'show Saved' }))
		const region = screen.getByRole('status')
		expect(region).toHaveAttribute('aria-live', 'polite')
		expect(screen.getByText('Saved').parentElement).toHaveClass('glass-panel', 'toast')

		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
		// It fades out first (the exit is shorter than the entrance), then leaves the tree.
		expect(screen.getByText('Saved').parentElement).toHaveAttribute('data-leaving', 'true')
		act(() => vi.advanceTimersByTime(TOAST_EXIT_MS))
		expect(screen.queryByText('Saved')).not.toBeInTheDocument()
	})

	it('keeps an Undo on screen long enough to reach, and runs it once', () => {
		const onUndo = vi.fn()
		render(
			<ToastProvider>
				<Trigger message="Archived" onUndo={onUndo} />
			</ToastProvider>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'show Archived' }))
		act(() => vi.advanceTimersByTime(TOAST_DURATION_MS))
		expect(screen.getByText('Archived').parentElement).not.toHaveAttribute('data-leaving')

		fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
		expect(onUndo).toHaveBeenCalledTimes(1)
		act(() => vi.advanceTimersByTime(TOAST_EXIT_MS))
		expect(screen.queryByText('Archived')).not.toBeInTheDocument()
	})

	it('lets a newer toast replace the current one, so Undo always belongs to the last action', () => {
		render(
			<ToastProvider>
				<Trigger message="Archived" onUndo={() => {}} />
				<Trigger message="Moved to Trash" />
			</ToastProvider>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'show Archived' }))
		act(() => vi.advanceTimersByTime(TOAST_WITH_ACTION_DURATION_MS - 1))
		fireEvent.click(screen.getByRole('button', { name: 'show Moved to Trash' }))
		expect(screen.queryByText('Archived')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
		// The replaced toast's timer no longer applies to the new one.
		act(() => vi.advanceTimersByTime(1))
		expect(screen.getByText('Moved to Trash').parentElement).not.toHaveAttribute('data-leaving')
	})

	it('does nothing outside a provider instead of throwing', () => {
		render(<Trigger message="Lost" />)
		fireEvent.click(screen.getByRole('button', { name: 'show Lost' }))
		expect(screen.queryByText('Lost')).not.toBeInTheDocument()
	})
})
