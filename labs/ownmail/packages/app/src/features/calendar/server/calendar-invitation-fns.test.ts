import { type Event, NylasApiError } from '@nylas-labs/cli-kit/v3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => {
		let validator: ((input: unknown) => unknown) | undefined
		const api = {
			validator(fn: (input: unknown) => unknown) {
				validator = fn
				return api
			},
			handler(fn: (context: { data: unknown }) => unknown) {
				return (options?: { data?: unknown }) =>
					fn({ data: validator ? validator(options?.data) : options?.data })
			},
		}
		return api
	},
}))

const { requireMailbox } = vi.hoisted(() => ({ requireMailbox: vi.fn() }))
vi.mock('#server/mailbox-boundary', () => ({ requireMailbox: () => requireMailbox() }))

const { signalLocalChange } = vi.hoisted(() => ({ signalLocalChange: vi.fn() }))
vi.mock('#server/change-version', () => ({
	signalLocalChange: (...args: unknown[]) => signalLocalChange(...args),
}))

const {
	getCalendarInvitation,
	normalizeInvitationReference,
	normalizeInvitationRsvpInput,
	respondCalendarInvitation,
} = await import('./calendar-invitation-fns.js')

const START = 1_817_823_600
const END = 1_817_827_200
const ICS = [
	'BEGIN:VCALENDAR',
	'METHOD:REQUEST',
	'BEGIN:VEVENT',
	'UID:invite@example.com',
	'DTSTART:20270809T150000Z',
	'DTEND:20270809T160000Z',
	'ORGANIZER:mailto:grace@example.com',
	'SUMMARY:Planning review',
	'END:VEVENT',
	'END:VCALENDAR',
].join('\r\n')

function invitationEvent(overrides: Partial<Event> = {}): Event {
	return {
		id: 'provider-event-id',
		calendar_id: 'primary',
		title: 'Planning review',
		location: 'Aurora room',
		when: { start_time: START, end_time: END },
		organizer: { name: 'Grace Hopper', email: 'grace@example.com' },
		participants: [{ email: 'ada@ownmail.com', status: 'noreply' }],
		ical_uid: 'invite@example.com',
		busy: true,
		...overrides,
	} as Event
}

function makeMailbox(overrides: Record<string, unknown> = {}) {
	const invite = invitationEvent()
	const conflict = {
		id: 'private-conflict-id',
		calendar_id: 'work',
		title: 'Private event title',
		when: { start_time: START + 900, end_time: END + 900 },
		busy: true,
	} as Event
	return {
		getMessage: vi.fn(async () => ({
			data: {
				id: 'message-1',
				grant_id: 'grant-1',
				attachments: [
					{ id: 'attachment-1', filename: 'invite.ics', content_type: 'text/calendar', size: 200 },
				],
			},
		})),
		downloadAttachment: vi.fn(async () => new Response(ICS)),
		listCalendars: vi.fn(async () => ({
			data: [
				{ id: 'primary', name: 'Personal', is_primary: true },
				{ id: 'work', name: 'Work' },
			],
		})),
		listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
			data: query.ical_uid
				? query.calendar_id === 'primary'
					? [invite]
					: []
				: query.calendar_id === 'primary'
					? [invite]
					: [conflict],
		})),
		sendRsvp: vi.fn(async () => ({ data: { ok: true } })),
		...overrides,
	}
}

describe('calendar invitation server functions', () => {
	beforeEach(() => {
		requireMailbox.mockReset()
		signalLocalChange.mockReset().mockResolvedValue(undefined)
	})

	it('returns an authoritative invitation summary and privacy-preserving conflict count', async () => {
		const mailbox = makeMailbox()
		requireMailbox.mockResolvedValue({
			mailbox,
			email: 'ada@ownmail.com',
			grantId: 'grant-1',
		})

		const result = await getCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})

		expect(result).toEqual({
			state: 'ready',
			title: 'Planning review',
			location: 'Aurora room',
			organizer: 'Grace Hopper',
			when: { kind: 'timed', start: START, end: END },
			status: 'noreply',
			conflicts: { state: 'conflict', count: 1 },
		})
		expect(JSON.stringify(result)).not.toContain('Private event title')
		expect(JSON.stringify(result)).not.toContain('private-conflict-id')
		expect(mailbox.listEvents).toHaveBeenCalledWith({
			calendar_id: 'primary',
			ical_uid: 'invite@example.com',
			limit: 20,
		})
	})

	it('re-resolves the attachment server-side before sending an RSVP', async () => {
		const mailbox = makeMailbox()
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			respondCalendarInvitation({
				data: { messageId: 'message-1', attachmentId: 'attachment-1', status: 'maybe' },
			}),
		).resolves.toEqual({ status: 'maybe' })
		expect(mailbox.getMessage).toHaveBeenCalledWith('message-1')
		expect(mailbox.sendRsvp).toHaveBeenCalledWith('provider-event-id', 'primary', 'maybe')
		expect(signalLocalChange).toHaveBeenCalledWith('grant-1', 'calendar')
	})

	it('fails closed when the referenced attachment is not on the authenticated message', async () => {
		const mailbox = makeMailbox()
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attacker-choice' } }),
		).rejects.toThrow('Calendar invitation not found.')
		expect(mailbox.downloadAttachment).not.toHaveBeenCalled()
		expect(mailbox.sendRsvp).not.toHaveBeenCalled()
	})

	it('withholds RSVP controls when the authenticated mailbox is not an attendee', async () => {
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
				data:
					query.ical_uid && query.calendar_id === 'primary'
						? [invitationEvent({ participants: [{ email: 'someone@example.com' }] })]
						: [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })
	})

	it('marks conflict detection unknown when any calendar page fails', async () => {
		const base = makeMailbox()
		const listEvents = vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => {
			if (!query.ical_uid && query.calendar_id === 'work') throw new Error('provider detail')
			return { data: query.calendar_id === 'primary' ? [invitationEvent()] : [] }
		})
		const mailbox = { ...base, listEvents }
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		const result = await getCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})

		expect(result).toMatchObject({ state: 'ready', conflicts: { state: 'unknown' } })
	})

	it('falls back to a strict time, organizer, and title match when ical_uid filtering is unsupported', async () => {
		const fallbackEvent = invitationEvent({ ical_uid: undefined } as Partial<Event>)
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string }) => {
				if (query.ical_uid) throw new Error('unsupported filter')
				return { data: [fallbackEvent] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', title: 'Planning review' })
	})

	it('accepts a fallback schedule plus exact title when ICS omits the organizer', async () => {
		const withoutOrganizer = ICS.replace('ORGANIZER:mailto:grace@example.com\r\n', '')
		const fallbackEvent = invitationEvent({ ical_uid: undefined } as Partial<Event>)
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(withoutOrganizer)),
			listEvents: vi.fn(async (query: { ical_uid?: string }) => {
				if (query.ical_uid) throw new Error('unsupported filter')
				return { data: [fallbackEvent] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
	})

	it('rejects an iCloud-style fallback that cannot be correlated strongly', async () => {
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string }) => {
				if (query.ical_uid) throw new Error('unsupported filter')
				return {
					data: [
						invitationEvent({
							ical_uid: undefined,
							title: 'Different event',
							organizer: { email: 'other@example.com' },
							when: { start_time: START + 7_200, end_time: END + 7_200 },
						} as Partial<Event>),
					],
				}
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'syncing' })
	})

	it('reports syncing when no matching provider event exists yet', async () => {
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'syncing' })
		await expect(
			respondCalendarInvitation({
				data: { messageId: 'message-1', attachmentId: 'attachment-1', status: 'yes' },
			}),
		).rejects.toThrow('cannot be answered right now')
	})

	it('can correlate a UID-only request without attempting an unsafe fallback', async () => {
		const withoutTimes = 'BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:invite@example.com\nEND:VEVENT'
		const mailbox = makeMailbox({ downloadAttachment: vi.fn(async () => new Response(withoutTimes)) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
	})

	it('maps a total calendar lookup outage to a safe error', async () => {
		const mailbox = makeMailbox({ listEvents: vi.fn().mockRejectedValue(new Error('private outage')) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')
	})

	it('supports authoritative all-day invitation summaries and provider status defaults', async () => {
		const allDay = invitationEvent({
			title: undefined,
			location: ' ',
			when: { date: '2027-12-25' },
			organizer: { email: 'grace@example.com' },
			participants: [{ email: 'ada@ownmail.com' }],
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
				data: query.calendar_id === 'primary' ? [allDay] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({
			state: 'ready',
			title: '(untitled invitation)',
			organizer: 'grace@example.com',
			when: { kind: 'all-day', startDate: '2027-12-25', endDate: '2027-12-26' },
			status: 'noreply',
			conflicts: { state: 'clear' },
		})
	})

	it('uses a generic organizer label when the provider omits organizer text', async () => {
		const unnamedOrganizer = invitationEvent({ organizer: { name: ' ', email: ' ' } })
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string }) => ({
				data: query.calendar_id === 'primary' ? [unnamedOrganizer] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ organizer: 'Organizer' })
	})

	it('skips conflict expansion for invitation spans longer than a month', async () => {
		const longEvent = invitationEvent({ when: { start_time: START, end_time: START + 32 * 86_400 } })
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string }) => ({
				data: query.calendar_id === 'primary' ? [longEvent] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ conflicts: { state: 'unknown' } })
	})

	it('preserves provider date spans in the invitation summary', async () => {
		const dateSpan = invitationEvent({ when: { start_date: '2027-12-25', end_date: '2027-12-28' } })
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string }) => ({
				data: query.calendar_id === 'primary' ? [dateSpan] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({
			when: { kind: 'all-day', startDate: '2027-12-25', endDate: '2027-12-28' },
		})
	})

	it('supports point-in-time provider events and treats truncated conflict pages as unknown', async () => {
		const point = invitationEvent({ when: { time: START } })
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
				data: query.calendar_id === 'primary' ? [point] : [],
				...(query.ical_uid ? {} : { next_cursor: 'more-private-events' }),
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({
			when: { kind: 'timed', start: START, end: START + 1 },
			conflicts: { state: 'unknown' },
		})
	})

	it.each([
		['oversized metadata', { size: 600_000 }, new Response(ICS)],
		['empty content', { size: 200 }, new Response('')],
		['oversized content', { size: undefined }, new Response(new Uint8Array(600_000))],
		['invalid UTF-8', { size: 200 }, new Response(new Uint8Array([0xff]))],
		['invalid ICS', { size: 200 }, new Response('not a calendar')],
	] as const)('rejects %s before calendar lookup', async (_label, attachment, download) => {
		const mailbox = makeMailbox({
			getMessage: vi.fn(async () => ({
				data: {
					id: 'message-1',
					grant_id: 'grant-1',
					attachments: [
						{
							id: 'attachment-1',
							filename: 'invite.ics',
							content_type: 'text/calendar',
							...attachment,
						},
					],
				},
			})),
			downloadAttachment: vi.fn(async () => download.clone()),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'invalid' })
		expect(mailbox.listCalendars).not.toHaveBeenCalled()
	})

	it('rejects provider download failures without exposing response details', async () => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response('secret', { status: 502 })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('Calendar invitation could not be opened.')
	})

	it('fails closed when the calendar boundary returns no valid calendars or a mismatched event', async () => {
		const noCalendars = makeMailbox({
			listCalendars: vi.fn(async () => ({
				data: [
					null,
					'calendar',
					{},
					{ id: 42, name: 'Bad' },
					{ id: 'missing-name' },
					{ id: 'bad', name: 42 },
				],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox: noCalendars, email: 'ada@ownmail.com', grantId: 'grant-1' })
		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })

		const nonArrayCalendars = makeMailbox({ listCalendars: vi.fn(async () => ({ data: undefined })) })
		requireMailbox.mockResolvedValue({
			mailbox: nonArrayCalendars,
			email: 'ada@ownmail.com',
			grantId: 'grant-1',
		})
		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })

		const mismatched = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string }) => ({
				data: query.ical_uid ? [invitationEvent({ calendar_id: 'not-authorized' })] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox: mismatched, email: 'ada@ownmail.com', grantId: 'grant-1' })
		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })
	})

	it('rejects an attachment ID that resolves to a non-calendar file', async () => {
		const mailbox = makeMailbox({
			getMessage: vi.fn(async () => ({
				data: {
					id: 'message-1',
					grant_id: 'grant-1',
					attachments: [{ id: 'attachment-1', filename: 'notes.txt', content_type: 'text/plain' }],
				},
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('Calendar invitation not found')
	})

	it('does not count the invitation series, free events, cancelled events, or non-overlaps as conflicts', async () => {
		const invite = invitationEvent()
		const ignored = [
			invitationEvent({ id: 'same-series', calendar_id: 'work' }),
			invitationEvent({ id: 'free', calendar_id: 'work', ical_uid: 'free', busy: false } as Partial<Event>),
			invitationEvent({ id: 'cancelled', calendar_id: 'work', ical_uid: 'cancelled', status: 'cancelled' }),
			invitationEvent({
				id: 'later',
				calendar_id: 'work',
				ical_uid: 'later',
				when: { start_time: END, end_time: END + 60 },
			} as Partial<Event>),
		]
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
				data: query.ical_uid ? (query.calendar_id === 'primary' ? [invite] : []) : [invite, ...ignored],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ conflicts: { state: 'clear' } })
	})

	it.each([
		[new NylasApiError('expired secret', 401), 'mailbox session expired'],
		[new NylasApiError('forbidden secret', 403), 'mailbox session expired'],
		[new NylasApiError('limited secret', 429), 'temporarily busy'],
		[new Error('provider secret'), 'could not be updated'],
	] as const)('maps provider failures to safe errors', async (failure, expected) => {
		const mailbox = makeMailbox({ getMessage: vi.fn().mockRejectedValue(failure) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow(expected)
	})

	it('maps RSVP provider failures to a generic safe error', async () => {
		const mailbox = makeMailbox({ sendRsvp: vi.fn().mockRejectedValue(new Error('provider secret')) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			respondCalendarInvitation({
				data: { messageId: 'message-1', attachmentId: 'attachment-1', status: 'no' },
			}),
		).rejects.toThrow('could not be updated')
	})
})

describe('calendar invitation input validation', () => {
	it('validates provider IDs and allow-lists RSVP values', () => {
		expect(normalizeInvitationReference({ messageId: 'message#1', attachmentId: 'attachment=1' })).toEqual({
			messageId: 'message#1',
			attachmentId: 'attachment=1',
		})
		expect(() => normalizeInvitationReference({ messageId: 'bad\nid', attachmentId: 'attachment' })).toThrow(
			'Invalid message',
		)
		expect(() =>
			normalizeInvitationRsvpInput({
				messageId: 'message',
				attachmentId: 'attachment',
				status: 'later' as 'yes',
			}),
		).toThrow('Invalid RSVP')
		expect(() => normalizeInvitationReference(null as never)).toThrow('Invalid invitation')
	})
})
