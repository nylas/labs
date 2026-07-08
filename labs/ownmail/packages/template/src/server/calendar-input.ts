import { requireNylasProviderId } from './ids.js'

const MAX_EVENT_RANGE_SECONDS = 60 * 60 * 24 * 62
const MAX_TITLE_LENGTH = 500
const MAX_LOCATION_LENGTH = 1000
const MAX_DESCRIPTION_LENGTH = 100_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RSVP_STATUSES = ['yes', 'no', 'maybe'] as const

type RsvpStatus = (typeof RSVP_STATUSES)[number]

export type EventRangeInput = {
	start: number
	end: number
}

export type CreateEventInput = {
	title: string
	description?: string
	location?: string
	startTime: number
	endTime: number
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
	const startTime = requireEpochSeconds(input.startTime, 'start time')
	const endTime = requireEpochSeconds(input.endTime, 'end time')
	requireValidRange(startTime, endTime)
	const participants = normalizeParticipants(input.participants)

	return {
		title,
		startTime,
		endTime,
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
