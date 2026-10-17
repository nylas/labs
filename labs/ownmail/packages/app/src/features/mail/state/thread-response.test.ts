import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getThreadMessages } = vi.hoisted(() => ({ getThreadMessages: vi.fn() }))
vi.mock('#server/fns', () => ({ getThreadMessages }))

import { composeKindForResponse, threadResponseSearch } from './thread-response.js'

const ME = 'me@x.com'
const thread = { id: 't1', subject: 'Plans' }

function detail(messages: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
	return { thread, messages, mailboxEmail: ME, ...extra }
}

const ada = {
	id: 'm1',
	subject: 'Plans',
	date: 100,
	from: [{ email: 'ada@example.com' }],
	to: [{ email: ME }, { email: 'bob@example.com' }],
	body: 'From Ada',
}
// The thread's saved reply draft is dated after Ada's message, so it sorts last.
const draft = {
	id: 'd1',
	subject: 'Re: Plans',
	date: 200,
	from: [{ email: ME }],
	to: [{ email: 'ada@example.com' }, { email: 'carol@example.com' }],
	body: 'My unsent reply',
}

describe('threadResponseSearch', () => {
	let client: QueryClient
	beforeEach(() => {
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		getThreadMessages.mockReset()
	})

	it('answers the latest sent message, never the unsent draft that sorts after it', async () => {
		getThreadMessages.mockResolvedValue(detail([ada, draft], { ownmailDraftMessageIds: ['d1'] }))

		expect(await threadResponseSearch(client, 't1', 'reply')).toEqual({
			to: 'ada@example.com',
			subject: 'Re: Plans',
			replyToMessageId: 'm1',
		})
		expect(await threadResponseSearch(client, 't1', 'reply-all')).toEqual({
			to: 'ada@example.com, bob@example.com',
			subject: 'Re: Plans',
			replyToMessageId: 'm1',
		})
		const forward = await threadResponseSearch(client, 't1', 'forward')
		expect(forward.body).toContain('From Ada')
		expect(forward.body).not.toContain('My unsent reply')
		// The thread is loaded once and then served from the reader's cache.
		expect(getThreadMessages).toHaveBeenCalledTimes(1)
	})

	it('skips a delivery report, and a plain Reply to your own latest message goes to the person you wrote to', async () => {
		const mine = {
			id: 'm2',
			subject: 'Plans',
			date: 150,
			from: [{ email: ME }],
			to: [{ email: 'bob@example.com' }],
		}
		const bounce = {
			id: 'm3',
			subject: 'Undeliverable: Plans',
			date: 160,
			from: [{ email: 'mailer-daemon@example.com' }],
			to: [{ email: ME }],
		}
		getThreadMessages.mockResolvedValue(detail([ada, mine, bounce]))

		expect(await threadResponseSearch(client, 't1', 'reply')).toEqual({
			to: 'bob@example.com',
			subject: 'Re: Plans',
			replyToMessageId: 'm2',
		})
	})

	it('leaves To empty when a plain Reply has nobody but you to go to', async () => {
		getThreadMessages.mockResolvedValue(
			detail([{ id: 'm1', subject: 'Note to self', from: [{ email: ME }], to: [{ email: ME }] }]),
		)

		expect(await threadResponseSearch(client, 't1', 'reply')).toMatchObject({
			to: '',
			replyToMessageId: 'm1',
		})
	})

	it('rejects a thread with nothing but drafts to answer', async () => {
		getThreadMessages.mockResolvedValue(detail([draft], { ownmailDraftMessageIds: ['d1'] }))

		await expect(threadResponseSearch(client, 't1', 'reply')).rejects.toThrow(
			'The thread has no message to answer.',
		)
	})

	it('rejects a thread that only partly loaded', async () => {
		getThreadMessages.mockResolvedValue(detail([ada], { failedMessageIds: ['m9'] }))

		await expect(threadResponseSearch(client, 't1', 'forward')).rejects.toThrow(
			'Part of the thread could not be loaded.',
		)
	})
})

describe('composeKindForResponse', () => {
	it('writes a reply or reply all in the thread and starts a forward afresh', () => {
		expect(composeKindForResponse('reply')).toBe('reply')
		expect(composeKindForResponse('reply-all')).toBe('reply')
		expect(composeKindForResponse('forward')).toBe('forward')
	})
})
