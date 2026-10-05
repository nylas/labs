// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAccountScope } from '../lib/account-scope.js'
import { documentNavigation } from '../lib/account-switch.js'
import { readSwitchingTo, setSwitchingTo } from '../lib/account-switch-status.js'
import { OwnmailQueryProvider, queryProviderTestApi } from './query-provider.js'

const routerState = vi.hoisted(() => ({
	pathname: '/',
	navigate: vi.fn(async (_options: { to: string }) => {}),
	invalidate: vi.fn(async () => {}),
	clearCache: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
	useRouter: () => ({
		state: { location: { pathname: routerState.pathname } },
		navigate: routerState.navigate,
		invalidate: routerState.invalidate,
		clearCache: routerState.clearCache,
	}),
	useRouterState: (options: { select: (state: { location: { pathname: string } }) => unknown }) =>
		options.select({ location: { pathname: routerState.pathname } }),
}))
const getMailboxInfo = vi.hoisted(() => vi.fn())
vi.mock('#server/fns', () => ({ getMailboxInfo: () => getMailboxInfo() }))
vi.mock('#features/calendar/server/calendar-fns', () => ({}))

const ada = { email: 'ada@ownmail.com', appName: 'OwnMail', accounts: [] }
const grace = { email: 'grace@ownmail.com', appName: 'OwnMail', accounts: [] }

beforeEach(() => {
	getMailboxInfo.mockResolvedValue(ada)
})

afterEach(() => {
	cleanup()
	act(() => setSwitchingTo(null))
	resetAccountScope()
	vi.restoreAllMocks()
	vi.useRealTimers()
	getMailboxInfo.mockReset()
	routerState.navigate.mockClear()
	routerState.invalidate.mockClear()
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

	it('keeps one baseline while navigating between synchronized routes', async () => {
		// Opening a thread changes the pathname. That must not look like a new
		// session: a full refetch would race the optimistic read-state update.
		routerState.pathname = '/mail/f/inbox'
		vi.useFakeTimers()
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(
				async () => new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })),
			)
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()
		const child = <div>mail</div>
		const view = render(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		expect(invalidate).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledTimes(1)

		for (const pathname of ['/mail/f/inbox/t/thread-1', '/mail/f/inbox/t/thread-2', '/calendar/week']) {
			routerState.pathname = pathname
			view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
			await act(async () => {})
		}

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(invalidate).toHaveBeenCalledTimes(1)
		view.unmount()
	})

	it('compares versions instead of refetching everything when returning from an unsynchronized route', async () => {
		routerState.pathname = '/mail/f/inbox'
		vi.useFakeTimers()
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 2, calendar: 1 } })))
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()
		const child = <div>route</div>
		const view = render(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})

		routerState.pathname = '/settings'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		routerState.pathname = '/mail/f/inbox'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})

		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(invalidate).toHaveBeenCalledTimes(2)
		const [, returning] = invalidate.mock.calls.map(([options]) => options)
		expect(returning?.predicate?.({ queryKey: ['contacts'] } as never)).toBe(true)
		expect(returning?.predicate?.({ queryKey: ['mail'] } as never)).toBe(false)
		view.unmount()
	})

	it('checks for external changes as soon as a hidden tab becomes visible again', async () => {
		routerState.pathname = '/mail/f/inbox'
		vi.useFakeTimers()
		const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 2, contacts: 1, calendar: 1 } })))
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()
		const view = render(
			<OwnmailQueryProvider>
				<div>mail</div>
			</OwnmailQueryProvider>,
		)
		await act(async () => {})

		visibility.mockReturnValue('hidden')
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange'))
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)

		visibility.mockReturnValue('visible')
		await act(async () => {
			document.dispatchEvent(new Event('visibilitychange'))
		})
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(invalidate.mock.calls.at(-1)?.[0]?.predicate?.({ queryKey: ['mail'] } as never)).toBe(true)
		view.unmount()
	})

	it('does not overlap version checks when the network reconnects mid-request', async () => {
		routerState.pathname = '/mail/f/inbox'
		let resolveVersion: (response: Response) => void = () => {}
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					resolveVersion = resolve
				}),
		)
		vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()
		const view = render(
			<OwnmailQueryProvider>
				<div>mail</div>
			</OwnmailQueryProvider>,
		)
		await act(async () => {
			window.dispatchEvent(new Event('online'))
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)

		await act(async () => {
			resolveVersion(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
		})
		await act(async () => {
			window.dispatchEvent(new Event('online'))
		})
		expect(fetchMock).toHaveBeenCalledTimes(2)
		view.unmount()
	})

	it('re-arms cancelled mail revalidation when returning to mail from an unsynchronized route', async () => {
		// A mail bump's immediate refetch can still return pre-change data; the
		// delayed revalidations cover that. Leaving mail cancels them, and the
		// preserved watermark shows no change on return, so without re-arming,
		// stale mail would persist until the 60s fallback refresh.
		routerState.pathname = '/mail/f/inbox'
		vi.useFakeTimers()
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })))
			.mockImplementation(
				async () => new Response(JSON.stringify({ domains: { mail: 2, contacts: 1, calendar: 1 } })),
			)
		const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue()
		const mailInvalidations = () =>
			invalidate.mock.calls.filter(
				([options]) => options?.predicate?.({ queryKey: ['mail'] } as never) === true,
			).length
		const child = <div>route</div>
		const view = render(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		await act(async () => vi.advanceTimersByTimeAsync(10_000))
		expect(mailInvalidations()).toBe(1)

		routerState.pathname = '/settings'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		routerState.pathname = '/mail/f/inbox'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		expect(mailInvalidations()).toBe(2)

		await act(async () => vi.advanceTimersByTimeAsync(5_000))
		expect(mailInvalidations()).toBe(4)

		// Once the delayed revalidations have run, leaving and returning is quiet.
		routerState.pathname = '/settings'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		routerState.pathname = '/mail/f/inbox'
		view.rerender(<OwnmailQueryProvider>{child}</OwnmailQueryProvider>)
		await act(async () => {})
		expect(mailInvalidations()).toBe(4)
		view.unmount()
	})
})

describe('session changed outside this tab', () => {
	function versionsUnchanged() {
		return vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(
				async () => new Response(JSON.stringify({ domains: { mail: 1, contacts: 1, calendar: 1 } })),
			)
	}

	it('drops the previous inbox and loads the new one when the mailbox behind the session changes', async () => {
		routerState.pathname = '/mail/f/inbox/t/ada-thread'
		versionsUnchanged()
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		render(
			<OwnmailQueryProvider client={client}>
				<div>mail</div>
			</OwnmailQueryProvider>,
		)
		await waitFor(() => expect(getMailboxInfo).toHaveBeenCalledOnce())
		client.setQueryData(['mail', 'ada@ownmail.com', 'folders'], [{ id: 'inbox', name: 'Ada inbox' }])
		const order: string[] = []
		routerState.navigate.mockImplementation(async (options) => {
			// By now the previous inbox is unmounted and none of its data remains.
			order.push(`navigate:${options.to}:${readSwitchingTo()}:${client.getQueryCache().getAll().length}`)
		})
		routerState.invalidate.mockImplementation(async () => {
			order.push('invalidate')
		})

		// Another tab switched inbox (or the person signed in again): the same
		// cookie now answers for Grace. The tab notices on its next focus refetch.
		getMailboxInfo.mockResolvedValue(grace)
		await act(async () => {
			await client.refetchQueries({ queryKey: ['account', 'mailbox-info'] })
		})

		await waitFor(() => expect(readSwitchingTo()).toBeNull())
		expect(order).toEqual(['navigate:/:grace@ownmail.com:0', 'invalidate'])
		expect(client.getQueryData(['mail', 'ada@ownmail.com', 'folders'])).toBeUndefined()
	})

	it('leaves an in-app switch that is already under way alone', async () => {
		routerState.pathname = '/calendar/week'
		versionsUnchanged()
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		render(
			<OwnmailQueryProvider client={client}>
				<div>calendar</div>
			</OwnmailQueryProvider>,
		)
		await waitFor(() => expect(getMailboxInfo).toHaveBeenCalledOnce())

		// The switcher owns the transition and will load the next inbox itself.
		act(() => setSwitchingTo('grace@ownmail.com'))
		getMailboxInfo.mockResolvedValue(grace)
		await act(async () => {
			await client.refetchQueries({ queryKey: ['account', 'mailbox-info'] })
		})

		expect(routerState.navigate).not.toHaveBeenCalled()
		expect(readSwitchingTo()).toBe('grace@ownmail.com')
	})

	it('loads the destination as a document if the in-app reload fails', async () => {
		routerState.pathname = '/contacts/ada-contact'
		versionsUnchanged()
		const assign = vi.spyOn(documentNavigation, 'assign').mockImplementation(() => {})
		routerState.navigate.mockRejectedValueOnce(new Error('loader failed'))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		render(
			<OwnmailQueryProvider client={client}>
				<div>contacts</div>
			</OwnmailQueryProvider>,
		)
		await waitFor(() => expect(getMailboxInfo).toHaveBeenCalledOnce())

		getMailboxInfo.mockResolvedValue(grace)
		await act(async () => {
			await client.refetchQueries({ queryKey: ['account', 'mailbox-info'] })
		})

		// The loader stays up: nothing of the previous inbox may come back.
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/contacts'))
		expect(readSwitchingTo()).toBe('grace@ownmail.com')
	})

	it('does not watch the mailbox outside the synchronized sections', async () => {
		routerState.pathname = '/login'
		versionsUnchanged()
		render(
			<OwnmailQueryProvider>
				<div>login</div>
			</OwnmailQueryProvider>,
		)
		await act(async () => {})

		expect(getMailboxInfo).not.toHaveBeenCalled()
	})
})
