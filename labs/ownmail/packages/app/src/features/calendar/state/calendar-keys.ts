import { accountScope } from '#app/lib/account-scope'

/** Provider ids never contain a line break, so the joined list is unambiguous. */
export function hiddenCalendarsKey(hiddenCalendarIds: readonly string[]): string {
	return hiddenCalendarIds.join('\n')
}

/** Where a range key holds its start; its end follows. */
export const CALENDAR_RANGE_START = 3

/** Every calendar key starts with `['calendar', <account>]`, so one inbox's
 * ranges and invitations can never be read as another's. */
export const calendarKeys = {
	get all() {
		return ['calendar', accountScope()] as const
	},
	ranges: () => [...calendarKeys.all, 'range'] as const,
	/**
	 * A range in Unix seconds. Hidden calendars are not fetched, so they are
	 * part of what a range entry holds: un-hiding one must miss the cache and
	 * load its events.
	 */
	range: (start: number, end: number, hiddenCalendarIds: readonly string[] = []) =>
		[...calendarKeys.all, 'range', start, end, hiddenCalendarsKey(hiddenCalendarIds)] as const,
	invitation: (messageId: string, attachmentId: string) =>
		[...calendarKeys.all, 'invitation', messageId, attachmentId] as const,
}
