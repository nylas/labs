import { beforeEach, describe, expect, it } from 'vitest'
import { messageBodyParagraphs } from '../components/ui-model.js'
import {
	devMailboxEmail,
	devMailboxName,
	mockDrafts,
	mockEvents,
	mockSaveDraft,
	mockSendDraft,
	mockSendMessage,
	mockThreadMessages,
	mockThreads,
	mockUpdateThreadState,
	resetDevMocks,
} from './dev-mocks.js'

beforeEach(() => {
	resetDevMocks()
})

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

	it('resets mutated mailbox state for fresh reference-style page loads', () => {
		mockUpdateThreadState({ threadId: 'thread-roadmap', unread: false, starred: false, folder: 'archive' })
		expect(mockThreads({ folderId: 'inbox' }).threads.filter((thread) => thread.unread)).toHaveLength(1)
		expect(mockThreads({ starred: true }).threads.map((thread) => thread.id)).not.toContain('thread-roadmap')

		resetDevMocks()

		const inboxThreads = mockThreads({ folderId: 'inbox' }).threads
		expect(inboxThreads.filter((thread) => thread.unread)).toHaveLength(2)
		expect(inboxThreads.map((thread) => thread.id)).toContain('thread-roadmap')
		expect(mockThreads({ starred: true }).threads.map((thread) => thread.id)).toContain('thread-roadmap')
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
})
