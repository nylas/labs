import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useState } from 'react'

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

function ServerStateSync() {
	const queryClient = useQueryClient()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	useEffect(() => {
		if (!/^\/(mail|contacts|calendar)(?:\/|$)/.test(pathname)) return
		let stopped = false
		let previous: DomainVersions | null = null
		let lastFallbackRefresh = 0
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
			if (stopped || document.visibilityState !== 'visible') return
			try {
				const response = await fetch('/api/version', {
					credentials: 'same-origin',
					headers: { Accept: 'application/json' },
				})
				if (!response.ok || stopped) return
				const next = normalizeVersions(await response.json())
				if (!next || stopped) return
				const now = Date.now()
				if (!previous) {
					// The initial refresh closes the window between route loading and
					// establishing the first external-change watermark.
					await queryClient.invalidateQueries({ refetchType: 'active' })
					lastFallbackRefresh = now
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
				if (now - lastFallbackRefresh >= FALLBACK_REFRESH_INTERVAL_MS) {
					await queryClient.invalidateQueries({ refetchType: 'active' })
					lastFallbackRefresh = now
				}
				previous = next
			} catch {
				// Transient network failures are retried on the next interval.
			}
		}

		void sync()
		const timer = window.setInterval(() => void sync(), VERSION_POLL_INTERVAL_MS)
		return () => {
			stopped = true
			window.clearInterval(timer)
			clearMailRevalidations()
		}
	}, [pathname, queryClient])
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
