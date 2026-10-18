import { type ReactNode, useEffect, useRef, useState } from 'react'
import { watchNear } from './reader-hooks.js'

/** The height held for a row that has never been measured. */
const ESTIMATED_HEIGHT = 56

/**
 * One row of a very long stream. Its wrapper (and so its anchor, which the
 * map, j/k and links scroll to) is always in the document; what is inside is
 * mounted only near the reader's scroll viewport. Away from it the row keeps
 * the height it last had, so the scroll position never jumps. `virtual` off,
 * or `pinned` (the message in focus), renders the row as it is. A message's
 * wrapper takes focus when the reader moves to it (`tabIndex` -1), so keys
 * pressed next stay with the reader.
 */
export function VirtualStreamItem({
	kind,
	anchorId,
	virtual,
	pinned,
	highlight = false,
	children,
}: {
	/** What the row is ("open", "line", "folded", "divider"…), for styles that differ by kind. */
	kind?: string
	/** The message's anchor (`message-<id>`), kept on the wrapper so it exists while the row is held. */
	anchorId?: string
	virtual: boolean
	pinned: boolean
	/** A source the catch-up summary was drawn from, while "Show sources" is on. */
	highlight?: boolean
	children: ReactNode
}) {
	const ref = useRef<HTMLDivElement>(null)
	const height = useRef<number | null>(null)
	const [near, setNear] = useState(false)

	useEffect(() => {
		const element = ref.current
		if (!virtual || !element || typeof IntersectionObserver === 'undefined') return
		return watchNear(element, (isNear) => {
			if (!isNear) height.current = element.getBoundingClientRect().height || height.current
			setNear(isNear)
		})
	}, [virtual])

	const mounted = !virtual || pinned || near || typeof IntersectionObserver === 'undefined'
	return (
		<div
			ref={ref}
			id={anchorId}
			tabIndex={anchorId ? -1 : undefined}
			data-slot="stream-item"
			data-kind={kind}
			data-source={highlight || undefined}
			data-virtual={virtual ? (mounted ? 'mounted' : 'held') : undefined}
			style={mounted ? undefined : { height: height.current ?? ESTIMATED_HEIGHT }}
		>
			{mounted ? children : null}
		</div>
	)
}
