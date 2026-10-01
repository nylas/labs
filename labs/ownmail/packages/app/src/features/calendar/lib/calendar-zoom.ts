import { CALENDAR_HOUR_HEIGHTS, type CalendarHourHeight } from '#app/preferences/user-preferences'

const HOUR_HEIGHT_LABELS: Record<CalendarHourHeight, string> = {
	40: 'Compact',
	52: 'Default',
	64: 'Roomy',
	80: 'Spacious',
}

/** The name shown and announced for a grid zoom step. */
export function hourHeightLabel(hourHeight: CalendarHourHeight): string {
	return HOUR_HEIGHT_LABELS[hourHeight]
}

/** The neighbouring zoom step in a direction, or null at either end of the scale. */
export function stepHourHeight(current: CalendarHourHeight, direction: 1 | -1): CalendarHourHeight | null {
	return CALENDAR_HOUR_HEIGHTS[CALENDAR_HOUR_HEIGHTS.indexOf(current) + direction] ?? null
}

/**
 * Where a scrolled grid sits after its hour height changes, so the hour at the
 * top of the viewport stays there instead of the grid jumping.
 */
export function rescaledScrollTop(
	scrollTop: number,
	previousHourHeight: number,
	nextHourHeight: number,
): number {
	return (scrollTop / previousHourHeight) * nextHourHeight
}
