import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { useMounted } from '#shared/components/ClientTime'

/** Tailwind's `md`: from here the reader is the desktop layout; below it, the phone thread screen. */
export const READER_DESKTOP_QUERY = '(min-width: 48rem)'
/** Tailwind's `lg`: the thread map's dots sit beside the stream. */
export const READER_MAP_QUERY = '(min-width: 64rem)'

/**
 * Whether a media query matches. False while rendering on the server and
 * hydrating, so the first client render matches the server's markup.
 */
export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(notify: () => void) => {
			const list = window.matchMedia?.(query)
			list?.addEventListener('change', notify)
			return () => list?.removeEventListener('change', notify)
		},
		[query],
	)
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia?.(query).matches ?? false,
		() => false,
	)
}

export type ReaderClock = { now: number; tz: string }

const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * The time and zone relative dates are written in ("Sep 28 – today",
 * "Tuesday"), or null on the server and during hydration: those labels depend
 * on the reader's clock, so they are written once the page is in the browser.
 */
export function useReaderClock(): ReaderClock | null {
	const mounted = useMounted()
	// One moment per reader, so memoised labels do not change on every render.
	const [now] = useState(() => Date.now())
	return useMemo(() => (mounted ? { now, tz: localZone() } : null), [mounted, now])
}
