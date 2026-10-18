import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
	READING_PANE_LIST_HEIGHT_RANGE,
	READING_PANE_LIST_WIDTH_RANGE,
	useUserPreferences,
} from '#app/preferences/user-preferences'
import {
	READING_PANE_COLLAPSE_PX,
	READING_PANE_SIZE_PROPERTY,
	type ReadingPaneResize,
	readingPaneDragExtent,
	readingPaneMinExtent,
	type SplitPane,
	settleReadingPaneResize,
} from '#features/mail/lib/reading-pane'
import { cn } from '#shared/lib/utils'

const KEYBOARD_STEP_PX = 16
// The 22.5rem vertical-split default (board 01) at the 16px root size.
const DEFAULT_LIST_WIDTH_PX = 360
const DEFAULT_LIST_HEIGHT_PERCENT = 40

type Panes = {
	container: HTMLElement
	list: HTMLElement
	/** The container's length along the split, in pixels. */
	panes: number
	/** The list's current length along the split, in pixels. */
	extent: number
	/** Where the list starts along the split, in viewport pixels. */
	start: number
}

type Drag = Panes & { pointerId: number; previous: string; moved: boolean }

/** The panes around a handle; null until it sits after a list inside a container. */
function measurePanes(root: HTMLElement | null, vertical: boolean): Panes | null {
	const container = root?.parentElement
	const list = root?.previousElementSibling
	if (!container || !(list instanceof HTMLElement)) return null
	const panes = container.getBoundingClientRect()
	const listRect = list.getBoundingClientRect()
	return {
		container,
		list,
		panes: vertical ? panes.width : panes.height,
		extent: vertical ? listRect.width : listRect.height,
		start: vertical ? listRect.left : listRect.top,
	}
}

/** The list size as laid out, in the separator's units; null while it is not laid out. */
function laidOutSize(root: HTMLElement | null, vertical: boolean): number | null {
	const panes = measurePanes(root, vertical)
	if (!panes || panes.extent <= 0 || panes.panes <= 0) return null
	return Math.round(vertical ? panes.extent : (panes.extent / panes.panes) * 100)
}

/**
 * The handle between the mail list and the reader in a split layout. It sits
 * between the two panes inside the layout container: dragging (or the arrow
 * keys) resizes the list, double-clicking restores the default size, and
 * shrinking the list to nearly nothing switches the reading pane to "no split".
 *
 * While dragging, the size is written straight to the container's custom
 * property so the mail list does not re-render on every pointer move; the
 * preference is saved once, when the drag ends.
 */
export function ReadingPaneDivider() {
	const [preferences, savePreferences] = useUserPreferences()
	const rootRef = useRef<HTMLDivElement>(null)
	const dragRef = useRef<Drag | null>(null)
	// Screen readers hear the size as laid out: the Condensed default, the root
	// font size and the cap that keeps the reader's room all change it.
	const [laidOut, setLaidOut] = useState<number | null>(null)
	const measuresWidth = preferences.readingPane === 'vertical'
	const shown = preferences.readingPane !== 'none'
	useLayoutEffect(() => {
		setLaidOut(laidOutSize(rootRef.current, measuresWidth))
	})
	// A window resize changes the panes, and the cap on the list, without a render.
	useEffect(() => {
		const root = rootRef.current
		// The handle mounts afresh each time a split is chosen again.
		if (!shown || !root) return
		const observer = new ResizeObserver(() => setLaidOut(laidOutSize(root, measuresWidth)))
		for (const element of [root.parentElement, root.previousElementSibling]) {
			if (element) observer.observe(element)
		}
		return () => observer.disconnect()
	}, [measuresWidth, shown])
	if (preferences.readingPane === 'none') return null
	const pane: SplitPane = preferences.readingPane
	const property = READING_PANE_SIZE_PROPERTY[pane]
	const vertical = pane === 'vertical'

	const measure = () => measurePanes(rootRef.current, vertical)

	function apply(resize: ReadingPaneResize) {
		if (resize.kind === 'collapse') savePreferences({ ...preferences, readingPane: 'none' })
		else if (resize.kind === 'width') savePreferences({ ...preferences, readingPaneListWidth: resize.value })
		else savePreferences({ ...preferences, readingPaneListHeight: resize.value })
	}

	function onPointerDown(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0 || dragRef.current) return
		const panes = measure()
		if (!panes) return
		event.preventDefault()
		event.currentTarget.setPointerCapture(event.pointerId)
		event.currentTarget.dataset.dragging = ''
		dragRef.current = {
			...panes,
			pointerId: event.pointerId,
			previous: panes.container.style.getPropertyValue(property),
			moved: false,
		}
	}

	function onPointerMove(event: PointerEvent<HTMLDivElement>) {
		const drag = dragRef.current
		if (drag?.pointerId !== event.pointerId) return
		const offset = (vertical ? event.clientX : event.clientY) - drag.start
		drag.extent = readingPaneDragExtent(pane, offset, drag.panes)
		drag.moved = true
		drag.container.style.setProperty(property, `${drag.extent}px`)
		// A list about to collapse fades, so letting go there is no surprise.
		if (drag.extent < READING_PANE_COLLAPSE_PX) drag.list.style.opacity = '0.4'
		else drag.list.style.removeProperty('opacity')
	}

	function endDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
		const drag = dragRef.current
		if (drag?.pointerId !== event.pointerId) return
		dragRef.current = null
		delete event.currentTarget.dataset.dragging
		drag.list.style.removeProperty('opacity')
		// A click without a drag (the first half of a double-click) changes nothing.
		const resize = commit && drag.moved ? settleReadingPaneResize(pane, drag.extent, drag.panes) : null
		// React writes the property only when the saved value changes, so the
		// container is put back to the settled (or previous) size here.
		if (resize?.kind === 'width') drag.container.style.setProperty(property, `${resize.value}px`)
		else if (resize?.kind === 'height') drag.container.style.setProperty(property, `${resize.value}%`)
		else if (drag.previous) drag.container.style.setProperty(property, drag.previous)
		else drag.container.style.removeProperty(property)
		if (resize) apply(resize)
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const grow = vertical ? 'ArrowRight' : 'ArrowDown'
		const shrink = vertical ? 'ArrowLeft' : 'ArrowUp'
		if (event.key !== grow && event.key !== shrink) return
		const panes = measure()
		if (!panes) return
		event.preventDefault()
		const min = readingPaneMinExtent(pane, panes.panes)
		// Shrinking a list already at its smallest is the keyboard's drag to the edge.
		if (event.key === shrink && panes.extent <= min + 0.5) {
			apply({ kind: 'collapse' })
			return
		}
		const next = panes.extent + (event.key === grow ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX)
		apply(settleReadingPaneResize(pane, Math.max(next, min), panes.panes))
	}

	function resetSize() {
		savePreferences(
			vertical
				? { ...preferences, readingPaneListWidth: null }
				: { ...preferences, readingPaneListHeight: null },
		)
	}

	const range = vertical ? READING_PANE_LIST_WIDTH_RANGE : READING_PANE_LIST_HEIGHT_RANGE
	const value =
		laidOut ??
		(vertical
			? (preferences.readingPaneListWidth ?? DEFAULT_LIST_WIDTH_PX)
			: (preferences.readingPaneListHeight ?? DEFAULT_LIST_HEIGHT_PERCENT))

	return (
		<div
			ref={rootRef}
			className={cn('relative z-20 hidden shrink-0 xl:block', vertical ? 'w-0' : 'h-0 w-full')}
			data-reading-pane-divider
		>
			{/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or pointer drags; a focusable separator is the ARIA window-splitter pattern. */}
			<div
				role="separator"
				tabIndex={0}
				aria-label="Resize conversation list"
				aria-orientation={vertical ? 'vertical' : 'horizontal'}
				aria-valuemin={range.min}
				aria-valuemax={range.max}
				aria-valuenow={value}
				aria-valuetext={vertical ? `${value} pixels wide` : `${value}% of the height`}
				title="Drag to resize. Drag to the edge for no split; double-click to reset."
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={(event) => endDrag(event, true)}
				onPointerCancel={(event) => endDrag(event, false)}
				onDoubleClick={resetSize}
				onKeyDown={onKeyDown}
				className={cn(
					'absolute touch-none transition-colors hover:bg-ring/30 focus-visible:bg-ring/50 focus-visible:outline-none data-[dragging]:bg-ring/50',
					vertical ? '-left-1 inset-y-0 w-2 cursor-col-resize' : '-top-1 inset-x-0 h-2 cursor-row-resize',
				)}
			/>
		</div>
	)
}
