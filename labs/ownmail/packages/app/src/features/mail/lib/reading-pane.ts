import type { CSSProperties } from 'react'
import {
	READING_PANE_LIST_HEIGHT_RANGE,
	READING_PANE_LIST_WIDTH_RANGE,
	type ReadingPane,
	type UserPreferences,
} from '#app/preferences/user-preferences'

export type ReadingPaneLayout = {
	/** Wraps the list and reader; stacks them for a horizontal split. */
	container: string
	list: string
	reader: string
	/** Whether the reader's back control is needed on wide screens. */
	wideBackControl: boolean
}

/**
 * Layout classes for the mail list and reader. Below Tailwind's `xl`
 * breakpoint every pane choice behaves as "no split": the conversation
 * replaces the list. From `xl` up, the list sits beside (vertical) or above
 * (horizontal) the reader, or is replaced by it (none).
 *
 * The layout never depends on the list density: `mail-list-vertical` only
 * marks the vertical-split list so `styles.css` can widen it for Condensed
 * rows inside the same fine-pointer query that enables those rows.
 *
 * A dragged size arrives as a custom property on the container (see
 * `readingPaneSizeStyle`); without one, each split keeps its default size.
 * Either way the list is capped against the current panes so the reader
 * keeps `READER_MIN_PX` when a size saved in a larger window is restored.
 */
export function readingPaneLayout(pane: ReadingPane, threadOpen: boolean): ReadingPaneLayout {
	// `relative`: the list pane is the containing block of its pinned toolbar.
	const listBase = 'relative h-full min-w-0 flex-1 flex-col bg-card/50'
	const readerBase = 'min-h-0 min-w-0 flex-1 flex-col bg-background'
	if (pane === 'none') {
		return {
			container: 'flex min-h-0 min-w-0 flex-1',
			list: `${listBase} ${threadOpen ? 'hidden' : 'flex'}`,
			reader: `${readerBase} ${threadOpen ? 'flex' : 'hidden'}`,
			wideBackControl: true,
		}
	}
	const split =
		pane === 'horizontal'
			? 'xl:h-[min(var(--mail-list-height,40%),calc(100%_-_160px))] xl:w-full xl:flex-none xl:border-b xl:border-border'
			: 'mail-list-vertical border-r border-border xl:w-[min(var(--mail-list-width,22rem),calc(100%_-_360px))] xl:max-w-[min(var(--mail-list-width,22rem),calc(100%_-_360px))] xl:flex-none'
	return {
		container: `flex min-h-0 min-w-0 flex-1${pane === 'horizontal' ? ' xl:flex-col' : ''}`,
		list: `${listBase} ${split} ${threadOpen ? 'hidden xl:flex' : 'flex'}`,
		reader: `${readerBase} ${threadOpen ? 'flex' : 'hidden xl:flex'}`,
		wideBackControl: false,
	}
}

/** The custom property carrying a dragged list size for each split. */
export const READING_PANE_SIZE_PROPERTY = {
	vertical: '--mail-list-width',
	horizontal: '--mail-list-height',
} as const

/** The container style that applies the person's dragged list size, if any. */
export function readingPaneSizeStyle(
	preferences: Pick<UserPreferences, 'readingPaneListWidth' | 'readingPaneListHeight'>,
): CSSProperties {
	const style: Record<string, string> = {}
	if (preferences.readingPaneListWidth !== null) {
		style[READING_PANE_SIZE_PROPERTY.vertical] = `${preferences.readingPaneListWidth}px`
	}
	if (preferences.readingPaneListHeight !== null) {
		style[READING_PANE_SIZE_PROPERTY.horizontal] = `${preferences.readingPaneListHeight}%`
	}
	return style
}

/** A list dragged thinner than this many pixels asks for no split at all. */
export const READING_PANE_COLLAPSE_PX = 96

/** The room the conversation always keeps, in pixels; the layout classes repeat these values. */
const READER_MIN_PX = { vertical: 360, horizontal: 160 } as const

export type SplitPane = Exclude<ReadingPane, 'none'>

/** The list size shown while dragging: anywhere from nothing up to the reader's minimum room. */
export function readingPaneDragExtent(pane: SplitPane, offset: number, panes: number): number {
	return Math.round(Math.min(Math.max(offset, 0), Math.max(panes - READER_MIN_PX[pane], 0)))
}

/** The smallest list a split keeps once a drag or keystroke settles, in pixels. */
export function readingPaneMinExtent(pane: SplitPane, panes: number): number {
	return pane === 'vertical'
		? READING_PANE_LIST_WIDTH_RANGE.min
		: (panes * READING_PANE_LIST_HEIGHT_RANGE.min) / 100
}

export type ReadingPaneResize =
	| { kind: 'collapse' }
	| { kind: 'width'; value: number }
	| { kind: 'height'; value: number }

/**
 * Where a resize settles. A list shrunk to near nothing switches the reading
 * pane to "no split"; any other size is clamped into the stored range (a
 * pixel width for the vertical split, a percentage height for the horizontal
 * one) so it stays usable when the window changes size.
 */
export function settleReadingPaneResize(pane: SplitPane, extent: number, panes: number): ReadingPaneResize {
	if (extent < READING_PANE_COLLAPSE_PX) return { kind: 'collapse' }
	if (pane === 'vertical') {
		const { min, max } = READING_PANE_LIST_WIDTH_RANGE
		const roomy = Math.max(Math.min(max, panes - READER_MIN_PX.vertical), min)
		return { kind: 'width', value: Math.round(Math.min(Math.max(extent, min), roomy)) }
	}
	const { min, max } = READING_PANE_LIST_HEIGHT_RANGE
	const percent = panes > 0 ? (extent / panes) * 100 : max
	return { kind: 'height', value: Math.round(Math.min(Math.max(percent, min), max)) }
}
