import type { Calendar, Event, ListQuery, ListResponse, Message } from '@nylas-labs/cli-kit/v3'
import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { signalLocalChange } from '#server/change-version'
import { requireNylasProviderId } from '#server/ids'
import { requireMailbox } from '#server/mailbox-boundary'
import { isRenderableCalendarEvent } from '../lib/calendar.js'
import {
	eventEpochRange,
	eventIcalUid,
	eventOverlaps,
	isCalendarInvitationAttachment,
	MAX_ICS_ATTACHMENT_BYTES,
	type ParsedCalendarInvitation,
	parseCalendarInvitation,
} from '../lib/calendar-invitation.js'

const MAX_CONFLICT_RANGE_SECONDS = 31 * 86_400
const RSVP_STATUSES = ['yes', 'maybe', 'no'] as const

export type CalendarInvitationReference = { messageId: string; attachmentId: string }
export type CalendarInvitationRsvpInput = CalendarInvitationReference & {
	status: (typeof RSVP_STATUSES)[number]
}

export type InvitationWhen =
	| { kind: 'timed'; start: number; end: number }
	| { kind: 'all-day'; startDate: string; endDate: string }

export type CalendarInvitationDetails =
	| { state: 'invalid' }
	| { state: 'syncing' }
	| { state: 'ineligible' }
	| {
			state: 'ready'
			title: string
			location?: string
			organizer: string
			when: InvitationWhen
			status: 'yes' | 'no' | 'maybe' | 'noreply'
			conflicts: { state: 'clear' } | { state: 'conflict'; count: number } | { state: 'unknown' }
	  }

type InvitationConflicts = Extract<CalendarInvitationDetails, { state: 'ready' }>['conflicts']

type InvitationMailbox = {
	getMessage(messageId: string): Promise<{ data: Message }>
	downloadAttachment(attachmentId: string, messageId: string): Promise<Response>
	listCalendars(query?: ListQuery): Promise<{ data?: unknown }>
	listEvents(query: ListQuery & { calendar_id: string }): Promise<ListResponse<Event>>
	sendRsvp(eventId: string, calendarId: string, status: 'yes' | 'no' | 'maybe'): Promise<unknown>
}

type ResolvedInvitation = {
	details: CalendarInvitationDetails
	event?: Event
	calendar?: Calendar
}

type EventPages = {
	events: Event[]
	complete: boolean
	succeeded: boolean
}

export const getCalendarInvitation = createServerFn({ method: 'GET' })
	.validator(normalizeInvitationReference)
	.handler(async ({ data }): Promise<CalendarInvitationDetails> => {
		const { mailbox, email } = await requireMailbox()
		try {
			return (await resolveInvitation(mailbox, email, data, true)).details
		} catch (error) {
			if (isInvitationBoundaryError(error)) throw error
			throw friendlyCalendarError(error)
		}
	})

export const respondCalendarInvitation = createServerFn({ method: 'POST' })
	.validator(normalizeInvitationRsvpInput)
	.handler(async ({ data }) => {
		const { mailbox, email, grantId } = await requireMailbox()
		try {
			// Resolve the attachment and provider event again for every mutation. The
			// browser never supplies an event or calendar ID that could cross an object boundary.
			const resolved = await resolveInvitation(mailbox, email, data, false)
			if (resolved.details.state !== 'ready' || !resolved.event || !resolved.calendar) {
				throw new InvitationBoundaryError('This invitation cannot be answered right now.')
			}
			await mailbox.sendRsvp(resolved.event.id, resolved.calendar.id, data.status)
			await signalLocalChange(grantId, 'calendar')
			return { status: data.status }
		} catch (error) {
			if (isInvitationBoundaryError(error)) throw error
			throw friendlyCalendarError(error)
		}
	})

export function normalizeInvitationReference(
	input: CalendarInvitationReference,
): CalendarInvitationReference {
	if (!input || typeof input !== 'object') throw new Error('Invalid invitation')
	return {
		messageId: requireNylasProviderId(input.messageId, 'message'),
		attachmentId: requireNylasProviderId(input.attachmentId, 'attachment'),
	}
}

export function normalizeInvitationRsvpInput(
	input: CalendarInvitationRsvpInput,
): CalendarInvitationRsvpInput {
	const reference = normalizeInvitationReference(input)
	if (!RSVP_STATUSES.includes(input.status)) throw new Error('Invalid RSVP')
	return { ...reference, status: input.status }
}

async function resolveInvitation(
	mailbox: InvitationMailbox,
	mailboxEmail: string,
	reference: CalendarInvitationReference,
	includeConflicts: boolean,
): Promise<ResolvedInvitation> {
	const message = await mailbox.getMessage(reference.messageId)
	const attachment = message.data.attachments?.find((candidate) => candidate.id === reference.attachmentId)
	if (!attachment || !isCalendarInvitationAttachment(attachment)) {
		throw new InvitationBoundaryError('Calendar invitation not found.')
	}
	if (attachment.size !== undefined && attachment.size > MAX_ICS_ATTACHMENT_BYTES) {
		return { details: { state: 'invalid' } }
	}

	const response = await mailbox.downloadAttachment(attachment.id, message.data.id)
	if (!response.ok) throw new InvitationBoundaryError('Calendar invitation could not be opened.')
	const bytes = await response.arrayBuffer()
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICS_ATTACHMENT_BYTES) {
		return { details: { state: 'invalid' } }
	}
	let source: string
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		return { details: { state: 'invalid' } }
	}
	const invitation = parseCalendarInvitation(source)
	if (!invitation) return { details: { state: 'invalid' } }

	const calendarResponse = await mailbox.listCalendars({ limit: 20 })
	const calendars = Array.isArray(calendarResponse.data) ? calendarResponse.data.filter(isCalendar) : []
	if (calendars.length === 0) return { details: { state: 'ineligible' } }

	const uidPages = await eventPages(mailbox, calendars, (calendar) => ({
		calendar_id: calendar.id,
		ical_uid: invitation.uid,
		limit: 20,
	}))
	let candidates = uidPages.events
	let trustedUidFilter = uidPages.succeeded

	const invitationStart = invitation.start
	const invitationEnd = invitation.end
	if (candidates.length === 0 && invitationStart !== undefined && invitationEnd !== undefined) {
		const fallback = await eventPages(mailbox, calendars, (calendar) => ({
			calendar_id: calendar.id,
			start: Math.max(0, invitationStart - 86_400),
			end: invitationEnd + 86_400,
			limit: 200,
			expand_recurring: true,
		}))
		candidates = fallback.events.filter((event) => secureFallbackMatch(event, invitation))
		// The fallback candidates have already passed the strict schedule plus
		// organizer/title correlation above, so they are trusted for attendee selection.
		trustedUidFilter = candidates.length > 0
		if (!fallback.succeeded && !uidPages.succeeded) throw new Error('Calendar lookup failed')
	}

	const event = chooseInvitationEvent(candidates, invitation, mailboxEmail, trustedUidFilter)
	if (!event) {
		return { details: { state: candidates.length > 0 ? 'ineligible' : 'syncing' } }
	}
	const calendar = calendars.find((candidate) => candidate.id === event.calendar_id)
	const participant = event.participants?.find(
		(candidate) => candidate.email.trim().toLowerCase() === mailboxEmail.trim().toLowerCase(),
	)
	const when = invitationWhen(event)
	if (!calendar || !participant || !when || !event.organizer) {
		return { details: { state: 'ineligible' } }
	}
	const organizer = boundedText(event.organizer.name || event.organizer.email, 500) || 'Organizer'
	const status = participant.status ?? 'noreply'
	const conflicts = includeConflicts
		? await invitationConflicts(mailbox, calendars, event)
		: ({ state: 'clear' } as const)
	return {
		details: {
			state: 'ready',
			title: boundedText(event.title, 500) || '(untitled invitation)',
			...(boundedText(event.location, 1_000) ? { location: boundedText(event.location, 1_000) } : {}),
			organizer,
			when,
			status,
			conflicts,
		},
		event,
		calendar,
	}
}

async function eventPages(
	mailbox: InvitationMailbox,
	calendars: Calendar[],
	query: (calendar: Calendar) => ListQuery & { calendar_id: string },
): Promise<EventPages> {
	const settled = await Promise.allSettled(calendars.map((calendar) => mailbox.listEvents(query(calendar))))
	const successful = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
	return {
		events: successful.flatMap((page) => page.data).filter(isRenderableCalendarEvent),
		complete: successful.length === calendars.length && successful.every((page) => !page.next_cursor),
		succeeded: successful.length > 0,
	}
}

function chooseInvitationEvent(
	events: Event[],
	invitation: ParsedCalendarInvitation,
	mailboxEmail: string,
	trustedUidFilter: boolean,
): Event | undefined {
	const normalizedMailbox = mailboxEmail.trim().toLowerCase()
	return events
		.filter((event) => {
			const participant = event.participants?.some(
				(candidate) => candidate.email.trim().toLowerCase() === normalizedMailbox,
			)
			const organizerIsMailbox = event.organizer?.email.trim().toLowerCase() === normalizedMailbox
			return Boolean(participant && event.organizer && !organizerIsMailbox && event.status !== 'cancelled')
		})
		.map((event) => ({ event, score: invitationMatchScore(event, invitation, trustedUidFilter) }))
		.filter((candidate) => candidate.score >= 8)
		.sort((left, right) => right.score - left.score)[0]?.event
}

function invitationMatchScore(
	event: Event,
	invitation: ParsedCalendarInvitation,
	trustedUidFilter: boolean,
): number {
	let score = trustedUidFilter || eventIcalUid(event) === invitation.uid ? 8 : 0
	const range = eventEpochRange(event)
	if (
		range &&
		invitation.start !== undefined &&
		invitation.end !== undefined &&
		Math.abs(range.start - invitation.start) <= 60 &&
		Math.abs(range.end - invitation.end) <= 60
	) {
		score += 4
	}
	if (
		invitation.organizerEmail &&
		event.organizer?.email.trim().toLowerCase() === invitation.organizerEmail
	) {
		score += 2
	}
	if (invitation.summary && event.title?.trim() === invitation.summary) score += 1
	return score
}

function secureFallbackMatch(event: Event, invitation: ParsedCalendarInvitation): boolean {
	const score = invitationMatchScore(event, invitation, false)
	return score >= 6 || (score >= 5 && Boolean(invitation.summary))
}

async function invitationConflicts(
	mailbox: InvitationMailbox,
	calendars: Calendar[],
	invitationEvent: Event,
): Promise<InvitationConflicts> {
	const range = eventEpochRange(invitationEvent)
	/* v8 ignore next -- candidate events pass isRenderableCalendarEvent before this function is called */
	if (!range) return { state: 'unknown' }
	if (range.end - range.start > MAX_CONFLICT_RANGE_SECONDS) return { state: 'unknown' }
	const pages = await eventPages(mailbox, calendars, (calendar) => ({
		calendar_id: calendar.id,
		start: Math.max(0, range.start - 86_400),
		end: range.end + 86_400,
		limit: 200,
		expand_recurring: true,
	}))
	if (!pages.complete) return { state: 'unknown' }
	const invitationUid = eventIcalUid(invitationEvent)
	const conflicts = pages.events.filter((event) => {
		if (event.id === invitationEvent.id && event.calendar_id === invitationEvent.calendar_id) return false
		if (invitationUid && eventIcalUid(event) === invitationUid) return false
		if (event.busy === false || event.status === 'cancelled') return false
		return eventOverlaps(event, range.start, range.end)
	})
	return conflicts.length > 0 ? { state: 'conflict', count: conflicts.length } : { state: 'clear' }
}

function invitationWhen(event: Event): InvitationWhen | null {
	const when = event.when
	if ('start_time' in when) {
		/* v8 ignore next -- malformed spans are removed by isRenderableCalendarEvent before selection */
		return when.end_time > when.start_time
			? { kind: 'timed', start: when.start_time, end: when.end_time }
			: null
	}
	if ('time' in when) return { kind: 'timed', start: when.time, end: when.time + 1 }
	if ('date' in when) return { kind: 'all-day', startDate: when.date, endDate: nextDate(when.date) }
	return { kind: 'all-day', startDate: when.start_date, endDate: when.end_date }
}

function nextDate(date: string): string {
	const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
	return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function isCalendar(value: unknown): value is Calendar {
	return Boolean(
		value &&
			typeof value === 'object' &&
			'id' in value &&
			typeof value.id === 'string' &&
			'name' in value &&
			typeof value.name === 'string',
	)
}

function boundedText(value: unknown, maxLength: number): string | undefined {
	return typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined
}

class InvitationBoundaryError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'InvitationBoundaryError'
	}
}

function isInvitationBoundaryError(error: unknown): error is InvitationBoundaryError {
	return error instanceof InvitationBoundaryError
}

function friendlyCalendarError(error: unknown): Error {
	if (error instanceof NylasApiError && (error.status === 401 || error.status === 403)) {
		return new Error('Your mailbox session expired. Sign in again and retry.')
	}
	if (error instanceof NylasApiError && error.status === 429) {
		return new Error('Your calendar is temporarily busy. Try again shortly.')
	}
	return new Error('The calendar invitation could not be updated. Check your connection and try again.')
}
