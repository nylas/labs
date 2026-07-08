import { describe, expect, it } from 'vitest'
import { messageBodyParagraphs } from '../components/ui-model.js'
import {
	devMailboxEmail,
	devMailboxName,
	mockDrafts,
	mockEvents,
	mockThreadMessages,
	mockThreads,
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
		const dentist = mockThreads({ folderId: 'inbox' }).threads.find(
			(thread) => thread.id === 'thread-dentist',
		)
		const draft = mockDrafts()[0]

		expect(roadmap?.subject).toBe('Q3 product roadmap — final review before Monday')
		expect(roadmap?.snippet).toBe('Thanks Grace — this is great.')
		expect(travel?.snippet).toBe('Your trip is booked!')
		expect(tokens?.snippet).toBe(
			'The v3 token set is live in the shared library. Highlights: refined spacing scale, new elevation tokens, and a proper focus ring.',
		)
		expect(dentist?.snippet).toBe(
			'This is a friendly reminder about your upcoming cleaning with Dr. Reyes on Thursday at 2:00 PM.',
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

	it('models starred as an account-wide thread query', () => {
		const starred = mockThreads({ starred: true }).threads

		expect(starred.map((thread) => thread.id)).toEqual(
			mockThreads({ folderId: 'starred' }).threads.map((thread) => thread.id),
		)
		expect(starred.every((thread) => thread.starred)).toBe(true)
	})

	it('models Agent Account thread search by subject or participant email', () => {
		expect(mockThreads({ subject: 'roadmap' }).threads.map((thread) => thread.id)).toContain('thread-roadmap')
		expect(mockThreads({ anyEmail: 'grace@vercel.com' }).threads.map((thread) => thread.id)).toContain(
			'thread-roadmap',
		)
		expect(mockThreads({ subject: '8:40 AM' }).threads.map((thread) => thread.id)).not.toContain(
			'thread-travel',
		)
	})

	it('preserves reference calendar event copy', () => {
		const now = Math.floor(Date.now() / 1000)
		const { events } = mockEvents({ start: now - 86_400, end: now + 7 * 86_400 })
		const roadmap = events.find((event) => event.id === 'event-roadmap-review')
		const dentist = events.find((event) => event.id === 'event-dentist')

		expect(roadmap?.location).toBe('Meet — Aurora room')
		expect(dentist?.title).toBe('Dentist — Dr. Reyes')
	})
})
