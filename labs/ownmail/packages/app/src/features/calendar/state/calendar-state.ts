import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { hiddenCalendarIdsFor, readUserPreferences } from '#app/preferences/user-preferences'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import {
	createEvent,
	deleteEvent,
	getEvents,
	rsvpEvent,
	updateEvent,
} from '#features/calendar/server/calendar-fns'
import type {
	CreateEventInput,
	EventIdInput,
	RsvpEventInput,
	UpdateEventInput,
} from '#features/calendar/server/calendar-input'
import {
	addDays,
	type CalView,
	eventTimes,
	hiddenCalendarIdsForRequest,
	shiftAnchor,
	viewRange,
	ymd,
} from '../lib/calendar.js'
import { isSameEmail } from '../lib/calendar-ui-model.js'

/** One cached event range. Route-only values (mailbox info, anchor) stay out of the cache. */
export type CalendarRangeData = Awaited<ReturnType<typeof getEvents>>
export type CalendarRouteData = Awaited<ReturnType<typeof loadCalendarRouteData>>

/** A fetched range in Unix seconds, as stored in the range query key. */
export type CalendarRange = { start: number; end: number }

export const calendarKeys = {
	all: ['calendar'] as const,
	/**
	 * Hidden calendars are not fetched, so they are part of what a range entry
	 * holds: un-hiding one must miss the cache and load its events.
	 */
	range: (start: number, end: number, hiddenCalendarIds: readonly string[] = []) =>
		['calendar', 'range', start, end, hiddenKey(hiddenCalendarIds)] as const,
}

/** Provider ids never contain a line break, so the joined list is unambiguous. */
function hiddenKey(hiddenCalendarIds: readonly string[]): string {
	return hiddenCalendarIds.join('\n')
}

const CONFIRMED_EFFECT_TTL_MS = 30_000
const confirmedEffects = new WeakMap<QueryClient, Array<{ effect: CalendarEffect; expiresAt: number }>>()

/** Drop replayed calendar receipts when the cache is cleared for another inbox. */
export function resetCalendarConfirmedEffects(queryClient: QueryClient): void {
	confirmedEffects.delete(queryClient)
}

function rememberConfirmedCalendarEffect(queryClient: QueryClient, effect: CalendarEffect) {
	const current = confirmedEffects.get(queryClient) ?? []
	confirmedEffects.set(queryClient, [
		...current.filter((entry) => entry.expiresAt > Date.now()),
		{ effect, expiresAt: Date.now() + CONFIRMED_EFFECT_TTL_MS },
	])
}

function reconcileCalendarData<T extends { events: Event[] }>(
	queryClient: QueryClient,
	data: T,
	range: CalendarRange,
): T {
	const active = (confirmedEffects.get(queryClient) ?? []).filter((entry) => entry.expiresAt > Date.now())
	confirmedEffects.set(queryClient, active)
	return {
		...data,
		events: active.reduce((events, entry) => applyEventEffect(events, entry.effect, range), data.events),
	}
}

export function calendarRouteRange(view: CalView, date?: string) {
	const anchor = date ? new Date(`${date}T00:00:00`) : new Date()
	const visibleRange = viewRange(view, anchor)
	// Include a day on either side because display timezone is a client preference.
	const start = Math.floor(addDays(visibleRange.start, -1).getTime() / 1000)
	const end = Math.floor(addDays(visibleRange.end, 1).getTime() / 1000)
	return { anchor, start, end }
}

/** The shared cache entry for one fetched range, used by the loader, the view, and prefetching. */
export function calendarRangeQueryOptions(
	queryClient: QueryClient,
	start: number,
	end: number,
	hiddenCalendarIds: readonly string[] = [],
) {
	return queryOptions({
		queryKey: calendarKeys.range(start, end, hiddenCalendarIds),
		queryFn: async (): Promise<CalendarRangeData> =>
			reconcileCalendarData(
				queryClient,
				await getEvents({
					data: {
						start,
						end,
						...(hiddenCalendarIds.length ? { hiddenCalendarIds: [...hiddenCalendarIds] } : {}),
					},
				}),
				{ start, end },
			),
	})
}

/**
 * Serves ranges already in the query cache immediately, so revisiting a week or
 * month does not block navigation on the provider. Stale entries are refreshed in
 * the background by the mounted view query.
 */
export async function loadCalendarRouteData(queryClient: QueryClient, view: CalView, date?: string) {
	const { anchor, start, end } = calendarRouteRange(view, date)
	// Hidden calendars are a per-mailbox device preference, so the mailbox must be
	// known before the range is requested. On the server there are no stored
	// preferences and every calendar is fetched.
	const info = await queryClient.ensureQueryData(mailboxInfoQueryOptions())
	const hiddenCalendarIds = hiddenCalendarIdsForRequest(
		hiddenCalendarIdsFor(readUserPreferences(), info.email),
	)
	const range = await queryClient.ensureQueryData(
		calendarRangeQueryOptions(queryClient, start, end, hiddenCalendarIds),
	)
	return {
		calendar: range.calendar,
		calendars: range.calendars,
		events: reconcileCalendarData(queryClient, range, { start, end }).events,
		truncated: range.truncated,
		hiddenCalendarIds,
		info,
		anchorIso: ymd(anchor),
	}
}

/** Reuses loader data as the initial value while making the query cache the live owner. */
export function useCalendarRouteData(
	view: CalView,
	date: string | undefined,
	initialData: CalendarRouteData,
	hiddenCalendarIds: readonly string[] = initialData.hiddenCalendarIds,
) {
	const queryClient = useQueryClient()
	const { start, end } = calendarRouteRange(view, date)
	const loadedForTheseCalendars = hiddenKey(hiddenCalendarIds) === hiddenKey(initialData.hiddenCalendarIds)
	const query = useQuery({
		...calendarRangeQueryOptions(queryClient, start, end, hiddenCalendarIds),
		initialData: {
			calendar: initialData.calendar,
			calendars: initialData.calendars,
			events: initialData.events,
			truncated: initialData.truncated,
		},
		// Loader data fetched for a different set of hidden calendars is only a
		// stand-in: mark it stale so the right set loads straight away.
		...(loadedForTheseCalendars ? {} : { initialDataUpdatedAt: 0 }),
		select: (data) => reconcileCalendarData(queryClient, data, { start, end }),
	})
	const data: CalendarRouteData = {
		...query.data,
		hiddenCalendarIds: initialData.hiddenCalendarIds,
		info: initialData.info,
		anchorIso: initialData.anchorIso,
	}
	return { data, refetch: query.refetch }
}

function subscribeToPreferences(onChange: () => void) {
	window.addEventListener('storage', onChange)
	window.addEventListener('ownmail:user-preferences', onChange)
	return () => {
		window.removeEventListener('storage', onChange)
		window.removeEventListener('ownmail:user-preferences', onChange)
	}
}

/**
 * The hidden calendars to leave out of event requests for one mailbox. It reads
 * the stored preference synchronously, so the first client render already asks
 * for the right calendars, and follows later changes. While hydrating it
 * repeats the ids the loader used, which keeps server and client output equal.
 */
export function useHiddenCalendarIdsForRequest(email: string, loaderIds: readonly string[]): string[] {
	const key = useSyncExternalStore(
		subscribeToPreferences,
		() => hiddenKey(hiddenCalendarIdsForRequest(hiddenCalendarIdsFor(readUserPreferences(), email))),
		() => hiddenKey(loaderIds),
	)
	return useMemo(() => (key ? key.split('\n') : []), [key])
}

/** Ranges one step before and after the visible view, so Previous and Next are instant. */
export function adjacentCalendarRanges(view: CalView, anchorIso: string) {
	const anchor = new Date(`${anchorIso}T00:00:00`)
	return ([-1, 1] as const).map((direction) =>
		calendarRouteRange(view, ymd(shiftAnchor(view, anchor, direction))),
	)
}

export function usePrefetchAdjacentCalendarRanges(
	view: CalView,
	anchorIso: string,
	hiddenCalendarIds: readonly string[] = [],
) {
	const queryClient = useQueryClient()
	useEffect(() => {
		for (const { start, end } of adjacentCalendarRanges(view, anchorIso)) {
			// prefetchQuery never throws and skips ranges that are already fresh.
			void queryClient.prefetchQuery(calendarRangeQueryOptions(queryClient, start, end, hiddenCalendarIds))
		}
	}, [anchorIso, hiddenCalendarIds, queryClient, view])
}

export type CalendarEffect =
	| { type: 'created'; event: Event }
	| { type: 'updated'; event: Event }
	| { type: 'deleted'; eventId: string }
	| { type: 'rsvped'; eventId: string; status: RsvpEventInput['status']; email: string }

export type CalendarResourceEffect =
	| { type: 'created'; calendar: Calendar }
	| { type: 'updated'; calendar: Calendar }
	| { type: 'deleted'; calendarId: string }

export function applyCalendarResourceEffect(queryClient: QueryClient, effect: CalendarResourceEffect) {
	queryClient.setQueriesData<CalendarRangeData>({ queryKey: calendarKeys.all }, (data) => {
		if (!data) return data
		if (effect.type === 'deleted') {
			const calendars = data.calendars.filter((calendar) => calendar.id !== effect.calendarId)
			const calendar = calendars.find((candidate) => candidate.is_primary) ?? calendars[0]
			if (!calendar) return data
			return {
				...data,
				calendar,
				calendars,
				events: data.events.filter((event) => event.calendar_id !== effect.calendarId),
			}
		}
		const found = data.calendars.some((calendar) => calendar.id === effect.calendar.id)
		const calendars = found
			? data.calendars.map((calendar) => (calendar.id === effect.calendar.id ? effect.calendar : calendar))
			: [...data.calendars, effect.calendar]
		return {
			...data,
			calendars,
			calendar: data.calendar.id === effect.calendar.id ? effect.calendar : data.calendar,
		}
	})
}

/**
 * Whether an event belongs in a fetched range. Events without parseable times
 * cannot be placed, so they are left wherever the provider returned them.
 */
function eventOverlapsRange(event: Event, range: CalendarRange): boolean | undefined {
	const times = eventTimes(event)
	if (!times) return undefined
	return times.start.getTime() < range.end * 1000 && times.end.getTime() > range.start * 1000
}

/**
 * Places a created or rescheduled event: it is upserted into a range it now
 * overlaps and removed from one it no longer overlaps, so moving an event into an
 * already-cached (e.g. prefetched) week shows it there immediately.
 */
function placeEvent(events: Event[], next: Event, range: CalendarRange): Event[] {
	const existing = events.some((event) => event.id === next.id)
	const overlaps = eventOverlapsRange(next, range)
	if (overlaps === false) return existing ? events.filter((event) => event.id !== next.id) : events
	if (existing) return events.map((event) => (event.id === next.id ? next : event))
	return overlaps ? [...events, next] : events
}

function applyEventEffect(events: Event[], effect: CalendarEffect, range: CalendarRange): Event[] {
	switch (effect.type) {
		case 'created':
		case 'updated':
			return placeEvent(events, effect.event, range)
		case 'deleted':
			return events.filter((event) => event.id !== effect.eventId)
		case 'rsvped':
			return events.map((event) =>
				event.id !== effect.eventId
					? event
					: {
							...event,
							// Only the signed-in user's own entry changes: the grid styles an
							// event from that entry, wherever it sits in the guest list.
							participants: event.participants?.map((participant) =>
								isSameEmail(participant.email, effect.email)
									? { ...participant, status: effect.status }
									: participant,
							),
						},
			)
	}
}

/** Pure cache reducer applied to every loaded calendar range. */
export function applyCalendarEffect(queryClient: QueryClient, effect: CalendarEffect) {
	for (const [queryKey, data] of queryClient.getQueriesData<CalendarRangeData>({
		queryKey: ['calendar', 'range'],
	})) {
		const [, , start, end] = queryKey
		if (!data || typeof start !== 'number' || typeof end !== 'number') continue
		queryClient.setQueryData<CalendarRangeData>(queryKey, {
			...data,
			events: applyEventEffect(data.events, effect, { start, end }),
		})
	}
}

function eventFromCreate(eventId: string, input: CreateEventInput): Event {
	const when = input.allDayDate
		? { object: 'date' as const, date: input.allDayDate }
		: {
				object: 'timespan' as const,
				start_time: input.startTime as number,
				end_time: input.endTime as number,
			}
	return {
		id: eventId,
		calendar_id: input.calendarId,
		title: input.title,
		when,
		...(input.description ? { description: input.description } : {}),
		...(input.location ? { location: input.location } : {}),
		...(input.participants?.length
			? { participants: input.participants.map((email) => ({ email, status: 'noreply' as const })) }
			: {}),
	} as Event
}

function eventFromUpdate(previous: Event, input: UpdateEventInput): Event {
	return {
		...previous,
		...(input.title !== undefined ? { title: input.title } : {}),
		...(input.location !== undefined ? { location: input.location } : {}),
		...(input.description !== undefined ? { description: input.description } : {}),
		...(input.startTime !== undefined && input.endTime !== undefined
			? {
					when: {
						object: 'timespan' as const,
						start_time: input.startTime,
						end_time: input.endTime,
					},
				}
			: {}),
	} as Event
}

type CalendarSnapshot = ReturnType<QueryClient['getQueriesData']>

function snapshotCalendar(queryClient: QueryClient): CalendarSnapshot {
	return queryClient.getQueriesData({ queryKey: calendarKeys.all })
}

function restoreCalendar(queryClient: QueryClient, snapshot: CalendarSnapshot | undefined) {
	for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data)
}

function refreshCalendar(queryClient: QueryClient) {
	// Do not await reconciliation from mutation callbacks: a provider read failure
	// cannot make an already-confirmed write appear to have failed.
	void queryClient.invalidateQueries({ queryKey: calendarKeys.all, refetchType: 'active' }).catch(
		/* v8 ignore next -- @preserve background reconciliation failures are intentionally detached and have no observable mutation result */
		() => {},
	)
}

function findCachedEvent(queryClient: QueryClient, eventId: string): Event | undefined {
	for (const [, data] of queryClient.getQueriesData<CalendarRangeData>({ queryKey: calendarKeys.all })) {
		const event = data?.events.find((candidate) => candidate.id === eventId)
		if (event) return event
	}
	return undefined
}

export function useCreateEventMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: CreateEventInput) => createEvent({ data: input }),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			const snapshot = snapshotCalendar(queryClient)
			const optimisticId = `optimistic-event-${crypto.randomUUID()}`
			applyCalendarEffect(queryClient, { type: 'created', event: eventFromCreate(optimisticId, input) })
			return { snapshot, optimisticId }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.snapshot),
		onSuccess: (receipt, input, context) => {
			/* v8 ignore else -- @preserve successful library callbacks always receive the context returned by onMutate */
			if (context) applyCalendarEffect(queryClient, { type: 'deleted', eventId: context.optimisticId })
			const canonical = 'event' in receipt && receipt.event ? receipt.event : undefined
			const effect = {
				type: 'created',
				event: canonical ?? eventFromCreate(receipt.eventId, input),
			} as const
			applyCalendarEffect(queryClient, effect)
			rememberConfirmedCalendarEffect(queryClient, effect)
			refreshCalendar(queryClient)
		},
	})
}

export function useUpdateEventMutation(event: Event | null) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: UpdateEventInput) => {
			if (!event) throw new Error('Event is required')
			return updateEvent({ data: input })
		},
		onMutate: async (input) => {
			if (!event) return undefined
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			const snapshot = snapshotCalendar(queryClient)
			applyCalendarEffect(queryClient, { type: 'updated', event: eventFromUpdate(event, input) })
			return { snapshot }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.snapshot),
		onSuccess: (receipt, input) => {
			/* v8 ignore next -- mutationFn rejects before success whenever the closed-over event is absent -- @preserve */
			if (!event) return
			const current = findCachedEvent(queryClient, event.id) ?? event
			const canonical = 'event' in receipt && receipt.event ? receipt.event : undefined
			const effect = {
				type: 'updated',
				event: canonical ?? eventFromUpdate(current, input),
			} as const
			applyCalendarEffect(queryClient, effect)
			rememberConfirmedCalendarEffect(queryClient, effect)
			refreshCalendar(queryClient)
		},
	})
}

export function useDeleteEventMutation(eventId: string) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: EventIdInput) => deleteEvent({ data: input }),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			const snapshot = snapshotCalendar(queryClient)
			applyCalendarEffect(queryClient, { type: 'deleted', eventId })
			return { snapshot }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.snapshot),
		onSuccess: () => {
			const effect = { type: 'deleted', eventId } as const
			applyCalendarEffect(queryClient, effect)
			rememberConfirmedCalendarEffect(queryClient, effect)
			refreshCalendar(queryClient)
		},
	})
}

export function useRsvpEventMutation(eventId: string) {
	const queryClient = useQueryClient()
	// The answer belongs to the signed-in mailbox. Without a known mailbox no entry
	// is changed optimistically and the provider read reconciles the event.
	const signedInEmail = () => queryClient.getQueryData(mailboxInfoQueryOptions().queryKey)?.email ?? ''
	return useMutation({
		mutationFn: (input: RsvpEventInput) => rsvpEvent({ data: input }),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			const snapshot = snapshotCalendar(queryClient)
			applyCalendarEffect(queryClient, {
				type: 'rsvped',
				eventId,
				status: input.status,
				email: signedInEmail(),
			})
			return { snapshot }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.snapshot),
		onSuccess: (_receipt, input) => {
			const effect = { type: 'rsvped', eventId, status: input.status, email: signedInEmail() } as const
			applyCalendarEffect(queryClient, effect)
			rememberConfirmedCalendarEffect(queryClient, effect)
			refreshCalendar(queryClient)
		},
	})
}

export const calendarStateTestApi = {
	findCachedEvent,
	rememberConfirmedCalendarEffect,
	reconcileCalendarData,
}
