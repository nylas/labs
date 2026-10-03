// @vitest-environment jsdom

// The composer's code is fetched after startup. These tests pin down the two
// promises that make that safe: a composer opened before the code arrives still
// opens, and once the idle warm-up has run, pressing C renders the composer in
// the same commit as the request (no extra suspense round trip, which would eat
// into the 100 ms an interaction has to feel instant).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '#shared/components/Toaster'

vi.mock('#server/fns', () => ({
	getDraft: vi.fn(),
	saveDraft: vi.fn(),
	sendDraft: vi.fn(),
	saveComposeRecipients: vi.fn(),
	deleteDraft: vi.fn(),
	markThreadRead: vi.fn(),
	updateThreadState: vi.fn(),
}))
vi.mock('#shared/components/RecipientInput', () => ({
	RecipientInput: ({ id }: { id: string }) => <input id={id} aria-label="To" />,
}))
vi.mock('./MarkdownEditor.js', () => ({
	MarkdownEditor: ({ id }: { id: string }) => <textarea id={id} placeholder="Write your message..." />,
}))

import { ComposeProvider, useCompose } from './ComposeProvider.js'

let compose: ReturnType<typeof useCompose>
function Harness() {
	compose = useCompose()
	return null
}

function renderProvider() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ToastProvider>
				<ComposeProvider>
					<Harness />
				</ComposeProvider>
			</ToastProvider>
		</QueryClientProvider>,
	)
}

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

// Order matters: the module keeps the loaded composer once any test loads it.
describe('ComposeProvider before the composer code has loaded', () => {
	it('opens a composer requested before the code arrives, as soon as it arrives', async () => {
		renderProvider()
		await act(async () => {
			await compose.openCompose({ kind: 'new' })
		})
		expect(await screen.findByRole('dialog', { name: 'Compose message' })).toBeInTheDocument()
	})
})

describe('ComposeProvider idle warm-up', () => {
	it('fetches the composer when the browser is idle, and cancels that on unmount', () => {
		const requestIdleCallback = vi.fn(() => 7)
		const cancelIdleCallback = vi.fn()
		vi.stubGlobal('requestIdleCallback', requestIdleCallback)
		vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)
		const view = renderProvider()
		expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 })
		view.unmount()
		expect(cancelIdleCallback).toHaveBeenCalledWith(7)
	})

	it('falls back to a timer where idle callbacks are unsupported', async () => {
		vi.stubGlobal('requestIdleCallback', undefined)
		vi.useFakeTimers()
		renderProvider()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500)
		})
		vi.useRealTimers()
		// Warmed: the composer renders in the same commit that opens it.
		await act(async () => {
			await compose.openCompose({ kind: 'new' })
		})
		expect(screen.getByRole('dialog', { name: 'Compose message' })).toBeInTheDocument()
	})

	it('clears the fallback timer on unmount', () => {
		vi.stubGlobal('requestIdleCallback', undefined)
		const clearTimeout = vi.spyOn(window, 'clearTimeout')
		renderProvider().unmount()
		expect(clearTimeout).toHaveBeenCalled()
	})
})
