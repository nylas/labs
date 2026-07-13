/**
 * Calendar server functions. Same security model as fns.ts: grant id comes
 * from the session, never the client.
 */
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { isRenderableCalendarEvent } from '../components/calendar.js'
import { LOGIN_PATH } from '../components/route-paths.js'
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
import { mailboxFromRequest } from './nylas.js'

async function requireMailbox() {
	const resolved = await mailboxFromRequest(getRequest())
	if (!resolved) throw redirect({ to: LOGIN_PATH })
	return resolved
}

async function primaryCalendar(): Promise<{
	calendar: Calendar
	calendars: Calendar[]
	mailbox: Awaited<ReturnType<typeof requireMailbox>>['mailbox']
}> {
	const { mailbox } = await requireMailbox()
	const calendars = await mailbox.listCalendars({ limit: 20 })
	const calendar = calendars.data.find((c) => c.is_primary) ?? calendars.data[0]
	if (!calendar) throw new Error('No calendar found on this account.')
	return { calendar, calendars: calendars.data, mailbox }
}

async function authorizedCalendar(calendarId?: string): Promise<{
	calendar: Calendar
	calendars: Calendar[]
	mailbox: Awaited<ReturnType<typeof requireMailbox>>['mailbox']
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
		)
		// `request<T>()` cannot validate live JSON at runtime. Drop malformed entries at
		// this external-data boundary so a single provider record cannot crash the calendar.
		const events = eventPages.flatMap((page) => page.data).filter(isRenderableCalendarEvent)
		return { calendar, calendars, events }
	})

export const createEvent = createServerFn({ method: 'POST' })
	.validator((input: CreateEventInput) => normalizeCreateEventInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		const created = await mailbox.createEvent(
			{
				title: data.title,
				...(data.description ? { description: data.description } : {}),
				...(data.location ? { location: data.location } : {}),
				when: { start_time: data.startTime, end_time: data.endTime },
				...(data.participants?.length ? { participants: data.participants.map((email) => ({ email })) } : {}),
			},
			calendar.id,
		)
		return { eventId: created.data.id }
	})

export const updateEvent = createServerFn({ method: 'POST' })
	.validator((input: UpdateEventInput) => normalizeUpdateEventInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		await mailbox.updateEvent(
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
		return { ok: true }
	})

export const deleteEvent = createServerFn({ method: 'POST' })
	.validator((input: EventIdInput) => normalizeEventIdInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		await mailbox.deleteEvent(data.eventId, calendar.id)
		return { ok: true }
	})

export const rsvpEvent = createServerFn({ method: 'POST' })
	.validator((input: RsvpEventInput) => normalizeRsvpEventInput(input))
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		await mailbox.sendRsvp(data.eventId, calendar.id, data.status)
		return { ok: true }
	})
