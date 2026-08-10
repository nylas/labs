import { type Event, type Message, NylasApiError } from '@nylas-labs/cli-kit/v3'
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
	acquireInvitationMutation,
	claimInvitationCreation,
	invitationCancellationSequence,
	invitationCreationClaimActive,
	invitationCreationClaimSequence,
	invitationCreationClaimsAvailable,
	recordInvitationCancellation,
	releaseInvitationMutation,
	releaseInvitationCreationClaim,
} = vi.hoisted(() => ({
	acquireInvitationMutation: vi.fn(),
	claimInvitationCreation: vi.fn(),
	invitationCancellationSequence: vi.fn(),
	invitationCreationClaimActive: vi.fn(),
	invitationCreationClaimSequence: vi.fn(),
	invitationCreationClaimsAvailable: vi.fn(),
	recordInvitationCancellation: vi.fn(),
	releaseInvitationMutation: vi.fn(),
	releaseInvitationCreationClaim: vi.fn(),
}))
vi.mock('#server/invitation-creation-claim', () => ({
	acquireInvitationMutation: (...args: unknown[]) => acquireInvitationMutation(...args),
	claimInvitationCreation: (...args: unknown[]) => claimInvitationCreation(...args),
	invitationCancellationSequence: (...args: unknown[]) => invitationCancellationSequence(...args),
	invitationCreationClaimActive: (...args: unknown[]) => invitationCreationClaimActive(...args),
	invitationCreationClaimSequence: (...args: unknown[]) => invitationCreationClaimSequence(...args),
	invitationCreationClaimsAvailable: () => invitationCreationClaimsAvailable(),
	recordInvitationCancellation: (...args: unknown[]) => recordInvitationCancellation(...args),
	releaseInvitationMutation: (...args: unknown[]) => releaseInvitationMutation(...args),
	releaseInvitationCreationClaim: (...args: unknown[]) => releaseInvitationCreationClaim(...args),
}))

const {
	addCalendarInvitation,
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
	'SEQUENCE:1',
	'DTSTART:20270809T150000Z',
	'DTEND:20270809T160000Z',
	'ORGANIZER:mailto:grace@example.com',
	'ATTENDEE;CN="Ada Lovelace";PARTSTAT=NEEDS-ACTION:mailto:ada@ownmail.com',
	'SUMMARY:Planning review',
	'END:VEVENT',
	'END:VCALENDAR',
].join('\r\n')
const CANCEL_ICS = [
	'BEGIN:VCALENDAR',
	'METHOD:CANCEL',
	'BEGIN:VEVENT',
	'UID:invite@example.com',
	'SEQUENCE:2',
	'ORGANIZER:mailto:grace@example.com',
	'END:VEVENT',
	'END:VCALENDAR',
].join('\r\n')

function invitationEvent(overrides: Partial<Event> = {}): Event {
	const metadata =
		overrides.metadata?.key1 === 'invite@example.com' && overrides.metadata.key2 === undefined
			? { ...overrides.metadata, key2: '1' }
			: overrides.metadata
	return {
		id: 'provider-event-id',
		calendar_id: 'primary',
		title: 'Planning review',
		location: 'Aurora room',
		when: { start_time: START, end_time: END },
		organizer: { name: 'Grace Hopper', email: 'grace@example.com' },
		participants: [{ email: 'ada@ownmail.com', name: 'Ada Lovelace', status: 'noreply' }],
		ical_uid: 'invite@example.com',
		busy: true,
		...overrides,
		...(metadata ? { metadata } : {}),
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
				from: [{ email: 'grace@example.com' }],
				to: [{ email: 'ada@ownmail.com' }],
				attachments: [
					{ id: 'attachment-1', filename: 'invite.ics', content_type: 'text/calendar', size: 200 },
				],
			},
		})),
		getThread: vi.fn(async () => ({
			data: { id: 'thread-1', grant_id: 'grant-1', message_ids: ['message-1'] },
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
		createEvent: vi.fn(async () => ({
			data: invitationEvent({ metadata: { key1: 'invite@example.com' } }),
		})),
		updateEvent: vi.fn(async (_eventId: string, body: Partial<Event>, calendarId: string) => ({
			data: invitationEvent({ ...body, calendar_id: calendarId }),
		})),
		deleteEvent: vi.fn(async () => undefined),
		...overrides,
	}
}

describe('calendar invitation server functions', () => {
	beforeEach(() => {
		requireMailbox.mockReset()
		signalLocalChange.mockReset().mockResolvedValue(undefined)
		acquireInvitationMutation.mockReset().mockResolvedValue('0123456789abcdef0123456789abcdef')
		claimInvitationCreation.mockReset().mockResolvedValue(true)
		invitationCancellationSequence.mockReset().mockResolvedValue(undefined)
		invitationCreationClaimActive
			.mockReset()
			.mockImplementation(async (...args: unknown[]) => args.length === 3)
		invitationCreationClaimSequence.mockReset().mockResolvedValue(undefined)
		invitationCreationClaimsAvailable.mockReset().mockResolvedValue(true)
		recordInvitationCancellation.mockReset().mockResolvedValue(2)
		releaseInvitationMutation.mockReset().mockResolvedValue(undefined)
		releaseInvitationCreationClaim.mockReset().mockResolvedValue(undefined)
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

	it('removes a matching OwnMail import when the organizer cancels it', async () => {
		acquireInvitationMutation.mockResolvedValue(undefined)
		invitationCreationClaimSequence.mockResolvedValue(2)
		const imported = invitationEvent({
			ical_uid: undefined,
			organizer: { email: 'ada@ownmail.com' },
			metadata: { key1: 'invite@example.com', key2: '1', key3: 'grace@example.com' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
			listEvents: vi.fn(async (query: { calendar_id: string; metadata_pair?: string }) => ({
				data: query.metadata_pair && query.calendar_id === 'primary' ? [imported] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: true, manualReview: false })
		expect(mailbox.deleteEvent).toHaveBeenCalledWith('provider-event-id', 'primary', {
			notifyParticipants: false,
		})
		expect(recordInvitationCancellation).toHaveBeenCalledWith(
			'grant-1',
			'invite@example.com',
			2,
			'grace@example.com',
		)
		expect(signalLocalChange).toHaveBeenCalledWith('grant-1', 'calendar')
		expect(releaseInvitationMutation).not.toHaveBeenCalled()
	})

	it('records a valid cancellation even when no calendar is currently available', async () => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
			listCalendars: vi.fn(async () => ({ data: [] })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })
		expect(recordInvitationCancellation).toHaveBeenCalledWith(
			'grant-1',
			'invite@example.com',
			2,
			'grace@example.com',
		)
		expect(mailbox.listEvents).not.toHaveBeenCalled()
	})

	it.each(['-1', 'not-a-number', '2147483648', '00000000000'])(
		'rejects a cancellation with malformed sequence %s',
		async (sequence) => {
			const mailbox = makeMailbox({
				downloadAttachment: vi.fn(
					async () => new Response(CANCEL_ICS.replace('SEQUENCE:2', `SEQUENCE:${sequence}`)),
				),
			})
			requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

			await expect(
				getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).resolves.toEqual({ state: 'invalid' })
			expect(recordInvitationCancellation).not.toHaveBeenCalled()
			expect(mailbox.listCalendars).not.toHaveBeenCalled()
		},
	)

	it('rejects an unterminated cancellation before persisting or deleting anything', async () => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(
				async () => new Response(CANCEL_ICS.replace('\r\nEND:VEVENT\r\nEND:VCALENDAR', '')),
			),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'invalid' })
		expect(recordInvitationCancellation).not.toHaveBeenCalled()
		expect(mailbox.listCalendars).not.toHaveBeenCalled()
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
	})

	it('rejects recurring-instance cancellations without tombstoning or deleting the series', async () => {
		const instanceCancellation = CANCEL_ICS.replace(
			'ORGANIZER:mailto:grace@example.com',
			'RECURRENCE-ID:20270816T150000Z\r\nORGANIZER:mailto:grace@example.com',
		)
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(instanceCancellation)),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })
		expect(recordInvitationCancellation).not.toHaveBeenCalled()
		expect(mailbox.listCalendars).not.toHaveBeenCalled()
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
	})

	it('blocks a request revision covered by a cancellation tombstone', async () => {
		invitationCancellationSequence.mockResolvedValue(1)
		const mailbox = makeMailbox()
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: false })
		expect(invitationCancellationSequence).toHaveBeenCalledWith(
			'grant-1',
			'invite@example.com',
			'grace@example.com',
		)
		expect(mailbox.listCalendars).not.toHaveBeenCalled()
	})

	it('allows a request revision newer than its cancellation tombstone', async () => {
		invitationCancellationSequence.mockResolvedValue(0)
		const mailbox = makeMailbox()
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
	})

	it('treats an omitted request sequence as revision zero for tombstones', async () => {
		invitationCancellationSequence.mockResolvedValue(0)
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(ICS.replace('SEQUENCE:1\r\n', ''))),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: false })
	})

	it('rechecks the tombstone after claiming a missing request', async () => {
		invitationCancellationSequence.mockResolvedValueOnce(undefined).mockResolvedValueOnce(1)
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: false })
		expect(mailbox.createEvent).not.toHaveBeenCalled()
		expect(releaseInvitationCreationClaim).toHaveBeenCalledWith('grant-1', 'invite@example.com', 1)
	})

	it('does not infer legacy organizer trust from a request in the cancellation thread', async () => {
		const imported = invitationEvent({
			ical_uid: undefined,
			organizer: { email: 'ada@ownmail.com' },
			metadata: { key1: 'invite@example.com', key2: '1' },
		})
		const mailbox = makeMailbox({
			getMessage: vi.fn(async (messageId: string) => ({
				data:
					messageId === 'message-1'
						? {
								id: 'message-1',
								grant_id: 'grant-1',
								thread_id: 'thread-1',
								from: [{ email: 'grace@example.com' }],
								to: [{ email: 'ada@ownmail.com' }],
								attachments: [
									{
										id: 'attachment-1',
										filename: 'cancel.ics',
										content_type: 'text/calendar',
										size: 200,
									},
								],
							}
						: {
								id: 'request-1',
								grant_id: 'grant-1',
								thread_id: 'thread-1',
								from: [{ email: 'grace@example.com' }],
								to: [{ email: 'ada@ownmail.com' }],
								attachments: [
									{
										id: 'request-attachment',
										filename: 'invite.ics',
										content_type: 'text/calendar',
										size: 200,
									},
								],
							},
			})),
			getThread: vi.fn(async () => ({
				data: {
					id: 'thread-1',
					grant_id: 'grant-1',
					message_ids: ['request-1', 'message-1'],
				},
			})),
			downloadAttachment: vi.fn(
				async (attachmentId: string) =>
					new Response(attachmentId === 'request-attachment' ? ICS : CANCEL_ICS),
			),
			listEvents: vi.fn(async (query: { calendar_id: string; metadata_pair?: string }) => ({
				data: query.metadata_pair && query.calendar_id === 'primary' ? [imported] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: true })
		expect(mailbox.getThread).not.toHaveBeenCalled()
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
	})

	it.each([
		[
			'mismatched thread boundary',
			{ id: 'other-thread', grant_id: 'grant-1', message_ids: ['request-1', 'message-1'] },
			undefined,
		],
		[
			'mismatched prior message boundary',
			{ id: 'thread-1', grant_id: 'grant-1', message_ids: ['request-1', 'message-1'] },
			{ id: 'request-1', grant_id: 'grant-1', thread_id: 'other-thread', attachments: [] },
		],
		[
			'invalid prior message identifier',
			{ id: 'thread-1', grant_id: 'grant-1', message_ids: ['bad id', 'message-1'] },
			undefined,
		],
		[
			'non-calendar prior attachment',
			{ id: 'thread-1', grant_id: 'grant-1', message_ids: ['request-1', 'message-1'] },
			{
				id: 'request-1',
				grant_id: 'grant-1',
				thread_id: 'thread-1',
				attachments: [{ id: 'notes', filename: 'notes.txt', content_type: 'text/plain' }],
			},
		],
		[
			'non-request calendar attachment',
			{ id: 'thread-1', grant_id: 'grant-1', message_ids: ['request-1', 'message-1'] },
			{
				id: 'request-1',
				grant_id: 'grant-1',
				thread_id: 'thread-1',
				attachments: [{ id: 'another-cancel', filename: 'cancel.ics', content_type: 'text/calendar' }],
			},
		],
	] as const)(
		'does not inspect untrusted legacy organizer evidence with a %s',
		async (_case, thread, prior) => {
			const imported = invitationEvent({
				organizer: { email: 'ada@ownmail.com' },
				metadata: { key1: 'invite@example.com', key2: '1' },
			})
			const mailbox = makeMailbox({
				getMessage: vi.fn(async (messageId: string) => ({
					data:
						messageId === 'message-1'
							? {
									id: 'message-1',
									grant_id: 'grant-1',
									thread_id: 'thread-1',
									from: [{ email: 'grace@example.com' }],
									to: [{ email: 'ada@ownmail.com' }],
									attachments: [
										{ id: 'attachment-1', filename: 'cancel.ics', content_type: 'text/calendar' },
									],
								}
							: prior,
				})),
				getThread: vi.fn(async () => ({ data: thread })),
				downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
				listEvents: vi.fn(async (query: { calendar_id: string; metadata_pair?: string }) => ({
					data: query.metadata_pair && query.calendar_id === 'primary' ? [imported] : [],
				})),
			})
			requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

			await expect(
				getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: true })
			expect(mailbox.getThread).not.toHaveBeenCalled()
			expect(mailbox.deleteEvent).not.toHaveBeenCalled()
		},
	)

	it('does not let an older cancellation remove a newer retained revision', async () => {
		invitationCreationClaimSequence.mockResolvedValue(5)
		releaseInvitationMutation.mockRejectedValue(new Error('mutation cleanup outage'))
		const stale = invitationEvent({
			ical_uid: undefined,
			metadata: { key1: 'invite@example.com', key2: '2', key3: 'grace@example.com' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS.replace('SEQUENCE:2', 'SEQUENCE:3'))),
			listEvents: vi.fn(async (query: { calendar_id: string; metadata_pair?: string }) => ({
				data: query.metadata_pair && query.calendar_id === 'primary' ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: false })
		expect(invitationCreationClaimSequence).toHaveBeenCalledWith('grant-1', 'invite@example.com')
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
	})

	it('keeps cancellation retryable while another mutation owns the UID lock', async () => {
		acquireInvitationMutation.mockResolvedValue(null)
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelling' })
		expect(mailbox.listEvents).not.toHaveBeenCalled()
		expect(releaseInvitationMutation).not.toHaveBeenCalled()
	})

	it.each([
		['invalid mailbox', CANCEL_ICS, 'not-an-email', {}],
		[
			'missing organizer',
			CANCEL_ICS.replace('ORGANIZER:mailto:grace@example.com\r\n', ''),
			'ada@ownmail.com',
			{},
		],
		['self organizer', CANCEL_ICS.replace('grace@example.com', 'ada@ownmail.com'), 'ada@ownmail.com', {}],
		['wrong grant', CANCEL_ICS, 'ada@ownmail.com', { grant_id: 'other' }],
		[
			'multiple senders',
			CANCEL_ICS,
			'ada@ownmail.com',
			{ from: [{ email: 'grace@example.com' }, { email: 'other@example.com' }] },
		],
		['missing sender', CANCEL_ICS, 'ada@ownmail.com', { from: undefined }],
		['wrong sender', CANCEL_ICS, 'ada@ownmail.com', { from: [{ email: 'other@example.com' }] }],
		['missing recipient', CANCEL_ICS, 'ada@ownmail.com', { to: undefined }],
	] as const)(
		'rejects a cancellation with an untrusted %s boundary',
		async (_case, source, email, envelope) => {
			const mailbox = makeMailbox({
				downloadAttachment: vi.fn(async () => new Response(source)),
				getMessage: vi.fn(async () => ({
					data: {
						id: 'message-1',
						grant_id: 'grant-1',
						from: [{ email: 'grace@example.com' }],
						to: [{ email: 'ada@ownmail.com' }],
						attachments: [
							{
								id: 'attachment-1',
								filename: 'cancel.ics',
								content_type: 'text/calendar',
								size: 200,
							},
						],
						...envelope,
					},
				})),
			})
			requireMailbox.mockResolvedValue({ mailbox, email, grantId: 'grant-1' })

			await expect(
				getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).resolves.toEqual({ state: 'ineligible' })
			expect(mailbox.listEvents).not.toHaveBeenCalled()
			expect(mailbox.deleteEvent).not.toHaveBeenCalled()
		},
	)

	it('does not delete unrelated, malformed, or newer imported revisions', async () => {
		const candidates = [
			invitationEvent({ metadata: { key1: 'other-uid', key2: '1' } }),
			invitationEvent({
				metadata: { key1: 'invite@example.com', key2: '1', key3: 'other@example.com' },
			}),
			invitationEvent({
				organizer: undefined,
				metadata: { key1: 'invite@example.com', key2: '1' },
			}),
			invitationEvent({
				participants: undefined,
				metadata: { key1: 'invite@example.com', key2: '1', key3: 'grace@example.com' },
			}),
			invitationEvent({
				metadata: { key1: 'invite@example.com', key2: 1, key3: 'grace@example.com' },
			}),
			invitationEvent({
				metadata: { key1: 'invite@example.com', key2: '3', key3: 'grace@example.com' },
			}),
		]
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? candidates : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: false, manualReview: true })
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
		expect(signalLocalChange).not.toHaveBeenCalled()
	})

	it('treats an already-deleted sequence-zero import as cancelled', async () => {
		const imported = invitationEvent({ metadata: { key1: 'invite@example.com', key2: '0' } })
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS.replace('SEQUENCE:2\r\n', ''))),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [imported] : [],
			})),
			deleteEvent: vi.fn().mockRejectedValue(new NylasApiError('gone', 404)),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'cancelled', removed: true, manualReview: false })
		expect(signalLocalChange).toHaveBeenCalledWith('grant-1', 'calendar')
	})

	it('fails safely when cancellation lookup is incomplete', async () => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
			listEvents: vi.fn(async () => ({ data: [], next_cursor: 'more' })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')
		expect(recordInvitationCancellation).toHaveBeenCalledWith(
			'grant-1',
			'invite@example.com',
			2,
			'grace@example.com',
		)
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
	})

	it('fails safely instead of deleting an import from a read-only calendar', async () => {
		const imported = invitationEvent({
			calendar_id: 'work',
			metadata: { key1: 'invite@example.com', key2: '1' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
			listCalendars: vi.fn(async () => ({
				data: [{ id: 'work', name: 'Work', read_only: true }],
			})),
			listEvents: vi.fn(async () => ({ data: [imported] })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')
		expect(mailbox.deleteEvent).not.toHaveBeenCalled()
	})

	it('maps cancellation deletion failures to a generic error', async () => {
		const imported = invitationEvent({ metadata: { key1: 'invite@example.com', key2: '1' } })
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(CANCEL_ICS)),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [imported] : [],
			})),
			deleteEvent: vi.fn().mockRejectedValue(new Error('private provider failure')),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')
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

	it('does not send provider RSVP for an OwnMail-imported copy', async () => {
		const imported = invitationEvent({
			location: undefined,
			metadata: { key1: 'invite@example.com' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [imported] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			respondCalendarInvitation({
				data: { messageId: 'message-1', attachmentId: 'attachment-1', status: 'yes' },
			}),
		).rejects.toThrow('cannot be answered right now')
		expect(mailbox.sendRsvp).not.toHaveBeenCalled()
	})

	it('paginates every calendar before resolving or creating an invitation', async () => {
		const secondary = invitationEvent({ calendar_id: 'page-two' })
		const mailbox = makeMailbox({
			listCalendars: vi.fn(async (query?: { page_token?: string }) =>
				query?.page_token
					? { data: [{ id: 'page-two', name: 'Page two' }] }
					: {
							data: [{ id: 'primary', name: 'Personal', is_primary: true }],
							next_cursor: 'calendar-page-two',
						},
			),
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
				data: query.ical_uid && query.calendar_id === 'page-two' ? [secondary] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.listCalendars).toHaveBeenNthCalledWith(2, {
			limit: 20,
			page_token: 'calendar-page-two',
		})
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('fails closed for invalid or unbounded calendar pagination', async () => {
		const invalidMailbox = makeMailbox({
			listCalendars: vi.fn(async () => ({ data: [], next_cursor: null })),
		})
		requireMailbox.mockResolvedValue({
			mailbox: invalidMailbox,
			email: 'ada@ownmail.com',
			grantId: 'grant-1',
		})
		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')

		let page = 0
		const unboundedMailbox = makeMailbox({
			listCalendars: vi.fn(async () => {
				page += 1
				return { data: [], next_cursor: `page-${page}` }
			}),
		})
		requireMailbox.mockResolvedValue({
			mailbox: unboundedMailbox,
			email: 'ada@ownmail.com',
			grantId: 'grant-1',
		})
		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')
		expect(unboundedMailbox.listCalendars).toHaveBeenCalledTimes(100)
	})

	it('creates after a complete strict fallback when the final UID filter is unsupported', async () => {
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string }) => {
				if (query.ical_uid) throw new Error('unsupported optional filter')
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.createEvent).toHaveBeenCalledOnce()
	})

	it('uses a strict final fallback event when the UID filter is unsupported', async () => {
		let timeLookups = 0
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string; start?: number }) => {
				if (query.ical_uid) throw new Error('unsupported optional filter')
				if (query.start !== undefined) {
					timeLookups += 1
					return { data: timeLookups > 2 ? [invitationEvent({ ical_uid: undefined })] : [] }
				}
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('uses a complete strict fallback when the final metadata filter is unsupported', async () => {
		let metadataLookups = 0
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => {
				if (query.metadata_pair) {
					metadataLookups += 1
					if (metadataLookups > 2) throw new Error('metadata outage')
				}
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', canRespond: false })
		expect(mailbox.createEvent).toHaveBeenCalledOnce()
	})

	it('reconciles a stale import found by strict fallback when metadata filtering is unsupported', async () => {
		let timeLookups = 0
		const stale = invitationEvent({
			ical_uid: undefined,
			location: 'Old room',
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string; start?: number }) => {
				if (query.metadata_pair) throw new Error('unsupported optional filter')
				if (query.start !== undefined) {
					timeLookups += 1
					return { data: timeLookups > 2 ? [stale] : [] }
				}
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', canRespond: false })
		expect(mailbox.updateEvent).toHaveBeenCalledOnce()
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('does not turn a genuine final lookup outage into an empty result', async () => {
		let uidLookups = 0
		let timeLookups = 0
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string; metadata_pair?: string; start?: number }) => {
				if (query.metadata_pair) return { data: [] }
				if (query.ical_uid) {
					uidLookups += 1
					if (uidLookups <= 2) return { data: [] }
				}
				if (query.start !== undefined) {
					timeLookups += 1
					if (timeLookups <= 2) return { data: [] }
				}
				throw new Error('provider outage')
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('could not be updated')
		expect(mailbox.createEvent).not.toHaveBeenCalled()
		expect(releaseInvitationCreationClaim).toHaveBeenCalledWith('grant-1', 'invite@example.com', 1)
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

	it('lets the user add a strictly matched missing invitation without notifying participants', async () => {
		releaseInvitationMutation.mockRejectedValue(new Error('mutation cleanup outage'))
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({
			state: 'ready',
			title: 'Planning review',
			status: 'noreply',
			canRespond: false,
		})

		expect(mailbox.createEvent).toHaveBeenCalledWith(
			{
				title: 'Planning review',
				when: { start_time: START, end_time: END },
				organizer: { email: 'grace@example.com' },
				participants: [{ email: 'ada@ownmail.com', name: 'Ada Lovelace', status: 'noreply' }],
				metadata: { key1: 'invite@example.com', key2: '1', key3: 'grace@example.com' },
			},
			'primary',
			{ notifyParticipants: false },
		)
		expect(signalLocalChange).toHaveBeenCalledWith('grant-1', 'calendar')
		expect(claimInvitationCreation).toHaveBeenCalledWith('grant-1', 'invite@example.com', 1)
		expect(releaseInvitationCreationClaim).not.toHaveBeenCalled()
	})

	it('does not supersede or release a revision claim when the UID mutation lock is busy', async () => {
		acquireInvitationMutation.mockResolvedValue(null)
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('already being added')
		expect(mailbox.listEvents).toHaveBeenCalled()
		expect(mailbox.createEvent).not.toHaveBeenCalled()
		expect(claimInvitationCreation).not.toHaveBeenCalled()
		expect(releaseInvitationCreationClaim).not.toHaveBeenCalled()
	})

	it('preserves rich ICS fields and safe defaults in the manually created event', async () => {
		const richIcs = ICS.replace(
			'ORGANIZER:mailto:grace@example.com',
			'ORGANIZER;CN="Grace Hopper":mailto:grace@example.com',
		)
			.replace('SEQUENCE:1\r\n', '')
			.replace('SUMMARY:Planning review\r\n', '')
			.replace(
				'END:VEVENT',
				'DESCRIPTION:Read the brief\\nBring notes\r\nLOCATION:Aurora\\, room\r\nEND:VEVENT',
			)
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(richIcs)),
			listEvents: vi.fn(async () => ({ data: [] })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await addCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})

		expect(mailbox.createEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				title: '(untitled invitation)',
				description: 'Read the brief\nBring notes',
				location: 'Aurora, room',
				organizer: { email: 'grace@example.com', name: 'Grace Hopper' },
			}),
			'primary',
			{ notifyParticipants: false },
		)
	})

	it('returns an event that Nylas created before the explicit fallback runs', async () => {
		const mailbox = makeMailbox()
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('uses the import marker when the provider event wins the final creation race', async () => {
		let metadataLookups = 0
		const imported = invitationEvent({
			organizer: { email: 'ada@ownmail.com' },
			location: undefined,
			metadata: { key1: 'invite@example.com' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => {
				if (query.metadata_pair) {
					metadataLookups += 1
					return { data: metadataLookups === 3 ? [imported] : [] }
				}
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', organizer: 'grace@example.com' })
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('uses the Nylas UID index when automatic creation wins the final race', async () => {
		let uidLookups = 0
		releaseInvitationCreationClaim.mockRejectedValue(new Error('claim cleanup outage'))
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { ical_uid?: string }) => {
				if (query.ical_uid) {
					uidLookups += 1
					return { data: uidLookups === 3 ? [invitationEvent()] : [] }
				}
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('rechecks every authorized calendar before creating the fallback', async () => {
		let workUidLookups = 0
		const secondary = invitationEvent({ calendar_id: 'work' })
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => {
				if (query.ical_uid && query.calendar_id === 'work') {
					workUidLookups += 1
					return { data: workUidLookups === 2 ? [secondary] : [] }
				}
				return { data: [] }
			}),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('reconciles a rescheduled OwnMail import instead of trusting or duplicating it', async () => {
		const stale = invitationEvent({
			title: 'Old planning review',
			when: { start_time: START - 3_600, end_time: END - 3_600 },
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string; start?: number }) => ({
				data: query.metadata_pair || query.start !== undefined ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', title: 'Planning review' })
		expect(mailbox.updateEvent).toHaveBeenCalledWith(
			'provider-event-id',
			expect.objectContaining({ title: 'Planning review', when: { start_time: START, end_time: END } }),
			'primary',
			{ notifyParticipants: false },
		)
		expect(mailbox.createEvent).not.toHaveBeenCalled()
		expect(releaseInvitationCreationClaim).not.toHaveBeenCalled()
	})

	it('reconciles a newer imported revision returned by the UID index', async () => {
		const stale = invitationEvent({
			location: 'Old room',
			metadata: { key1: 'invite@example.com', key2: '1' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(ICS.replace('SEQUENCE:1', 'SEQUENCE:5'))),
			listEvents: vi.fn(async (query: { calendar_id: string; ical_uid?: string }) => ({
				data: query.ical_uid && query.calendar_id === 'primary' ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', canRespond: false })
		expect(mailbox.updateEvent).toHaveBeenCalledOnce()
		expect(mailbox.createEvent).not.toHaveBeenCalled()
		expect(claimInvitationCreation).toHaveBeenCalledWith('grant-1', 'invite@example.com', 5)
		expect(invitationCreationClaimActive).toHaveBeenCalledWith('grant-1', 'invite@example.com', 5)
	})

	it.each([
		['title', { title: 'Old planning review', location: 'Aurora room' }],
		['location', { title: 'Planning review', location: 'Old room' }],
	] as const)('reconciles an imported invitation with stale %s content', async (_field, changes) => {
		const stale = invitationEvent({
			...changes,
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const source = ICS.replace('END:VEVENT', 'LOCATION:Aurora room\r\nEND:VEVENT')
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(source)),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.updateEvent).toHaveBeenCalledOnce()
	})

	it.each([
		['description', { description: 'Old notes', location: undefined }],
		['location', { description: undefined, location: 'Old room' }],
	] as const)('clears %s content removed by a later invitation', async (_field, content) => {
		const stale = invitationEvent({
			...content,
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string; start?: number }) => ({
				data: query.metadata_pair || query.start !== undefined ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
		expect(mailbox.updateEvent).toHaveBeenCalledWith(
			'provider-event-id',
			expect.objectContaining({ description: '', location: '' }),
			'primary',
			{ notifyParticipants: false },
		)
	})

	it('reconciles attendee changes in a later invitation', async () => {
		const stale = invitationEvent({
			location: undefined,
			participants: [
				{ email: 'ada@ownmail.com', name: 'Ada Lovelace', status: 'noreply' },
				{ email: 'old-attendee@example.com', name: 'Old Attendee', status: 'yes' },
			],
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', canRespond: false })
		expect(mailbox.updateEvent).toHaveBeenCalledWith(
			'provider-event-id',
			expect.objectContaining({
				participants: [{ email: 'ada@ownmail.com', name: 'Ada Lovelace', status: 'noreply' }],
			}),
			'primary',
			{ notifyParticipants: false },
		)
	})

	it('does not let an older invitation overwrite a newer imported revision', async () => {
		const current = invitationEvent({
			title: 'New planning review',
			ical_uid: undefined,
			location: undefined,
			metadata: { key1: 'invite@example.com', key2: '2' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(ICS.replace('SEQUENCE:1\r\n', ''))),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [current] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', title: 'New planning review', canRespond: false })
		expect(mailbox.updateEvent).not.toHaveBeenCalled()
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it.each(['2147483648', 1] as const)(
		'does not overwrite an import with invalid stored revision marker %s',
		async (storedSequence) => {
			const current = invitationEvent({
				title: 'Current planning review',
				ical_uid: undefined,
				location: undefined,
				metadata: { key1: 'invite@example.com', key2: storedSequence },
			})
			const mailbox = makeMailbox({
				listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
					data: query.metadata_pair ? [current] : [],
				})),
			})
			requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

			await expect(
				addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).resolves.toMatchObject({ state: 'ready', title: 'Current planning review' })
			expect(mailbox.updateEvent).not.toHaveBeenCalled()
		},
	)

	it('recognizes a one-day OwnMail import when the invitation omits DTEND', async () => {
		const source = ICS.replace(
			'DTSTART:20270809T150000Z\r\nDTEND:20270809T160000Z',
			'DTSTART;VALUE=DATE:20271225',
		)
		const imported = invitationEvent({
			location: undefined,
			when: { start_date: '2027-12-25', end_date: '2027-12-26' },
			metadata: { key1: 'invite@example.com' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(source)),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [imported] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({
			state: 'ready',
			when: { kind: 'all-day', startDate: '2027-12-25', endDate: '2027-12-26' },
		})
		expect(mailbox.updateEvent).not.toHaveBeenCalled()
	})

	it.each([
		{
			name: 'matching optional content',
			source: ICS.replace('END:VEVENT', 'DESCRIPTION:Read the brief\r\nLOCATION:Aurora room\r\nEND:VEVENT'),
			event: invitationEvent({
				description: 'Read the brief',
				metadata: { key1: 'invite@example.com' },
			}),
		},
		{
			name: 'matching omitted summary',
			source: ICS.replace('SUMMARY:Planning review\r\n', ''),
			event: invitationEvent({
				title: undefined,
				location: undefined,
				metadata: { key1: 'invite@example.com' },
			}),
		},
	])('recognizes an OwnMail import with $name', async ({ source, event }) => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(source)),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [event] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready' })
	})

	it('refuses to reconcile a stale import on a read-only calendar', async () => {
		const stale = invitationEvent({
			calendar_id: 'work',
			title: 'Old title',
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const mailbox = makeMailbox({
			listCalendars: vi.fn(async () => ({
				data: [
					{ id: 'primary', name: 'Personal', is_primary: true },
					{ id: 'work', name: 'Work', read_only: true },
				],
			})),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('cannot be updated')
		expect(mailbox.updateEvent).not.toHaveBeenCalled()
	})

	it.each([{ id: 'bad-update' } as Event, invitationEvent({ calendar_id: 'other-calendar' })])(
		'maps an invalid reconciliation response to a safe error',
		async (updatedEvent) => {
			const stale = invitationEvent({
				title: 'Old title',
				metadata: { key1: 'invite@example.com', key2: '0' },
			})
			const mailbox = makeMailbox({
				listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
					data: query.metadata_pair ? [stale] : [],
				})),
				updateEvent: vi.fn(async () => ({ data: updatedEvent })),
			})
			requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

			await expect(
				addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).rejects.toThrow('could not be updated')
		},
	)

	it('recognizes an earlier OwnMail import even when the provider rewrites its organizer', async () => {
		const imported = invitationEvent({
			organizer: { email: 'ada@ownmail.com' },
			ical_uid: undefined,
			location: undefined,
			metadata: { key1: 'invite@example.com' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [imported] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', organizer: 'grace@example.com' })
	})

	it('uses the ICS organizer name when an imported provider event omits its organizer', async () => {
		const imported = invitationEvent({
			organizer: undefined,
			ical_uid: undefined,
			location: undefined,
			metadata: { key1: 'invite@example.com' },
		})
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(
				async () =>
					new Response(
						ICS.replace(
							'ORGANIZER:mailto:grace@example.com',
							'ORGANIZER;CN="Grace Hopper":mailto:grace@example.com',
						),
					),
			),
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [imported] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toMatchObject({ state: 'ready', organizer: 'Grace Hopper' })
	})

	it('ignores malformed import markers and organizer-less provider candidates', async () => {
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string; ical_uid?: string }) => ({
				data: query.ical_uid
					? [invitationEvent({ organizer: undefined })]
					: query.metadata_pair
						? [invitationEvent({ metadata: { key1: 'x'.repeat(1_001) } })]
						: [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'ineligible' })
	})

	it('coalesces repeat clicks while one invitation creation is in flight', async () => {
		let finishCreation!: () => void
		const createEvent = vi.fn(
			() =>
				new Promise<{ data: Event }>((resolve) => {
					finishCreation = () =>
						resolve({ data: invitationEvent({ metadata: { key1: 'invite@example.com' } }) })
				}),
		)
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })), createEvent })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		const first = addCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})
		const second = addCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})
		await vi.waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1))
		finishCreation()

		await expect(Promise.all([first, second])).resolves.toHaveLength(2)
		expect(createEvent).toHaveBeenCalledTimes(1)
	})

	it('maps one in-flight provider failure safely for both concurrent callers', async () => {
		let failCreation!: () => void
		const createEvent = vi.fn(
			() =>
				new Promise<{ data: Event }>((_resolve, reject) => {
					failCreation = () => reject(new Error('raw provider detail'))
				}),
		)
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })), createEvent })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		const first = addCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})
		const second = addCalendarInvitation({
			data: { messageId: 'message-1', attachmentId: 'attachment-1' },
		})
		await vi.waitFor(() => expect(createEvent).toHaveBeenCalledOnce())
		failCreation()

		const outcomes = await Promise.allSettled([first, second])
		expect(outcomes).toEqual([
			expect.objectContaining({
				status: 'rejected',
				reason: expect.objectContaining({ message: expect.stringContaining('could not be updated') }),
			}),
			expect.objectContaining({
				status: 'rejected',
				reason: expect.objectContaining({ message: expect.stringContaining('could not be updated') }),
			}),
		])
		expect(releaseInvitationCreationClaim).not.toHaveBeenCalled()
	})

	it('refuses a cross-instance duplicate when another request owns the atomic claim', async () => {
		claimInvitationCreation.mockResolvedValue(false)
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('already being added')
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('does not reconcile a newer revision without owning the atomic claim', async () => {
		claimInvitationCreation.mockResolvedValue(false)
		const stale = invitationEvent({
			ical_uid: undefined,
			location: 'Old room',
			metadata: { key1: 'invite@example.com', key2: '0' },
		})
		const mailbox = makeMailbox({
			listEvents: vi.fn(async (query: { metadata_pair?: string }) => ({
				data: query.metadata_pair ? [stale] : [],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('already being added')
		expect(mailbox.updateEvent).not.toHaveBeenCalled()
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it.each([
		['recurring', `${ICS.replace('END:VEVENT', 'RRULE:FREQ=WEEKLY\r\nEND:VEVENT')}`],
		[
			'floating-time',
			ICS.replace('DTSTART:20270809T150000Z', 'DTSTART:20270809T150000').replace(
				'DTEND:20270809T160000Z',
				'DTEND:20270809T160000',
			),
		],
	] as const)('keeps a %s invitation on the automatic Nylas path', async (_case, source) => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(source)),
			listEvents: vi.fn(async () => ({ data: [] })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'syncing', canAdd: false })
		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('cannot be added')
		expect(claimInvitationCreation).not.toHaveBeenCalled()
	})

	it('hides manual creation when the deployment has no atomic shared claim', async () => {
		invitationCreationClaimsAvailable.mockResolvedValue(false)
		const mailbox = makeMailbox({ listEvents: vi.fn(async () => ({ data: [] })) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'syncing', canAdd: false })
	})

	it.each([
		['sender', { from: [{ email: 'attacker@example.com' }], to: [{ email: 'ada@ownmail.com' }] }],
		['recipient', { from: [{ email: 'grace@example.com' }], to: [{ email: 'other@example.com' }] }],
		['missing sender', { from: undefined, to: [{ email: 'ada@ownmail.com' }] }],
		['missing direct recipient', { from: [{ email: 'grace@example.com' }], to: undefined }],
		[
			'grant',
			{ from: [{ email: 'grace@example.com' }], to: [{ email: 'ada@ownmail.com' }], grant_id: 'other' },
		],
	] as const)(
		'rejects a manual import when the authenticated message %s does not match',
		async (_case, envelope) => {
			const mailbox = makeMailbox({
				listEvents: vi.fn(async () => ({ data: [] })),
				getMessage: vi.fn(async () => ({
					data: {
						id: 'message-1',
						grant_id: 'grant-1',
						...envelope,
						attachments: [
							{ id: 'attachment-1', filename: 'invite.ics', content_type: 'text/calendar', size: 200 },
						],
					},
				})),
			})
			requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

			await expect(
				addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).rejects.toThrow('cannot be added right now')
			expect(mailbox.createEvent).not.toHaveBeenCalled()
		},
	)

	it('requires a writable primary calendar for the manual fallback', async () => {
		const mailbox = makeMailbox({
			listEvents: vi.fn(async () => ({ data: [] })),
			listCalendars: vi.fn(async () => ({
				data: [{ id: 'primary', name: 'Personal', is_primary: true, read_only: true }],
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			getCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).resolves.toEqual({ state: 'syncing', canAdd: false })
		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('no writable primary calendar')
		expect(mailbox.createEvent).not.toHaveBeenCalled()
	})

	it('rejects non-string participant addresses at the message boundary', async () => {
		const mailbox = makeMailbox({
			listEvents: vi.fn(async () => ({ data: [] })),
			getMessage: vi.fn(async () => ({
				data: {
					id: 'message-1',
					grant_id: 'grant-1',
					from: [{ email: 42 }],
					to: [{ email: 'ada@ownmail.com' }],
					attachments: [
						{ id: 'attachment-1', filename: 'invite.ics', content_type: 'text/calendar', size: 200 },
					],
				} as unknown as Message,
			})),
		})
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('cannot be added right now')
	})

	it.each([
		['attendee', ICS.replace(/ATTENDEE[^\r]+\r\n/, ''), 'ada@ownmail.com'],
		['organizer address', ICS.replace('grace@example.com', 'not-an-email'), 'ada@ownmail.com'],
		['mailbox address', ICS, 'not-an-email'],
		['self organizer', ICS.replaceAll('grace@example.com', 'ada@ownmail.com'), 'ada@ownmail.com'],
	] as const)('rejects a manual import with an invalid %s match', async (_case, source, email) => {
		const mailbox = makeMailbox({
			downloadAttachment: vi.fn(async () => new Response(source)),
			listEvents: vi.fn(async () => ({ data: [] })),
		})
		requireMailbox.mockResolvedValue({ mailbox, email, grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('cannot be added right now')
	})

	it('rejects a manual add before creation when the attachment is not a usable request', async () => {
		const mailbox = makeMailbox({ downloadAttachment: vi.fn(async () => new Response('not an ICS')) })
		requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

		await expect(
			addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
		).rejects.toThrow('cannot be added right now')
	})

	it.each([{ id: 'bad' } as Event, invitationEvent({ calendar_id: 'other-calendar' })])(
		'maps an invalid manual-create provider response to a safe error',
		async (providerEvent) => {
			const mailbox = makeMailbox({
				listEvents: vi.fn(async () => ({ data: [] })),
				createEvent: vi.fn(async () => ({ data: providerEvent })),
			})
			requireMailbox.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-1' })

			await expect(
				addCalendarInvitation({ data: { messageId: 'message-1', attachmentId: 'attachment-1' } }),
			).rejects.toThrow('could not be updated')
			expect(signalLocalChange).not.toHaveBeenCalled()
		},
	)

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
