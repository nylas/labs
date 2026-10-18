import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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

/** The nearest scrolling ancestor: the reader's scroll area viewport. */
export function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node)
		if (overflowY === 'auto' || overflowY === 'scroll') return node
	}
	return null
}

/** How far beyond the scroll viewport a stream row is still mounted. */
export const NEAR_MARGIN = '1200px 0px'

type NearWatch = { observer: IntersectionObserver; callbacks: Map<Element, (near: boolean) => void> }
const nearWatches = new Map<Element | null, NearWatch>()

/**
 * Calls `onChange` with whether `element` is within `NEAR_MARGIN` of what its
 * scroll viewport shows. The margin is measured against that viewport (the
 * observer's root), not the page, which the viewport clips. The rows of one
 * viewport share one observer. Returns the function that stops watching.
 */
export function watchNear(element: HTMLElement, onChange: (near: boolean) => void): () => void {
	const root = scrollParent(element)
	let watch = nearWatches.get(root)
	if (!watch) {
		const callbacks = new Map<Element, (near: boolean) => void>()
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting)
			},
			{ root, rootMargin: NEAR_MARGIN },
		)
		watch = { observer, callbacks }
		nearWatches.set(root, watch)
	}
	const current = watch
	current.callbacks.set(element, onChange)
	current.observer.observe(element)
	return () => {
		current.observer.unobserve(element)
		current.callbacks.delete(element)
		if (current.callbacks.size > 0) return
		current.observer.disconnect()
		nearWatches.delete(root)
	}
}

/**
 * Whether an element is at least `min` CSS pixels wide, measured again as the
 * window resizes; undefined while it is not laid out (no element, no width,
 * or on the server), so the caller can fall back to a breakpoint.
 */
export function useWidthAtLeast(element: HTMLElement | null | undefined, min: number): boolean | undefined {
	const [wide, setWide] = useState<boolean | undefined>(undefined)
	useEffect(() => {
		if (!element) return
		const update = () => {
			const { width } = element.getBoundingClientRect()
			setWide(width > 0 ? width >= min : undefined)
		}
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	}, [element, min])
	return element ? wide : undefined
}
