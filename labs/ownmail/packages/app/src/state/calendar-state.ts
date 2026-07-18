import type { Event } from '@nylas-labs/cli-kit/v3'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, type CalView, viewRange, ymd } from '../components/calendar.js'
import { createEvent, deleteEvent, getEvents, rsvpEvent, updateEvent } from '../server/calendar-fns.js'
import type {
	CreateEventInput,
	EventIdInput,
	RsvpEventInput,
	UpdateEventInput,
} from '../server/calendar-input.js'
import { getMailboxInfo } from '../server/fns.js'

export type CalendarRouteData = Awaited<ReturnType<typeof loadCalendarRouteData>>

export const calendarKeys = {
	all: ['calendar'] as const,
	range: (start: number, end: number) => ['calendar', 'range', start, end] as const,
}

const CONFIRMED_EFFECT_TTL_MS = 30_000
const confirmedEffects = new WeakMap<QueryClient, Array<{ effect: CalendarEffect; expiresAt: number }>>()

function rememberConfirmedCalendarEffect(queryClient: QueryClient, effect: CalendarEffect) {
	const current = confirmedEffects.get(queryClient) ?? []
	confirmedEffects.set(queryClient, [
		...current.filter((entry) => entry.expiresAt > Date.now()),
		{ effect, expiresAt: Date.now() + CONFIRMED_EFFECT_TTL_MS },
	])
}

function reconcileCalendarData(queryClient: QueryClient, data: CalendarRouteData): CalendarRouteData {
	const active = (confirmedEffects.get(queryClient) ?? []).filter((entry) => entry.expiresAt > Date.now())
	confirmedEffects.set(queryClient, active)
	return {
		...data,
		events: active.reduce((events, entry) => applyEventEffect(events, entry.effect), data.events),
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

export async function loadCalendarRouteData(view: CalView, date?: string) {
	const { anchor, start, end } = calendarRouteRange(view, date)
	const [info, res] = await Promise.all([getMailboxInfo(), getEvents({ data: { start, end } })])
	return { ...res, info, anchorIso: ymd(anchor) }
}

/** Reuses loader data as the initial value while making the query cache the live owner. */
export function useCalendarRouteData(
	view: CalView,
	date: string | undefined,
	initialData: CalendarRouteData,
) {
	const queryClient = useQueryClient()
	const { start, end } = calendarRouteRange(view, date)
	return useQuery({
		queryKey: calendarKeys.range(start, end),
		queryFn: async () => reconcileCalendarData(queryClient, await loadCalendarRouteData(view, date)),
		initialData,
		select: (data) => reconcileCalendarData(queryClient, data),
	})
}

export type CalendarEffect =
	| { type: 'created'; event: Event }
	| { type: 'updated'; event: Event }
	| { type: 'deleted'; eventId: string }
	| { type: 'rsvped'; eventId: string; status: RsvpEventInput['status'] }

function applyEventEffect(events: Event[], effect: CalendarEffect): Event[] {
	switch (effect.type) {
		case 'created': {
			const existing = events.some((event) => event.id === effect.event.id)
			return existing
				? events.map((event) => (event.id === effect.event.id ? effect.event : event))
				: [...events, effect.event]
		}
		case 'updated':
			return events.map((event) => (event.id === effect.event.id ? effect.event : event))
		case 'deleted':
			return events.filter((event) => event.id !== effect.eventId)
		case 'rsvped':
			return events.map((event) =>
				event.id !== effect.eventId
					? event
					: {
							...event,
							participants: event.participants?.map((participant, index) =>
								index === 0 ? { ...participant, status: effect.status } : participant,
							),
						},
			)
	}
}

/** Pure cache reducer applied to every loaded calendar range. */
export function applyCalendarEffect(queryClient: QueryClient, effect: CalendarEffect) {
	queryClient.setQueriesData<CalendarRouteData>({ queryKey: ['calendar', 'range'] }, (data) =>
		data ? { ...data, events: applyEventEffect(data.events, effect) } : data,
	)
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
	void queryClient.invalidateQueries({ queryKey: calendarKeys.all, refetchType: 'active' }).catch(() => {})
}

function findCachedEvent(queryClient: QueryClient, eventId: string): Event | undefined {
	for (const [, data] of queryClient.getQueriesData<CalendarRouteData>({ queryKey: calendarKeys.all })) {
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
			/* v8 ignore next -- mutationFn rejects before success whenever the closed-over event is absent */
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
	return useMutation({
		mutationFn: (input: RsvpEventInput) => rsvpEvent({ data: input }),
		onMutate: async (input) => {
			await queryClient.cancelQueries({ queryKey: calendarKeys.all })
			const snapshot = snapshotCalendar(queryClient)
			applyCalendarEffect(queryClient, { type: 'rsvped', eventId, status: input.status })
			return { snapshot }
		},
		onError: (_error, _input, context) => restoreCalendar(queryClient, context?.snapshot),
		onSuccess: (_receipt, input) => {
			const effect = { type: 'rsvped', eventId, status: input.status } as const
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
