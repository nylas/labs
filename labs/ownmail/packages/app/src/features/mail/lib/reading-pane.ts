import type { ReadingPane } from '#app/preferences/user-preferences'

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
			? 'xl:h-[40%] xl:w-full xl:flex-none xl:border-b xl:border-border'
			: 'mail-list-vertical border-r border-border xl:w-[22rem] xl:max-w-[22rem] xl:flex-none'
	return {
		container: `flex min-h-0 min-w-0 flex-1${pane === 'horizontal' ? ' xl:flex-col' : ''}`,
		list: `${listBase} ${split} ${threadOpen ? 'hidden xl:flex' : 'flex'}`,
		reader: `${readerBase} ${threadOpen ? 'flex' : 'hidden xl:flex'}`,
		wideBackControl: false,
	}
}
