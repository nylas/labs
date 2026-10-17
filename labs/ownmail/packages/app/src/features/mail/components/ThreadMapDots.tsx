import { Fragment, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '#shared/lib/utils'
import { type MapEntry, type Person, personHue, personName } from '../lib/thread-reading-model.js'
import { scrollParent } from './reader-hooks.js'

/** A person's tint: the six avatar hues by address, the owner always on the green pair. */
export const dotHue = (person: Person): ReturnType<typeof personHue> =>
	person.isOwner ? 158 : personHue(person.email)

/**
 * The thread's shape beside the reader: a dot per message, tinted for its
 * sender. Read messages are small, the first a little larger, new ones larger
 * and stronger, with a short green rule where the reader stopped and a ring on
 * the message in focus. A dot scrolls to its message and opens it; the column
 * itself (or `g m`) opens the thread map panel.
 *
 * The column fits the viewport: on a very long thread the dots draw closer
 * together instead of running past the screen. One dot is in the tab order
 * (the message in focus); the arrow keys, Home and End move between dots.
 */
export function ThreadMapDots({
	entries,
	stoppedBeforeIndex,
	currentId,
	dateLabel,
	onSelect,
	onOpenPanel,
}: {
	entries: MapEntry[]
	stoppedBeforeIndex: number | null
	currentId?: string
	dateLabel: (seconds: number) => string
	onSelect: (messageId: string) => void
	onOpenPanel: () => void
}) {
	const ref = useRef<HTMLElement>(null)
	const maxHeight = useViewportHeight(ref)
	const tabbableId = entries.some((entry) => entry.messageId === currentId)
		? currentId
		: entries[0]?.messageId

	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		const track = event.currentTarget.parentElement as HTMLElement
		const dots = [...track.querySelectorAll<HTMLElement>('[data-slot="thread-map-dot"]')]
		const index = dots.indexOf(event.currentTarget)
		const next =
			event.key === 'ArrowDown' || event.key === 'ArrowRight'
				? index + 1
				: event.key === 'ArrowUp' || event.key === 'ArrowLeft'
					? index - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? dots.length - 1
							: null
		if (next === null) return
		event.preventDefault()
		dots[Math.min(dots.length - 1, Math.max(0, next))]?.focus()
	}

	return (
		<aside
			ref={ref}
			aria-label="Thread map"
			data-slot="thread-map-dots"
			className="reader-map"
			style={maxHeight ? { maxHeight } : undefined}
		>
			<div className="reader-map-track">
				{entries.map((entry, index) => {
					const size = entry.unread ? 'new' : index === 0 ? 'first' : 'read'
					const name = personName(entry.from, 'full')
					const date = entry.date ? dateLabel(entry.date) : ''
					return (
						<Fragment key={entry.messageId}>
							{index === stoppedBeforeIndex ? (
								<span aria-hidden="true" data-slot="thread-map-stopped" className="reader-map-stopped" />
							) : null}
							<button
								type="button"
								data-slot="thread-map-dot"
								tabIndex={entry.messageId === tabbableId ? 0 : -1}
								aria-label={`${entry.from.isOwner ? 'You' : name}${date ? `, ${date}` : ''}${entry.unread ? ', new' : ''}`}
								aria-current={entry.messageId === currentId ? 'true' : undefined}
								title={`${entry.from.isOwner ? 'You' : name}${date ? `, ${date}` : ''}`}
								className={cn('reader-map-dot', `reader-map-dot-${size}`)}
								data-hue={dotHue(entry.from)}
								onClick={() => onSelect(entry.messageId)}
								onKeyDown={onKeyDown}
							>
								<span aria-hidden="true" />
							</button>
						</Fragment>
					)
				})}
			</div>
			<button type="button" data-slot="thread-map-open" className="reader-map-open" onClick={onOpenPanel}>
				Open thread map
				<span className="sr-only"> (g m)</span>
			</button>
		</aside>
	)
}

/**
 * The height the reader's scroll viewport shows (inside the padding that
 * clears its bars), kept current as it resizes; undefined until known.
 */
function useViewportHeight(ref: { current: HTMLElement | null }): number | undefined {
	const [height, setHeight] = useState<number | undefined>(undefined)
	useLayoutEffect(() => {
		const viewport = scrollParent(ref.current as HTMLElement)
		if (!viewport) return
		const update = () => {
			const style = getComputedStyle(viewport)
			const inner =
				viewport.clientHeight -
				(Number.parseFloat(style.paddingTop) || 0) -
				(Number.parseFloat(style.paddingBottom) || 0)
			setHeight(inner > 0 ? inner : undefined)
		}
		update()
		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(update)
		observer.observe(viewport)
		return () => observer.disconnect()
	}, [ref])
	return height
}
