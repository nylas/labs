import type { Event, EventParticipant, EventWhen, MessageAttachment } from '@nylas-labs/cli-kit/v3'
import { calendarSlotTime } from './calendar.js'

export const MAX_ICS_ATTACHMENT_BYTES = 512 * 1024
const MAX_ICS_UID_LENGTH = 1_000
const MAX_ICS_TEXT_LENGTH = 4_000
const MAX_ICS_SEQUENCE = 2_147_483_647

export type ParsedCalendarInvitation = {
	uid: string
	method: 'REQUEST' | 'CANCEL'
	organizerEmail?: string
	organizerName?: string
	attendees?: EventParticipant[]
	summary?: string
	description?: string
	location?: string
	start?: number
	end?: number
	when?: EventWhen
	hasRecurrence?: true
	isRecurrenceInstance?: true
	sequence?: number
}

type IcsProperty = {
	name: string
	params: Map<string, string>
	value: string
}

type EventWithIcalUid = Event & { ical_uid?: unknown }

export function isCalendarInvitationAttachment(
	attachment: Pick<MessageAttachment, 'filename' | 'content_type'>,
): boolean {
	const contentType = attachment.content_type?.split(';', 1)[0]?.trim().toLowerCase()
	const filename = attachment.filename?.trim().toLowerCase()
	return (
		contentType === 'text/calendar' ||
		contentType === 'application/ics' ||
		Boolean(filename?.endsWith('.ics'))
	)
}

export function firstCalendarInvitationAttachment(
	attachments: MessageAttachment[] | undefined,
): MessageAttachment | undefined {
	return attachments?.find(isCalendarInvitationAttachment)
}

/**
 * Parse only the small iCalendar surface required to correlate an email attachment
 * with its provider-created calendar event. Unknown properties are ignored and the
 * parser fails closed for unsupported methods or malformed identifiers.
 */
export function parseCalendarInvitation(source: string): ParsedCalendarInvitation | null {
	if (
		typeof source !== 'string' ||
		source.length === 0 ||
		source.length > MAX_ICS_ATTACHMENT_BYTES ||
		source.includes('\0')
	) {
		return null
	}

	const lines = source
		.replace(/\r\n?/g, '\n')
		.replace(/\n[ \t]/g, '')
		.split('\n')
	let method: string | undefined
	let inEvent = false
	const eventProperties: IcsProperty[] = []

	for (const line of lines) {
		const property = parseProperty(line)
		if (!property) continue
		if (!inEvent && property.name === 'METHOD') method = property.value.trim().toUpperCase()
		if (property.name === 'BEGIN' && property.value.trim().toUpperCase() === 'VEVENT') {
			if (inEvent) return null
			inEvent = true
			continue
		}
		if (property.name === 'END' && property.value.trim().toUpperCase() === 'VEVENT') break
		if (inEvent) eventProperties.push(property)
	}

	if ((method !== 'REQUEST' && method !== 'CANCEL') || eventProperties.length === 0) return null
	const uid = propertyValue(eventProperties, 'UID')?.trim()
	if (!uid || uid.length > MAX_ICS_UID_LENGTH || hasUnsafeControl(uid)) return null

	const startProperty = findProperty(eventProperties, 'DTSTART')
	const endProperty = findProperty(eventProperties, 'DTEND')
	const start = startProperty ? parseIcsDate(startProperty) : undefined
	const end = endProperty ? parseIcsDate(endProperty) : undefined
	const organizerEmail = organizerAddress(propertyValue(eventProperties, 'ORGANIZER'))
	const organizerProperty = findProperty(eventProperties, 'ORGANIZER')
	const organizerName = boundedIcsText(organizerProperty?.params.get('CN'))
	const attendees = parseAttendees(eventProperties)
	const summary = boundedIcsText(propertyValue(eventProperties, 'SUMMARY'))
	const description = boundedIcsText(propertyValue(eventProperties, 'DESCRIPTION'))
	const location = boundedIcsText(propertyValue(eventProperties, 'LOCATION'))
	const sequenceProperty = findProperty(eventProperties, 'SEQUENCE')
	const sequence = parseSequence(sequenceProperty?.value)
	if (sequenceProperty && sequence === undefined) return null
	const when = invitationEventWhen(startProperty, endProperty, start, end)
	const whenRange = when ? eventWhenEpochRange(when) : null
	const isRecurrenceInstance = eventProperties.some((property) => property.name === 'RECURRENCE-ID')
	const hasRecurrence = eventProperties.some((property) =>
		['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID'].includes(property.name),
	)

	return {
		uid,
		method,
		...(organizerEmail ? { organizerEmail } : {}),
		...(organizerName ? { organizerName } : {}),
		...(attendees.length > 0 ? { attendees } : {}),
		...(summary ? { summary } : {}),
		...(description ? { description } : {}),
		...(location ? { location } : {}),
		...(whenRange ? { start: whenRange.start, end: whenRange.end } : {}),
		...(when ? { when } : {}),
		...(hasRecurrence ? { hasRecurrence: true as const } : {}),
		...(isRecurrenceInstance ? { isRecurrenceInstance: true as const } : {}),
		...(sequence !== undefined ? { sequence } : {}),
	}
}

export function eventIcalUid(event: Event): string | undefined {
	const value = (event as EventWithIcalUid).ical_uid
	return typeof value === 'string' && value.length > 0 && value.length <= MAX_ICS_UID_LENGTH
		? value
		: undefined
}

export function eventEpochRange(event: Event): { start: number; end: number } | null {
	return eventWhenEpochRange(event.when)
}

function eventWhenEpochRange(when: EventWhen): { start: number; end: number } | null {
	if ('start_time' in when) {
		return when.end_time > when.start_time ? { start: when.start_time, end: when.end_time } : null
	}
	if ('time' in when) return { start: when.time, end: when.time + 1 }
	if ('date' in when) {
		const start = calendarDateEpoch(when.date)
		return start === null ? null : { start, end: start + 86_400 }
	}
	const start = calendarDateEpoch(when.start_date)
	const end = calendarDateEpoch(when.end_date)
	return start !== null && end !== null && end > start ? { start, end } : null
}

export function eventOverlaps(event: Event, start: number, end: number): boolean {
	const range = eventEpochRange(event)
	return Boolean(range && range.end > start && range.start < end)
}

function parseProperty(line: string): IcsProperty | null {
	const separator = propertySeparator(line)
	if (separator < 1) return null
	const head = line.slice(0, separator)
	const value = line.slice(separator + 1)
	const [rawName, ...rawParams] = head.split(';')
	const name = rawName?.trim().toUpperCase()
	if (!name || !/^[A-Z0-9-]+$/.test(name)) return null
	const params = new Map<string, string>()
	for (const rawParam of rawParams) {
		const equals = rawParam.indexOf('=')
		if (equals < 1) continue
		const key = rawParam.slice(0, equals).trim().toUpperCase()
		const parameterValue = rawParam
			.slice(equals + 1)
			.trim()
			.replace(/^"|"$/g, '')
		if (/^[A-Z0-9-]+$/.test(key)) params.set(key, parameterValue)
	}
	return { name, params, value }
}

function propertySeparator(line: string): number {
	let quoted = false
	for (let index = 0; index < line.length; index += 1) {
		if (line[index] === '"') quoted = !quoted
		else if (line[index] === ':' && !quoted) return index
	}
	return -1
}

function findProperty(properties: IcsProperty[], name: string): IcsProperty | undefined {
	return properties.find((property) => property.name === name)
}

function propertyValue(properties: IcsProperty[], name: string): string | undefined {
	return findProperty(properties, name)?.value
}

function invitationEventWhen(
	startProperty: IcsProperty | undefined,
	endProperty: IcsProperty | undefined,
	start: number | undefined,
	end: number | undefined,
): EventWhen | undefined {
	if (!startProperty) return undefined
	const startDate = compactDateToIso(startProperty.value.trim())
	if (startDate) {
		const endDate = endProperty ? compactDateToIso(endProperty.value.trim()) : nextCalendarDate(startDate)
		if (!endDate) return undefined
		const when = { start_date: startDate, end_date: endDate } as const
		return eventWhenEpochRange(when) ? when : undefined
	}
	const timezone = startProperty.params.get('TZID')
	const hasAbsoluteTime = startProperty.value.trim().endsWith('Z') || Boolean(timezone)
	if (!hasAbsoluteTime) return undefined
	return start !== undefined && end !== undefined && end > start
		? { start_time: start, end_time: end }
		: undefined
}

function nextCalendarDate(value: string): string {
	const epoch = calendarDateEpoch(value)
	/* v8 ignore next -- value is produced by compactDateToIso and therefore always valid */
	return new Date(((epoch ?? 0) + 86_400) * 1_000).toISOString().slice(0, 10)
}

function parseAttendees(properties: IcsProperty[]): EventParticipant[] {
	const attendees = new Map<string, EventParticipant>()
	for (const property of properties) {
		if (property.name !== 'ATTENDEE') continue
		const email = organizerAddress(property.value)
		if (!email || attendees.has(email)) continue
		const name = boundedIcsText(property.params.get('CN'))
		const status = attendeeStatus(property.params.get('PARTSTAT'))
		attendees.set(email, { email, ...(name ? { name } : {}), ...(status ? { status } : {}) })
	}
	return [...attendees.values()]
}

function attendeeStatus(value: string | undefined): EventParticipant['status'] | undefined {
	const normalized = value?.trim().toUpperCase()
	if (normalized === 'ACCEPTED') return 'yes'
	if (normalized === 'DECLINED') return 'no'
	if (normalized === 'TENTATIVE') return 'maybe'
	if (normalized === 'NEEDS-ACTION') return 'noreply'
	return undefined
}

function parseSequence(value: string | undefined): number | undefined {
	const normalized = value?.trim()
	if (!normalized || !/^\d{1,10}$/.test(normalized)) return undefined
	const sequence = Number(normalized)
	return sequence <= MAX_ICS_SEQUENCE ? sequence : undefined
}

function boundedIcsText(value: string | undefined): string | undefined {
	if (!value) return undefined
	const text = decodeIcsText(value).trim().slice(0, MAX_ICS_TEXT_LENGTH)
	return text && !hasUnsafeControlExceptNewline(text) ? text : undefined
}

function parseIcsDate(property: IcsProperty): number | undefined {
	const value = property.value.trim()
	const dateOnly = property.params.get('VALUE')?.toUpperCase() === 'DATE' || /^\d{8}$/.test(value)
	if (dateOnly) {
		const iso = compactDateToIso(value)
		const epoch = iso ? calendarDateEpoch(iso) : null
		return epoch ?? undefined
	}

	const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value)
	if (!match) return undefined
	const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', utc] = match
	const year = Number(yearText)
	const month = Number(monthText)
	const day = Number(dayText)
	const hour = Number(hourText)
	const minute = Number(minuteText)
	const second = Number(secondText)
	if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return undefined
	if (utc) return Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1_000)

	const timezone = property.params.get('TZID')
	if (timezone) {
		try {
			const dayValue = new Date(year, month - 1, day)
			return Math.floor(calendarSlotTime(dayValue, hour + minute / 60, timezone).getTime() / 1_000) + second
		} catch {
			return undefined
		}
	}
	return Math.floor(new Date(year, month - 1, day, hour, minute, second).getTime() / 1_000)
}

function compactDateToIso(value: string): string | undefined {
	const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
	if (!match) return undefined
	const [, year, month, day] = match
	const iso = `${year}-${month}-${day}`
	return calendarDateEpoch(iso) === null ? undefined : iso
}

function calendarDateEpoch(value: string): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
	if (!validDateParts(year, month, day)) return null
	return Math.floor(Date.UTC(year, month - 1, day) / 1_000)
}

function validDateParts(year: number, month: number, day: number): boolean {
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false
	const date = new Date(Date.UTC(year, month - 1, day))
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function organizerAddress(value: string | undefined): string | undefined {
	if (!value) return undefined
	const normalized = value
		.trim()
		.replace(/^mailto:/i, '')
		.toLowerCase()
	return normalized && normalized.length <= 320 && !hasUnsafeControl(normalized) ? normalized : undefined
}

function decodeIcsText(value: string): string {
	return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

function hasUnsafeControl(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 0x20 || code === 0x7f
	})
}

function hasUnsafeControlExceptNewline(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0)
		return (code < 0x20 && character !== '\n' && character !== '\t') || code === 0x7f
	})
}
