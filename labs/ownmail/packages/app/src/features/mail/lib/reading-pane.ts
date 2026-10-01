import type { ListDensity, ReadingPane } from '#app/preferences/user-preferences'

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
 * (horizontal) the reader, or is replaced by it (none). A Condensed list puts
 * sender, subject, and date on one line, so the vertical split gives it a
 * wider column.
 */
export function readingPaneLayout(
	pane: ReadingPane,
	threadOpen: boolean,
	density: ListDensity = 'default',
): ReadingPaneLayout {
	const listBase = 'h-full min-w-0 flex-1 flex-col bg-card/50'
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
			: `border-r border-border ${
					density === 'condensed' ? 'xl:w-[26rem] xl:max-w-[26rem]' : 'xl:w-[22rem] xl:max-w-[22rem]'
				} xl:flex-none`
	return {
		container: `flex min-h-0 min-w-0 flex-1${pane === 'horizontal' ? ' xl:flex-col' : ''}`,
		list: `${listBase} ${split} ${threadOpen ? 'hidden xl:flex' : 'flex'}`,
		reader: `${readerBase} ${threadOpen ? 'flex' : 'hidden xl:flex'}`,
		wideBackControl: false,
	}
}
