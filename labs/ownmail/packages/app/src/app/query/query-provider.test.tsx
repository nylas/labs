// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnmailQueryProvider, queryProviderTestApi } from './query-provider.js'

const routerState = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('@tanstack/react-router', () => ({
	useRouterState: (options: { select: (state: { location: { pathname: string } }) => unknown }) =>
		options.select({ location: { pathname: routerState.pathname } }),
}))

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.useRealTimers()
	routerState.pathname = '/'
	history.replaceState(null, '', '/')
})

describe('server state version normalization', () => {
	it('accepts scoped domain versions', () => {
		expect(
			queryProviderTestApi.normalizeVersions({ domains: { mail: 3, contacts: 2, calendar: 1 } }),
		).toEqual({
			mail: 3,
			contacts: 2,
			calendar: 1,
		})
	})

	it('keeps compatibility with the legacy shared version', () => {
		expect(queryProviderTestApi.normalizeVersions({ version: 7 })).toEqual({
			mail: 7,
			contacts: 7,
			calendar: 7,
		})
	})

	it('fails closed for malformed payloads', () => {
		expect(queryProviderTestApi.normalizeVersions(null)).toBeNull()
		expect(queryProviderTestApi.normalizeVersions({ version: -1 })).toEqual({
			mail: 0,
			contacts: 0,
			calendar: 0,
		})
	})
})

describe('server state synchronization', () => {
	it('establishes a baseline and invalidates only domains whose versions changed', async () => {
		routerState.pathname = '/mail/f/inbox'
		history.replaceState(null, '', '/mail/f/inbox')
		vi.useFakeTimers()
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 2, contacts: 1, calendar: 3 } })))
			.mockImplementation(async () => {
				return new Response(JSON.stringify({ domains: { mail: 2, contacts: 1, calendar: 3 } }))
			})
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()

		const view = render(
			<OwnmailQueryProvider>
				<div>mail</div>
			</OwnmailQueryProvider>,
		)
		await act(async () => {})
		expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' })

		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		expect(fetchMock).toHaveBeenCalledTimes(2)
		const scoped = invalidate.mock.calls.slice(1).map(([options]) => options)
		expect(scoped).toHaveLength(2)
		expect(scoped[0]?.predicate?.({ queryKey: ['mail'] } as never)).toBe(true)
		expect(scoped[0]?.predicate?.({ queryKey: ['contacts'] } as never)).toBe(false)
		expect(scoped[1]?.predicate?.({ queryKey: ['calendar'] } as never)).toBe(true)

		await act(async () => vi.advanceTimersByTimeAsync(60_000))
		expect(fetchMock).toHaveBeenCalledTimes(8)
		expect(invalidate).toHaveBeenLastCalledWith({ refetchType: 'active' })

		view.unmount()
	})

	it('starts polling after in-app navigation enters a synchronized route', async () => {
		routerState.pathname = '/settings'
		vi.useFakeTimers()
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify({ domains: { mail: 1, contacts: 0, calendar: 0 } })))
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()

		const child = <div>route</div>
		const view = render(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		expect(fetchMock).not.toHaveBeenCalled()

		routerState.pathname = '/mail/f/inbox'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' })
	})

	it('revalidates active mail queries after a mail version change', async () => {
		routerState.pathname = '/mail/f/inbox'
		vi.useFakeTimers()
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 2, contacts: 1, calendar: 1 } })))
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()

		const view = render(
			<OwnmailQueryProvider>
				<div>mail</div>
			</OwnmailQueryProvider>,
		)
		await act(async () => {})
		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		await act(async () => vi.advanceTimersByTimeAsync(5_000))

		const mailInvalidations = invalidate.mock.calls.filter(
			([options]) => options?.predicate?.({ queryKey: ['mail'] } as never) === true,
		)
		expect(mailInvalidations).toHaveLength(3)
		view.unmount()
	})

	it('does not run delayed mail revalidation in a hidden tab', async () => {
		routerState.pathname = '/mail/f/inbox'
		vi.useFakeTimers()
		const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 2, contacts: 1, calendar: 1 } })))
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()

		const view = render(
			<OwnmailQueryProvider>
				<div>mail</div>
			</OwnmailQueryProvider>,
		)
		await act(async () => {})
		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		visibility.mockReturnValue('hidden')
		await act(async () => vi.advanceTimersByTimeAsync(5_000))

		const mailInvalidations = invalidate.mock.calls.filter(
			([options]) => options?.predicate?.({ queryKey: ['mail'] } as never) === true,
		)
		expect(mailInvalidations).toHaveLength(1)
		view.unmount()
	})

	it('skips unrelated routes, hidden tabs, malformed responses, and transient failures', async () => {
		routerState.pathname = '/settings'
		const fetchMock = vi.spyOn(globalThis, 'fetch')
		render(
			<OwnmailQueryProvider>
				<div>home</div>
			</OwnmailQueryProvider>,
		)
		expect(fetchMock).not.toHaveBeenCalled()
		cleanup()

		routerState.pathname = '/contacts'
		history.replaceState(null, '', '/contacts')
		vi.useFakeTimers()
		const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
		render(
			<OwnmailQueryProvider>
				<div>contacts</div>
			</OwnmailQueryProvider>,
		)
		expect(fetchMock).not.toHaveBeenCalled()

		visibility.mockReturnValue('visible')
		fetchMock
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockResolvedValueOnce(new Response(JSON.stringify([])))
			.mockRejectedValueOnce(new Error('offline'))
		await act(async () => vi.advanceTimersByTimeAsync(30_000))
		expect(fetchMock).toHaveBeenCalledTimes(3)
	})
})
