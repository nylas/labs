// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { type ReactNode, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_PREFERENCES_STORAGE_KEY } from '#app/preferences/user-preferences'
import {
	LIST_CLOCK_MS,
	ThreadListEnvironment,
	ThreadListGroupHeading,
	useSeen,
	useThreadListEnv,
	useThreadListEnvValue,
} from './ThreadListGroups.js'

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	window.localStorage.clear()
})

describe('the list environment', () => {
	it('reads the time and zone, and nobody as "you", outside a list', () => {
		const { result } = renderHook(() => useThreadListEnv())
		expect(result.current).toMatchObject({ owner: '', ownerFirstName: '', tz: expect.any(String) })
		expect(result.current.mutedIds.size).toBe(0)
		expect(Math.abs(result.current.now - Date.now())).toBeLessThan(5_000)
	})

	it('hands the rows beneath it one value', () => {
		const value = {
			owner: 'ada@ownmail.com',
			ownerFirstName: 'Ada',
			now: 1,
			tz: 'UTC',
			mutedIds: new Set<string>(),
		}
		const { result } = renderHook(() => useThreadListEnv(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<ThreadListEnvironment value={value}>{children}</ThreadListEnvironment>
			),
		})
		expect(result.current).toBe(value)
	})

	describe('its value', () => {
		beforeEach(() => {
			window.localStorage.setItem(
				USER_PREFERENCES_STORAGE_KEY,
				JSON.stringify({ primaryTimezone: 'Europe/Lisbon', mutedThreadIds: ['thread-staging'] }),
			)
		})

		const withClient = (client: QueryClient | null) => ({
			wrapper: ({ children }: { children: ReactNode }) =>
				client ? <QueryClientProvider client={client}>{children}</QueryClientProvider> : children,
		})

		it('knows the owner from the mailbox, the zone and mutes from preferences', () => {
			const client = new QueryClient()
			client.setQueryData(['account', 'mailbox-info'], {
				email: 'ada@ownmail.com',
				displayName: 'Ada Lovelace',
			})
			const { result } = renderHook(() => useThreadListEnvValue(), withClient(client))
			expect(result.current).toMatchObject({
				owner: 'ada@ownmail.com',
				ownerFirstName: 'Ada',
				tz: 'Europe/Lisbon',
			})
			expect([...result.current.mutedIds]).toEqual(['thread-staging'])
		})

		it('falls back to the bootstrap mailbox, then to nobody', () => {
			const client = new QueryClient()
			client.setQueryData(['account', 'mailbox-info-bootstrap'], { email: 'grace@vercel.com' })
			expect(renderHook(() => useThreadListEnvValue(), withClient(client)).result.current.owner).toBe(
				'grace@vercel.com',
			)
			expect(
				renderHook(() => useThreadListEnvValue(), withClient(new QueryClient())).result.current.owner,
			).toBe('')
			expect(renderHook(() => useThreadListEnvValue(), withClient(null)).result.current.owner).toBe('')
		})

		it('moves its clock once a minute, and keeps its identity in between', () => {
			vi.useFakeTimers()
			const { result, rerender, unmount } = renderHook(() => useThreadListEnvValue(), withClient(null))
			const first = result.current
			rerender()
			expect(result.current).toBe(first)
			act(() => {
				vi.advanceTimersByTime(LIST_CLOCK_MS)
			})
			expect(result.current).not.toBe(first)
			expect(result.current.now).toBeGreaterThanOrEqual(first.now + LIST_CLOCK_MS)
			unmount()
		})
	})
})

describe('ThreadListGroupHeading', () => {
	it('names its day group as a heading', () => {
		render(<ThreadListGroupHeading label="Yesterday" />)
		expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toHaveClass('thread-list-group')
	})
})

describe('useSeen', () => {
	let callback: IntersectionObserverCallback | undefined
	const observe = vi.fn()
	const disconnect = vi.fn()
	beforeEach(() => {
		callback = undefined
		observe.mockReset()
		disconnect.mockReset()
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(next: IntersectionObserverCallback) {
					callback = next
				}
				observe = observe
				disconnect = disconnect
			},
		)
	})

	function Probe({ enabled = true, attach = true }: { enabled?: boolean; attach?: boolean }) {
		const ref = useRef<HTMLSpanElement>(null)
		const seen = useSeen(ref, enabled)
		return <span ref={attach ? ref : undefined}>{seen ? 'seen' : 'unseen'}</span>
	}

	it('turns true once the element is on screen, and stops watching', () => {
		render(<Probe />)
		expect(observe).toHaveBeenCalledTimes(1)
		act(() => callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as never))
		expect(screen.getByText('unseen')).toBeInTheDocument()
		act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as never))
		expect(screen.getByText('seen')).toBeInTheDocument()
		expect(disconnect).toHaveBeenCalled()
	})

	it('watches nothing when it is off, when there is no element, or without IntersectionObserver', () => {
		render(<Probe enabled={false} />)
		render(<Probe attach={false} />)
		expect(observe).not.toHaveBeenCalled()
		vi.stubGlobal('IntersectionObserver', undefined)
		render(<Probe />)
		expect(screen.getAllByText('unseen')).toHaveLength(3)
	})
})
