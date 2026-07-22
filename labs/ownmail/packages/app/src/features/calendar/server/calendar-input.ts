import { requireNylasProviderId } from '../../../server/ids.js'

const MAX_EVENT_RANGE_SECONDS = 60 * 60 * 24 * 62
const MAX_TITLE_LENGTH = 500
const MAX_LOCATION_LENGTH = 1000
const MAX_DESCRIPTION_LENGTH = 100_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RSVP_STATUSES = ['yes', 'no', 'maybe'] as const
const RECURRENCE_FREQUENCIES = ['weekly', 'yearly'] as const
const RECURRENCE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

type RsvpStatus = (typeof RSVP_STATUSES)[number]
export type RecurrenceWeekday = (typeof RECURRENCE_WEEKDAYS)[number]
export type EventRecurrence =
	| { frequency: 'weekly'; interval: 1 | 2; weekdays: RecurrenceWeekday[] }
	| { frequency: 'yearly'; interval: 1; weekdays?: never }

export type EventRangeInput = {
	start: number
	end: number
}

export type CreateEventInput = {
	title: string
	description?: string
	location?: string
	startTime?: number
	endTime?: number
	allDayDate?: string
	timezone?: string
	recurrence?: EventRecurrence
	participants?: string[]
	calendarId?: string
}

export type UpdateEventInput = {
	eventId: string
	calendarId?: string
	title?: string
	description?: string
	location?: string
	startTime?: number
	endTime?: number
}

export type EventIdInput = {
	eventId: string
	calendarId?: string
}

export type RsvpEventInput = EventIdInput & {
	status: RsvpStatus
}

export function normalizeEventRangeInput(input: EventRangeInput): EventRangeInput {
	const start = requireEpochSeconds(input.start, 'start')
	const end = requireEpochSeconds(input.end, 'end')
	requireValidRange(start, end)
	if (end - start > MAX_EVENT_RANGE_SECONDS) throw new Error('Range too large')
	return { start, end }
}

export function normalizeCreateEventInput(input: CreateEventInput): CreateEventInput {
	const title = requireBoundedString(input.title, 'title', MAX_TITLE_LENGTH).trim()
	if (!title) throw new Error('Title is required')
	const allDayDate = input.allDayDate === undefined ? undefined : requireCalendarDate(input.allDayDate)
	if (allDayDate !== undefined && (input.startTime !== undefined || input.endTime !== undefined)) {
		throw new Error('Choose either an all-day date or a time range')
	}
	if (allDayDate === undefined && (input.startTime === undefined || input.endTime === undefined)) {
		throw new Error('Start and end time are required')
	}
	const startTime =
		input.startTime === undefined ? undefined : requireEpochSeconds(input.startTime, 'start time')
	const endTime = input.endTime === undefined ? undefined : requireEpochSeconds(input.endTime, 'end time')
	if (startTime !== undefined && endTime !== undefined) requireValidRange(startTime, endTime)
	const recurrence = input.recurrence === undefined ? undefined : normalizeRecurrence(input.recurrence)
	const timezone = input.timezone === undefined ? undefined : requireTimeZone(input.timezone)
	if (recurrence && !allDayDate && !timezone) throw new Error('Timezone is required for recurring events')
	const participants = normalizeParticipants(input.participants)

	return {
		title,
		...(startTime !== undefined ? { startTime } : {}),
		...(endTime !== undefined ? { endTime } : {}),
		...(allDayDate !== undefined ? { allDayDate } : {}),
		...(timezone !== undefined ? { timezone } : {}),
		...(recurrence !== undefined ? { recurrence } : {}),
		...(input.description !== undefined
			? { description: requireBoundedString(input.description, 'description', MAX_DESCRIPTION_LENGTH) }
			: {}),
		...(input.location !== undefined
			? { location: requireBoundedString(input.location, 'location', MAX_LOCATION_LENGTH) }
			: {}),
		...(participants.length ? { participants } : {}),
		...(input.calendarId !== undefined
			? { calendarId: requireNylasProviderId(input.calendarId, 'calendar') }
			: {}),
	}
}

function normalizeRecurrence(value: EventRecurrence): EventRecurrence {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid recurrence')
	if (!RECURRENCE_FREQUENCIES.includes(value.frequency)) throw new Error('Invalid recurrence')
	if (value.interval !== 1 && value.interval !== 2) throw new Error('Invalid recurrence')
	if (value.frequency === 'yearly') {
		if (value.interval !== 1 || value.weekdays !== undefined) throw new Error('Invalid recurrence')
		return { frequency: 'yearly', interval: 1 }
	}
	if (!Array.isArray(value.weekdays) || value.weekdays.length === 0 || value.weekdays.length > 7) {
		throw new Error('Invalid recurrence')
	}
	if (
		!value.weekdays.every((weekday): weekday is RecurrenceWeekday => RECURRENCE_WEEKDAYS.includes(weekday))
	) {
		throw new Error('Invalid recurrence')
	}
	const weekdays = RECURRENCE_WEEKDAYS.filter((weekday) => value.weekdays?.includes(weekday))
	if (weekdays.length !== value.weekdays.length) throw new Error('Invalid recurrence')
	return { frequency: 'weekly', interval: value.interval, weekdays }
}

export function normalizeUpdateEventInput(input: UpdateEventInput): UpdateEventInput {
	const normalized: UpdateEventInput = {
		eventId: requireNylasProviderId(input.eventId, 'event'),
		...(input.calendarId !== undefined
			? { calendarId: requireNylasProviderId(input.calendarId, 'calendar') }
			: {}),
	}

	if (input.title !== undefined) {
		normalized.title = requireBoundedString(input.title, 'title', MAX_TITLE_LENGTH).trim()
		if (!normalized.title) throw new Error('Title is required')
	}
	if (input.description !== undefined) {
		normalized.description = requireBoundedString(input.description, 'description', MAX_DESCRIPTION_LENGTH)
	}
	if (input.location !== undefined) {
		normalized.location = requireBoundedString(input.location, 'location', MAX_LOCATION_LENGTH)
	}

	if ((input.startTime === undefined) !== (input.endTime === undefined)) {
		throw new Error('Start and end time are required together')
	}
	if (input.startTime !== undefined && input.endTime !== undefined) {
		const startTime = requireEpochSeconds(input.startTime, 'start time')
		const endTime = requireEpochSeconds(input.endTime, 'end time')
		requireValidRange(startTime, endTime)
		normalized.startTime = startTime
		normalized.endTime = endTime
	}

	if (
		normalized.title === undefined &&
		normalized.description === undefined &&
		normalized.location === undefined &&
		normalized.startTime === undefined
	) {
		throw new Error('No event updates provided')
	}

	return normalized
}

export function normalizeEventIdInput(input: EventIdInput): EventIdInput {
	return {
		eventId: requireNylasProviderId(input.eventId, 'event'),
		...(input.calendarId !== undefined
			? { calendarId: requireNylasProviderId(input.calendarId, 'calendar') }
			: {}),
	}
}

export function normalizeRsvpEventInput(input: RsvpEventInput): RsvpEventInput {
	if (!RSVP_STATUSES.includes(input.status)) throw new Error('Invalid RSVP')
	return {
		...normalizeEventIdInput(input),
		status: input.status,
	}
}

function requireEpochSeconds(value: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		throw new Error(`Invalid ${label}`)
	}
	return value
}

function requireValidRange(start: number, end: number) {
	if (end <= start) throw new Error('End must be after start')
}

function requireBoundedString(value: string, label: string, maxLength: number): string {
	if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Invalid ${label}`)
	return value
}

function requireCalendarDate(value: string): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid all-day date')
	const date = new Date(`${value}T00:00:00`)
	if (Number.isNaN(date.getTime()) || formatDate(date) !== value) throw new Error('Invalid all-day date')
	return value
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function requireTimeZone(value: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 100) throw new Error('Invalid timezone')
	try {
		Intl.DateTimeFormat(undefined, { timeZone: value })
		return value
	} catch {
		throw new Error('Invalid timezone')
	}
}

function normalizeParticipants(participants: string[] | undefined): string[] {
	if (participants === undefined) return []
	if (!Array.isArray(participants)) throw new Error('Invalid participants')
	return participants.map((email) => {
		if (typeof email !== 'string') throw new Error('Invalid participant')
		const normalized = email.trim()
		if (!EMAIL_RE.test(normalized)) throw new Error(`Invalid participant: ${email}`)
		return normalized
	})
}
