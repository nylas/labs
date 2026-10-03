/** Chrome shared by the calendar's eager pending view and its lazily loaded screen. */

/** The top bar's start cell while the sidebar is hidden (in its sheet, or
 * collapsed on desktop): the icon-only New event action, after the toggle that
 * brings the sidebar back. The pending view draws the same cell so the title
 * beside it sits where it will when the grid arrives. */
export const CREATE_CELL_CLASS =
	'col-start-1 row-start-1 flex shrink-0 items-center gap-control border-r border-border px-control'

/** The details pane's width, shared with the pending view so the grid keeps its width while loading. */
export const DETAIL_PANE_WIDTH_CLASS = 'w-72 xl:w-80'

/** The header title for an anchor date; the loaded screen and its pending view
 * share it so the title always names the range beside it. */
export function calendarTitle(anchor: Date): string {
	return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
