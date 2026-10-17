import { ArrowDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'

/** Marks a message that was unread when the thread opened, for `useNewBelowViewport`. */
export const NEW_MESSAGE_ATTR = 'data-new-message'

// Board 03 draws the jump control as a pill; the panel recipe's 12px corner would square it off.
const PILL_RADIUS = { borderRadius: '999px' } as const

/**
 * The phone reader's "2 more new" pill (board 03). It floats over the
 * conversation, so it is panel glass, 16px clear of the mobile bar. The
 * visible pill is 36px; the button around it keeps the 44px touch target.
 */
export function JumpToNewPill({ count, onJump }: { count: number; onJump: () => void }) {
	if (count <= 0) return null
	return (
		<button
			type="button"
			data-slot="jump-to-new"
			onClick={onJump}
			className="group fixed bottom-[calc(var(--mobile-tab-bar-height)+var(--safe-area-bottom)+0.75rem)] left-1/2 z-30 flex h-11 -translate-x-1/2 items-center outline-none md:hidden"
		>
			<span
				style={PILL_RADIUS}
				className={`${GLASS_PANEL_CLASS} inline-flex h-9 items-center gap-cluster px-hairline text-[13px] font-semibold whitespace-nowrap text-foreground group-active:scale-[0.97] group-focus-visible:ring-[3px] group-focus-visible:ring-ring`}
			>
				<ArrowDown className="size-4 text-cta-icon" aria-hidden="true" />
				{count} more new
			</span>
		</button>
	)
}

/** Messages marked new that start below what the scroll region shows, top to bottom. */
function newBelow(root: HTMLElement): HTMLElement[] {
	// Scroll padding is the part of the region a pinned bar covers (`under-mobile-bar`).
	const covered = Number.parseFloat(getComputedStyle(root).scrollPaddingBottom) || 0
	const edge = root.getBoundingClientRect().bottom - covered
	return [...root.querySelectorAll<HTMLElement>(`[${NEW_MESSAGE_ATTR}]`)].filter(
		(element) => element.getBoundingClientRect().top >= edge,
	)
}

/**
 * How many messages marked with `NEW_MESSAGE_ATTR` are still below the
 * viewport of `scrollRoot`, kept current while it scrolls or resizes, and a
 * jump that brings the next one to the top. Pass `revision` when the marked
 * messages change (a fold opens, the thread refetches) to count again.
 */
export function useNewBelowViewport(
	scrollRoot: HTMLElement | null,
	revision?: unknown,
): { count: number; jump: () => void } {
	const [count, setCount] = useState(0)

	useEffect(() => {
		if (!scrollRoot) {
			setCount(0)
			return
		}
		void revision
		const update = () => setCount(newBelow(scrollRoot).length)
		update()
		scrollRoot.addEventListener('scroll', update, { passive: true })
		window.addEventListener('resize', update)
		return () => {
			scrollRoot.removeEventListener('scroll', update)
			window.removeEventListener('resize', update)
		}
	}, [scrollRoot, revision])

	const jump = useCallback(() => {
		const next = scrollRoot ? newBelow(scrollRoot)[0] : undefined
		if (!next) return
		const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
		next.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
	}, [scrollRoot])

	return { count, jump }
}
