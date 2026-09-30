import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'

const VERSION_POLL_INTERVAL_MS = 10_000
const FALLBACK_REFRESH_INTERVAL_MS = 60_000
const MAIL_REVALIDATION_DELAYS_MS = [1_500, 5_000]

type DomainVersions = {
	mail: number
	contacts: number
	calendar: number
}

export function createOwnmailQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: 5 * 60_000,
				refetchOnReconnect: true,
				refetchOnWindowFocus: true,
				retry: 1,
				staleTime: 30_000,
			},
			mutations: { retry: false },
		},
	})
}

function normalizeVersions(value: unknown): DomainVersions | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const record = value as Record<string, unknown>
	const legacy = safeVersion(record.version)
	const source =
		record.domains && typeof record.domains === 'object' && !Array.isArray(record.domains)
			? (record.domains as Record<string, unknown>)
			: record
	return {
		mail: safeVersion(source.mail) ?? legacy ?? 0,
		contacts: safeVersion(source.contacts) ?? legacy ?? 0,
		calendar: safeVersion(source.calendar) ?? legacy ?? 0,
	}
}

function safeVersion(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

const SYNCED_PATH_PATTERN = /^\/(mail|contacts|calendar)(?:\/|$)/

function ServerStateSync() {
	const queryClient = useQueryClient()
	// Only entering or leaving the synchronized sections restarts polling.
	// Depending on the full pathname would restart it on every thread open and
	// repeat the initial full refetch, racing optimistic cache updates.
	const inApp = useRouterState({ select: (state) => SYNCED_PATH_PATTERN.test(state.location.pathname) })
	// The watermark outlives polling restarts so returning to a synchronized
	// section compares versions instead of refetching every active query.
	const previousRef = useRef<DomainVersions | null>(null)
	const lastFallbackRefreshRef = useRef(0)
	useEffect(() => {
		if (!inApp) return
		let stopped = false
		let syncing = false
		let mailRevalidationTimers: number[] = []

		function clearMailRevalidations() {
			for (const timer of mailRevalidationTimers) window.clearTimeout(timer)
			mailRevalidationTimers = []
		}

		function invalidateMailQueries() {
			return queryClient.invalidateQueries({
				predicate: (query) => query.queryKey[0] === 'mail',
				refetchType: 'active',
			})
		}

		function scheduleMailRevalidations() {
			clearMailRevalidations()
			mailRevalidationTimers = MAIL_REVALIDATION_DELAYS_MS.map((delay) =>
				window.setTimeout(() => {
					if (stopped || document.visibilityState !== 'visible') return
					void invalidateMailQueries()
				}, delay),
			)
		}

		async function sync() {
			if (stopped || syncing || document.visibilityState !== 'visible') return
			syncing = true
			try {
				const response = await fetch('/api/version', {
					credentials: 'same-origin',
					headers: { Accept: 'application/json' },
				})
				if (!response.ok || stopped) return
				const next = normalizeVersions(await response.json())
				if (!next || stopped) return
				const now = Date.now()
				const previous = previousRef.current
				if (!previous) {
					// The initial refresh closes the window between route loading and
					// establishing the first external-change watermark.
					await queryClient.invalidateQueries({ refetchType: 'active' })
					lastFallbackRefreshRef.current = now
				} else {
					for (const domain of ['mail', 'contacts', 'calendar'] as const) {
						if (next[domain] === previous[domain]) continue
						if (domain === 'mail') {
							await invalidateMailQueries()
							scheduleMailRevalidations()
						} else {
							await queryClient.invalidateQueries({
								predicate: (query) => query.queryKey[0] === domain,
								refetchType: 'active',
							})
						}
					}
				}
				if (now - lastFallbackRefreshRef.current >= FALLBACK_REFRESH_INTERVAL_MS) {
					await queryClient.invalidateQueries({ refetchType: 'active' })
					lastFallbackRefreshRef.current = now
				}
				previousRef.current = next
			} catch {
				// Transient network failures are retried on the next interval.
			} finally {
				syncing = false
			}
		}

		function syncWhenVisible() {
			if (document.visibilityState === 'visible') void sync()
		}

		void sync()
		const timer = window.setInterval(() => void sync(), VERSION_POLL_INTERVAL_MS)
		// A returning tab checks for external changes immediately instead of
		// showing stale mail until the next poll interval.
		document.addEventListener('visibilitychange', syncWhenVisible)
		window.addEventListener('online', syncWhenVisible)
		return () => {
			stopped = true
			window.clearInterval(timer)
			document.removeEventListener('visibilitychange', syncWhenVisible)
			window.removeEventListener('online', syncWhenVisible)
			clearMailRevalidations()
		}
	}, [inApp, queryClient])
	return null
}

export type OwnmailRouterContext = {
	queryClient: QueryClient
}

export function OwnmailQueryProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
	const [queryClient] = useState(() => client ?? createOwnmailQueryClient())
	return (
		<QueryClientProvider client={queryClient}>
			<ServerStateSync />
			{children}
		</QueryClientProvider>
	)
}

export const queryProviderTestApi = { normalizeVersions }
