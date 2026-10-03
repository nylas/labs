import { type ReactNode, useEffect, useRef } from 'react'

/**
 * An icon that changes in place (design.md "Motion" clause 6): when `swapKey`
 * changes the new icon rotates in, so it reads as the same control in a new
 * state. The first paint never animates.
 */
export function SwapIcon({ swapKey, children }: { swapKey: string; children: ReactNode }) {
	const previous = useRef(swapKey)
	const changed = previous.current !== swapKey
	useEffect(() => {
		previous.current = swapKey
	}, [swapKey])
	return (
		<span key={swapKey} className={changed ? 'icon-swap inline-flex' : 'inline-flex'}>
			{children}
		</span>
	)
}
