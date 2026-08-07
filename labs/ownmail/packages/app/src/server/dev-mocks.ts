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
import { threadFoldersAfterMove } from '#features/mail/server/mail-folders'

const GRANT_ID = 'dev-grant'
const MAILBOX_NAME = 'Ada Lovelace'
const MAILBOX_EMAIL = 'ada@ownmail.com'
const ACCOUNT = { name: MAILBOX_NAME, email: MAILBOX_EMAIL }
let managedResourceSequence = 0

type StoredThread = Thread & { folders: string[]; message_ids: string[] }
type StoredMessage = Message & { thread_id: string }
type StoredDraft = Draft & { id: string; outbound_attachments?: SendMessageRequest['attachments'] }

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

	async send(body: SendMessageRequest): Promise<ItemResponse<Message>> {
		const sent = mockSendMessage({
			toList: (body.to ?? []).map((participant) => participant.email),
			subject: body.subject ?? '',
			body: body.body ?? '',
			...(body.reply_to_message_id ? { replyToMessageId: body.reply_to_message_id } : {}),
			...(body.attachments ? { attachments: body.attachments } : {}),
		})
		return itemResponse(sent)
	}

	async listDrafts(): Promise<ListResponse<Draft>> {
		return listResponse(mockDrafts())
	}

	async getDraft(draftId: string): Promise<ItemResponse<Draft>> {
		return itemResponse(mockDraft(draftId))
	}

	async downloadAttachment(attachmentId: string, draftId: string): Promise<Response> {
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
		return listResponse(
			mockEvents({
				start: Number(query.start ?? 0),
				end: Number(query.end ?? Number.MAX_SAFE_INTEGER),
			}).events.filter((event) => event.calendar_id === query.calendar_id),
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

// A real-world HTML newsletter: table layout, a fixed 600px width, inline styles,
// remote image, and several links — exercises the HTML renderer (shadow-DOM CSS
// scoping, links-open-in-new-tab + hover preview, auto-dark, and shrink-to-fit on
// narrow screens). Deliberately ships no dark-mode styles so auto-dark kicks in.
const NEWSLETTER_BODY = `
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;margin:0 auto;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;background:#ffffff;color:#1f2937">
	<tr><td style="background:#4f46e5;padding:28px 32px">
		<span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px">The&nbsp;Dispatch</span>
		<span style="color:#c7d2fe;font-size:13px;float:right;padding-top:6px">Issue #48 · Weekly</span>
	</td></tr>
	<tr><td style="padding:0">
		<img src="https://picsum.photos/600/220" width="600" alt="A desk with a laptop and coffee" style="display:block;width:600px;height:auto" />
	</td></tr>
	<tr><td style="padding:32px 32px 8px">
		<h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;color:#111827">Calendar sync is here — and it’s fast</h1>
		<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151">This week we shipped two-way calendar sync across Google, Microsoft, and iCloud. Events you create in ownmail now land in your provider within seconds, and vice versa. Here’s everything new.</p>
		<a href="https://ownmail.example.com/blog/calendar-sync" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">Read the announcement →</a>
	</td></tr>
	<tr><td style="padding:24px 32px">
		<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px" />
		<h2 style="margin:0 0 8px;font-size:17px;color:#111827">Three tips for shipping faster</h2>
		<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#374151">Small changes, reviewed and deployed the same day, beat big-bang releases. Our team’s favorite habits, distilled.</p>
		<p style="margin:0 0 24px"><a href="https://ownmail.example.com/blog/shipping-tips" style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px">Keep reading →</a></p>
		<h2 style="margin:0 0 8px;font-size:17px;color:#111827">What we learned rebuilding search</h2>
		<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#374151">Rebuilding full-text search on top of a new index cut p95 latency by 60%. The tradeoffs, and what we’d do differently.</p>
		<p style="margin:0"><a href="https://ownmail.example.com/blog/search-rebuild" style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px">Read the deep dive →</a></p>
	</td></tr>
	<tr><td style="background:#f9fafb;padding:24px 32px;text-align:center">
		<p style="margin:0 0 8px;font-size:13px;color:#6b7280">You’re receiving this because you subscribed to The Dispatch.</p>
		<p style="margin:0;font-size:13px;color:#6b7280"><a href="https://ownmail.example.com/unsubscribe" style="color:#6b7280;text-decoration:underline">Unsubscribe</a> · <a href="https://ownmail.example.com/preferences" style="color:#6b7280;text-decoration:underline">Manage preferences</a></p>
	</td></tr>
</table>`

const messages = new Map<string, StoredMessage>(
	[
		{
			id: 'msg-newsletter-1',
			thread_id: 'thread-newsletter',
			subject: 'The Dispatch — your weekly product digest',
			snippet:
				'This week: the new calendar sync, three shipping tips, and what we learned rebuilding search.',
			body: NEWSLETTER_BODY,
			from: [{ name: 'The Dispatch', email: 'digest@dispatch.email' }],
			to: [ACCOUNT],
			date: daysAgo(0, 9, 45),
			unread: true,
			starred: false,
			folders: ['inbox'],
			grant_id: GRANT_ID,
		},
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
			snippet:
				'Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning. Weather looks perfect.',
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
			snippet: 'Attached is the countersigned draft. Let me know if anything else is needed on my end.',
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
			snippet: 'Quick recap of what we agreed on today, with owners and dates. Shout if I missed anything.',
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
			id: 'thread-newsletter',
			subject: 'The Dispatch — your weekly product digest',
			snippet:
				'This week: the new calendar sync, three shipping tips, and what we learned rebuilding search.',
			participants: [{ name: 'The Dispatch', email: 'digest@dispatch.email' }],
			message_ids: ['msg-newsletter-1'],
			latest_message_received_date: daysAgo(0, 9, 45),
			has_attachments: false,
			unread: true,
			starred: false,
			folders: ['inbox'],
			grant_id: GRANT_ID,
		},
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
			snippet:
				'Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning. Weather looks perfect.',
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
			snippet: 'Attached is the countersigned draft. Let me know if anything else is needed on my end.',
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
			snippet: 'Quick recap of what we agreed on today, with owners and dates. Shout if I missed anything.',
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
	addEvent('event-coffee-katherine', 'Coffee with Katherine', addDays(startOfDay, -1), 10, 0, 30, {
		calendar_id: 'social',
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
	subject: string
	body: string
	replyToMessageId?: string
	attachments?: SendMessageRequest['attachments']
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

export function mockSaveDraft(input: {
	draftId?: string
	to: string
	subject: string
	body: string
	replyToMessageId?: string
	attachments?: SendMessageRequest['attachments']
}): {
	draftId: string
} {
	const id = input.draftId || `draft-${Date.now()}`
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
		...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
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
			.sort(
				(a, b) =>
					(b.latest_message_received_date ?? b.latest_message_sent_date ?? 0) -
					(a.latest_message_received_date ?? a.latest_message_sent_date ?? 0),
			)
	)
	/* v8 ignore stop -- @preserve */
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
	if ('start_date' in when) {
		const start = Math.floor(new Date(`${when.start_date}T00:00:00`).getTime() / 1000)
		const end = Math.floor(new Date(`${when.end_date}T00:00:00`).getTime() / 1000)
		return { start, end }
	}
	return { start: when.time, end: when.time }
}
/* v8 ignore stop -- @preserve */
