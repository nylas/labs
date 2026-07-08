import type {
	Calendar,
	Contact,
	Draft,
	Event,
	Folder,
	ItemResponse,
	ListQuery,
	ListResponse,
	Message,
	SendMessageRequest,
	Thread,
} from '@nylas-labs/cli-kit/v3'

const GRANT_ID = 'dev-grant'
const MAILBOX_EMAIL = 'demo@ownmail.local'
const now = Math.floor(Date.now() / 1000)

type StoredThread = Thread & { folders: string[]; message_ids: string[] }
type StoredMessage = Message & { thread_id: string }
type StoredDraft = Draft & { id: string }

const folderNames = new Map<string, { name: string; system: boolean }>([
	['inbox', { name: 'Inbox', system: true }],
	['sent', { name: 'Sent', system: true }],
	['drafts', { name: 'Drafts', system: true }],
	['archive', { name: 'Archive', system: true }],
	['junk', { name: 'Junk', system: true }],
	['trash', { name: 'Trash', system: true }],
	['work', { name: 'Work', system: false }],
	['finance', { name: 'Finance', system: false }],
	['travel', { name: 'Travel', system: false }],
])

export function devMailboxEmail(email?: string): string {
	return email?.trim() || MAILBOX_EMAIL
}

export function createDevMailbox() {
	return new DevMailbox()
}

class DevMailbox {
	async listFolders(): Promise<ListResponse<Folder>> {
		return listResponse(mockFolders())
	}

	async listThreads(query?: ListQuery): Promise<ListResponse<Thread>> {
		const folderId = typeof query?.in === 'string' ? query.in : 'inbox'
		const q = typeof query?.search_query_native === 'string' ? query.search_query_native : undefined
		return listResponse(mockThreads({ folderId, q }).threads)
	}

	async getThread(threadId: string): Promise<ItemResponse<Thread>> {
		return itemResponse(mockThreadMessages(threadId).thread)
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
		if (!thread) throw new Error('Not found - it may have been deleted.')
		return itemResponse(toThread(thread))
	}

	async send(body: SendMessageRequest): Promise<ItemResponse<Message>> {
		const sent = mockSendMessage({
			toList: (body.to ?? []).map((participant) => participant.email),
			subject: body.subject ?? '',
			body: body.body ?? '',
			...(body.reply_to_message_id ? { replyToMessageId: body.reply_to_message_id } : {}),
		})
		return itemResponse(sent)
	}

	async listDrafts(): Promise<ListResponse<Draft>> {
		return listResponse(mockDrafts())
	}

	async createDraft(body: SendMessageRequest): Promise<ItemResponse<Draft>> {
		const saved = mockSaveDraft({
			to: (body.to ?? []).map((participant) => participant.email).join(', '),
			subject: body.subject ?? '',
			body: body.body ?? '',
		})
		return itemResponse(mockDraft(saved.draftId))
	}

	async updateDraft(draftId: string, body: SendMessageRequest): Promise<ItemResponse<Draft>> {
		const saved = mockSaveDraft({
			draftId,
			to: (body.to ?? []).map((participant) => participant.email).join(', '),
			subject: body.subject ?? '',
			body: body.body ?? '',
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
			.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))[0]
		if (!sent) throw new Error('Failed to send draft')
		return itemResponse(sent)
	}

	async listContacts(query?: ListQuery): Promise<ListResponse<Contact>> {
		const q = typeof query?.email === 'string' ? query.email : ''
		return listResponse(
			mockContacts(q).map((contact, index) => ({
				id: `contact-${index}`,
				grant_id: GRANT_ID,
				given_name: contact.name?.split(' ')[0],
				surname: contact.name?.split(' ').slice(1).join(' '),
				emails: [{ email: contact.email }],
			})),
		)
	}

	async listCalendars(): Promise<ListResponse<Calendar>> {
		return listResponse(calendars)
	}

	async listEvents(query: ListQuery & { calendar_id: string }): Promise<ListResponse<Event>> {
		return listResponse(
			mockEvents({
				start: Number(query.start ?? 0),
				end: Number(query.end ?? Number.MAX_SAFE_INTEGER),
			}).events.filter((event) => event.calendar_id === query.calendar_id),
		)
	}

	async createEvent(body: Partial<Event>, calendarId: string): Promise<ItemResponse<Event>> {
		const when = body.when && 'start_time' in body.when ? body.when : null
		if (!when) throw new Error('Invalid event time')
		const created = mockCreateEvent({
			title: body.title ?? '',
			...(body.description ? { description: body.description } : {}),
			...(body.location ? { location: body.location } : {}),
			startTime: when.start_time,
			endTime: when.end_time,
			participants: body.participants?.map((participant) => participant.email),
			calendarId,
		})
		const event = events.get(created.eventId)
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
		if (!event) throw new Error('Not found - it may have been deleted.')
		return itemResponse(event)
	}

	async deleteEvent(eventId: string, _calendarId: string): Promise<void> {
		mockDeleteEvent(eventId)
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

const messages = new Map<string, StoredMessage>(
	[
		{
			id: 'msg-welcome-1',
			thread_id: 'thread-welcome',
			subject: 'Welcome to your local OwnMail workspace',
			snippet: 'Use this mock inbox to tune layout, empty states, and thread actions without deploying.',
			body: '<p>Use this local workspace to tune OwnMail UI without touching Cloudflare or a live mailbox.</p><p>Thread actions, replies, drafts, contacts, and calendar edits update in memory while the dev server is running.</p>',
			from: [{ name: 'OwnMail Team', email: 'team@ownmail.local' }],
			to: [{ email: MAILBOX_EMAIL }],
			date: now - 60 * 25,
			unread: true,
			starred: true,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-design-1',
			thread_id: 'thread-design',
			subject: 'Calendar density pass',
			snippet: 'Could you check the week view after the event modal changes?',
			body: '<p>Could you check the week view after the event modal changes?</p><p>The local mock calendar has a few overlapping events for visual QA.</p>',
			from: [{ name: 'Mina Park', email: 'mina@example.com' }],
			to: [{ email: MAILBOX_EMAIL }],
			date: now - 60 * 60 * 4,
			unread: false,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
			attachments: [
				{
					id: 'att-calendar-notes',
					filename: 'calendar-notes.txt',
					content_type: 'text/plain',
					size: 1840,
				},
			],
		},
		{
			id: 'msg-sent-1',
			thread_id: 'thread-sent',
			subject: 'Re: Billing copy',
			snippet: 'I tightened the text and left the failure-state wording generic.',
			body: '<p>I tightened the text and left the failure-state wording generic.</p>',
			from: [{ email: MAILBOX_EMAIL }],
			to: [{ name: 'Alex Rivera', email: 'alex@example.com' }],
			date: now - 60 * 60 * 27,
			unread: false,
			folders: ['sent', 'finance'],
			grant_id: GRANT_ID,
		},
	].map((message) => [message.id, message]),
)

const threads = new Map<string, StoredThread>(
	[
		{
			id: 'thread-welcome',
			subject: 'Welcome to your local OwnMail workspace',
			snippet: 'Use this mock inbox to tune layout, empty states, and thread actions without deploying.',
			participants: [{ name: 'OwnMail Team', email: 'team@ownmail.local' }],
			message_ids: ['msg-welcome-1'],
			latest_message_received_date: now - 60 * 25,
			has_attachments: false,
			unread: true,
			starred: true,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-design',
			subject: 'Calendar density pass',
			snippet: 'Could you check the week view after the event modal changes?',
			participants: [{ name: 'Mina Park', email: 'mina@example.com' }],
			message_ids: ['msg-design-1'],
			latest_message_received_date: now - 60 * 60 * 4,
			has_attachments: true,
			unread: false,
			starred: false,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-sent',
			subject: 'Re: Billing copy',
			snippet: 'I tightened the text and left the failure-state wording generic.',
			participants: [{ name: 'Alex Rivera', email: 'alex@example.com' }],
			message_ids: ['msg-sent-1'],
			latest_message_sent_date: now - 60 * 60 * 27,
			has_attachments: false,
			unread: false,
			starred: false,
			folders: ['sent', 'finance'],
			grant_id: GRANT_ID,
		},
	].map((thread) => [thread.id, thread]),
)

const drafts = new Map<string, StoredDraft>([
	[
		'draft-launch-copy',
		{
			id: 'draft-launch-copy',
			grant_id: GRANT_ID,
			subject: 'Launch checklist',
			snippet: 'Confirm callbacks, smoke test search, and verify calendar create/edit.',
			body: 'Confirm callbacks, smoke test search, and verify calendar create/edit.',
			to: [{ name: 'Sam Lee', email: 'sam@example.com' }],
			date: now - 60 * 15,
			folders: ['drafts'],
		},
	],
])

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

const calendars: Calendar[] = [
	{
		id: 'primary',
		grant_id: GRANT_ID,
		name: 'Personal',
		timezone: localTimezone,
		is_primary: true,
		hex_color: '#2563eb',
	},
	{
		id: 'work',
		grant_id: GRANT_ID,
		name: 'Work',
		timezone: localTimezone,
		is_primary: false,
		hex_color: '#14b8a6',
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
	addEvent('event-standup', 'Product standup', startOfDay, 9, 30, 30, { calendar_id: 'work' })
	addEvent('event-design', 'UI review', startOfDay, 11, 0, 60, {
		calendar_id: 'work',
		location: 'Zoom',
		participants: [{ name: 'Mina Park', email: 'mina@example.com', status: 'yes' }],
	})
	addEvent('event-focus', 'Inbox polish block', startOfDay, 14, 0, 120, { calendar_id: 'focus' })
	addEvent('event-tomorrow', 'Integration smoke test', addDays(startOfDay, 1), 10, 0, 45, {
		calendar_id: 'work',
	})
	events.set('event-all-day', {
		id: 'event-all-day',
		calendar_id: 'primary',
		grant_id: GRANT_ID,
		title: 'Local QA day',
		when: { object: 'date', date: ymd(startOfDay) },
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

export function mockMailboxInfo(appName: string, email?: string) {
	return { email: email || MAILBOX_EMAIL, appName }
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

export function mockThreads(input: { folderId: string; q?: string }): { threads: Thread[] } {
	const query = input.q?.trim().toLowerCase()
	const selected = visibleThreads(input.folderId).filter((thread) => {
		if (!query) return true
		const text = [
			thread.subject,
			thread.snippet,
			...(thread.participants ?? []).flatMap((participant) => [participant.name, participant.email]),
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
		return text.includes(query)
	})
	return { threads: selected.map(toThread) }
}

export function mockThreadMessages(threadId: string): { thread: Thread; messages: Message[] } {
	const thread = threads.get(threadId)
	if (!thread) throw new Error('Not found - it may have been deleted.')
	thread.unread = false
	for (const messageId of thread.message_ids) {
		const message = messages.get(messageId)
		if (message) message.unread = false
	}
	return {
		thread: toThread(thread),
		messages: thread.message_ids
			.map((messageId) => messages.get(messageId))
			.filter((message): message is StoredMessage => Boolean(message))
			.sort((a, b) => (a.date ?? 0) - (b.date ?? 0)),
	}
}

export function mockSendMessage(input: {
	toList: string[]
	subject: string
	body: string
	replyToMessageId?: string
}): Message {
	const sentAt = Math.floor(Date.now() / 1000)
	const id = `msg-${sentAt}-${messages.size + 1}`
	const replyTo = input.replyToMessageId ? messages.get(input.replyToMessageId) : null
	const threadId = replyTo?.thread_id ?? `thread-${sentAt}-${threads.size + 1}`
	const recipients = input.toList.map((email) => ({ email }))
	const message: StoredMessage = {
		id,
		thread_id: threadId,
		grant_id: GRANT_ID,
		subject: input.subject,
		snippet: stripHtml(input.body).slice(0, 140),
		body: input.body,
		from: [{ email: MAILBOX_EMAIL }],
		to: recipients,
		date: sentAt,
		unread: false,
		folders: ['sent'],
		...(input.replyToMessageId ? { reply_to: recipients } : {}),
	}
	messages.set(id, message)

	const existing = threads.get(threadId)
	if (existing) {
		existing.message_ids.push(id)
		existing.snippet = message.snippet
		existing.latest_message_sent_date = sentAt
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
			unread: false,
			starred: false,
			folders: ['sent'],
		})
	}
	return message
}

export function mockUpdateThreadState(input: {
	threadId: string
	unread?: boolean
	starred?: boolean
	folder?: string
}): { ok: true } {
	const thread = threads.get(input.threadId)
	if (!thread) throw new Error('Not found - it may have been deleted.')
	if (input.unread !== undefined) thread.unread = input.unread
	if (input.starred !== undefined) thread.starred = input.starred
	if (input.folder) thread.folders = [input.folder]
	return { ok: true }
}

export function mockSaveDraft(input: { draftId?: string; to: string; subject: string; body: string }): {
	draftId: string
} {
	const id = input.draftId || `draft-${Date.now()}`
	drafts.set(id, {
		id,
		grant_id: GRANT_ID,
		subject: input.subject,
		snippet: input.body.slice(0, 140),
		body: input.body,
		to: splitEmails(input.to).map((email) => ({ email })),
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
		toList: (draft.to ?? []).map((participant) => participant.email),
		subject: draft.subject ?? '',
		body: draft.body ?? '',
	})
	drafts.delete(draftId)
	return { ok: true }
}

export function mockDeleteDraft(draftId: string): { ok: true } {
	drafts.delete(draftId)
	return { ok: true }
}

export function mockDrafts(): Draft[] {
	return [...drafts.values()].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
}

export function mockContacts(query: string): { email: string; name?: string }[] {
	const normalized = query.trim().toLowerCase()
	if (normalized.length < 2) return []
	const contacts = [
		{ name: 'Mina Park', email: 'mina@example.com' },
		{ name: 'Alex Rivera', email: 'alex@example.com' },
		{ name: 'Sam Lee', email: 'sam@example.com' },
		{ name: 'OwnMail Team', email: 'team@ownmail.local' },
	]
	return contacts.filter((contact) => `${contact.name} ${contact.email}`.toLowerCase().includes(normalized))
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
	startTime: number
	endTime: number
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
		when: { object: 'timespan', start_time: input.startTime, end_time: input.endTime },
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

function visibleThreads(folderId: string): StoredThread[] {
	return [...threads.values()]
		.filter((thread) => thread.folders.includes(folderId))
		.sort(
			(a, b) =>
				(b.latest_message_received_date ?? b.latest_message_sent_date ?? 0) -
				(a.latest_message_received_date ?? a.latest_message_sent_date ?? 0),
		)
}

function toThread(thread: StoredThread): Thread {
	return { ...thread, folders: [...thread.folders], message_ids: [...thread.message_ids] }
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
	const start = Math.floor(new Date(`${when.start_date}T00:00:00`).getTime() / 1000)
	const end = Math.floor(new Date(`${when.end_date}T00:00:00`).getTime() / 1000)
	return { start, end }
}
