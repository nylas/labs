import { type ReactNode, useEffect, useRef, useState } from 'react'

/** How far beyond the viewport a stream row is still mounted. */
const MOUNT_MARGIN = '1200px 0px'
/** The height held for a row that has never been measured. */
const ESTIMATED_HEIGHT = 56

/**
 * One row of a very long stream. Its wrapper (and so its anchor, which the
 * map, j/k and links scroll to) is always in the document; what is inside is
 * mounted only near the viewport. Away from it the row keeps the height it
 * last had, so the scroll position never jumps. `virtual` off, or `pinned`
 * (the message in focus), renders the row as it is.
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
		const observer = new IntersectionObserver(
			(entries) => {
				// One element is observed, so each report is about it.
				const entry = entries[0] as IntersectionObserverEntry
				if (!entry.isIntersecting) height.current = element.getBoundingClientRect().height || height.current
				setNear(entry.isIntersecting)
			},
			{ rootMargin: MOUNT_MARGIN },
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [virtual])

	const mounted = !virtual || pinned || near || typeof IntersectionObserver === 'undefined'
	return (
		<div
			ref={ref}
			id={anchorId}
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
