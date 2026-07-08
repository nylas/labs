import { describe, expect, it } from 'vitest'
import { devMailboxEmail, devMailboxName, mockThreadMessages } from './dev-mocks.js'

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
})
