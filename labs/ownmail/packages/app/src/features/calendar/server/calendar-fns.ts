/**
 * Calendar server functions. Same security model as fns.ts: grant id comes
 * from the session, never the client.
 */
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { signalLocalChange } from '#server/change-version'
import { requireMailbox } from '#server/mailbox-boundary'
import { isRenderableCalendarEvent } from '../lib/calendar.js'
import {
	type CalendarIdInput,
	type CalendarNameInput,
	type CreateEventInput,
	type EventIdInput,
	type EventRangeInput,
	normalizeCalendarIdInput,
	normalizeCalendarNameInput,
	normalizeCreateEventInput,
	normalizeEventIdInput,
	normalizeEventRangeInput,
	normalizeRsvpEventInput,
	normalizeUpdateCalendarInput,
	normalizeUpdateEventInput,
	type RsvpEventInput,
	type UpdateCalendarInput,
	type UpdateEventInput,
} from './calendar-input.js'

function friendly(err: unknown): Error {
	if (err instanceof NylasApiError && (err.status === 401 || err.status === 403))
		return new Error('Your mailbox session expired. Sign in again and retry.')
	if (err instanceof NylasApiError && err.status === 429)
		return new Error('Your mailbox is temporarily rate limited. Try again shortly.')
	return new Error('Something went wrong talking to your calendar. Check your connection and try again.')
}

function listData<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : []
}

const CALENDAR_PAGE_SIZE = 50
const EVENT_PAGE_SIZE = 200
/**
 * Safety ceilings on followed page tokens, so a provider that never stops
 * paging cannot hold a request open. Reaching one is reported, never hidden.
 */
export const MAX_CALENDAR_PAGES = 10
export const MAX_EVENT_PAGES_PER_CALENDAR = 10

type Page = { data?: unknown; next_cursor?: unknown }

/** Keeps the first record for each id. Records without a usable id are left for the caller's validation. */
function uniqueById<T>(items: T[]): T[] {
	const seen = new Set<string>()
	return items.filter((item) => {
		const id = (item as { id?: unknown } | null)?.id
		if (typeof id !== 'string') return true
		if (seen.has(id)) return false
		seen.add(id)
		return true
	})
}

/**
 * Follows page tokens until the provider reports no further page, repeats a
 * token it already gave, or the ceiling is reached. A repeated token would
 * refetch a page already held, so the sequence stops there and is reported as
 * incomplete instead of appending copies. Items are returned once per id.
 */
async function listAllPages<T>(
	fetchPage: (pageToken: string | undefined) => Promise<Page>,
	maxPages: number,
): Promise<{ items: T[]; truncated: boolean }> {
	const items: T[] = []
	const seenTokens = new Set<string>()
	let pageToken: string | undefined
	for (let page = 0; page < maxPages; page += 1) {
		const response = await fetchPage(pageToken)
		items.push(...listData<T>(response.data))
		const next = response.next_cursor
		if (typeof next !== 'string' || !next) return { items: uniqueById(items), truncated: false }
		if (seenTokens.has(next)) break
		seenTokens.add(next)
		pageToken = next
	}
	return { items: uniqueById(items), truncated: true }
}

async function primaryCalendar(): Promise<{
	calendar: Calendar
	calendars: Calendar[]
	calendarsTruncated: boolean
	mailbox: Awaited<ReturnType<typeof requireMailbox>>['mailbox']
	grantId: string
}> {
	const { mailbox, grantId } = await requireMailbox()
	const { items: calendars, truncated: calendarsTruncated } = await listAllPages<Calendar>(
		(page_token) =>
			mailbox.listCalendars({ limit: CALENDAR_PAGE_SIZE, ...(page_token ? { page_token } : {}) }),
		MAX_CALENDAR_PAGES,
	).catch((err: unknown) => {
		throw friendly(err)
	})
	const calendar = calendars.find((c) => c.is_primary) ?? calendars[0]
	if (!calendar) throw new Error('No calendar found on this account.')
	return { calendar, calendars, calendarsTruncated, mailbox, grantId }
}

async function authorizedCalendar(calendarId?: string): Promise<Awaited<ReturnType<typeof primaryCalendar>>> {
	const resolved = await primaryCalendar()
	if (!calendarId) return resolved
	const calendar = resolved.calendars.find((c) => c.id === calendarId)
	if (!calendar) throw new Error('Calendar not found.')
	return { ...resolved, calendar }
}

async function managedCalendar(
	calendarId: string,
	operation: 'update' | 'delete',
): Promise<Awaited<ReturnType<typeof primaryCalendar>>> {
	const resolved = await primaryCalendar()
	const calendar = resolved.calendars.find((candidate) => candidate.id === calendarId)
	if (!calendar || calendar.read_only || (operation === 'delete' && calendar.is_primary)) {
		throw new Error('This calendar cannot be changed.')
	}
	return { ...resolved, calendar }
}

export const createCalendar = createServerFn({ method: 'POST' })
	.validator((input: CalendarNameInput) => normalizeCalendarNameInput(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const created = await mailbox.createCalendar({ name: data.name })
			await signalLocalChange(grantId, 'calendar')
			return { calendar: created.data }
		} catch (err) {
			throw friendly(err)
		}
	})

export const updateCalendar = createServerFn({ method: 'POST' })
	.validator((input: UpdateCalendarInput) => normalizeUpdateCalendarInput(input))
	.handler(async ({ data }) => {
		try {
			const { mailbox, calendar, grantId } = await managedCalendar(data.calendarId, 'update')
			const updated = await mailbox.updateCalendar(calendar.id, { name: data.name })
			await signalLocalChange(grantId, 'calendar')
			return { calendar: updated.data }
		} catch (err) {
			if (err instanceof Error && err.message === 'This calendar cannot be changed.') throw err
			throw friendly(err)
		}
	})

export const deleteCalendar = createServerFn({ method: 'POST' })
	.validator((input: CalendarIdInput) => normalizeCalendarIdInput(input))
	.handler(async ({ data }) => {
		try {
			const { mailbox, calendar, grantId } = await managedCalendar(data.calendarId, 'delete')
			await mailbox.deleteCalendar(calendar.id)
			await signalLocalChange(grantId, 'calendar')
			return { removedCalendarId: calendar.id }
		} catch (err) {
			if (err instanceof Error && err.message === 'This calendar cannot be changed.') throw err
			throw friendly(err)
		}
	})

export const getEvents = createServerFn({ method: 'GET' })
	.validator((input: EventRangeInput) => normalizeEventRangeInput(input))
	.handler(
		async ({
			data,
		}): Promise<{ calendar: Calendar; calendars: Calendar[]; events: Event[]; truncated: boolean }> => {
			const { calendar, calendars, calendarsTruncated, mailbox } = await primaryCalendar()
			// Hidden ids only narrow the session grant's own calendar list: they are never
			// used as fetch targets, so they cannot reach a calendar outside this grant.
			const hidden = new Set(data.hiddenCalendarIds)
			const results = await Promise.all(
				calendars
					.filter((cal) => !hidden.has(cal.id))
					.map((cal) =>
						listAllPages<Event>(
							(page_token) =>
								mailbox.listEvents({
									calendar_id: cal.id,
									start: data.start,
									end: data.end,
									limit: EVENT_PAGE_SIZE,
									expand_recurring: true,
									...(page_token ? { page_token } : {}),
								}),
							MAX_EVENT_PAGES_PER_CALENDAR,
						),
					),
			).catch((err: unknown) => {
				throw friendly(err)
			})
			// `request<T>()` cannot validate live JSON at runtime. Drop malformed entries at
			// this external-data boundary so a single provider record cannot crash the calendar.
			// An event id is a render key, so one returned under two calendars is kept once.
			const events = uniqueById(results.flatMap((result) => result.items)).filter(isRenderableCalendarEvent)
			// Never drop events silently: the grid shows a notice when a ceiling was reached.
			const truncated = calendarsTruncated || results.some((result) => result.truncated)
			return { calendar, calendars, events, truncated }
		},
	)

export const createEvent = createServerFn({ method: 'POST' })
	.validator((input: CreateEventInput) => normalizeCreateEventInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox, grantId } = await authorizedCalendar(data.calendarId)
		const when =
			data.allDayDate !== undefined
				? { date: data.allDayDate }
				: {
						start_time: data.startTime as number,
						end_time: data.endTime as number,
						...(data.recurrence ? { start_timezone: data.timezone, end_timezone: data.timezone } : {}),
					}
		try {
			const created = await mailbox.createEvent(
				{
					title: data.title,
					...(data.description ? { description: data.description } : {}),
					...(data.location ? { location: data.location } : {}),
					when,
					...(data.recurrence ? { recurrence: recurrenceRules(data.recurrence) } : {}),
					...(data.participants?.length
						? { participants: data.participants.map((email) => ({ email })) }
						: {}),
				},
				calendar.id,
			)
			await signalLocalChange(grantId, 'calendar')
			return { eventId: created.data.id, event: created.data }
		} catch (err) {
			throw friendly(err)
		}
	})

function recurrenceRules(recurrence: NonNullable<CreateEventInput['recurrence']>): string[] {
	if (recurrence.frequency === 'yearly') return ['RRULE:FREQ=YEARLY']
	return [`RRULE:FREQ=WEEKLY;INTERVAL=${recurrence.interval};BYDAY=${recurrence.weekdays.join(',')}`]
}

export const updateEvent = createServerFn({ method: 'POST' })
	.validator((input: UpdateEventInput) => normalizeUpdateEventInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox, grantId } = await authorizedCalendar(data.calendarId)
		try {
			const updated = await mailbox.updateEvent(
				data.eventId,
				{
					...(data.title !== undefined ? { title: data.title } : {}),
					...(data.description !== undefined ? { description: data.description } : {}),
					...(data.location !== undefined ? { location: data.location } : {}),
					...(data.startTime !== undefined && data.endTime !== undefined
						? { when: { start_time: data.startTime, end_time: data.endTime } }
						: {}),
				},
				calendar.id,
			)
			await signalLocalChange(grantId, 'calendar')
			return { event: updated.data }
		} catch (err) {
			throw friendly(err)
		}
	})

export const deleteEvent = createServerFn({ method: 'POST' })
	.validator((input: EventIdInput) => normalizeEventIdInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox, grantId } = await authorizedCalendar(data.calendarId)
		try {
			await mailbox.deleteEvent(data.eventId, calendar.id)
			await signalLocalChange(grantId, 'calendar')
			return { removedEventId: data.eventId, calendarId: calendar.id }
		} catch (err) {
			throw friendly(err)
		}
	})

export const rsvpEvent = createServerFn({ method: 'POST' })
	.validator((input: RsvpEventInput) => normalizeRsvpEventInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox, grantId } = await authorizedCalendar(data.calendarId)
		try {
			await mailbox.sendRsvp(data.eventId, calendar.id, data.status)
			await signalLocalChange(grantId, 'calendar')
			return {
				eventId: data.eventId,
				calendarId: calendar.id,
				status: data.status,
			}
		} catch (err) {
			throw friendly(err)
		}
	})
