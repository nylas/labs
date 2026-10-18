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

const { getThreadUnreadSummary } = await import('./thread-list-functions.js')
const { THREAD_MAX_PAGES, THREAD_PAGE_SIZE } = await import('./thread-message-pages.js')

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
			limit: THREAD_PAGE_SIZE,
		})
	})

	it('names no file when there is none, and answers nothing from an unexpected answer', async () => {
		listMessages.mockResolvedValue({ data: [{ id: 'm1', thread_id: 't1', unread: true, from: [GRACE] }] })
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({ unreadCount: 1 })
		listMessages.mockResolvedValue({ data: 'unexpected' })
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).rejects.toThrow(/./)
	})

	const page = (from: number, unread: (index: number) => boolean) =>
		Array.from({ length: THREAD_PAGE_SIZE }, (_, offset) => ({
			id: `m${from + offset}`,
			thread_id: 't1',
			unread: unread(from + offset),
			date: 10_000 - from - offset,
			from: [GRACE],
		}))

	it('follows the cursor past the first page, counting a message seen twice once', async () => {
		listMessages
			.mockResolvedValueOnce({ data: page(0, () => true), next_cursor: 'c1' })
			.mockResolvedValueOnce({
				data: [
					{ id: 'm0', thread_id: 't1', unread: true, from: [GRACE] },
					{ id: 'late', thread_id: 't1', unread: true, from: [GRACE] },
				],
			})
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({
			unreadCount: THREAD_PAGE_SIZE + 1,
		})
		expect(listMessages).toHaveBeenLastCalledWith({
			thread_id: 't1',
			select: 'id,thread_id,unread,date,from,attachments',
			limit: THREAD_PAGE_SIZE,
			page_token: 'c1',
		})
	})

	it('says the count is a floor only when it stopped at its cap with everything it read unread', async () => {
		listMessages.mockImplementation(async (query: { page_token?: string }) => {
			const index = Number(query.page_token ?? 0)
			return { data: page(index * THREAD_PAGE_SIZE, () => true), next_cursor: String(index + 1) }
		})
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({
			unreadCount: THREAD_PAGE_SIZE * THREAD_MAX_PAGES,
			moreUnread: true,
		})
		expect(listMessages).toHaveBeenCalledTimes(THREAD_MAX_PAGES)
		// A read message among them means the unread run ended inside the cap.
		listMessages.mockImplementation(async (query: { page_token?: string }) => {
			const index = Number(query.page_token ?? 0)
			return { data: page(index * THREAD_PAGE_SIZE, (n) => n < 120), next_cursor: String(index + 1) }
		})
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).resolves.toEqual({ unreadCount: 120 })
	})

	it('rejects a bad thread id and says a failed lookup failed, in words a person can read', async () => {
		expect(() => getThreadUnreadSummary({ data: { threadId: 'bad\nid' } })).toThrow('Invalid thread')
		listMessages.mockRejectedValue(new NylasApiError('rate limited', 429))
		await expect(getThreadUnreadSummary({ data: { threadId: 't1' } })).rejects.toThrow(/./)
		expect(requireMailbox).toHaveBeenCalled()
	})
})
