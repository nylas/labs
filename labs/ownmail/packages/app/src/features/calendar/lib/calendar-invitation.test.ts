import type { Event } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import {
	eventEpochRange,
	eventIcalUid,
	eventOverlaps,
	firstCalendarInvitationAttachment,
	isCalendarInvitationAttachment,
	MAX_ICS_ATTACHMENT_BYTES,
	parseCalendarInvitation,
} from './calendar-invitation.js'

describe('calendar invitation parsing', () => {
	it('recognizes provider calendar MIME types and .ics filenames', () => {
		expect(isCalendarInvitationAttachment({ content_type: 'text/calendar; method=REQUEST' })).toBe(true)
		expect(isCalendarInvitationAttachment({ content_type: 'application/ics', filename: 'invite.bin' })).toBe(
			true,
		)
		expect(isCalendarInvitationAttachment({ filename: 'Team.ICS' })).toBe(true)
		expect(isCalendarInvitationAttachment({ content_type: 'text/plain', filename: 'invite.txt' })).toBe(false)
		expect(isCalendarInvitationAttachment({})).toBe(false)
	})

	it('selects one invitation attachment when providers expose duplicate calendar parts', () => {
		const selected = firstCalendarInvitationAttachment([
			{ id: 'pdf', filename: 'agenda.pdf', content_type: 'application/pdf' },
			{ id: 'calendar-inline', filename: 'invite.ics', content_type: 'text/calendar' },
			{ id: 'calendar-file', filename: 'invite.ics', content_type: 'application/ics' },
		])

		expect(selected?.id).toBe('calendar-inline')
		expect(firstCalendarInvitationAttachment(undefined)).toBeUndefined()
	})

	it('parses a folded REQUEST with UTC times and escaped display text', () => {
		const invitation = parseCalendarInvitation(
			[
				'BEGIN:VCALENDAR',
				'METHOD:REQUEST',
				'BEGIN:VEVENT',
				'UID:long-meeting-',
				' uid@example.com',
				'DTSTART:20270809T150000Z',
				'DTEND:20270809T160000Z',
				'ORGANIZER;CN="Grace Hopper":mailto:GRACE@example.com',
				'SUMMARY:Planning\\, review',
				'END:VEVENT',
				'END:VCALENDAR',
			].join('\r\n'),
		)

		expect(invitation).toEqual({
			uid: 'long-meeting-uid@example.com',
			method: 'REQUEST',
			organizerEmail: 'grace@example.com',
			summary: 'Planning, review',
			start: 1_817_823_600,
			end: 1_817_827_200,
		})
	})

	it('parses date-only invitations and rejects unsupported or unsafe payloads', () => {
		expect(
			parseCalendarInvitation(
				'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:holiday\nDTSTART;VALUE=DATE:20271225\nDTEND;VALUE=DATE:20271226\nEND:VEVENT\nEND:VCALENDAR',
			),
		).toMatchObject({ start: 1_829_692_800, end: 1_829_779_200 })
		expect(
			parseCalendarInvitation(
				'BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:event\nEND:VEVENT\nEND:VCALENDAR',
			),
		).toBeNull()
		expect(
			parseCalendarInvitation(
				'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:bad\u0000uid\nEND:VEVENT\nEND:VCALENDAR',
			),
		).toBeNull()
		expect(parseCalendarInvitation('x'.repeat(MAX_ICS_ATTACHMENT_BYTES + 1))).toBeNull()
		expect(parseCalendarInvitation('')).toBeNull()
		expect(
			parseCalendarInvitation(
				'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nBEGIN:VEVENT\nUID:event\nEND:VEVENT\nEND:VCALENDAR',
			),
		).toBeNull()
	})

	it('accepts timezone and floating wall-clock values while dropping malformed optional fields', () => {
		const timezone = parseCalendarInvitation(
			[
				'BEGIN:VCALENDAR',
				'METHOD:REQUEST',
				'NOT A PROPERTY',
				'BEGIN:VEVENT',
				'UID:timezone-event',
				'DTSTART;TZID=America/Toronto:20270809T150000',
				'DTEND;TZID=America/Toronto:20270809T160000',
				'ORGANIZER:',
				'SUMMARY:',
				'END:VEVENT',
			].join('\n'),
		)
		expect(timezone).toMatchObject({ uid: 'timezone-event', start: 1_817_838_000, end: 1_817_841_600 })
		expect(timezone).not.toHaveProperty('organizerEmail')
		expect(timezone).not.toHaveProperty('summary')

		const floating = parseCalendarInvitation(
			'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:floating\nDTSTART:20270809T1500\nDTEND:20270809T1600\nEND:VEVENT',
		)
		expect(floating?.start).toBeTypeOf('number')
		expect(floating?.end).toBeTypeOf('number')

		const invalidOptional = parseCalendarInvitation(
			'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:valid\nDTSTART;TZID=Not/AZone:20270809T150000\nDTEND:20270230T160000Z\nEND:VEVENT',
		)
		expect(invalidOptional).toEqual({ uid: 'valid', method: 'REQUEST' })
	})

	it('fails closed for missing and malformed required properties', () => {
		expect(parseCalendarInvitation(null as never)).toBeNull()
		expect(parseCalendarInvitation('BEGIN:VCALENDAR\nMETHOD:REQUEST\nEND:VCALENDAR')).toBeNull()
		expect(
			parseCalendarInvitation('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:event\nEND:VEVENT\nEND:VCALENDAR'),
		).toBeNull()
		expect(
			parseCalendarInvitation('BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nEND:VEVENT\nEND:VCALENDAR'),
		).toBeNull()
		expect(
			parseCalendarInvitation(
				`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:${'a'.repeat(1_001)}\nEND:VEVENT`,
			),
		).toBeNull()
	})

	it('drops malformed dates, parameters, and optional organizer values without guessing', () => {
		const malformed = parseCalendarInvitation(
			[
				'BEGIN:VCALENDAR',
				'METHOD:REQUEST',
				'1 BAD:ignored',
				'BAD NAME:ignored',
				'BEGIN:VEVENT',
				'UID:event',
				'X-NOTE;BROKEN;BAD KEY=value;LABEL="a:b":ignored',
				'DTSTART;VALUE=DATE:not-a-date',
				'DTEND:20271301T250061Z',
				`ORGANIZER:mailto:${'a'.repeat(321)}`,
				'SUMMARY:A\\;B\\\\C\\nD',
				'END:VEVENT',
			].join('\n'),
		)
		expect(malformed).toEqual({ uid: 'event', method: 'REQUEST', summary: 'A;B\\C\nD' })

		for (const date of ['00000101', '20271301', '20270230']) {
			const parsed = parseCalendarInvitation(
				`BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:${date}\nDTSTART;VALUE=DATE:${date}\nEND:VEVENT`,
			)
			expect(parsed).toEqual({ uid: date, method: 'REQUEST' })
		}
		const controlOrganizer = parseCalendarInvitation(
			'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:event\nORGANIZER:mailto:bad\u007f@example.com\nEND:VEVENT',
		)
		expect(controlOrganizer).toEqual({ uid: 'event', method: 'REQUEST' })
		expect(
			parseCalendarInvitation(
				'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:event\nDTSTART:not-a-date\nEND:VEVENT',
			),
		).toEqual({ uid: 'event', method: 'REQUEST' })
	})
})

describe('calendar invitation event helpers', () => {
	it('normalizes event ranges and overlap checks without exposing event details', () => {
		const timed = {
			id: 'event',
			calendar_id: 'calendar',
			ical_uid: 'uid@example.com',
			when: { start_time: 100, end_time: 200 },
		} as Event
		const allDay = {
			id: 'all-day',
			calendar_id: 'calendar',
			when: { date: '2027-12-25' },
		} as Event

		expect(eventIcalUid(timed)).toBe('uid@example.com')
		expect(eventEpochRange(timed)).toEqual({ start: 100, end: 200 })
		expect(eventOverlaps(timed, 199, 300)).toBe(true)
		expect(eventOverlaps(timed, 200, 300)).toBe(false)
		expect(eventEpochRange(allDay)).toEqual({ start: 1_829_692_800, end: 1_829_779_200 })
		expect(eventEpochRange({ id: 'point', calendar_id: 'calendar', when: { time: 500 } } as Event)).toEqual({
			start: 500,
			end: 501,
		})
		expect(
			eventEpochRange({
				id: 'span',
				calendar_id: 'calendar',
				when: { start_date: '2027-12-25', end_date: '2027-12-27' },
			} as Event),
		).toEqual({ start: 1_829_692_800, end: 1_829_865_600 })
		expect(
			eventEpochRange({
				id: 'bad-span',
				calendar_id: 'calendar',
				when: { start_date: '2027-12-27', end_date: '2027-12-25' },
			} as Event),
		).toBeNull()
		expect(
			eventEpochRange({ id: 'bad', calendar_id: 'calendar', when: { start_time: 2, end_time: 1 } } as Event),
		).toBeNull()
		expect(
			eventEpochRange({ id: 'bad-date', calendar_id: 'calendar', when: { date: '2027-02-30' } } as Event),
		).toBeNull()
		expect(eventIcalUid({ ...timed, ical_uid: 42 } as unknown as Event)).toBeUndefined()
		expect(eventIcalUid({ ...timed, ical_uid: '' } as Event)).toBeUndefined()
		expect(eventIcalUid({ ...timed, ical_uid: 'x'.repeat(1_001) } as Event)).toBeUndefined()
		expect(
			eventEpochRange({ id: 'bad-shape', calendar_id: 'calendar', when: { date: 'bad' } } as Event),
		).toBeNull()
	})
})
