import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { accountScope } from '#app/lib/account-scope'
import {
	hiddenCalendarIdsFor,
	readUserPreferences,
	useUserPreferences,
	useUserPreferencesReady,
} from '#app/preferences/user-preferences'
import { ensureMailboxInfo, mailboxInfoQueryOptions } from '#app/query/mailbox-info'
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
	type OptimisticWrite,
	recordOptimisticWrite,
	undoOptimisticWrite,
} from '#shared/lib/optimistic-write'
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
import { CALENDAR_RANGE_START, calendarKeys, hiddenCalendarsKey } from './calendar-keys.js'

export { calendarKeys }

/** One cached event range. Route-only values (mailbox info, anchor) stay out of the cache. */
export type CalendarRangeData = Awaited<ReturnType<typeof getEvents>>
export type CalendarRouteData = Awaited<ReturnType<typeof loadCalendarRouteData>>

/** A fetched range in Unix seconds, as stored in the range query key. */
export type CalendarRange = { start: number; end: number }

const CONFIRMED_EFFECT_TTL_MS = 30_000
// Each receipt remembers the account it was confirmed for; it is only replayed
// onto that account's ranges.
const confirmedEffects = new WeakMap<
	QueryClient,
	Array<{ account: string; effect: CalendarEffect; expiresAt: number }>
>()

/** Drop replayed calendar receipts when the cache is cleared for another inbox. */
export function resetCalendarConfirmedEffects(queryClient: QueryClient): void {
	confirmedEffects.delete(queryClient)
	// Requests still in flight for the previous inbox may not write into the next one.
	eventWrites.delete(queryClient)
}

function rememberConfirmedCalendarEffect(queryClient: QueryClient, effect: CalendarEffect) {
	const current = confirmedEffects.get(queryClient) ?? []
	confirmedEffects.set(queryClient, [
		...current.filter((entry) => entry.expiresAt > Date.now()),
		{ account: accountScope(), effect, expiresAt: Date.now() + CONFIRMED_EFFECT_TTL_MS },
	])
}

/**
 * Sets aside the receipts remembered for an event's earlier create or update.
 * They hold its previous times, and replaying them over a newer local change
 * would draw the event back where it was. Returns how to put them back if that
 * newer change is rejected.
 */
function supersedeConfirmedEventEffects(queryClient: QueryClient, eventId: string): () => void {
	const previous = confirmedEffects.get(queryClient) ?? []
	const account = accountScope()
	confirmedEffects.set(
		queryClient,
		previous.filter(
			(entry) =>
				!(
					entry.account === account &&
					(entry.effect.type === 'created' || entry.effect.type === 'updated') &&
					entry.effect.event.id === eventId
				),
		),
	)
	return () => {
		confirmedEffects.set(queryClient, previous)
	}
}

function reconcileCalendarData<T extends { events: Event[] }>(
	queryClient: QueryClient,
	data: T,
	range: CalendarRange,
): T {
	const active = (confirmedEffects.get(queryClient) ?? []).filter((entry) => entry.expiresAt > Date.now())
	confirmedEffects.set(queryClient, active)
	const account = accountScope()
	return {
		...data,
		events: active
			.filter((entry) => entry.account === account)
			.reduce((events, entry) => applyEventEffect(events, entry.effect, range), data.events),
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
	// The mailbox comes first, for two reasons: the range key is partitioned by
	// account, and hidden calendars are a per-mailbox device preference. On the
	// server there are no stored preferences and every calendar is fetched.
	const info = await ensureMailboxInfo(queryClient)
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
	const loadedForTheseCalendars =
		hiddenCalendarsKey(hiddenCalendarIds) === hiddenCalendarsKey(initialData.hiddenCalendarIds)
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

/**
 * The hidden calendars to leave out of event requests for one mailbox. It reads
 * the stored preference synchronously, so the first client render already asks
 * for the right calendars, and follows later changes. While hydrating it
 * repeats the ids the loader used, which keeps server and client output equal.
 */
export function useHiddenCalendarIdsForRequest(email: string, loaderIds: readonly string[]): string[] {
	// The one shared preference store: no second subscription to keep in step.
	const [preferences] = useUserPreferences()
	const ready = useUserPreferencesReady()
	const key = hiddenCalendarsKey(
		ready ? hiddenCalendarIdsForRequest(hiddenCalendarIdsFor(preferences, email)) : loaderIds,
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
		queryKey: calendarKeys.ranges(),
	})) {
		const [start, end] = queryKey.slice(CALENDAR_RANGE_START, CALENDAR_RANGE_START + 2)
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

/** Undoes a failed optimistic write without touching anything it did not change
 * or anything the server has replaced since, then asks the server what is true. */
function restoreCalendar(queryClient: QueryClient, written: OptimisticWrite | undefined) {
	undoOptimisticWrite(queryClient, written)
	refreshCalendar(queryClient)
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
			const optimisticId = `optimistic-event-${crypto.randomUUID()}`
			const written = recordOptimisticWrite(queryClient, calendarKeys.all, () =>
				applyCalendarEffect(queryClient, { type: 'created', event: eventFromCreate(optimisticId, input) }),
			)
			return { written, optimisticId }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.written),
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

/*
 * Changes to one event can overlap: it is dragged again, or saved again, before
 * the previous request has settled, and the responses may arrive in either
 * order. Each change takes a number in the order it was made. Only the newest
 * change still standing may write its result: an older response is discarded,
 * and an older failure does not undo what came after it.
 */
type EventWrites = { issued: number; failed: Set<number>; pending: Map<number, OptimisticWrite> }
type EventWriteTicket = { key: string; sequence: number }

const eventWrites = new WeakMap<QueryClient, Map<string, EventWrites>>()

function issueEventWrite(queryClient: QueryClient, eventId: string): EventWriteTicket {
	const byEvent = eventWrites.get(queryClient) ?? new Map<string, EventWrites>()
	eventWrites.set(queryClient, byEvent)
	// Event ids are only unique within one inbox.
	const key = `${accountScope()}\n${eventId}`
	const writes = byEvent.get(key) ?? { issued: 0, failed: new Set<number>(), pending: new Map() }
	byEvent.set(key, writes)
	writes.issued += 1
	writes.pending.set(writes.issued, [])
	return { key, sequence: writes.issued }
}

function trackEventWrite(queryClient: QueryClient, ticket: EventWriteTicket, written: OptimisticWrite) {
	eventWrites.get(queryClient)?.get(ticket.key)?.pending.set(ticket.sequence, written)
}

/**
 * Closes one change and says whether it is the newest still standing, which is
 * the only one allowed to apply its response or roll back.
 *
 * When an older change fails underneath a newer one, the newer one's rollback
 * target is moved back past it: what the newer change would restore was the
 * failed change's unconfirmed value.
 */
function settleEventWrite(queryClient: QueryClient, ticket: EventWriteTicket, failed: boolean): boolean {
	const writes = eventWrites.get(queryClient)?.get(ticket.key)
	// The cache was cleared for another inbox while this request was in flight.
	if (!writes) return false
	const own = writes.pending.get(ticket.sequence) as OptimisticWrite
	writes.pending.delete(ticket.sequence)
	if (failed) writes.failed.add(ticket.sequence)
	let newest = true
	for (let later = ticket.sequence + 1; later <= writes.issued; later += 1) {
		if (!writes.failed.has(later)) newest = false
	}
	if (failed && !newest) {
		for (const laterWrite of writes.pending.values()) {
			for (const entry of laterWrite) {
				const undone = own.find((candidate) => candidate.after === entry.before)
				if (undone) entry.before = undone.before
			}
		}
	}
	if (writes.pending.size === 0) eventWrites.get(queryClient)?.delete(ticket.key)
	return newest
}

/**
 * Rolls back a failed change to an event, unless a newer change to it is still
 * standing. The rollback restores only what this change wrote, then asks the
 * server what is true.
 */
function rollBackEventWrite(
	queryClient: QueryClient,
	context: { ticket: EventWriteTicket; written: OptimisticWrite; restoreReceipts: () => void },
) {
	if (!settleEventWrite(queryClient, context.ticket, true)) return
	context.restoreReceipts()
	undoOptimisticWrite(queryClient, context.written)
	// An older change still in flight wrote the value just restored. The cache
	// may hold it as a new object, and that is the one the older change must
	// recognise as its own if it fails too.
	const stillPending = eventWrites.get(queryClient)?.get(context.ticket.key)?.pending.values() ?? []
	for (const earlier of stillPending) {
		for (const entry of earlier) {
			const restored = context.written.find((candidate) => candidate.before === entry.after)
			if (restored) entry.after = queryClient.getQueryData(restored.queryKey)
		}
	}
	refreshCalendar(queryClient)
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
			const ticket = issueEventWrite(queryClient, event.id)
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			// The receipt of an earlier save holds the event's previous fields; it
			// must not be replayed over this newer change.
			const restoreReceipts = supersedeConfirmedEventEffects(queryClient, event.id)
			const written = recordOptimisticWrite(queryClient, calendarKeys.all, () =>
				applyCalendarEffect(queryClient, { type: 'updated', event: eventFromUpdate(event, input) }),
			)
			trackEventWrite(queryClient, ticket, written)
			return { written, restoreReceipts, ticket }
		},
		onError: (_error, _input, context) => {
			// A newer save of this event still standing is not undone.
			if (context) rollBackEventWrite(queryClient, context)
		},
		onSuccess: (receipt, input, context) => {
			/* v8 ignore next -- mutationFn rejects before success whenever the closed-over event is absent -- @preserve */
			if (!event || !context) return
			// A newer save of this event was made since: this older response is discarded.
			if (!settleEventWrite(queryClient, context.ticket, false)) return
			const current = findCachedEvent(queryClient, event.id) ?? event
			const canonical = 'event' in receipt && receipt.event ? receipt.event : undefined
			const effect = {
				type: 'updated',
				event: canonical ?? eventFromUpdate(current, input),
			} as const
			// Remembered before it is applied: the views re-read the receipts when the cache changes.
			rememberConfirmedCalendarEffect(queryClient, effect)
			applyCalendarEffect(queryClient, effect)
			refreshCalendar(queryClient)
		},
	})
}

/** New times for one event, e.g. from a drag in the time grid. */
export type RescheduleEventInput = { event: Event; startTime: number; endTime: number }

/**
 * Moves or resizes any event through the same `updateEvent` path the editor
 * uses: the cache changes at once and is restored if the provider rejects it.
 * The event travels with each call, so one hook serves every event in the grid.
 */
export function useRescheduleEventMutation() {
	const queryClient = useQueryClient()
	const updateInput = ({ event, startTime, endTime }: RescheduleEventInput): UpdateEventInput => ({
		eventId: event.id,
		...(event.calendar_id ? { calendarId: event.calendar_id } : {}),
		startTime,
		endTime,
	})
	return useMutation({
		mutationFn: (input: RescheduleEventInput) => updateEvent({ data: updateInput(input) }),
		onMutate: async (input) => {
			const ticket = issueEventWrite(queryClient, input.event.id)
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			// An event is often dragged again within moments; its last confirmed
			// position must not be replayed over the new one.
			const restoreReceipts = supersedeConfirmedEventEffects(queryClient, input.event.id)
			const written = recordOptimisticWrite(queryClient, calendarKeys.all, () =>
				applyCalendarEffect(queryClient, {
					type: 'updated',
					event: eventFromUpdate(input.event, updateInput(input)),
				}),
			)
			trackEventWrite(queryClient, ticket, written)
			return { written, restoreReceipts, ticket }
		},
		onError: (_error, _input, context) => {
			// The event was moved again since: that newer position is not undone.
			/* v8 ignore next -- @preserve failed library callbacks always receive the context returned by onMutate */
			if (!context) return
			// Only the ranges this drag changed are put back, then the server is asked.
			rollBackEventWrite(queryClient, context)
		},
		onSuccess: (receipt, input, context) => {
			// The event was moved again since: this older response must neither
			// redraw it nor be remembered as its confirmed position.
			/* v8 ignore next -- @preserve successful library callbacks always receive the context returned by onMutate */
			if (!context) return
			if (!settleEventWrite(queryClient, context.ticket, false)) return
			const current = findCachedEvent(queryClient, input.event.id) ?? input.event
			const canonical = 'event' in receipt && receipt.event ? receipt.event : undefined
			const effect = {
				type: 'updated',
				event: canonical ?? eventFromUpdate(current, updateInput(input)),
			} as const
			// Remembered before it is applied: the views re-read the receipts when the cache changes.
			rememberConfirmedCalendarEffect(queryClient, effect)
			applyCalendarEffect(queryClient, effect)
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
			const written = recordOptimisticWrite(queryClient, calendarKeys.all, () =>
				applyCalendarEffect(queryClient, { type: 'deleted', eventId }),
			)
			return { written }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.written),
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
			const written = recordOptimisticWrite(queryClient, calendarKeys.all, () =>
				applyCalendarEffect(queryClient, {
					type: 'rsvped',
					eventId,
					status: input.status,
					email: signedInEmail(),
				}),
			)
			return { written }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.written),
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
