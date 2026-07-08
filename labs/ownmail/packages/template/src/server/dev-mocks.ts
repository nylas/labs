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
const MAILBOX_NAME = 'Ada Lovelace'
const MAILBOX_EMAIL = 'ada@ownmail.com'
const ACCOUNT = { name: MAILBOX_NAME, email: MAILBOX_EMAIL }

type StoredThread = Thread & { folders: string[]; message_ids: string[] }
type StoredMessage = Message & { thread_id: string }
type StoredDraft = Draft & { id: string }

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

export function createDevMailbox() {
	return new DevMailbox()
}

class DevMailbox {
	async listFolders(): Promise<ListResponse<Folder>> {
		return listResponse(mockFolders())
	}

	async listThreads(query?: ListQuery): Promise<ListResponse<Thread>> {
		const folderId = typeof query?.in === 'string' ? query.in : undefined
		const q = typeof query?.search_query_native === 'string' ? query.search_query_native : undefined
		const starred = typeof query?.starred === 'boolean' ? query.starred : undefined
		return listResponse(mockThreads({ folderId, q, starred }).threads)
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

function daysAgo(dayCount: number, hour: number, minute: number): number {
	const date = new Date()
	date.setDate(date.getDate() - dayCount)
	date.setHours(hour, minute, 0, 0)
	return Math.floor(date.getTime() / 1000)
}

const messages = new Map<string, StoredMessage>(
	[
		{
			id: 'msg-roadmap-1',
			thread_id: 'thread-roadmap',
			subject: 'Q3 product roadmap — final review before Monday',
			snippet: "Hi Ada, I went through the latest roadmap deck and it's looking sharp.",
			body: "<p>Hi Ada,</p><p>I went through the latest roadmap deck and it's looking sharp. Before we lock it on Monday, can you take one more pass at the sequencing for the calendar sync work? I want to make sure the dependencies on the sync engine are called out clearly.</p><p>I've attached the updated deck with my comments in the margins. The big open question is whether we ship the shared-inbox feature in the same release or hold it for the following one.</p><p>Let me know your thoughts before EOD.</p><p>Best,<br>Grace</p>",
			from: [{ name: 'Grace Hopper', email: 'grace@vercel.com' }],
			to: [ACCOUNT],
			date: daysAgo(0, 8, 12),
			unread: true,
			starred: true,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
			attachments: [
				{
					id: 'att-roadmap-deck',
					filename: 'attachment.pdf',
					content_type: 'application/pdf',
					size: 248 * 1024,
				},
			],
		},
		{
			id: 'msg-roadmap-2',
			thread_id: 'thread-roadmap',
			subject: 'Q3 product roadmap — final review before Monday',
			snippet: 'Thanks Grace — this is great.',
			body: "<p>Thanks Grace — this is great.</p><p>I think we hold shared-inbox for the next release. It needs the new permissions model to land first, and I'd rather not couple the two timelines. I'll annotate the sequencing slide this afternoon and send it back.</p><p>Ada</p>",
			from: [ACCOUNT],
			to: [{ name: 'Grace Hopper', email: 'grace@vercel.com' }],
			date: daysAgo(0, 9, 30),
			unread: false,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-travel-1',
			thread_id: 'thread-travel',
			subject: 'Your itinerary for Lisbon is confirmed',
			snippet: 'Your trip is booked!',
			body: "<p>Your trip is booked!</p><p>Departure: Fri, 8:40 AM — SFO to LIS, connecting in Lisbon.</p><p>Hotel: Praça Boutique, check-in from 3:00 PM. Confirmation #VYG-40192.</p><p>We'll send a reminder 24 hours before departure with your gate information.</p>",
			from: [{ name: 'Voyage', email: 'trips@voyage.com' }],
			to: [ACCOUNT],
			date: daysAgo(0, 7, 5),
			unread: true,
			starred: false,
			folders: ['inbox', 'travel'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-invoice-1',
			thread_id: 'thread-invoice',
			subject: 'Invoice #2041 has been paid',
			snippet: 'You received a payment of $4,200.00 from Northwind Studio.',
			body: '<p>You received a payment of $4,200.00 from Northwind Studio.</p><p>Invoice #2041 is now marked as paid. Funds will settle to your account within 2 business days.</p><p>A PDF receipt is attached for your records.</p>',
			from: [{ name: 'Stripe', email: 'receipts@stripe.com' }],
			to: [ACCOUNT],
			date: daysAgo(1, 16, 20),
			unread: false,
			starred: false,
			folders: ['inbox', 'finance'],
			grant_id: GRANT_ID,
			attachments: [
				{
					id: 'att-invoice-receipt',
					filename: 'invoice-2041.pdf',
					content_type: 'application/pdf',
					size: 184_000,
				},
			],
		},
		{
			id: 'msg-hiking-1',
			thread_id: 'thread-hiking',
			subject: 'Weekend hiking plans?',
			snippet: 'Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning.',
			body: "<p>Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning. Weather looks perfect.</p><p>Want to join? We'd start around 8 to beat the crowds. I can drive.</p>",
			from: [{ name: 'Alan Turing', email: 'alan@hey.com' }],
			to: [ACCOUNT],
			date: daysAgo(1, 11, 45),
			unread: false,
			starred: true,
			folders: ['inbox', 'personal'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-tokens-1',
			thread_id: 'thread-tokens',
			subject: 'Design system: new component tokens shipped',
			snippet:
				'The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.',
			body: '<p>The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.</p><p>Nothing you need to do today — existing components will pick up the changes automatically on the next release.</p>',
			from: [{ name: 'Katherine Johnson', email: 'katherine@vercel.com' }],
			to: [ACCOUNT],
			date: daysAgo(2, 14, 0),
			unread: false,
			starred: false,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-dentist-1',
			thread_id: 'thread-dentist',
			subject: 'Reminder: dentist appointment Thursday 2:00 PM',
			snippet:
				'This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:00 PM.',
			body: '<p>This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:00 PM.</p><p>Reply to reschedule, or arrive 10 minutes early to update your paperwork.</p>',
			from: [{ name: 'Bright Smile Dental', email: 'hello@brightsmile.com' }],
			to: [ACCOUNT],
			date: daysAgo(2, 10, 30),
			unread: false,
			starred: false,
			folders: ['inbox', 'personal'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-statement-1',
			thread_id: 'thread-statement',
			subject: 'Your monthly statement is ready',
			snippet: 'Your statement for June is now available. Sign in to view your transactions and balances.',
			body: "<p>Your statement for June is now available. Sign in to view your transactions and balances.</p><p>As always, we'll never ask for your password by email.</p>",
			from: [{ name: 'Meridian Bank', email: 'noreply@meridian.com' }],
			to: [ACCOUNT],
			date: daysAgo(3, 6, 0),
			unread: false,
			starred: false,
			folders: ['inbox', 'finance'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-welcome-1',
			thread_id: 'thread-welcome',
			subject: 'Welcome to ownmail',
			snippet: 'Welcome aboard! ownmail brings your mail and your calendar into one calm, fast workspace.',
			body: '<p>Welcome aboard! ownmail brings your mail and your calendar into one calm, fast workspace.</p><p>Press C to compose, or jump to your calendar from the rail on the left. Everything you need is a keystroke away.</p><p>Happy sending,<br>The ownmail team</p>',
			from: [{ name: 'The ownmail team', email: 'team@ownmail.com' }],
			to: [ACCOUNT],
			date: daysAgo(4, 9, 0),
			unread: false,
			starred: false,
			folders: ['inbox'],
			grant_id: GRANT_ID,
		},
		{
			id: 'msg-contract-1',
			thread_id: 'thread-contract',
			subject: 'Re: Contract draft',
			snippet: 'Attached is the countersigned draft.',
			body: '<p>Attached is the countersigned draft. Let me know if anything else is needed on my end.</p><p>Ada</p>',
			from: [ACCOUNT],
			to: [{ name: 'Legal', email: 'legal@northwind.com' }],
			date: daysAgo(1, 17, 10),
			unread: false,
			starred: false,
			folders: ['sent', 'work'],
			grant_id: GRANT_ID,
			attachments: [
				{
					id: 'att-contract-draft',
					filename: 'contract-draft.pdf',
					content_type: 'application/pdf',
					size: 420_000,
				},
			],
		},
		{
			id: 'msg-sync-1',
			thread_id: 'thread-sync',
			subject: "Notes from today's sync",
			snippet: 'Quick recap of what we agreed on today, with owners and dates.',
			body: '<p>Quick recap of what we agreed on today, with owners and dates. Shout if I missed anything.</p>',
			from: [ACCOUNT],
			to: [{ name: 'Team', email: 'team@vercel.com' }],
			date: daysAgo(2, 18, 0),
			unread: false,
			starred: false,
			folders: ['sent', 'work'],
			grant_id: GRANT_ID,
		},
	].map((message) => [message.id, message]),
)

const threads = new Map<string, StoredThread>(
	[
		{
			id: 'thread-roadmap',
			subject: 'Q3 product roadmap — final review before Monday',
			snippet: 'Thanks Grace — this is great.',
			participants: [{ name: 'Grace Hopper', email: 'grace@vercel.com' }],
			message_ids: ['msg-roadmap-1', 'msg-roadmap-2'],
			latest_message_received_date: daysAgo(0, 8, 12),
			latest_message_sent_date: daysAgo(0, 9, 30),
			has_attachments: true,
			unread: true,
			starred: true,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-travel',
			subject: 'Your itinerary for Lisbon is confirmed',
			snippet: 'Your trip is booked!',
			participants: [{ name: 'Voyage', email: 'trips@voyage.com' }],
			message_ids: ['msg-travel-1'],
			latest_message_received_date: daysAgo(0, 7, 5),
			has_attachments: false,
			unread: true,
			starred: false,
			folders: ['inbox', 'travel'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-invoice',
			subject: 'Invoice #2041 has been paid',
			snippet: 'You received a payment of $4,200.00 from Northwind Studio.',
			participants: [{ name: 'Stripe', email: 'receipts@stripe.com' }],
			message_ids: ['msg-invoice-1'],
			latest_message_received_date: daysAgo(1, 16, 20),
			has_attachments: true,
			unread: false,
			starred: false,
			folders: ['inbox', 'finance'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-hiking',
			subject: 'Weekend hiking plans?',
			snippet: 'Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning.',
			participants: [{ name: 'Alan Turing', email: 'alan@hey.com' }],
			message_ids: ['msg-hiking-1'],
			latest_message_received_date: daysAgo(1, 11, 45),
			has_attachments: false,
			unread: false,
			starred: true,
			folders: ['inbox', 'personal'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-tokens',
			subject: 'Design system: new component tokens shipped',
			snippet:
				'The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.',
			participants: [{ name: 'Katherine Johnson', email: 'katherine@vercel.com' }],
			message_ids: ['msg-tokens-1'],
			latest_message_received_date: daysAgo(2, 14, 0),
			has_attachments: false,
			unread: false,
			starred: false,
			folders: ['inbox', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-dentist',
			subject: 'Reminder: dentist appointment Thursday 2:00 PM',
			snippet:
				'This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:00 PM.',
			participants: [{ name: 'Bright Smile Dental', email: 'hello@brightsmile.com' }],
			message_ids: ['msg-dentist-1'],
			latest_message_received_date: daysAgo(2, 10, 30),
			has_attachments: false,
			unread: false,
			starred: false,
			folders: ['inbox', 'personal'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-statement',
			subject: 'Your monthly statement is ready',
			snippet: 'Your statement for June is now available. Sign in to view your transactions and balances.',
			participants: [{ name: 'Meridian Bank', email: 'noreply@meridian.com' }],
			message_ids: ['msg-statement-1'],
			latest_message_received_date: daysAgo(3, 6, 0),
			has_attachments: false,
			unread: false,
			starred: false,
			folders: ['inbox', 'finance'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-welcome',
			subject: 'Welcome to ownmail',
			snippet: 'Welcome aboard! ownmail brings your mail and your calendar into one calm, fast workspace.',
			participants: [{ name: 'The ownmail team', email: 'team@ownmail.com' }],
			message_ids: ['msg-welcome-1'],
			latest_message_received_date: daysAgo(4, 9, 0),
			has_attachments: false,
			unread: false,
			starred: false,
			folders: ['inbox'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-contract',
			subject: 'Re: Contract draft',
			snippet: 'Attached is the countersigned draft.',
			participants: [{ name: 'Legal', email: 'legal@northwind.com' }],
			message_ids: ['msg-contract-1'],
			latest_message_sent_date: daysAgo(1, 17, 10),
			has_attachments: true,
			unread: false,
			starred: false,
			folders: ['sent', 'work'],
			grant_id: GRANT_ID,
		},
		{
			id: 'thread-sync',
			subject: "Notes from today's sync",
			snippet: 'Quick recap of what we agreed on today, with owners and dates.',
			participants: [{ name: 'Team', email: 'team@vercel.com' }],
			message_ids: ['msg-sync-1'],
			latest_message_sent_date: daysAgo(2, 18, 0),
			has_attachments: false,
			unread: false,
			starred: false,
			folders: ['sent', 'work'],
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
			subject: 'Thoughts on the offsite agenda',
			snippet: 'Here are a few ideas for the offsite —',
			body: 'Here are a few ideas for the offsite —',
			to: [{ name: 'Grace Hopper', email: 'grace@vercel.com' }],
			date: daysAgo(0, 12, 0),
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
			{ name: 'Grace Hopper', email: 'grace@vercel.com', status: 'yes' },
			{ name: 'Katherine Johnson', email: 'katherine@vercel.com', status: 'yes' },
		],
	})
	addEvent('event-lunch', 'Lunch with Alan', startOfDay, 12, 30, 60, {
		calendar_id: 'social',
		location: 'Tartine, Mission',
	})
	addEvent('event-design-system', 'Design system sync', startOfDay, 15, 0, 60, {
		calendar_id: 'work',
		participants: [{ name: 'Katherine Johnson', email: 'katherine@vercel.com', status: 'yes' }],
	})
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
	addEvent('event-dentist', 'Dentist - Dr. Reyes', addDays(startOfDay, 2), 14, 0, 60, {
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
			{ name: 'Grace Hopper', email: 'grace@vercel.com', status: 'yes' },
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

export function mockThreads(input: { folderId?: string; q?: string; starred?: boolean }): {
	threads: Thread[]
} {
	const query = input.q?.trim().toLowerCase()
	const base = input.folderId ? visibleThreads(input.folderId) : visibleThreads()
	const selected = base.filter((thread) => {
		if (input.starred !== undefined && thread.starred !== input.starred) return false
		if (!query) return true
		const text = [
			thread.subject,
			thread.snippet,
			...(thread.participants ?? []).flatMap((participant) => [participant.name, participant.email]),
			...thread.message_ids.flatMap((messageId) => {
				const message = messages.get(messageId)
				if (!message) return []
				return [
					message.subject,
					message.snippet,
					stripHtml(message.body ?? ''),
					...(message.from ?? []).flatMap((participant) => [participant.name, participant.email]),
					...(message.to ?? []).flatMap((participant) => [participant.name, participant.email]),
				]
			}),
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
		from: [ACCOUNT],
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

function visibleThreads(folderId?: string): StoredThread[] {
	return [...threads.values()]
		.filter((thread) => {
			if (!folderId) return true
			return folderId === 'starred' ? thread.starred : thread.folders.includes(folderId)
		})
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
