import { type RefObject, useLayoutEffect, useRef } from 'react'

/** design.md "Motion" clause 5: rows slide into a gap over `--dur-medium` with `--ease-out`. */
export const FLIP_DURATION_MS = 220
export const FLIP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'

/**
 * When a list's order changes (a row is archived, deleted or moved), each row
 * that stays slides from where it was to where it is now, with a transform
 * only; row height never animates. Rows are found by `data-flip-id` and
 * measured with `offsetTop`, so scrolling between renders moves nothing.
 * Reduced motion skips the slide.
 */
export function useFlipList(containerRef: RefObject<HTMLElement | null>, order: string) {
	const positions = useRef(new Map<string, number>())
	// biome-ignore lint/correctness/useExhaustiveDependencies: `order` is the trigger; rows are re-measured whenever it changes.
	useLayoutEffect(() => {
		const container = containerRef.current
		if (!container) return
		const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
		const next = new Map<string, number>()
		for (const row of container.querySelectorAll<HTMLElement>('[data-flip-id]')) {
			const id = row.dataset.flipId as string
			const top = row.offsetTop
			next.set(id, top)
			const previous = positions.current.get(id)
			if (animate && previous !== undefined && previous !== top && typeof row.animate === 'function') {
				row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'none' }], {
					duration: FLIP_DURATION_MS,
					easing: FLIP_EASING,
				})
			}
		}
		positions.current = next
	}, [containerRef, order])
}
