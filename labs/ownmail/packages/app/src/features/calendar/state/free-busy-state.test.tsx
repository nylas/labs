// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_BUSY_FAILED_MESSAGE, FREE_BUSY_RATE_LIMITED_MESSAGE } from '../lib/free-busy.js'

const { getFreeBusy } = vi.hoisted(() => ({ getFreeBusy: vi.fn() }))
vi.mock('#features/calendar/server/calendar-fns', () => ({ getFreeBusy }))

import { resetAccountScope, setAccountScope } from '#app/lib/account-scope'
import { applyCalendarResourceEffect, calendarKeys } from './calendar-state.js'
import {
	FREE_BUSY_SETTLE_MS,
	FREE_BUSY_STALE_MS,
	freeBusyErrorMessage,
	freeBusyKeys,
	useFreeBusy,
} from './free-busy-state.js'

const WEEK_A = { start: 1_800_000_000, end: 1_800_600_000 }
const WEEK_B = { start: 1_800_600_000, end: 1_801_200_000 }
const busy = (email: string, start: number) => ({
	email,
	busy: [{ start, end: start + 3600 }],
	unavailable: false,
})

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
)
type Props = { emails: string[]; range: { start: number; end: number } | null }
const setup = (initialProps: Props) =>
	renderHook(({ emails, range }: Props) => useFreeBusy(emails, range), { wrapper, initialProps })
/** Lets the settle timer fire, then the request it starts resolve and be delivered. */
const settle = async (ms = FREE_BUSY_SETTLE_MS) => {
	await act(() => vi.advanceTimersByTimeAsync(ms))
	await act(() => vi.advanceTimersByTimeAsync(0))
	await act(() => vi.advanceTimersByTimeAsync(0))
}

beforeEach(() => {
	vi.useFakeTimers()
	client = new QueryClient()
	getFreeBusy
		.mockReset()
		.mockImplementation(async ({ data }: { data: { start: number; emails: string[] } }) => ({
			people: data.emails.map((email) => busy(email, data.start)),
		}))
})
afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe('looking up colleagues busy times', () => {
	it('asks the provider once for everyone, after the choice has settled', async () => {
		const { result } = setup({ emails: ['ada@example.com', 'bob@example.com'], range: WEEK_A })
		expect(getFreeBusy).not.toHaveBeenCalled()
		expect(result.current.loading).toBe(true)
		expect(result.current.people).toEqual([])

		await settle()
		expect(getFreeBusy).toHaveBeenCalledExactlyOnceWith({
			data: { ...WEEK_A, emails: ['ada@example.com', 'bob@example.com'] },
		})
		expect(result.current.people).toEqual([
			busy('ada@example.com', WEEK_A.start),
			busy('bob@example.com', WEEK_A.start),
		])
		expect(result.current.loading).toBe(false)
		expect(result.current.error).toBeNull()
	})

	it('does not call the provider for every intermediate state while people are added or weeks are paged', async () => {
		const { rerender } = setup({ emails: ['ada@example.com'], range: WEEK_A })
		await settle(FREE_BUSY_SETTLE_MS - 100)
		rerender({ emails: ['ada@example.com', 'bob@example.com'], range: WEEK_A })
		await settle(FREE_BUSY_SETTLE_MS - 100)
		rerender({ emails: ['ada@example.com', 'bob@example.com'], range: WEEK_B })
		await settle(FREE_BUSY_SETTLE_MS - 100)
		expect(getFreeBusy).not.toHaveBeenCalled()
		await settle(100)
		expect(getFreeBusy).toHaveBeenCalledExactlyOnceWith({
			data: { ...WEEK_B, emails: ['ada@example.com', 'bob@example.com'] },
		})
	})

	it('shows a week already looked up at once, without asking again', async () => {
		const { result, rerender } = setup({ emails: ['ada@example.com'], range: WEEK_A })
		await settle()
		rerender({ emails: ['ada@example.com'], range: WEEK_B })
		// A week not looked up yet shows nothing: last week's times are never drawn in its place.
		expect(result.current.people).toEqual([])
		expect(result.current.loading).toBe(true)
		await settle()
		expect(result.current.people).toEqual([busy('ada@example.com', WEEK_B.start)])
		expect(getFreeBusy).toHaveBeenCalledTimes(2)

		rerender({ emails: ['ada@example.com'], range: WEEK_A })
		// Cached: correct immediately, not reported as loading, and not requested again.
		expect(result.current.people).toEqual([busy('ada@example.com', WEEK_A.start)])
		expect(result.current.loading).toBe(false)
		await settle()
		expect(getFreeBusy).toHaveBeenCalledTimes(2)

		// A cached range is refreshed once it is older than the reuse window.
		await settle(FREE_BUSY_STALE_MS)
		rerender({ emails: ['ada@example.com'], range: WEEK_B })
		await settle()
		expect(getFreeBusy).toHaveBeenCalledTimes(3)
	})

	it('makes no request when nobody is chosen or there is no time grid to draw on', async () => {
		const { result, rerender } = setup({ emails: [], range: WEEK_A })
		await settle()
		rerender({ emails: ['ada@example.com'], range: null })
		await settle()
		expect(getFreeBusy).not.toHaveBeenCalled()
		expect(result.current).toMatchObject({ people: [], loading: false, error: null })
	})

	it('hides results and errors once the last person is removed', async () => {
		getFreeBusy.mockRejectedValueOnce(new Error(FREE_BUSY_RATE_LIMITED_MESSAGE))
		const { result, rerender } = setup({ emails: ['ada@example.com'], range: WEEK_A })
		await settle()
		expect(result.current.error).toBe(FREE_BUSY_RATE_LIMITED_MESSAGE)
		rerender({ emails: [], range: WEEK_A })
		expect(result.current).toMatchObject({ people: [], loading: false, error: null })
	})

	it('reports a rate limit generically and does not retry on its own', async () => {
		getFreeBusy.mockRejectedValue(new Error(FREE_BUSY_RATE_LIMITED_MESSAGE))
		const { result } = setup({ emails: ['ada@example.com'], range: WEEK_A })
		await settle()
		await settle(60_000)
		expect(getFreeBusy).toHaveBeenCalledOnce()
		expect(result.current.error).toBe(FREE_BUSY_RATE_LIMITED_MESSAGE)
		expect(result.current.loading).toBe(false)

		// Trying again is the person's choice.
		getFreeBusy.mockResolvedValueOnce({ people: [busy('ada@example.com', WEEK_A.start)] })
		await act(async () => {
			await result.current.retry()
		})
		await settle(0)
		expect(getFreeBusy).toHaveBeenCalledTimes(2)
		expect(result.current.error).toBeNull()
		expect(result.current.people).toHaveLength(1)
	})

	it('never shows an unexpected error message: anything unknown becomes the generic failure', () => {
		expect(freeBusyErrorMessage(new Error('ECONNRESET talking to ada@example.com'))).toBe(
			FREE_BUSY_FAILED_MESSAGE,
		)
		expect(freeBusyErrorMessage('boom')).toBe(FREE_BUSY_FAILED_MESSAGE)
		expect(freeBusyErrorMessage(new Error(FREE_BUSY_RATE_LIMITED_MESSAGE))).toBe(
			FREE_BUSY_RATE_LIMITED_MESSAGE,
		)
	})
})

describe('the availability cache', () => {
	it('shares one entry for the same people in any order', () => {
		expect(freeBusyKeys.range(1, 2, ['b@x.co', 'a@x.co'])).toEqual(
			freeBusyKeys.range(1, 2, ['a@x.co', 'b@x.co']),
		)
		expect(freeBusyKeys.range(1, 2, ['a@x.co'])).not.toEqual(freeBusyKeys.range(1, 3, ['a@x.co']))
	})

	it('is partitioned by account, because each inbox looks people up on its own grant', () => {
		const key = freeBusyKeys.range(WEEK_A.start, WEEK_A.end, ['ada@example.com'])
		setAccountScope('first@example.com')
		const first = freeBusyKeys.range(WEEK_A.start, WEEK_A.end, ['ada@example.com'])
		client.setQueryData(first, [busy('ada@example.com', WEEK_A.start)])
		setAccountScope('second@example.com')
		const second = freeBusyKeys.range(WEEK_A.start, WEEK_A.end, ['ada@example.com'])
		resetAccountScope()
		expect(first).toContain('first@example.com')
		expect(second).not.toEqual(first)
		expect(key).not.toEqual(first)
		// The second inbox misses the first inbox's entry.
		expect(client.getQueryData(second)).toBeUndefined()
	})

	it('is kept apart from calendar data, so calendar updates neither rewrite nor refetch it', () => {
		expect(freeBusyKeys.all[0]).not.toBe(calendarKeys.all[0])
		const key = freeBusyKeys.range(WEEK_A.start, WEEK_A.end, ['ada@example.com'])
		const people = [busy('ada@example.com', WEEK_A.start)]
		client.setQueryData(key, people)
		// A calendar being renamed sweeps every entry under the calendar root.
		applyCalendarResourceEffect(client, { type: 'updated', calendar: { id: 'work', name: 'Work' } })
		expect(client.getQueryData(key)).toBe(people)
	})
})
