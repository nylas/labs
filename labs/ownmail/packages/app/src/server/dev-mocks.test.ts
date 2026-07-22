import { describe, expect, it } from 'vitest'
import { messageBodyParagraphs } from '../features/mail/lib/mail-ui-model.js'
import {
	createDevMailbox,
	devMailboxEmail,
	devMailboxName,
	mockContactList,
	mockCreateContact,
	mockCreateEvent,
	mockDeleteContact,
	mockDraft,
	mockDrafts,
	mockEvents,
	mockGetContact,
	mockMailboxInfo,
	mockRsvpEvent,
	mockSaveDraft,
	mockSendDraft,
	mockSendMessage,
	mockThreadMessages,
	mockThreads,
	mockUpdateContact,
	mockUpdateThreadState,
} from './dev-mocks.js'

describe('dev mock reference identity', () => {
	it('uses the reference account by default', () => {
		expect(devMailboxEmail()).toBe('ada@ownmail.com')
		expect(devMailboxName()).toBe('Ada Lovelace')
		expect(devMailboxName('ada@ownmail.com')).toBe('Ada Lovelace')
	})

	it('labels sent messages with the reference account name', () => {
		const { messages } = mockThreadMessages('thread-roadmap')
		const sent = messages.find((message) => message.from?.[0]?.email === 'ada@ownmail.com')

		expect(sent?.from?.[0]?.name).toBe('Ada Lovelace')
	})

	it('preserves reference punctuation in visible mock content', () => {
		const roadmap = mockThreads({ folderId: 'inbox' }).threads.find(
			(thread) => thread.id === 'thread-roadmap',
		)
		const travel = mockThreads({ folderId: 'inbox' }).threads.find((thread) => thread.id === 'thread-travel')
		const tokens = mockThreads({ folderId: 'inbox' }).threads.find((thread) => thread.id === 'thread-tokens')
		const hiking = mockThreads({ folderId: 'inbox' }).threads.find((thread) => thread.id === 'thread-hiking')
		const dentist = mockThreads({ folderId: 'inbox' }).threads.find(
			(thread) => thread.id === 'thread-dentist',
		)
		const contract = mockThreads({ folderId: 'work' }).threads.find(
			(thread) => thread.id === 'thread-contract',
		)
		const sync = mockThreads({ folderId: 'work' }).threads.find((thread) => thread.id === 'thread-sync')
		const draft = mockDrafts()[0]

		expect(roadmap?.subject).toBe('Q3 product roadmap — final review before Monday')
		expect(roadmap?.snippet).toBe('Thanks Grace — this is great.')
		expect(travel?.snippet).toBe('Your trip is booked!')
		expect(tokens?.snippet).toBe(
			'The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.',
		)
		expect(hiking?.snippet).toBe(
			'Hey! A few of us are thinking of doing the Dipsea trail on Saturday morning. Weather looks perfect.',
		)
		expect(dentist?.snippet).toBe(
			'This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:00 PM.',
		)
		expect(contract?.snippet).toBe(
			'Attached is the countersigned draft. Let me know if anything else is needed on my end.',
		)
		expect(sync?.snippet).toBe(
			'Quick recap of what we agreed on today, with owners and dates. Shout if I missed anything.',
		)
		expect(draft?.body).toBe('Here are a few ideas for the offsite —')
	})

	it('preserves reference message body paragraphs', () => {
		const invoice = mockThreadMessages('thread-invoice').messages[0]
		const hiking = mockThreadMessages('thread-hiking').messages[0]

		expect(invoice).toBeDefined()
		expect(hiking).toBeDefined()
		if (!invoice || !hiking) return

		expect(messageBodyParagraphs(invoice)).toContain('A PDF receipt is attached for your records.')
		expect(messageBodyParagraphs(hiking)).toContain(
			"Want to join? We'd start around 8 to beat the crowds. I can drive.",
		)
	})

	it('preserves reference attachment metadata', () => {
		const { messages } = mockThreadMessages('thread-roadmap')
		const attachment = messages
			.flatMap((message) => message.attachments ?? [])
			.find((candidate) => !candidate.is_inline)

		expect(attachment?.filename).toBe('attachment.pdf')
		expect(attachment?.size).toBe(248 * 1024)
	})

	it('preserves outbound attachment metadata in sent messages and drafts', () => {
		const attachment = {
			filename: 'notes.txt',
			content_type: 'text/plain',
			content: btoa('hello'),
		}
		const sent = mockSendMessage({
			toList: ['grace@vercel.com'],
			subject: 'Notes',
			body: 'Attached.',
			attachments: [attachment],
		})

		expect(sent.attachments?.[0]).toMatchObject({
			filename: 'notes.txt',
			content_type: 'text/plain',
			size: 5,
		})
		expect(sent.attachments?.[0]).not.toHaveProperty('content')

		const saved = mockSaveDraft({
			to: 'grace@vercel.com',
			subject: 'Draft notes',
			body: 'Attached.',
			attachments: [attachment],
		})
		expect(mockDrafts().find((draft) => draft.id === saved.draftId)?.attachments?.[0]?.filename).toBe(
			'notes.txt',
		)

		mockSendDraft(saved.draftId)
		const sentDraft = mockThreads({ folderId: 'sent' }).threads.find(
			(thread) => thread.subject === 'Draft notes',
		)
		expect(sentDraft?.has_attachments).toBe(true)
	})

	it('preserves existing draft attachments when an update omits replacements', async () => {
		const mailbox = createDevMailbox()
		const attachment = { filename: 'notes.txt', content_type: 'text/plain', content: btoa('hello') }
		const created = await mailbox.createDraft({
			to: [{ email: 'grace@vercel.com' }],
			attachments: [attachment],
		})
		await mailbox.updateDraft(created.data.id, { subject: 'Updated draft' })
		expect((await mailbox.getDraft(created.data.id)).data.attachments?.[0]?.filename).toBe('notes.txt')
		const downloaded = await mailbox.downloadAttachment('att-outbound-0-notes.txt', created.data.id)
		expect(await downloaded.text()).toBe('hello')
		expect((await mailbox.downloadAttachment('missing', created.data.id)).status).toBe(404)
	})

	it('preserves draft reply context and accepts replacement attachments', async () => {
		const mailbox = createDevMailbox()
		const original = { filename: 'notes.txt', content_type: 'text/plain', content: btoa('hello') }
		const replacement = { filename: 'updated.txt', content_type: 'text/plain', content: btoa('updated') }
		const created = await mailbox.createDraft({
			to: [{ email: 'grace@vercel.com' }],
			reply_to_message_id: 'm1',
			attachments: [original],
		})

		await mailbox.updateDraft(created.data.id, { attachments: [replacement] })
		expect((await mailbox.getDraft(created.data.id)).data.reply_to_message_id).toBe('m1')
		expect((await mailbox.getDraft(created.data.id)).data.attachments?.[0]?.filename).toBe('updated.txt')

		await mailbox.updateDraft(created.data.id, { reply_to_message_id: 'm2' })
		expect((await mailbox.getDraft(created.data.id)).data.reply_to_message_id).toBe('m2')

		const plainDraft = await mailbox.createDraft({ to: [{ email: 'ada@lovelace.dev' }] })
		await mailbox.updateDraft(plainDraft.data.id, { subject: 'No attachments' })
		expect((await mailbox.getDraft(plainDraft.data.id)).data.attachments).toBeUndefined()
	})

	it('models starred as an account-wide thread query', () => {
		const starred = mockThreads({ starred: true }).threads

		expect(starred.map((thread) => thread.id)).toEqual(
			mockThreads({ folderId: 'starred' }).threads.map((thread) => thread.id),
		)
		expect(starred.every((thread) => thread.starred)).toBe(true)

		mockUpdateThreadState({ threadId: 'thread-roadmap', starred: false })
		expect(mockThreads({ starred: true }).threads.map((thread) => thread.id)).not.toContain('thread-roadmap')
	})

	it('preserves reference labels when archiving a thread', () => {
		mockUpdateThreadState({ threadId: 'thread-roadmap', folder: 'archive' })
		const roadmap = mockThreads({ folderId: 'archive' }).threads.find(
			(thread) => thread.id === 'thread-roadmap',
		)

		expect(roadmap?.folders).toEqual(['archive', 'work'])
		expect(mockThreads({ folderId: 'inbox' }).threads.map((thread) => thread.id)).not.toContain(
			'thread-roadmap',
		)
	})

	it('models Nylas thread search by native text or participant email', () => {
		expect(mockThreads({ searchQueryNative: 'roadmap' }).threads.map((thread) => thread.id)).toContain(
			'thread-roadmap',
		)
		expect(mockThreads({ searchQueryNative: 'crowds' }).threads.map((thread) => thread.id)).toContain(
			'thread-hiking',
		)
		expect(mockThreads({ searchQueryNative: 'Alan Turing' }).threads.map((thread) => thread.id)).toContain(
			'thread-hiking',
		)
		expect(
			mockThreads({ folderId: 'work', searchQueryNative: 'roadmap' }).threads.map((thread) => thread.id),
		).toEqual(['thread-roadmap'])
		expect(mockThreads({ folderId: 'work', searchQueryNative: 'Welcome' }).threads).toEqual([])
		expect(mockThreads({ anyEmail: 'grace@vercel.com' }).threads.map((thread) => thread.id)).toContain(
			'thread-roadmap',
		)
		expect(mockThreads({ searchQueryNative: 'not-present-in-reference' }).threads).toEqual([])
	})

	it('preserves reference calendar event copy', () => {
		const now = Math.floor(Date.now() / 1000)
		const { events } = mockEvents({ start: now - 2 * 86_400, end: now + 7 * 86_400 })
		const roadmap = events.find((event) => event.id === 'event-roadmap-review')
		const coffee = events.find((event) => event.id === 'event-coffee-katherine')
		const dentist = events.find((event) => event.id === 'event-dentist')

		expect(roadmap?.location).toBe('Meet — Aurora room')
		expect(coffee?.title).toBe('Coffee with Katherine')
		expect(coffee?.calendar_id).toBe('social')
		expect(dentist?.title).toBe('Dentist — Dr. Reyes')
	})

	it('filters date-span and point-in-time events', () => {
		const allDay = mockEvents({ start: 0, end: Number.MAX_SAFE_INTEGER }).events.find(
			(event) => event.id === 'event-all-day',
		)
		if (!allDay) throw new Error('Expected the seeded all-day event')
		const originalWhen = allDay.when
		try {
			allDay.when = { object: 'datespan', start_date: '2030-01-01', end_date: '2030-01-03' }
			expect(mockEvents({ start: 1_893_456_000, end: 1_893_628_800 }).events).toContain(allDay)

			allDay.when = { object: 'time', time: 1_893_456_000 }
			expect(mockEvents({ start: 1_893_455_999, end: 1_893_456_001 }).events).toContain(allDay)
		} finally {
			allDay.when = originalWhen
		}
	})
})

describe('dev mailbox reference account fallbacks', () => {
	it('trims a provided inbox email and keeps the reference default when it is blank', () => {
		expect(devMailboxEmail('  grace@vercel.com  ')).toBe('grace@vercel.com')
		expect(devMailboxEmail('   ')).toBe('ada@ownmail.com')
	})

	it('only names the reference account, leaving other mailboxes anonymous', () => {
		expect(devMailboxName('someone-else@example.com')).toBeUndefined()
	})

	it('composes mailbox info for the app shell', () => {
		expect(mockMailboxInfo('OwnMail', 'ada@ownmail.com')).toEqual({
			email: 'ada@ownmail.com',
			displayName: 'Ada Lovelace',
			appName: 'OwnMail',
		})
	})
})

describe('dev mock Nylas client surface', () => {
	const mailbox = createDevMailbox()
	const now = Math.floor(Date.now() / 1000)
	const attachment = { filename: 'a.txt', content_type: 'text/plain', content: btoa('hi') }

	it('lists folders with system flags and counts', async () => {
		const { data } = await mailbox.listFolders()
		const inbox = data.find((folder) => folder.id === 'inbox')
		const work = data.find((folder) => folder.id === 'work')

		expect(inbox?.system_folder).toBe(true)
		expect(work?.system_folder).toBe(false)
		expect(typeof inbox?.total_count).toBe('number')
	})

	it('applies every thread query filter and also returns everything for an empty query', async () => {
		const filtered = await mailbox.listThreads({
			in: 'personal',
			subject: 'weekend',
			any_email: 'alan@hey.com',
			search_query_native: 'weekend',
			starred: true,
		})
		expect(filtered.data.map((thread) => thread.id)).toContain('thread-hiking')

		const all = await mailbox.listThreads()
		expect(all.data.length).toBeGreaterThan(0)
	})

	it('reads a thread and its messages, and reports deleted messages as not found', async () => {
		const thread = await mailbox.getThread('thread-hiking')
		expect(thread.data.id).toBe('thread-hiking')

		const message = await mailbox.getMessage('msg-hiking-1')
		expect(message.data.id).toBe('msg-hiking-1')

		await expect(mailbox.getMessage('msg-does-not-exist')).rejects.toThrow('Not found')
	})

	it('updates thread state and treats an empty body as a no-op', async () => {
		const updated = await mailbox.updateThread('thread-tokens', {
			unread: true,
			starred: true,
			folders: ['archive'],
		})
		expect(updated.data.starred).toBe(true)
		expect(updated.data.folders).toContain('archive')

		const noop = await mailbox.updateThread('thread-tokens', {})
		expect(noop.data.id).toBe('thread-tokens')
	})

	it('sends a reply with attachments and a bare message with defaulted fields', async () => {
		const reply = await mailbox.send({
			to: [{ email: 'alan@hey.com' }],
			subject: 'Re: hike',
			body: '<p>See you there</p>',
			reply_to_message_id: 'msg-hiking-1',
			attachments: [attachment],
		})
		expect(reply.data.thread_id).toBe('thread-hiking')
		expect(reply.data.attachments?.[0]?.filename).toBe('a.txt')

		const bare = await mailbox.send({})
		expect(bare.data.subject).toBe('')
		expect(bare.data.attachments).toBeUndefined()
	})

	it('creates, reads, updates, sends and deletes drafts', async () => {
		const created = await mailbox.createDraft({
			to: [{ email: 'grace@vercel.com' }],
			subject: 'Draft one',
			body: 'first',
			attachments: [attachment],
		})
		const draftId = created.data.id
		expect(await mailbox.getDraft(draftId).then((response) => response.data.subject)).toBe('Draft one')

		const bareDraft = await mailbox.createDraft({})
		expect(bareDraft.data.subject).toBe('')

		await mailbox.updateDraft(draftId, {
			to: [{ email: 'grace@vercel.com' }],
			subject: 'Draft two',
			body: 'second',
			attachments: [attachment],
		})
		const bareUpdate = await mailbox.updateDraft(draftId, {})
		expect(bareUpdate.data.id).toBe(draftId)

		const listed = await mailbox.listDrafts()
		expect(listed.data.some((draft) => draft.id === draftId)).toBe(true)

		const disposable = await mailbox.createDraft({ subject: 'trash me' })
		await mailbox.deleteDraft(disposable.data.id)
		expect((await mailbox.listDrafts()).data.some((draft) => draft.id === disposable.data.id)).toBe(false)
	})

	it('sends a draft and returns the resulting sent message', async () => {
		const created = await mailbox.createDraft({
			to: [{ email: 'grace@vercel.com' }],
			subject: 'Send this draft',
			body: 'ready',
		})
		const sent = await mailbox.sendDraft(created.data.id)
		expect(sent.data.subject).toBe('Send this draft')
		expect(sent.data.folders).toContain('sent')
	})

	it('filters contacts by an email query and lists all of them for a blank query', async () => {
		const matches = await mailbox.listContacts({ email: 'mina' })
		expect(matches.data[0]?.given_name).toBe('Mina')
		expect(matches.data[0]?.surname).toBe('Park')

		// The management view lists the whole directory — a blank query is no longer empty.
		const all = await mailbox.listContacts()
		expect(all.data.length).toBeGreaterThanOrEqual(4)
	})

	it('lists calendars and events, defaulting the range when omitted', async () => {
		const calendars = await mailbox.listCalendars()
		expect(calendars.data.some((calendar) => calendar.is_primary)).toBe(true)

		const bounded = await mailbox.listEvents({ calendar_id: 'work', start: now - 86_400, end: now + 86_400 })
		expect(bounded.data.every((event) => event.calendar_id === 'work')).toBe(true)

		const unbounded = await mailbox.listEvents({ calendar_id: 'work' })
		expect(unbounded.data.every((event) => event.calendar_id === 'work')).toBe(true)
	})

	it('creates events with and without optional fields and rejects a missing time', async () => {
		const full = await mailbox.createEvent(
			{
				title: 'Full event',
				description: 'desc',
				location: 'HQ',
				participants: [{ email: 'grace@vercel.com' }],
				when: { object: 'timespan', start_time: now, end_time: now + 3600 },
			},
			'work',
		)
		expect(full.data.calendar_id).toBe('work')
		expect(full.data.location).toBe('HQ')

		const bare = await mailbox.createEvent(
			{ title: 'Bare event', when: { object: 'timespan', start_time: now, end_time: now + 3600 } },
			'work',
		)
		expect(bare.data.description).toBeUndefined()

		const allDay = await mailbox.createEvent(
			{ title: 'All day', when: { object: 'date', date: '2030-01-02' }, recurrence: ['RRULE:FREQ=YEARLY'] },
			'work',
		)
		expect(allDay.data.when).toEqual({ object: 'date', date: '2030-01-02' })
		expect(allDay.data.recurrence).toEqual(['RRULE:FREQ=YEARLY'])

		await expect(mailbox.createEvent({ title: 'No time' }, 'work')).rejects.toThrow('Invalid event time')
	})

	it('updates every event field, applies no-op updates and rejects a missing event', async () => {
		const created = await mailbox.createEvent(
			{ title: 'To update', when: { object: 'timespan', start_time: now, end_time: now + 3600 } },
			'work',
		)
		const eventId = created.data.id

		const updated = await mailbox.updateEvent(
			eventId,
			{
				title: 'Updated title',
				description: 'new desc',
				location: 'new loc',
				when: { object: 'timespan', start_time: now + 60, end_time: now + 3660 },
			},
			'work',
		)
		expect(updated.data.title).toBe('Updated title')

		const noop = await mailbox.updateEvent(eventId, {}, 'work')
		expect(noop.data.id).toBe(eventId)

		await expect(mailbox.updateEvent('event-missing', { title: 'x' }, 'work')).rejects.toThrow('Not found')
	})

	it('deletes an event', async () => {
		const created = await mailbox.createEvent(
			{ title: 'To delete', when: { object: 'timespan', start_time: now, end_time: now + 3600 } },
			'work',
		)
		await mailbox.deleteEvent(created.data.id, 'work')
		const remaining = await mailbox.listEvents({
			calendar_id: 'work',
			start: now - 86_400,
			end: now + 86_400,
		})
		expect(remaining.data.some((event) => event.id === created.data.id)).toBe(false)
	})

	it('records an RSVP against the first participant, and no-ops without participants', async () => {
		const withParticipants = await mailbox.createEvent(
			{
				title: 'RSVP event',
				participants: [{ email: 'grace@vercel.com' }, { email: 'katherine@vercel.com' }],
				when: { object: 'timespan', start_time: now, end_time: now + 3600 },
			},
			'work',
		)
		await mailbox.sendRsvp(withParticipants.data.id, 'work', 'yes')
		const refreshed = await mailbox.listEvents({
			calendar_id: 'work',
			start: now - 86_400,
			end: now + 86_400,
		})
		const rsvped = refreshed.data.find((event) => event.id === withParticipants.data.id)
		expect(rsvped?.participants?.[0]?.status).toBe('yes')
		expect(rsvped?.participants?.[1]?.status).toBe('noreply')

		const withoutParticipants = await mailbox.createEvent(
			{ title: 'Solo event', when: { object: 'timespan', start_time: now, end_time: now + 3600 } },
			'work',
		)
		const result = await mailbox.sendRsvp(withoutParticipants.data.id, 'work', 'maybe')
		expect(result.data).toEqual({ ok: true })
	})
})

describe('dev mock not-found handling', () => {
	const mailbox = createDevMailbox()

	it('reports a missing thread as not found across the read and update surface', async () => {
		// Every store lookup that can be handed a stale id must fail closed, not return a partial.
		expect(() => mockThreadMessages('thread-missing')).toThrow('Not found')
		await expect(mailbox.getThread('thread-missing')).rejects.toThrow('Not found')
		expect(() => mockUpdateThreadState({ threadId: 'thread-missing', starred: true })).toThrow('Not found')
		await expect(mailbox.updateThread('thread-missing', { starred: true })).rejects.toThrow('Not found')
	})

	it('reports a missing draft as not found when read or sent', async () => {
		expect(() => mockDraft('draft-missing')).toThrow('Not found')
		await expect(mailbox.getDraft('draft-missing')).rejects.toThrow('Not found')
		expect(() => mockSendDraft('draft-missing')).toThrow('Not found')
		await expect(mailbox.sendDraft('draft-missing')).rejects.toThrow('Not found')
	})

	it('reports a missing event as not found when updating or replying', async () => {
		expect(() => mockRsvpEvent({ eventId: 'event-missing', status: 'yes' })).toThrow('Not found')
		await expect(mailbox.sendRsvp('event-missing', 'work', 'yes')).rejects.toThrow('Not found')
	})
})

describe('dev mock optional-field defaults', () => {
	const mailbox = createDevMailbox()
	const now = Math.floor(Date.now() / 1000)

	it('defaults an omitted calendar id to the primary calendar', () => {
		// mockCreateEvent is the raw store writer: an event created with no calendarId must fall
		// back to the primary calendar id rather than landing without a calendar.
		const created = mockCreateEvent({ title: 'No calendar', startTime: now, endTime: now + 3600 })
		const { events } = mockEvents({ start: now - 3600, end: now + 7200 })
		const event = events.find((candidate) => candidate.id === created.eventId)
		expect(event?.calendar_id).toBe('primary')
	})

	it('stores date-only events without inventing a timed range', () => {
		const created = mockCreateEvent({
			title: 'Holiday',
			allDayDate: '2030-12-25',
			recurrence: ['RRULE:FREQ=YEARLY'],
		})
		const event = mockEvents({ start: 0, end: Number.MAX_SAFE_INTEGER }).events.find(
			(candidate) => candidate.id === created.eventId,
		)
		expect(event?.when).toEqual({ object: 'date', date: '2030-12-25' })
		expect(event?.recurrence).toEqual(['RRULE:FREQ=YEARLY'])
	})

	it('defaults the created event title to an empty string through the client', async () => {
		const created = await mailbox.createEvent(
			{ when: { object: 'timespan', start_time: now, end_time: now + 3600 } },
			'work',
		)
		expect(created.data.title).toBe('')
	})

	it('measures attachment sizes across every base64 padding length', async () => {
		// btoa('a')='YQ==' (2 pad), btoa('hi')='aGk=' (1 pad), btoa('abc')='YWJj' (no pad).
		// Each padding arm changes the decoded byte count, so all three must be exercised.
		const sent = await mailbox.send({
			to: [{ email: 'grace@vercel.com' }],
			subject: 'Padding sizes',
			body: 'x',
			attachments: [
				{ filename: 'two.bin', content_type: 'text/plain', content: btoa('a') },
				{ filename: 'one.bin', content_type: 'text/plain', content: btoa('hi') },
				{ filename: 'none.bin', content_type: 'text/plain', content: btoa('abc') },
			],
		})
		expect(sent.data.attachments?.map((attachment) => attachment.size)).toEqual([1, 2, 3])
	})

	it('searches a message with an empty body without indexing its stripped html', () => {
		// A sent message can have an empty body; searchableThreadText must skip stripHtml for it
		// and still index the subject so the thread is findable.
		mockSendMessage({ toList: ['grace@vercel.com'], subject: 'EmptyBodyMarker', body: '' })
		const found = mockThreads({ searchQueryNative: 'emptybodymarker' }).threads
		expect(found.map((thread) => thread.subject)).toContain('EmptyBodyMarker')
	})
})

describe('dev mock contact store', () => {
	const mailbox = createDevMailbox()

	it('returns every seeded contact when the query is blank', () => {
		const all = mockContactList('')
		expect(all.length).toBeGreaterThanOrEqual(4)
		expect(all.map((contact) => contact.given_name)).toContain('Mina')
	})

	it('filters by name, email, or company across the seed data', () => {
		// A contact with no company_name still matches on name/email — contactHaystack drops the
		// missing field rather than indexing "undefined".
		expect(mockContactList('northwind').map((contact) => contact.given_name)).toEqual(['Mina'])
		expect(mockContactList('sam@example.com').map((contact) => contact.given_name)).toEqual(['Sam'])
		expect(mockContactList('zzzz')).toEqual([])
	})

	it('caps results through the client only when a limit is supplied', async () => {
		const unlimited = await mailbox.listContacts()
		const capped = await mailbox.listContacts({ limit: 1 })
		expect(unlimited.data.length).toBeGreaterThan(1)
		expect(capped.data).toHaveLength(1)
	})

	it('scopes the client contact search to the email query parameter', async () => {
		const res = await mailbox.listContacts({ email: 'mina' })
		expect(res.data.map((contact) => contact.given_name)).toEqual(['Mina'])
	})

	it('creates, reads, updates, and deletes a contact through the store writers', () => {
		const created = mockCreateContact({ given_name: 'Grace', emails: [{ email: 'grace@example.com' }] })
		expect(mockGetContact(created.id).given_name).toBe('Grace')

		const updated = mockUpdateContact(created.id, { given_name: 'Grace', job_title: 'Admiral' })
		expect(updated.job_title).toBe('Admiral')

		mockDeleteContact(created.id)
		expect(() => mockGetContact(created.id)).toThrow('Not found')
	})

	it('exposes the same lifecycle through the client surface', async () => {
		const created = await mailbox.createContact({ given_name: 'Ada' })
		const fetched = await mailbox.getContact(created.data.id)
		expect(fetched.data.given_name).toBe('Ada')

		const updated = await mailbox.updateContact(created.data.id, { given_name: 'Ada Lovelace' })
		expect(updated.data.given_name).toBe('Ada Lovelace')

		await mailbox.deleteContact(created.data.id)
		await expect(mailbox.getContact(created.data.id)).rejects.toThrow('Not found')
	})

	it('searches contacts that have no email addresses', () => {
		// contactHaystack must tolerate a contact with no emails array while filtering.
		const created = mockCreateContact({ given_name: 'Zeb', surname: 'Quist' })
		expect(mockContactList('quist').map((contact) => contact.id)).toContain(created.id)
	})

	it('reports a missing contact as not found when read or updated', () => {
		expect(() => mockGetContact('contact-missing')).toThrow('Not found')
		expect(() => mockUpdateContact('contact-missing', { given_name: 'Nobody' })).toThrow('Not found')
	})
})
