/**
 * Calendar server functions. Same security model as fns.ts: grant id comes
 * from the session, never the client.
 */
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LOGIN_PATH } from '#app/config/route-paths'
import { signalLocalChange } from '#server/change-version'
import { mailboxFromRequest } from '#server/nylas'
import { isRenderableCalendarEvent } from '../lib/calendar.js'
import {
	type CreateEventInput,
	type EventIdInput,
	type EventRangeInput,
	normalizeCreateEventInput,
	normalizeEventIdInput,
	normalizeEventRangeInput,
	normalizeRsvpEventInput,
	normalizeUpdateEventInput,
	type RsvpEventInput,
	type UpdateEventInput,
} from './calendar-input.js'

async function requireMailbox() {
	const resolved = await mailboxFromRequest(getRequest())
	if (!resolved) throw redirect({ to: LOGIN_PATH })
	return resolved
}

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

async function primaryCalendar(): Promise<{
	calendar: Calendar
	calendars: Calendar[]
	mailbox: Awaited<ReturnType<typeof requireMailbox>>['mailbox']
	grantId: string
}> {
	const { mailbox, grantId } = await requireMailbox()
	const response = await mailbox.listCalendars({ limit: 20 }).catch((err: unknown) => {
		throw friendly(err)
	})
	const calendars = listData<Calendar>(response.data)
	const calendar = calendars.find((c) => c.is_primary) ?? calendars[0]
	if (!calendar) throw new Error('No calendar found on this account.')
	return { calendar, calendars, mailbox, grantId }
}

async function authorizedCalendar(calendarId?: string): Promise<{
	calendar: Calendar
	calendars: Calendar[]
	mailbox: Awaited<ReturnType<typeof requireMailbox>>['mailbox']
	grantId: string
}> {
	const resolved = await primaryCalendar()
	if (!calendarId) return resolved
	const calendar = resolved.calendars.find((c) => c.id === calendarId)
	if (!calendar) throw new Error('Calendar not found.')
	return { ...resolved, calendar }
}

export const getEvents = createServerFn({ method: 'GET' })
	.validator((input: EventRangeInput) => normalizeEventRangeInput(input))
	.handler(async ({ data }): Promise<{ calendar: Calendar; calendars: Calendar[]; events: Event[] }> => {
		const { calendar, calendars, mailbox } = await primaryCalendar()
		const eventPages = await Promise.all(
			calendars.map((cal) =>
				mailbox.listEvents({
					calendar_id: cal.id,
					start: data.start,
					end: data.end,
					limit: 200,
					expand_recurring: true,
				}),
			),
		).catch((err: unknown) => {
			throw friendly(err)
		})
		// `request<T>()` cannot validate live JSON at runtime. Drop malformed entries at
		// this external-data boundary so a single provider record cannot crash the calendar.
		const events = eventPages.flatMap((page) => listData<Event>(page.data)).filter(isRenderableCalendarEvent)
		return { calendar, calendars, events }
	})

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
