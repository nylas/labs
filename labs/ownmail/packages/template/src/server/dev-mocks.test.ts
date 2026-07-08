import { describe, expect, it } from 'vitest'
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
		const draft = mockDrafts()[0]

		expect(roadmap?.subject).toBe('Q3 product roadmap — final review before Monday')
		expect(roadmap?.snippet).toBe('Thanks Grace — this is great.')
		expect(travel?.snippet).toContain('8:40 AM — SFO to LIS')
		expect(draft?.body).toBe('Here are a few ideas for the offsite —')
	})

	it('preserves reference calendar event copy', () => {
		const now = Math.floor(Date.now() / 1000)
		const { events } = mockEvents({ start: now - 86_400, end: now + 86_400 })
		const roadmap = events.find((event) => event.id === 'event-roadmap-review')

		expect(roadmap?.location).toBe('Meet — Aurora room')
	})
})
