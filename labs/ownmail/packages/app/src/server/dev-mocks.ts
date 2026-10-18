import type {
	Calendar,
	Contact,
	Draft,
	Event,
	Folder,
	FreeBusy,
	FreeBusyRequest,
	FreeBusyTimeSlot,
	ItemResponse,
	ListQuery,
	ListResponse,
	Message,
	RawMimeMessage,
	SendMessageRequest,
	Thread,
} from '@nylas-labs/cli-kit/v3'
import { threadFoldersAfterMove } from '#features/mail/server/mail-folders'
import type { DevMocks } from './dev-mailbox.js'
import {
	ACCOUNT,
	DESIGN_REVIEW_UID,
	designReviewVersions,
	GRANT_ID,
	MAILBOX_EMAIL,
	MAILBOX_NAME,
	mockMessageHeaders,
	type StoredDraft,
	type StoredMessage,
	type StoredThread,
	seedDrafts,
	seedMessages,
	seedThreads,
	upcoming,
} from './dev-mock-mail.fixture.js'

let managedResourceSequence = 0

const folderNames = new Map<string, { name: string; system: boolean }>([
	['inbox', { name: 'Inbox', system: true }],
	['starred', { name: 'Starred', system: true }],
	['sent', { name: 'Sent', system: true }],
	['drafts', { name: 'Drafts', system: true }],
	['archive', { name: 'Archive', system: true }],
	['junk', { name: 'Junk', system: true }],
	['trash', { name: 'Trash', system: true }],
	['work', { name: 'Work', system: false }],
	['personal', { name: 'Personal', system: false }],
	['finance', { name: 'Finance', system: false }],
	['travel', { name: 'Travel', system: false }],
])

export function devMailboxEmail(email?: string): string {
	return email?.trim() || MAILBOX_EMAIL
}

export function devMailboxName(email?: string): string | undefined {
	const normalized = email?.trim().toLowerCase()
	return !normalized || normalized === MAILBOX_EMAIL ? MAILBOX_NAME : undefined
}

/** The Cc, Bcc and Reply-To of an outgoing message, as a mock draft stores them. */
function copiedPeople(body: SendMessageRequest): Pick<MockDraftInput, 'cc' | 'bcc' | 'replyTo'> {
	const emails = (people: NonNullable<SendMessageRequest['cc']>) =>
		people.map((person) => person.email).join(', ')
	return {
		...(body.cc?.length ? { cc: emails(body.cc) } : {}),
		...(body.bcc?.length ? { bcc: emails(body.bcc) } : {}),
		...(body.reply_to?.length ? { replyTo: emails(body.reply_to) } : {}),
	}
}

export function createDevMailbox() {
	return new DevMailbox()
}

class DevMailbox {
	async listFolders(): Promise<ListResponse<Folder>> {
		return listResponse(mockFolders())
	}

	async createFolder(body: { name: string }): Promise<ItemResponse<Folder>> {
		const id = `folder-${++managedResourceSequence}`
		folderNames.set(id, { name: body.name, system: false })
		return itemResponse(mockFolders().find((folder) => folder.id === id) as Folder)
	}

	async updateFolder(folderId: string, body: { name: string }): Promise<ItemResponse<Folder>> {
		const folder = folderNames.get(folderId)
		if (!folder || folder.system) throw new Error('Folder cannot be changed')
		folder.name = body.name
		return itemResponse(mockFolders().find((candidate) => candidate.id === folderId) as Folder)
	}

	async deleteFolder(folderId: string): Promise<void> {
		const folder = folderNames.get(folderId)
		if (!folder || folder.system) throw new Error('Folder cannot be changed')
		folderNames.delete(folderId)
		for (const thread of threads.values()) thread.folders = thread.folders.filter((id) => id !== folderId)
	}

	async listThreads(query?: ListQuery): Promise<ListResponse<Thread>> {
		const folderId = typeof query?.in === 'string' ? query.in : undefined
		const subject = typeof query?.subject === 'string' ? query.subject : undefined
		const anyEmail = typeof query?.any_email === 'string' ? query.any_email : undefined
		const searchQueryNative =
			typeof query?.search_query_native === 'string' ? query.search_query_native : undefined
		const starred = typeof query?.starred === 'boolean' ? query.starred : undefined
		return listResponse(mockThreads({ folderId, subject, anyEmail, searchQueryNative, starred }).threads)
	}

	async getThread(threadId: string): Promise<ItemResponse<Thread>> {
		return itemResponse(mockThreadMessages(threadId).thread)
	}

	/** The messages of one thread, newest first as the provider lists them, with their headers when `include_headers` is asked for. */
	async listMessages(query?: ListQuery): Promise<ListResponse<Message>> {
		const listed = [...messages.values()]
			.filter((message) => message.thread_id === query?.thread_id)
			.sort((a, b) => Number(b.date) - Number(a.date))
		if (query?.fields !== 'include_headers') return listResponse(listed)
		return listResponse(listed.map((message) => ({ ...message, headers: mockMessageHeaders(message) })))
	}

	/** A provider's raw message: its headers, then an HTML or plain-text body, as base64url. */
	async getRawMime(messageId: string): Promise<ItemResponse<RawMimeMessage>> {
		const message = messages.get(messageId)
		if (!message) throw new Error('Not found - it may have been deleted.')
		/* v8 ignore next -- every stored message carries a body string -- @preserve */
		const body = message.body ?? ''
		const contentType = /<[a-z][^>]*>/i.test(body) ? 'text/html' : 'text/plain'
		const raw = [
			...mockMessageHeaders(message).map((header) => `${header.name}: ${header.value}`),
			`Content-Type: ${contentType}; charset=utf-8`,
			'',
			body,
		].join('\r\n')
		return itemResponse({ id: message.id, grant_id: GRANT_ID, object: 'message', raw_mime: base64Url(raw) })
	}

	async getMessage(messageId: string): Promise<ItemResponse<Message>> {
		const message = messages.get(messageId)
		if (!message) throw new Error('Not found - it may have been deleted.')
		return itemResponse(message)
	}

	async updateThread(
		threadId: string,
		body: { unread?: boolean; starred?: boolean; folders?: string[] },
	): Promise<ItemResponse<Thread>> {
		mockUpdateThreadState({
			threadId,
			...(body.unread !== undefined ? { unread: body.unread } : {}),
			...(body.starred !== undefined ? { starred: body.starred } : {}),
			...(body.folders?.[0] ? { folder: body.folders[0] } : {}),
		})
		const thread = threads.get(threadId)
		/* v8 ignore next -- mockUpdateThreadState above already throws for a missing thread, so this re-fetch is never nullish -- @preserve */
		if (!thread) throw new Error('Not found - it may have been deleted.')
		return itemResponse(toThread(thread))
	}

	/** One message's state; the thread is unread while any of its messages is. */
	async updateMessage(
		messageId: string,
		body: { unread?: boolean; starred?: boolean; folders?: string[] },
	): Promise<ItemResponse<Message>> {
		return itemResponse(mockUpdateMessageState({ messageId, ...body }))
	}

	async send(body: SendMessageRequest): Promise<ItemResponse<Message>> {
		const sent = mockSendMessage({
			toList: (body.to ?? []).map((participant) => participant.email),
			...(body.cc ? { cc: body.cc } : {}),
			...(body.bcc ? { bcc: body.bcc } : {}),
			subject: body.subject ?? '',
			body: body.body ?? '',
			...(body.reply_to_message_id ? { replyToMessageId: body.reply_to_message_id } : {}),
			...(body.attachments ? { attachments: body.attachments } : {}),
		})
		return itemResponse(sent)
	}

	async cancelScheduledMessage(scheduleId: string): Promise<void> {
		mockCancelScheduledMessage(scheduleId)
	}

	async listDrafts(): Promise<ListResponse<Draft>> {
		return listResponse(mockDrafts())
	}

	async getDraft(draftId: string): Promise<ItemResponse<Draft>> {
		return itemResponse(mockDraft(draftId))
	}

	async downloadAttachment(attachmentId: string, draftId: string): Promise<Response> {
		const invitation = designReviewVersions.find(
			(version) => version.messageId === draftId && version.attachmentId === attachmentId,
		)
		if (invitation) {
			return new Response(mockCalendarInvitationIcs(invitation.hoursEarlier), {
				headers: { 'Content-Type': 'text/calendar' },
			})
		}
		// A scheduled message's files are read before it is saved as a draft.
		const message = messages.get(draftId)
		if (message) {
			const file = message.attachments?.find((candidate) => candidate.id === attachmentId)
			if (!file) throw new Error('Not found - it may have been deleted.')
			return new Response(`Mock file ${file.filename}`, {
				headers: { 'Content-Type': file.content_type ?? 'application/octet-stream' },
			})
		}
		const draft = mockDraft(draftId) as StoredDraft
		const attachment = draft.outbound_attachments?.find(
			(candidate, index) => `att-outbound-${index}-${candidate.filename}` === attachmentId,
		)
		if (!attachment) return new Response('Not found', { status: 404 })
		return new Response(base64ToBytes(attachment.content).buffer as ArrayBuffer, {
			headers: { 'Content-Type': attachment.content_type },
		})
	}

	async createDraft(body: SendMessageRequest): Promise<ItemResponse<Draft>> {
		const saved = mockSaveDraft({
			to: (body.to ?? []).map((participant) => participant.email).join(', '),
			...copiedPeople(body),
			subject: body.subject ?? '',
			body: body.body ?? '',
			...(body.reply_to_message_id ? { replyToMessageId: body.reply_to_message_id } : {}),
			...(body.attachments ? { attachments: body.attachments } : {}),
		})
		return itemResponse(mockDraft(saved.draftId))
	}

	async updateDraft(draftId: string, body: SendMessageRequest): Promise<ItemResponse<Draft>> {
		const previous = mockDraft(draftId) as StoredDraft
		const saved = mockSaveDraft({
			draftId,
			to: (body.to ?? []).map((participant) => participant.email).join(', '),
			...copiedPeople(body),
			subject: body.subject ?? '',
			body: body.body ?? '',
			...(body.reply_to_message_id
				? { replyToMessageId: body.reply_to_message_id }
				: previous.reply_to_message_id
					? { replyToMessageId: previous.reply_to_message_id }
					: {}),
			...(body.attachments
				? { attachments: body.attachments }
				: previous.outbound_attachments
					? { attachments: previous.outbound_attachments }
					: {}),
		})
		return itemResponse(mockDraft(saved.draftId))
	}

	async deleteDraft(draftId: string): Promise<void> {
		mockDeleteDraft(draftId)
	}

	async sendDraft(draftId: string): Promise<ItemResponse<Message>> {
		const draft = mockDraft(draftId)
		mockSendDraft(draftId)
		const sent = [...messages.values()]
			.filter((message) => message.subject === draft.subject && message.folders?.includes('sent'))
			.sort(
				/* v8 ignore next -- @preserve mockSendDraft creates exactly one new matching sent message before this lookup */
				(a, b) => (b.date ?? 0) - (a.date ?? 0),
			)[0]
		/* v8 ignore next -- mockSendDraft always appends a sent message with this subject, so the lookup always resolves -- @preserve */
		if (!sent) throw new Error('Failed to send draft')
		return itemResponse(sent)
	}

	async listContacts(query?: ListQuery): Promise<ListResponse<Contact>> {
		const q = typeof query?.email === 'string' ? query.email : ''
		const limit = typeof query?.limit === 'number' ? query.limit : undefined
		const matched = mockContactList(q)
		return listResponse(limit === undefined ? matched : matched.slice(0, limit))
	}

	async getContact(contactId: string): Promise<ItemResponse<Contact>> {
		return itemResponse(mockGetContact(contactId))
	}

	async createContact(body: Partial<Contact>): Promise<ItemResponse<Contact>> {
		return itemResponse(mockCreateContact(body))
	}

	async updateContact(contactId: string, body: Partial<Contact>): Promise<ItemResponse<Contact>> {
		return itemResponse(mockUpdateContact(contactId, body))
	}

	async deleteContact(contactId: string): Promise<void> {
		mockDeleteContact(contactId)
	}

	async listCalendars(): Promise<ListResponse<Calendar>> {
		return listResponse(calendars)
	}

	async createCalendar(body: { name: string }): Promise<ItemResponse<Calendar>> {
		const created: Calendar = {
			id: `calendar-${++managedResourceSequence}`,
			grant_id: GRANT_ID,
			name: body.name,
			timezone: localTimezone,
			is_primary: false,
			read_only: false,
		}
		calendars.push(created)
		return itemResponse(created)
	}

	async updateCalendar(calendarId: string, body: { name: string }): Promise<ItemResponse<Calendar>> {
		const calendar = calendars.find((candidate) => candidate.id === calendarId)
		if (!calendar || calendar.read_only) throw new Error('Calendar cannot be changed')
		calendar.name = body.name
		return itemResponse(calendar)
	}

	async deleteCalendar(calendarId: string): Promise<void> {
		const index = calendars.findIndex((candidate) => candidate.id === calendarId)
		if (index < 0 || calendars[index]?.read_only || calendars[index]?.is_primary) {
			throw new Error('Calendar cannot be changed')
		}
		calendars.splice(index, 1)
		for (const [eventId, event] of events) {
			if (event.calendar_id === calendarId) events.delete(eventId)
		}
	}

	async listEvents(query: ListQuery & { calendar_id: string }): Promise<ListResponse<Event>> {
		const icalUid = typeof query.ical_uid === 'string' ? query.ical_uid : undefined
		return listResponse(
			mockEvents({
				start: Number(query.start ?? 0),
				end: Number(query.end ?? Number.MAX_SAFE_INTEGER),
			}).events.filter(
				(event) =>
					event.calendar_id === query.calendar_id &&
					(!icalUid || (event as Event & { ical_uid?: string }).ical_uid === icalUid),
			),
		)
	}

	async createEvent(body: Partial<Event>, calendarId: string): Promise<ItemResponse<Event>> {
		const when = body.when
		if (!when || (!('start_time' in when) && !('date' in when))) throw new Error('Invalid event time')
		const created = mockCreateEvent({
			title: body.title ?? '',
			...(body.description ? { description: body.description } : {}),
			...(body.location ? { location: body.location } : {}),
			...('date' in when
				? { allDayDate: when.date }
				: { startTime: when.start_time, endTime: when.end_time }),
			...(body.recurrence ? { recurrence: body.recurrence } : {}),
			participants: body.participants?.map((participant) => participant.email),
			calendarId,
		})
		const event = events.get(created.eventId)
		/* v8 ignore next -- mockCreateEvent writes the event to the store before returning its id, so this is never nullish -- @preserve */
		if (!event) throw new Error('Failed to create event')
		event.calendar_id = calendarId
		return itemResponse(event)
	}

	async updateEvent(
		eventId: string,
		body: Partial<Event>,
		_calendarId: string,
	): Promise<ItemResponse<Event>> {
		const when = body.when && 'start_time' in body.when ? body.when : null
		mockUpdateEvent({
			eventId,
			...(body.title !== undefined ? { title: body.title } : {}),
			...(body.description !== undefined ? { description: body.description } : {}),
			...(body.location !== undefined ? { location: body.location } : {}),
			...(when ? { startTime: when.start_time, endTime: when.end_time } : {}),
		})
		const event = events.get(eventId)
		/* v8 ignore next -- mockUpdateEvent above already throws for a missing event, so this re-fetch is never nullish -- @preserve */
		if (!event) throw new Error('Not found - it may have been deleted.')
		return itemResponse(event)
	}

	async deleteEvent(eventId: string, _calendarId: string): Promise<void> {
		mockDeleteEvent(eventId)
	}

	/**
	 * Made-up availability for local development: every weekday in the range each
	 * person is busy mid-morning and mid-afternoon, offset a little per person.
	 */
	async getFreeBusy(body: FreeBusyRequest): Promise<ListResponse<FreeBusy>> {
		const HOUR = 3600
		return listResponse(
			body.emails.map((email, index): FreeBusy => {
				const time_slots: FreeBusyTimeSlot[] = []
				for (let day = Math.floor(body.start_time / 86_400) * 86_400; day < body.end_time; day += 86_400) {
					const weekday = new Date(day * 1000).getUTCDay()
					if (weekday === 0 || weekday === 6) continue
					for (const [startHour, hours] of [
						[14 + index, 1],
						[18 + index, 1.5],
					] as const) {
						const start_time = day + startHour * HOUR
						const end_time = start_time + hours * HOUR
						if (start_time >= body.start_time && end_time <= body.end_time)
							time_slots.push({ start_time, end_time, status: 'busy', object: 'time_slot' })
					}
				}
				return { email, object: 'free_busy', time_slots }
			}),
		)
	}

	async sendRsvp(
		eventId: string,
		_calendarId: string,
		status: 'yes' | 'no' | 'maybe',
	): Promise<ItemResponse<unknown>> {
		mockRsvpEvent({ eventId, status })
		return itemResponse({ ok: true })
	}
}

function listResponse<T>(data: T[]): ListResponse<T> {
	return { request_id: 'dev', data }
}

function itemResponse<T>(data: T): ItemResponse<T> {
	return { request_id: 'dev', data }
}

// Copies, so the seed data stays pristine while the session mutates the stores.
const messages = new Map<string, StoredMessage>(seedMessages.map((message) => [message.id, { ...message }]))

const threads = new Map<string, StoredThread>(
	seedThreads.map((thread) => [
		thread.id,
		{ ...thread, folders: [...thread.folders], message_ids: [...thread.message_ids] },
	]),
)

const drafts = new Map<string, StoredDraft>(seedDrafts.map((draft) => [draft.id, { ...draft }]))

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const calendars: Calendar[] = [
	{
		id: 'primary',
		grant_id: GRANT_ID,
		name: 'Personal',
		timezone: localTimezone,
		is_primary: true,
		hex_color: '#14b8a6',
	},
	{
		id: 'work',
		grant_id: GRANT_ID,
		name: 'Work',
		timezone: localTimezone,
		is_primary: false,
		hex_color: '#2563eb',
	},
	{
		id: 'focus',
		grant_id: GRANT_ID,
		name: 'Focus',
		timezone: localTimezone,
		is_primary: false,
		hex_color: '#f59e0b',
	},
	{
		id: 'social',
		grant_id: GRANT_ID,
		name: 'Social',
		timezone: localTimezone,
		is_primary: false,
		hex_color: '#f43f5e',
	},
]

const calendar = calendars[0] as Calendar

const events = new Map<string, Event>()

function seedEvents() {
	if (events.size > 0) return
	const today = new Date()
	const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
	addEvent('event-focus-block', 'Morning focus block', startOfDay, 8, 0, 90, {
		calendar_id: 'focus',
		description: 'Deep work on the roadmap sequencing. No meetings.',
	})
	addEvent('event-roadmap-review', 'Roadmap review with Grace', startOfDay, 10, 0, 60, {
		calendar_id: 'work',
		location: 'Meet — Aurora room',
		description: 'Final pass on the Q3 deck before Monday lock.',
		participants: [
			{ name: 'Grace Hopper', email: 'grace.hopper@vercel.com', status: 'yes' },
			{ name: 'Katherine Johnson', email: 'katherine.johnson@vercel.com', status: 'yes' },
		],
	})
	addEvent('event-coffee-katherine', 'Coffee with Katherine', addDays(startOfDay, -1), 10, 0, 30, {
		calendar_id: 'social',
	})
	addEvent('event-lunch', 'Lunch with Alan', startOfDay, 12, 30, 60, {
		calendar_id: 'social',
		location: 'Tartine, Mission',
	})
	addEvent('event-design-system', 'Design system sync', startOfDay, 15, 0, 60, {
		calendar_id: 'work',
		participants: [{ name: 'Katherine Johnson', email: 'katherine.johnson@vercel.com', status: 'yes' }],
	})
	const designReviewDay = new Date(upcoming(4, 0, 0) * 1000)
	addEvent('event-calendar-invite', 'Design review: token migration', designReviewDay, 14, 0, 45, {
		calendar_id: 'primary',
		location: 'Meet — Apollo room',
		organizer: { name: 'Katherine Johnson', email: 'katherine.johnson@vercel.com' },
		participants: [
			{ name: MAILBOX_NAME, email: MAILBOX_EMAIL, status: 'noreply' },
			{ name: 'Grace Hopper', email: 'grace.hopper@vercel.com', status: 'yes' },
		],
	})
	const invitation = events.get('event-calendar-invite') as Event & { ical_uid?: string }
	invitation.ical_uid = DESIGN_REVIEW_UID
	addEvent('event-manager', '1:1 with manager', addDays(startOfDay, 1), 9, 0, 30, {
		calendar_id: 'work',
	})
	addEvent('event-standup', 'Team standup', addDays(startOfDay, 1), 11, 0, 15, {
		calendar_id: 'work',
	})
	addEvent('event-gym', 'Gym', addDays(startOfDay, 1), 18, 0, 60, {
		calendar_id: 'primary',
	})
	addEvent('event-writing', 'Writing sprint', addDays(startOfDay, 2), 9, 0, 120, {
		calendar_id: 'focus',
	})
	addEvent('event-dentist', 'Dentist — Dr. Reyes', addDays(startOfDay, 2), 14, 0, 60, {
		calendar_id: 'primary',
		location: 'Bright Smile Dental',
	})
	addEvent('event-flight', 'Flight to Lisbon', addDays(startOfDay, 3), 8, 30, 150, {
		calendar_id: 'primary',
		location: 'SFO Terminal 2',
		description: 'Confirmation #VYG-40192',
	})
	addEvent('event-planning', 'Quarterly planning', addDays(startOfDay, 4), 13, 0, 120, {
		calendar_id: 'work',
		participants: [
			{ name: 'Grace Hopper', email: 'grace.hopper@vercel.com', status: 'yes' },
			{ name: 'Team', email: 'team@vercel.com', status: 'yes' },
		],
	})
	addEvent('event-prs', 'Review PRs', addDays(startOfDay, 4), 16, 0, 60, {
		calendar_id: 'focus',
	})
	addEvent('event-hike', 'Dipsea trail hike', addDays(startOfDay, 5), 8, 0, 180, {
		calendar_id: 'social',
		location: 'Mill Valley',
	})
	addEvent('event-dinner', 'Dinner party', addDays(startOfDay, 6), 19, 0, 180, {
		calendar_id: 'social',
		location: 'Home',
	})
	events.set('event-all-day', {
		id: 'event-all-day',
		calendar_id: 'primary',
		grant_id: GRANT_ID,
		title: 'Pay rent',
		when: { object: 'date', date: ymd(addDays(startOfDay, 2)) },
		busy: false,
	})
}

function addEvent(
	id: string,
	title: string,
	day: Date,
	hour: number,
	minute: number,
	durationMinutes: number,
	extra: Partial<Event> = {},
) {
	const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
	const end = new Date(start.getTime() + durationMinutes * 60_000)
	events.set(id, {
		id,
		/* v8 ignore next -- every seeded addEvent call supplies a calendar_id and addEvent is not exported, so the fallback is unreachable -- @preserve */
		calendar_id: extra.calendar_id ?? calendar.id,
		grant_id: GRANT_ID,
		title,
		when: {
			object: 'timespan',
			start_time: Math.floor(start.getTime() / 1000),
			end_time: Math.floor(end.getTime() / 1000),
		},
		busy: true,
		...extra,
	})
}

/** One version of the design review invitation; earlier versions sat `hoursEarlier` before the current time. */
function mockCalendarInvitationIcs(hoursEarlier: number): string {
	seedEvents()
	const event = events.get('event-calendar-invite')
	/* v8 ignore next -- the fixture is seeded immediately above with this exact timed event */
	if (!event || !('start_time' in event.when)) throw new Error('Invitation fixture unavailable')
	const shift = hoursEarlier * 3600
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'METHOD:REQUEST',
		'BEGIN:VEVENT',
		`UID:${DESIGN_REVIEW_UID}`,
		`SEQUENCE:${designReviewVersions.length - 1 - hoursEarlier}`,
		`DTSTART:${compactUtcDateTime(event.when.start_time - shift)}`,
		`DTEND:${compactUtcDateTime(event.when.end_time - shift)}`,
		'ORGANIZER;CN="Katherine Johnson":mailto:katherine.johnson@vercel.com',
		`ATTENDEE;CN="${MAILBOX_NAME}";PARTSTAT=NEEDS-ACTION:mailto:${MAILBOX_EMAIL}`,
		'SUMMARY:Design review: token migration',
		'LOCATION:Meet — Apollo room',
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\r\n')
}

function compactUtcDateTime(epochSeconds: number): string {
	return new Date(epochSeconds * 1_000)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z')
}

export function mockMailboxInfo(appName: string, email?: string) {
	return { email: devMailboxEmail(email), displayName: devMailboxName(email), appName }
}

export function mockFolders(): Folder[] {
	return [...folderNames].map(([id, folder]) => ({
		id,
		name: folder.name,
		grant_id: GRANT_ID,
		system_folder: folder.system,
		total_count: id === 'drafts' ? drafts.size : visibleThreads(id).length,
		unread_count: id === 'drafts' ? 0 : visibleThreads(id).filter((thread) => thread.unread).length,
	}))
}

export function mockThreads(input: {
	folderId?: string
	q?: string
	subject?: string
	anyEmail?: string
	searchQueryNative?: string
	starred?: boolean
}): {
	threads: Thread[]
} {
	const subject = (input.subject ?? input.q)?.trim().toLowerCase()
	const anyEmail = input.anyEmail?.trim().toLowerCase()
	const searchQuery = input.searchQueryNative?.trim().toLowerCase()
	const base = input.folderId ? visibleThreads(input.folderId) : visibleThreads()
	const selected = base.filter((thread) => {
		if (input.starred !== undefined && thread.starred !== input.starred) return false
		/* v8 ignore next -- threads always carry a string subject, so the `?.` never short-circuits (line-level ignore: the subject filter itself stays exercised by search tests) -- @preserve */
		if (subject && !thread.subject?.toLowerCase().includes(subject)) return false
		if (searchQuery && !searchableThreadText(thread).includes(searchQuery)) return false
		if (!anyEmail) return true
		const emails = [
			/* v8 ignore start -- seeded and created threads always carry a participants array -- @preserve */
			...(thread.participants ?? []).flatMap((participant) => [participant.name, participant.email]),
			/* v8 ignore stop -- @preserve */
			...thread.message_ids.flatMap((messageId) => {
				const message = messages.get(messageId)
				/* v8 ignore next -- a thread's message_ids always resolve to a stored message -- @preserve */
				if (!message) return []
				return [
					/* v8 ignore start -- stored messages always carry recipient arrays -- @preserve */
					...(message.from ?? []).flatMap((participant) => [participant.name, participant.email]),
					...(message.to ?? []).flatMap((participant) => [participant.name, participant.email]),
					...(message.cc ?? []).flatMap((participant) => [participant.name, participant.email]),
					...(message.bcc ?? []).flatMap((participant) => [participant.name, participant.email]),
					/* v8 ignore stop -- @preserve */
				]
			}),
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
		return emails.includes(anyEmail)
	})
	return { threads: selected.map(toThread) }
}

function searchableThreadText(thread: StoredThread): string {
	return [
		thread.subject,
		thread.snippet,
		/* v8 ignore start -- seeded and created threads always carry a participants array -- @preserve */
		...(thread.participants ?? []).flatMap((participant) => [participant.name, participant.email]),
		/* v8 ignore stop -- @preserve */
		...thread.message_ids.flatMap((messageId) => {
			const message = messages.get(messageId)
			/* v8 ignore next -- a thread's message_ids always resolve to a stored message -- @preserve */
			if (!message) return []
			return [
				message.subject,
				message.snippet,
				message.body ? stripHtml(message.body) : undefined,
				/* v8 ignore start -- stored messages always carry recipient arrays -- @preserve */
				...(message.from ?? []).flatMap((participant) => [participant.name, participant.email]),
				...(message.to ?? []).flatMap((participant) => [participant.name, participant.email]),
				...(message.cc ?? []).flatMap((participant) => [participant.name, participant.email]),
				...(message.bcc ?? []).flatMap((participant) => [participant.name, participant.email]),
				/* v8 ignore stop -- @preserve */
			]
		}),
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase()
}

export function mockThreadMessages(threadId: string): { thread: Thread; messages: Message[] } {
	const thread = threads.get(threadId)
	if (!thread) throw new Error('Not found - it may have been deleted.')
	return {
		thread: toThread(thread),
		messages: thread.message_ids
			.map((messageId) => messages.get(messageId))
			.filter((message): message is StoredMessage => Boolean(message))
			/* v8 ignore start -- every stored message carries a date -- @preserve */
			.sort((a, b) => (a.date ?? 0) - (b.date ?? 0)),
		/* v8 ignore stop -- @preserve */
	}
}

export function mockSendMessage(input: {
	toList: string[]
	cc?: Message['cc']
	bcc?: Message['bcc']
	subject: string
	body: string
	replyToMessageId?: string
	attachments?: SendMessageRequest['attachments']
}): Message {
	const sentAt = Math.floor(Date.now() / 1000)
	// A counter, not the store's size: a cancelled message or thread shrinks the
	// store, and a size-based id could then name one that still exists.
	const sequence = ++managedResourceSequence
	const id = `msg-${sentAt}-${sequence}`
	const replyTo = input.replyToMessageId ? messages.get(input.replyToMessageId) : null
	const threadId = replyTo?.thread_id ?? `thread-${sentAt}-${sequence}`
	const recipients = input.toList.map((email) => ({ email }))
	const message: StoredMessage = {
		id,
		thread_id: threadId,
		grant_id: GRANT_ID,
		subject: input.subject,
		snippet: stripHtml(input.body).slice(0, 140),
		body: input.body,
		from: [ACCOUNT],
		to: recipients,
		...(input.cc?.length ? { cc: input.cc } : {}),
		...(input.bcc?.length ? { bcc: input.bcc } : {}),
		date: sentAt,
		unread: false,
		folders: ['sent'],
		...(input.attachments?.length ? { attachments: mockAttachmentMetadata(input.attachments) } : {}),
		...(input.replyToMessageId ? { reply_to: recipients } : {}),
	}
	messages.set(id, message)

	const existing = threads.get(threadId)
	if (existing) {
		existing.message_ids.push(id)
		existing.snippet = message.snippet
		existing.latest_message_sent_date = sentAt
		existing.has_attachments = existing.has_attachments || Boolean(input.attachments?.length)
		existing.folders = unique([...existing.folders, 'sent'])
	} else {
		threads.set(threadId, {
			id: threadId,
			grant_id: GRANT_ID,
			subject: input.subject,
			snippet: message.snippet,
			participants: recipients,
			message_ids: [id],
			latest_message_sent_date: sentAt,
			has_attachments: Boolean(input.attachments?.length),
			unread: false,
			starred: false,
			folders: ['sent'],
		})
	}
	return message
}

/**
 * Cancels a scheduled send the way the provider does for a message it holds
 * until its time: the message leaves the thread, and a thread left empty goes.
 */
export function mockCancelScheduledMessage(scheduleId: string): { ok: true } {
	const message = [...messages.values()].find((candidate) => candidate.schedule_id === scheduleId)
	if (!message) throw new Error('Not found - it may have been deleted.')
	messages.delete(message.id)
	const thread = threads.get(message.thread_id) as StoredThread
	thread.message_ids = thread.message_ids.filter((id) => id !== message.id)
	if (thread.message_ids.length === 0) threads.delete(thread.id)
	else thread.snippet = (messages.get(thread.message_ids.at(-1) as string) as StoredMessage).snippet
	return { ok: true }
}

export function mockUpdateThreadState(input: {
	threadId: string
	unread?: boolean
	starred?: boolean
	folder?: string
}): { ok: true } {
	const thread = threads.get(input.threadId)
	if (!thread) throw new Error('Not found - it may have been deleted.')
	if (input.unread !== undefined) {
		thread.unread = input.unread
		for (const messageId of thread.message_ids) {
			const message = messages.get(messageId)
			/* v8 ignore else -- every stored thread message id resolves to a message -- @preserve */
			if (message) message.unread = input.unread
		}
	}
	if (input.starred !== undefined) thread.starred = input.starred
	if (input.folder) thread.folders = threadFoldersAfterMove(thread.folders, input.folder)
	return { ok: true }
}

type MockDraftInput = {
	draftId?: string
	to: string
	cc?: string
	bcc?: string
	replyTo?: string
	subject: string
	body: string
	replyToMessageId?: string
	attachments?: SendMessageRequest['attachments']
}

/** One message read or unread (or starred, or moved); its thread is unread while any message is. */
export function mockUpdateMessageState(input: {
	messageId: string
	unread?: boolean
	starred?: boolean
	folders?: string[]
}): Message {
	const message = messages.get(input.messageId)
	if (!message) throw new Error('Not found - it may have been deleted.')
	if (input.unread !== undefined) message.unread = input.unread
	if (input.starred !== undefined) message.starred = input.starred
	if (input.folders) message.folders = input.folders
	const thread = threads.get(message.thread_id) as StoredThread
	thread.unread = thread.message_ids.some((id) => (messages.get(id) as StoredMessage).unread === true)
	return message
}

export function mockSaveDraft(input: MockDraftInput): {
	draftId: string
} {
	const id = input.draftId || `draft-${Date.now()}-${++managedResourceSequence}`
	// A reply draft belongs to the thread of the message it answers, and keeps it
	// across edits, so the thread lists it in draft_ids and latest_draft_or_message.
	const previous = input.draftId ? drafts.get(input.draftId) : undefined
	const threadId =
		previous?.thread_id ??
		(input.replyToMessageId ? messages.get(input.replyToMessageId)?.thread_id : undefined)
	drafts.set(id, {
		id,
		grant_id: GRANT_ID,
		subject: input.subject,
		// Real providers derive the snippet from the body's text content; mirror
		// that so markdown-envelope drafts list their source, not the markup.
		snippet: stripHtml(input.body)
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&')
			.slice(0, 140),
		body: input.body,
		to: splitEmails(input.to).map((email) => ({ email })),
		...(input.cc ? { cc: splitEmails(input.cc).map((email) => ({ email })) } : {}),
		...(input.bcc ? { bcc: splitEmails(input.bcc).map((email) => ({ email })) } : {}),
		...(input.replyTo ? { reply_to: splitEmails(input.replyTo).map((email) => ({ email })) } : {}),
		...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
		...(threadId ? { thread_id: threadId } : {}),
		...(input.attachments?.length
			? { attachments: mockAttachmentMetadata(input.attachments), outbound_attachments: input.attachments }
			: {}),
		date: Math.floor(Date.now() / 1000),
		folders: ['drafts'],
	})
	return { draftId: id }
}

export function mockDraft(draftId: string): Draft {
	const draft = drafts.get(draftId)
	if (!draft) throw new Error('Not found - it may have been deleted.')
	return draft
}

export function mockSendDraft(draftId: string): { ok: true } {
	const draft = drafts.get(draftId)
	if (!draft) throw new Error('Not found - it may have been deleted.')
	mockSendMessage({
		/* v8 ignore start -- mockSaveDraft always stores recipients, subject, and body -- @preserve */
		toList: (draft.to ?? []).map((participant) => participant.email),
		subject: draft.subject ?? '',
		body: draft.body ?? '',
		/* v8 ignore stop -- @preserve */
		...(draft.cc ? { cc: draft.cc } : {}),
		...(draft.bcc ? { bcc: draft.bcc } : {}),
		...(draft.reply_to_message_id ? { replyToMessageId: draft.reply_to_message_id } : {}),
		attachments: draft.outbound_attachments,
	})
	drafts.delete(draftId)
	return { ok: true }
}

export function mockDeleteDraft(draftId: string): { ok: true } {
	drafts.delete(draftId)
	return { ok: true }
}

export function mockDrafts(): Draft[] {
	/* v8 ignore next -- every stored draft carries a date, so the `?? 0` fallbacks never run -- @preserve */
	return [...drafts.values()].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
}

function mockAttachmentMetadata(attachments: SendMessageRequest['attachments']): Message['attachments'] {
	return attachments?.map((attachment, index) => ({
		id: `att-outbound-${index}-${attachment.filename}`,
		filename: attachment.filename,
		content_type: attachment.content_type,
		size: base64DecodedBytes(attachment.content),
		is_inline: attachment.is_inline,
		content_id: attachment.content_id,
	}))
}

function base64DecodedBytes(value: string): number {
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
	return Math.floor((value.length * 3) / 4) - padding
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value)
	return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const contacts = new Map<string, Contact>(
	(
		[
			{
				id: 'contact-mina',
				given_name: 'Mina',
				surname: 'Park',
				company_name: 'Northwind Traders',
				job_title: 'Product Designer',
				emails: [{ email: 'mina@example.com', type: 'work' }],
				phone_numbers: [{ number: '+1 (555) 0142', type: 'mobile' }],
			},
			{
				id: 'contact-alex',
				given_name: 'Alex',
				surname: 'Rivera',
				company_name: 'Contoso',
				job_title: 'Engineering Manager',
				emails: [
					{ email: 'alex@example.com', type: 'work' },
					{ email: 'alex.rivera@personal.example', type: 'home' },
				],
			},
			{
				id: 'contact-sam',
				given_name: 'Sam',
				surname: 'Lee',
				emails: [{ email: 'sam@example.com' }],
				notes: 'Met at the 2024 accessibility summit.',
			},
			{
				id: 'contact-team',
				given_name: 'OwnMail',
				surname: 'Team',
				emails: [{ email: 'team@ownmail.local', type: 'work' }],
			},
		] satisfies Contact[]
	).map((contact) => [contact.id, { ...contact, grant_id: GRANT_ID }]),
)

/** Name + email + company haystack for the dev search/autocomplete filter. */
function contactHaystack(contact: Contact): string {
	return [
		contact.given_name,
		contact.surname,
		contact.company_name,
		...(contact.emails ?? []).map((entry) => entry.email),
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase()
}

export function mockContactList(query: string): Contact[] {
	const normalized = query.trim().toLowerCase()
	const all = [...contacts.values()]
	if (!normalized) return all
	return all.filter((contact) => contactHaystack(contact).includes(normalized))
}

export function mockGetContact(contactId: string): Contact {
	const contact = contacts.get(contactId)
	if (!contact) throw new Error('Not found - it may have been deleted.')
	return contact
}

export function mockCreateContact(body: Partial<Contact>): Contact {
	const id = `contact-${Date.now()}`
	const contact: Contact = { ...body, id, grant_id: GRANT_ID }
	contacts.set(id, contact)
	return contact
}

export function mockUpdateContact(contactId: string, body: Partial<Contact>): Contact {
	if (!contacts.has(contactId)) throw new Error('Not found - it may have been deleted.')
	const updated: Contact = { ...body, id: contactId, grant_id: GRANT_ID }
	contacts.set(contactId, updated)
	return updated
}

export function mockDeleteContact(contactId: string): { ok: true } {
	contacts.delete(contactId)
	return { ok: true }
}

export function mockEvents(input: { start: number; end: number }): { calendar: Calendar; events: Event[] } {
	seedEvents()
	return {
		calendar,
		events: [...events.values()].filter((event) => {
			const range = eventRange(event)
			return range.end > input.start && range.start < input.end
		}),
	}
}

export function mockCreateEvent(input: {
	title: string
	description?: string
	location?: string
	startTime?: number
	endTime?: number
	allDayDate?: string
	recurrence?: string[]
	participants?: string[]
	calendarId?: string
}): { eventId: string } {
	seedEvents()
	const id = `event-${Date.now()}`
	events.set(id, {
		id,
		calendar_id: input.calendarId ?? calendar.id,
		grant_id: GRANT_ID,
		title: input.title,
		...(input.description ? { description: input.description } : {}),
		...(input.location ? { location: input.location } : {}),
		when:
			input.allDayDate !== undefined
				? { object: 'date', date: input.allDayDate }
				: { object: 'timespan', start_time: input.startTime as number, end_time: input.endTime as number },
		...(input.recurrence?.length ? { recurrence: input.recurrence } : {}),
		...(input.participants?.length
			? { participants: input.participants.map((email) => ({ email, status: 'noreply' as const })) }
			: {}),
	})
	return { eventId: id }
}

export function mockUpdateEvent(input: {
	eventId: string
	title?: string
	description?: string
	location?: string
	startTime?: number
	endTime?: number
}): { ok: true } {
	seedEvents()
	const event = events.get(input.eventId)
	if (!event) throw new Error('Not found - it may have been deleted.')
	if (input.title !== undefined) event.title = input.title
	if (input.description !== undefined) event.description = input.description
	if (input.location !== undefined) event.location = input.location
	if (input.startTime !== undefined && input.endTime !== undefined) {
		event.when = { object: 'timespan', start_time: input.startTime, end_time: input.endTime }
	}
	return { ok: true }
}

export function mockDeleteEvent(eventId: string): { ok: true } {
	events.delete(eventId)
	return { ok: true }
}

export function mockRsvpEvent(input: { eventId: string; status: 'yes' | 'no' | 'maybe' }): { ok: true } {
	const event = events.get(input.eventId)
	if (!event) throw new Error('Not found - it may have been deleted.')
	event.participants = (event.participants ?? []).map((participant, index) =>
		index === 0 ? { ...participant, status: input.status } : participant,
	)
	return { ok: true }
}

function visibleThreads(folderId?: string): StoredThread[] {
	return (
		[...threads.values()]
			.filter((thread) => {
				if (!folderId) return true
				return folderId === 'starred' ? thread.starred : thread.folders.includes(folderId)
			})
			/* v8 ignore start -- seed threads and mockSendMessage always set at least one date -- @preserve */
			.sort((a, b) => threadActivity(b) - threadActivity(a))
	)
	/* v8 ignore stop -- @preserve */
}

/** A thread's place in the list: its newest received or sent message, like a provider. */
function threadActivity(thread: StoredThread): number {
	return Math.max(thread.latest_message_received_date ?? 0, thread.latest_message_sent_date ?? 0)
}

/** A provider thread with its newest message or reply draft, and the ids of its drafts. */
function toThread(thread: StoredThread): Thread {
	const threadDrafts = [...drafts.values()].filter((draft) => draft.thread_id === thread.id)
	// Drafts go first so that a reply draft saved at the same moment as the message it
	// answers counts as the newer of the two. Every thread holds at least one message,
	// and every message and draft is dated.
	const candidates: Message[] = [
		...threadDrafts,
		...thread.message_ids.flatMap((messageId) => {
			const message = messages.get(messageId)
			return message ? [message] : []
		}),
	]
	const latest = candidates.reduce((newest, candidate) =>
		(candidate.date as number) > (newest.date as number) ? candidate : newest,
	)
	return {
		...thread,
		folders: [...thread.folders],
		message_ids: [...thread.message_ids],
		latest_draft_or_message: { ...latest },
		...(threadDrafts.length > 0 ? { draft_ids: threadDrafts.map((draft) => draft.id) } : {}),
	}
}

function base64Url(text: string): string {
	let binary = ''
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function splitEmails(value: string): string[] {
	return value
		.split(',')
		.map((email) => email.trim())
		.filter(Boolean)
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)]
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date)
	next.setDate(next.getDate() + days)
	return next
}

function ymd(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function eventRange(event: Event): { start: number; end: number } {
	const when = event.when
	if ('start_time' in when) return { start: when.start_time, end: when.end_time }
	if ('date' in when) {
		const start = Math.floor(new Date(`${when.date}T00:00:00`).getTime() / 1000)
		return { start, end: start + 24 * 60 * 60 }
	}
	if ('start_date' in when) {
		const start = Math.floor(new Date(`${when.start_date}T00:00:00`).getTime() / 1000)
		const end = Math.floor(new Date(`${when.end_date}T00:00:00`).getTime() / 1000)
		return { start, end }
	}
	return { start: when.time, end: when.time }
}
/* v8 ignore stop -- @preserve */

/**
 * The mock mailbox under the name `dev-mailbox.ts` exports: the local builds
 * (`vite.config.local.ts`) resolve that module to this one.
 */
export const devMocks: DevMocks = { createDevMailbox, devMailboxEmail, devMailboxName }
