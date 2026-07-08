/**
 * Calendar server functions. Same security model as fns.ts: grant id comes
 * from the session, never the client.
 */
import type { Calendar, Event } from '@nylas-labs/cli-kit/v3'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LOGIN_PATH } from '../components/route-paths.js'
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
	.validator((input: { start: number; end: number }) => {
		if (input.end <= input.start) throw new Error('Invalid range')
		if (input.end - input.start > 60 * 60 * 24 * 62) throw new Error('Range too large')
		return input
	})
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
		const events = eventPages.flatMap((page) => page.data)
		return { calendar, calendars, events }
	})

export const createEvent = createServerFn({ method: 'POST' })
	.validator(
		(input: {
			title: string
			description?: string
			location?: string
			startTime: number
			endTime: number
			participants?: string[]
			calendarId?: string
		}) => {
			if (!input.title.trim()) throw new Error('Title is required')
			if (input.endTime <= input.startTime) throw new Error('End must be after start')
			if (input.calendarId !== undefined && input.calendarId.length > 200) throw new Error('Invalid calendar')
			for (const email of input.participants ?? []) {
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid participant: ${email}`)
			}
			return input
		},
	)
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
	.validator(
		(input: {
			eventId: string
			calendarId?: string
			title?: string
			description?: string
			location?: string
			startTime?: number
			endTime?: number
		}) => input,
	)
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		await mailbox.updateEvent(
			data.eventId,
			{
				...(data.title !== undefined ? { title: data.title } : {}),
				...(data.description !== undefined ? { description: data.description } : {}),
				...(data.location !== undefined ? { location: data.location } : {}),
				...(data.startTime && data.endTime
					? { when: { start_time: data.startTime, end_time: data.endTime } }
					: {}),
			},
			calendar.id,
		)
		return { ok: true }
	})

export const deleteEvent = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; calendarId?: string }) => input)
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		await mailbox.deleteEvent(data.eventId, calendar.id)
		return { ok: true }
	})

export const rsvpEvent = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; calendarId?: string; status: 'yes' | 'no' | 'maybe' }) => {
		if (!['yes', 'no', 'maybe'].includes(input.status)) throw new Error('Invalid RSVP')
		return input
	})
	.handler(async ({ data }) => {
		const { calendar, mailbox } = await authorizedCalendar(data.calendarId)
		await mailbox.sendRsvp(data.eventId, calendar.id, data.status)
		return { ok: true }
	})
