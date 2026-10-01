import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { accountScope } from '#app/lib/account-scope'
import { getFreeBusy } from '#features/calendar/server/calendar-fns'
import {
	FREE_BUSY_FAILED_MESSAGE,
	FREE_BUSY_RATE_LIMITED_MESSAGE,
	type FreeBusyPerson,
} from '../lib/free-busy.js'

/** How long a looked-up range is reused before it is asked for again. */
export const FREE_BUSY_STALE_MS = 5 * 60_000
/** A range or guest list must hold still this long before the provider is asked. */
export const FREE_BUSY_SETTLE_MS = 400

/**
 * Availability has its own cache root. It is not calendar data: the calendar's
 * optimistic updates and invalidations sweep everything under `calendar`, and a
 * colleague's busy times must be neither rewritten nor refetched by them. Like
 * every key it starts with the account, because the lookup runs on that inbox's
 * grant: one inbox's answer is never served to another.
 */
export const freeBusyKeys = {
	get all() {
		return ['free-busy', accountScope()] as const
	},
	range: (start: number, end: number, emails: readonly string[]) =>
		[...freeBusyKeys.all, start, end, [...emails].sort().join('\n')] as const,
}

/**
 * Colleagues' busy times for a range. One request covers everyone, results are
 * cached per range and guest list, and paging quickly through weeks or adding
 * several people in a row waits until the choice settles, so the provider is
 * not called for every intermediate state. A cached range is shown at once;
 * a range or guest list not looked up yet shows nothing until it arrives,
 * never the previous one's times.
 */
export function useFreeBusy(emails: readonly string[], range: { start: number; end: number } | null) {
	const queryKey = freeBusyKeys.range(range?.start ?? 0, range?.end ?? 0, emails)
	const requested = queryKey.join('|')
	const [settled, setSettled] = useState('')
	const wanted = range !== null && emails.length > 0

	useEffect(() => {
		if (!wanted) return
		const timer = setTimeout(() => setSettled(requested), FREE_BUSY_SETTLE_MS)
		return () => clearTimeout(timer)
	}, [requested, wanted])

	const query = useQuery({
		queryKey,
		queryFn: async (): Promise<FreeBusyPerson[]> => {
			const { start, end } = range as { start: number; end: number }
			return (await getFreeBusy({ data: { start, end, emails: [...emails] } })).people
		},
		enabled: wanted && settled === requested,
		staleTime: FREE_BUSY_STALE_MS,
		// A rate limit is not retried: retrying is what makes it worse.
		retry: false,
		refetchOnWindowFocus: false,
	})

	const people = wanted ? (query.data ?? []) : []
	const error = !wanted || !query.error ? null : freeBusyErrorMessage(query.error)
	// Waiting to settle only counts as loading when there is nothing current to show.
	const waiting = settled !== requested && query.data === undefined
	return { people, loading: wanted && (query.isFetching || waiting), error, retry: query.refetch }
}

/** Only the two known, generic messages are ever shown; anything else becomes the generic failure. */
export function freeBusyErrorMessage(error: unknown): string {
	return error instanceof Error && error.message === FREE_BUSY_RATE_LIMITED_MESSAGE
		? FREE_BUSY_RATE_LIMITED_MESSAGE
		: FREE_BUSY_FAILED_MESSAGE
}
