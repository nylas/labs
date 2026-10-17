import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => {
		let validator: ((input: unknown) => unknown) | undefined
		const api = {
			validator(fn: (input: unknown) => unknown) {
				validator = fn
				return api
			},
			handler(fn: (context: { data: unknown }) => unknown) {
				return (options?: { data?: unknown }) =>
					fn({ data: validator ? validator(options?.data) : options?.data })
			},
		}
		return api
	},
}))

const { requireMailbox, listMessages } = vi.hoisted(() => ({
	requireMailbox: vi.fn(),
	listMessages: vi.fn(),
}))
vi.mock('#server/mailbox-boundary', async (importOriginal) => ({
	...(await importOriginal<typeof import('#server/mailbox-boundary')>()),
	requireMailbox: () => requireMailbox(),
}))

const { getThreadUnreadSummary, UNREAD_SUMMARY_LOOKUP_LIMIT } = await import('./thread-list-functions.js')

const ADA = { name: 'Ada Lovelace', email: 'ada@ownmail.com' }
const GRACE = { name: 'Grace Hopper', email: 'grace@vercel.com' }

beforeEach(() => {
	listMessages.mockReset()
	requireMailbox.mockReset().mockResolvedValue({ mailbox: { listMessages }, email: ADA.email })
})

describe('getThreadUnreadSummary', () => {
	it('lists one thread’s messages without bodies and counts what is unread, with the newest file', async () => {
		listMessages.mockResolvedValue({
			data: [
				{
					id: 'v4',
					thread_id: 't1',
					unread: true,
					date: 300,
					from: [GRACE],
					attachments: [
						{ id: 'a4', filename: 'Q3-roadmap-v4.pdf', size: 2_100_000, content_type: 'application/pdf' },
					],
				},
				{ id: 'm2', thread_id: 't1', unread: true, date: 200, from: [GRACE] },
				{ id: 'm1', thread_id: 't1', unread: false, date: 100, from: [ADA] },
				// Never counted: another thread's message, a nameless entry, nothing at all.
				{ id: 'x', thread_id: 'other', unread: true, date: 400, from: [GRACE] },
				{ thread_id: 't1', unread: true },
				null,
			],
		})
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({
			unreadCount: 2,
			newestFile: 'Q3-roadmap-v4.pdf',
		})
		expect(listMessages).toHaveBeenCalledWith({
			thread_id: 't1',
			select: 'id,thread_id,unread,date,from,attachments',
			limit: UNREAD_SUMMARY_LOOKUP_LIMIT,
		})
	})

	it('names no file when there is none, and counts nothing from an unexpected answer', async () => {
		listMessages.mockResolvedValue({ data: [{ id: 'm1', thread_id: 't1', unread: true, from: [GRACE] }] })
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({ unreadCount: 1 })
		listMessages.mockResolvedValue({ data: 'unexpected' })
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({ unreadCount: 0 })
	})

	it('rejects a bad thread id and says a failed lookup failed, in words a person can read', async () => {
		expect(() => getThreadUnreadSummary({ data: { threadId: 'bad\nid' } })).toThrow('Invalid thread')
		listMessages.mockRejectedValue(new NylasApiError('rate limited', 429))
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).rejects.toThrow(/./)
		expect(requireMailbox).toHaveBeenCalled()
	})
})
