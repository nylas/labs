import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'

const VERSION_POLL_INTERVAL_MS = 10_000

type DomainVersions = {
	mail: number
	contacts: number
	calendar: number
}

function createOwnmailQueryClient(): QueryClient {
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
	useEffect(() => {
		if (!/^\/(mail|contacts|calendar)(?:\/|$)/.test(window.location.pathname)) return
		let stopped = false
		let previous: DomainVersions | null = null

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
				if (!previous) {
					// The initial refresh closes the window between route loading and
					// establishing the first external-change watermark.
					await queryClient.invalidateQueries({ refetchType: 'active' })
				} else {
					for (const domain of ['mail', 'contacts', 'calendar'] as const) {
						if (next[domain] === previous[domain]) continue
						await queryClient.invalidateQueries({
							predicate: (query) => query.queryKey[0] === domain,
							refetchType: 'active',
						})
					}
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
		}
	}, [queryClient])
	return null
}

export function OwnmailQueryProvider({ children }: { children: ReactNode }) {
	const [queryClient] = useState(createOwnmailQueryClient)
	return (
		<QueryClientProvider client={queryClient}>
			<ServerStateSync />
			{children}
		</QueryClientProvider>
	)
}

export const queryProviderTestApi = { normalizeVersions }
