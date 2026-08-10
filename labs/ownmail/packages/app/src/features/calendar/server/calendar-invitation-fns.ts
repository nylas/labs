import type { Calendar, Event, ListQuery, ListResponse, Message } from '@nylas-labs/cli-kit/v3'
import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { signalLocalChange } from '#server/change-version'
import { requireNylasProviderId } from '#server/ids'
import {
	claimInvitationCreation,
	invitationCreationClaimsAvailable,
	releaseInvitationCreationClaim,
} from '#server/invitation-creation-claim'
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
	| { state: 'syncing'; canAdd?: false }
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
	createEvent(
		body: Partial<Event>,
		calendarId: string,
		options?: { notifyParticipants?: boolean },
	): Promise<{ data: Event }>
	updateEvent(
		eventId: string,
		body: Partial<Event>,
		calendarId: string,
		options?: { notifyParticipants?: boolean },
	): Promise<{ data: Event }>
	sendRsvp(eventId: string, calendarId: string, status: 'yes' | 'no' | 'maybe'): Promise<unknown>
}

type ResolvedInvitation = {
	details: CalendarInvitationDetails
	event?: Event
	calendar?: Calendar
	invitation?: ParsedCalendarInvitation
	message?: Message
	calendars?: Calendar[]
}

type EventPages = {
	events: Event[]
	complete: boolean
	succeeded: boolean
}

const invitationCreations = new Map<string, Promise<CalendarInvitationDetails>>()

export const getCalendarInvitation = createServerFn({ method: 'GET' })
	.validator(normalizeInvitationReference)
	.handler(async ({ data }): Promise<CalendarInvitationDetails> => {
		const { mailbox, email, grantId } = await requireMailbox()
		try {
			return (await resolveInvitation(mailbox, email, grantId, data, true)).details
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
			const resolved = await resolveInvitation(mailbox, email, grantId, data, false)
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

export const addCalendarInvitation = createServerFn({ method: 'POST' })
	.validator(normalizeInvitationReference)
	.handler(async ({ data }): Promise<CalendarInvitationDetails> => {
		const { mailbox, email, grantId } = await requireMailbox()
		const key = `${grantId}:${data.messageId}:${data.attachmentId}`
		const existing = invitationCreations.get(key)
		const creation = existing ?? addCalendarInvitationOnce(mailbox, email, grantId, data)
		if (!existing) invitationCreations.set(key, creation)
		try {
			return await creation
		} catch (error) {
			if (isInvitationBoundaryError(error)) throw error
			throw friendlyCalendarError(error)
		} finally {
			if (!existing && invitationCreations.get(key) === creation) invitationCreations.delete(key)
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
	grantId: string,
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
	if (calendars.length === 0) return { details: { state: 'ineligible' }, invitation, message: message.data }

	const uidPages = await eventPages(mailbox, calendars, (calendar) => ({
		calendar_id: calendar.id,
		ical_uid: invitation.uid,
		limit: 20,
	}))
	let candidates = uidPages.events
	let trustedUidFilter = uidPages.succeeded
	if (candidates.length === 0) {
		const metadataPages = await eventPages(mailbox, calendars, (calendar) => ({
			calendar_id: calendar.id,
			metadata_pair: invitationMetadataPair(invitation.uid),
			limit: 20,
		}))
		candidates = metadataPages.events.filter(
			(event) => eventMetadataUid(event) === invitation.uid && invitationContentMatches(event, invitation),
		)
		trustedUidFilter = candidates.length > 0
	}

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
		const canAdd =
			candidates.length === 0 &&
			canCreateInvitation(message.data, invitation, mailboxEmail, grantId) &&
			(await invitationCreationClaimsAvailable())
		return {
			details:
				candidates.length > 0
					? { state: 'ineligible' }
					: { state: 'syncing', ...(canAdd ? {} : { canAdd: false }) },
			invitation,
			message: message.data,
			calendars,
		}
	}
	return detailsForInvitationEvent(mailbox, calendars, event, invitation, mailboxEmail, includeConflicts)
}

async function detailsForInvitationEvent(
	mailbox: InvitationMailbox,
	calendars: Calendar[],
	event: Event,
	invitation: ParsedCalendarInvitation,
	mailboxEmail: string,
	includeConflicts: boolean,
): Promise<ResolvedInvitation> {
	const calendar = calendars.find((candidate) => candidate.id === event.calendar_id)
	const participant = event.participants?.find(
		(candidate) => candidate.email.trim().toLowerCase() === mailboxEmail.trim().toLowerCase(),
	)
	const when = invitationWhen(event)
	const importedByOwnmail = eventMetadataUid(event) === invitation.uid
	const organizerValue = importedByOwnmail
		? invitation.organizerName || invitation.organizerEmail
		: event.organizer?.name || event.organizer?.email
	if (!calendar || !participant || !when || !organizerValue) {
		return { details: { state: 'ineligible' } }
	}
	const organizer = boundedText(organizerValue, 500) || 'Organizer'
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
		invitation,
		calendars,
	}
}

async function addCalendarInvitationOnce(
	mailbox: InvitationMailbox,
	mailboxEmail: string,
	grantId: string,
	reference: CalendarInvitationReference,
): Promise<CalendarInvitationDetails> {
	const resolved = await resolveInvitation(mailbox, mailboxEmail, grantId, reference, true)
	if (resolved.details.state === 'ready') return resolved.details
	if (
		resolved.details.state !== 'syncing' ||
		!resolved.invitation ||
		!resolved.message ||
		!resolved.calendars
	) {
		throw new InvitationBoundaryError('This invitation cannot be added right now.')
	}
	const { invitation, message, calendars } = resolved
	const when = invitation.when
	const organizerEmail = invitation.organizerEmail
	if (!when || !organizerEmail || !canCreateInvitation(message, invitation, mailboxEmail, grantId)) {
		throw new InvitationBoundaryError('This invitation cannot be added right now.')
	}
	const primary = calendars.find((calendar) => calendar.is_primary === true && calendar.read_only !== true)
	if (!primary) throw new InvitationBoundaryError('This mailbox has no writable primary calendar.')

	const claimed = await claimInvitationCreation(grantId, invitation.uid)
	let keepClaim = false
	try {
		const finalLookup = await finalInvitationLookup(mailbox, calendars, invitation, mailboxEmail)
		if (finalLookup.event) {
			return (
				await detailsForInvitationEvent(mailbox, calendars, finalLookup.event, invitation, mailboxEmail, true)
			).details
		}
		if (finalLookup.staleImport) {
			return reconcileImportedInvitation(
				mailbox,
				calendars,
				finalLookup.staleImport,
				invitation,
				when,
				organizerEmail,
				mailboxEmail,
				grantId,
			)
		}
		if (!claimed) throw new InvitationBoundaryError('This invitation is already being added.')

		const created = await mailbox.createEvent(
			invitationEventBody(invitation, when, organizerEmail),
			primary.id,
			{ notifyParticipants: false },
		)
		if (!isRenderableCalendarEvent(created.data) || created.data.calendar_id !== primary.id) {
			throw new Error('Calendar provider returned an invalid event')
		}
		keepClaim = true
		await signalLocalChange(grantId, 'calendar')
		return (await detailsForInvitationEvent(mailbox, calendars, created.data, invitation, mailboxEmail, true))
			.details
	} finally {
		if (claimed && !keepClaim) {
			await releaseInvitationCreationClaim(grantId, invitation.uid).catch(() => undefined)
		}
	}
}

type FinalInvitationLookup = { event?: Event; staleImport?: Event }

async function finalInvitationLookup(
	mailbox: InvitationMailbox,
	calendars: Calendar[],
	invitation: ParsedCalendarInvitation,
	mailboxEmail: string,
): Promise<FinalInvitationLookup> {
	const uidPages = await eventPages(mailbox, calendars, (calendar) => ({
		calendar_id: calendar.id,
		ical_uid: invitation.uid,
		limit: 20,
	}))
	const uidEvent = chooseInvitationEvent(uidPages.events, invitation, mailboxEmail, uidPages.succeeded)
	if (uidEvent) return { event: uidEvent }

	const metadataPages = await eventPages(mailbox, calendars, (calendar) => ({
		calendar_id: calendar.id,
		metadata_pair: invitationMetadataPair(invitation.uid),
		limit: 20,
	}))
	if (!metadataPages.complete) throw new Error('Calendar metadata lookup failed')
	const imported = chooseInvitationEvent(
		metadataPages.events.filter((event) => eventMetadataUid(event) === invitation.uid),
		invitation,
		mailboxEmail,
		true,
	)
	if (imported) {
		return invitationContentMatches(imported, invitation) ? { event: imported } : { staleImport: imported }
	}
	if (uidPages.complete) return {}

	// addCalendarInvitationOnce only reaches this lookup after canCreateInvitation
	// has required a concrete EventWhen, which the parser emits with both bounds.
	const start = invitation.start as number
	const end = invitation.end as number
	const fallback = await eventPages(mailbox, calendars, (calendar) => ({
		calendar_id: calendar.id,
		start: Math.max(0, start - 86_400),
		end: end + 86_400,
		limit: 200,
		expand_recurring: true,
	}))
	if (!fallback.complete) throw new Error('Calendar fallback lookup failed')
	return {
		event: chooseInvitationEvent(
			fallback.events.filter((event) => secureFallbackMatch(event, invitation)),
			invitation,
			mailboxEmail,
			true,
		),
	}
}

async function reconcileImportedInvitation(
	mailbox: InvitationMailbox,
	calendars: Calendar[],
	event: Event,
	invitation: ParsedCalendarInvitation,
	when: Event['when'],
	organizerEmail: string,
	mailboxEmail: string,
	grantId: string,
): Promise<CalendarInvitationDetails> {
	const calendar = calendars.find(
		(candidate) => candidate.id === event.calendar_id && candidate.read_only !== true,
	)
	if (!calendar) {
		throw new InvitationBoundaryError('This invitation cannot be updated right now.')
	}
	const updated = await mailbox.updateEvent(
		event.id,
		invitationEventBody(invitation, when, organizerEmail),
		calendar.id,
		{ notifyParticipants: false },
	)
	if (!isRenderableCalendarEvent(updated.data) || updated.data.calendar_id !== calendar.id) {
		throw new Error('Calendar provider returned an invalid event')
	}
	await signalLocalChange(grantId, 'calendar')
	return (await detailsForInvitationEvent(mailbox, calendars, updated.data, invitation, mailboxEmail, true))
		.details
}

function invitationEventBody(
	invitation: ParsedCalendarInvitation,
	when: Event['when'],
	organizerEmail: string,
): Partial<Event> {
	return {
		title: invitation.summary || '(untitled invitation)',
		...(invitation.description ? { description: invitation.description } : {}),
		...(invitation.location ? { location: invitation.location } : {}),
		when,
		organizer: {
			email: organizerEmail,
			...(invitation.organizerName ? { name: invitation.organizerName } : {}),
		},
		participants: invitation.attendees,
		metadata: { key1: invitation.uid },
	}
}

function canCreateInvitation(
	message: Message,
	invitation: ParsedCalendarInvitation,
	mailboxEmail: string,
	grantId: string,
): boolean {
	const mailbox = normalizedEmail(mailboxEmail)
	const organizer = normalizedEmail(invitation.organizerEmail)
	if (
		!mailbox ||
		!organizer ||
		organizer === mailbox ||
		message.grant_id !== grantId ||
		!invitation.when ||
		invitation.hasRecurrence
	) {
		return false
	}
	const senders = message.from?.map((participant) => normalizedEmail(participant.email)).filter(Boolean) ?? []
	const recipients = [...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])]
	const attendeeEmails = (invitation.attendees ?? []).map((participant) => normalizedEmail(participant.email))
	return (
		senders.length === 1 &&
		senders[0] === organizer &&
		recipients.some((participant) => normalizedEmail(participant.email) === mailbox) &&
		attendeeEmails.includes(mailbox)
	)
}

function normalizedEmail(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim().toLowerCase()
	return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined
}

function invitationMetadataPair(uid: string): string {
	return `key1:${uid}`
}

function eventMetadataUid(event: Event): string | undefined {
	const value = event.metadata?.key1
	return typeof value === 'string' && value.length <= 1_000 ? value : undefined
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
			const importedByOwnmail = eventMetadataUid(event) === invitation.uid
			return Boolean(
				participant &&
					(event.organizer || (importedByOwnmail && invitation.organizerEmail)) &&
					(!organizerIsMailbox || importedByOwnmail) &&
					event.status !== 'cancelled',
			)
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

function invitationContentMatches(event: Event, invitation: ParsedCalendarInvitation): boolean {
	const range = eventEpochRange(event)
	if (
		!range ||
		invitation.start === undefined ||
		invitation.end === undefined ||
		Math.abs(range.start - invitation.start) > 60 ||
		Math.abs(range.end - invitation.end) > 60
	) {
		return false
	}
	if (invitation.summary && event.title?.trim() !== invitation.summary) return false
	if (invitation.location && event.location?.trim() !== invitation.location) return false
	return true
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
