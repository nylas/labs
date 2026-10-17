// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailMessage } from '../state/mail-queries.js'

const { getDevMockThreadSummary } = vi.hoisted(() => ({ getDevMockThreadSummary: vi.fn() }))
vi.mock('../server/thread-summary-mock.js', () => ({
	DEV_MOCK_SUMMARY_MESSAGE_ID: 'msg-roadmap-14',
	getDevMockThreadSummary: () => getDevMockThreadSummary(),
}))

const { mockModeThreadSummaryProvider, ThreadSummaryContext, ThreadSummaryProvider, useThreadSummary } =
	await import('./thread-summary.js')
type ThreadSummarySource = import('./thread-summary.js').ThreadSummarySource

afterEach(cleanup)

const message = (id: string): MailMessage => ({ id })
const NEW = [message('msg-roadmap-12'), message('msg-roadmap-13'), message('msg-roadmap-14')]

function withProvider(provider: ThreadSummarySource | null) {
	return ({ children }: { children: React.ReactNode }) => (
		<ThreadSummaryProvider provider={provider}>{children}</ThreadSummaryProvider>
	)
}

/** A provider whose answers the test releases one by one. */
function deferredProvider() {
	const pending: Array<{ messages: MailMessage[]; resolve: (bullets: string[] | null) => void }> = []
	const provider: ThreadSummarySource = {
		summarize: (messages) =>
			new Promise((resolve) => {
				pending.push({ messages, resolve })
			}),
	}
	return { provider, pending }
}

describe('mockModeThreadSummaryProvider', () => {
	it('asks the server about the mock roadmap thread only', async () => {
		getDevMockThreadSummary.mockReset().mockResolvedValue(['From the mock layer.'])
		await expect(mockModeThreadSummaryProvider.summarize(NEW)).resolves.toEqual(['From the mock layer.'])
		expect(getDevMockThreadSummary).toHaveBeenCalledOnce()
		// Real mail never reaches the server: there is nothing to say about it.
		await expect(mockModeThreadSummaryProvider.summarize([message('real-message')])).resolves.toBeNull()
		expect(getDevMockThreadSummary).toHaveBeenCalledOnce()
	})
})

describe('ThreadSummaryProvider', () => {
	it('defaults to the mock-mode provider in development builds and can be turned off', () => {
		const { result } = renderHook(() => useContext(ThreadSummaryContext))
		expect(result.current).toBe(mockModeThreadSummaryProvider)

		const off = renderHook(() => useContext(ThreadSummaryContext), { wrapper: withProvider(null) })
		expect(off.result.current).toBeNull()
	})

	it('renders its children', () => {
		render(
			<ThreadSummaryProvider provider={null}>
				<p>Inside</p>
			</ThreadSummaryProvider>,
		)
		expect(screen.getByText('Inside')).toBeInTheDocument()
	})
})

describe('useThreadSummary', () => {
	it('is null without a provider and never asks for nothing', async () => {
		const summarize = vi.fn(async () => ['A line'])
		const none = renderHook(() => useThreadSummary(NEW), { wrapper: withProvider(null) })
		expect(none.result.current).toBeNull()

		const empty = renderHook(() => useThreadSummary([]), { wrapper: withProvider({ summarize }) })
		await act(async () => {})
		expect(empty.result.current).toBeNull()
		expect(summarize).not.toHaveBeenCalled()
	})

	it('returns the trimmed, non-empty lines the provider gives for these messages', async () => {
		const summarize = vi.fn(async () => ['  First.  ', '', 'Second.'])
		const { result } = renderHook(() => useThreadSummary(NEW), { wrapper: withProvider({ summarize }) })
		await waitFor(() => expect(result.current).toEqual(['First.', 'Second.']))
		expect(summarize).toHaveBeenCalledWith(NEW)
	})

	it('keeps only the lines that are text, each in its place, repeats included', async () => {
		const summarize = vi.fn(async () => ['Same.', 42, null, 'Same.'] as unknown as string[])
		const { result } = renderHook(() => useThreadSummary(NEW), { wrapper: withProvider({ summarize }) })
		await waitFor(() => expect(result.current).toEqual(['Same.', 'Same.']))
	})

	it('stays null when the provider throws before it answers or answers with something else', async () => {
		const throwing = renderHook(() => useThreadSummary(NEW), {
			wrapper: withProvider({
				summarize: () => {
					throw new Error('not configured')
				},
			}),
		})
		const odd = renderHook(() => useThreadSummary(NEW), {
			wrapper: withProvider({ summarize: () => 'One line.' as unknown as Promise<string[]> }),
		})
		await act(async () => {})
		expect(throwing.result.current).toBeNull()
		expect(odd.result.current).toBeNull()
	})

	it('stays null when the provider has nothing to say or fails', async () => {
		const silent = renderHook(() => useThreadSummary(NEW), {
			wrapper: withProvider({ summarize: async () => null }),
		})
		const blank = renderHook(() => useThreadSummary(NEW), {
			wrapper: withProvider({ summarize: async () => ['   '] }),
		})
		const failing = renderHook(() => useThreadSummary(NEW), {
			wrapper: withProvider({ summarize: async () => Promise.reject(new Error('offline')) }),
		})
		await act(async () => {})
		expect(silent.result.current).toBeNull()
		expect(blank.result.current).toBeNull()
		expect(failing.result.current).toBeNull()
	})

	it('never shows one set of messages the summary of another', async () => {
		const { provider, pending } = deferredProvider()
		const { result, rerender } = renderHook(({ messages }) => useThreadSummary(messages), {
			initialProps: { messages: NEW },
			wrapper: withProvider(provider),
		})
		// The provider is asked on the next tick, so a synchronous throw cannot escape the effect.
		await act(async () => {})
		expect(pending).toHaveLength(1)
		await act(async () => pending[0]?.resolve(['About the roadmap.']))
		expect(result.current).toEqual(['About the roadmap.'])

		// Another thread: its own summary or nothing, never the roadmap's.
		rerender({ messages: [message('other')] })
		expect(result.current).toBeNull()
		// The answer for a set the reader has already left is dropped.
		rerender({ messages: [message('third')] })
		await act(async () => {})
		expect(pending.map((call) => call.messages[0]?.id)).toEqual(['msg-roadmap-12', 'other', 'third'])
		await act(async () => pending[1]?.resolve(['About the other thread.']))
		expect(result.current).toBeNull()
		await act(async () => pending[2]?.resolve(['About the third thread.']))
		expect(result.current).toEqual(['About the third thread.'])
	})
})
