import type { Draft, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
	draftQueryOptions,
	draftsQueryOptions,
	foldersQueryOptions,
	mailKeys,
	normalizeMailThreadFilters,
	threadDetailQueryOptions,
	threadListQueryOptions,
	toMailDraft,
	toMailFolder,
	toMailMessage,
	toMailThread,
	toMailThreadDetail,
} from './mail-queries.js'

const message: Message = {
	id: 'm1',
	grant_id: 'must-not-enter-cache',
	thread_id: 't1',
	subject: 'Hello',
}
const thread: Thread = {
	id: 't1',
	grant_id: 'must-not-enter-cache',
	latest_draft_or_message: message,
	folders: ['inbox'],
}
const draft: Draft = { ...message, id: 'd1' }
const folder: Folder = { id: 'inbox', grant_id: 'must-not-enter-cache', name: 'Inbox' }

describe('mail query cache boundaries', () => {
	it('normalizes stable filters and query keys', () => {
		expect(normalizeMailThreadFilters({ folderId: 'inbox', q: 'roadmap', starred: false })).toEqual({
			folderId: 'inbox',
			q: 'roadmap',
			starred: false,
		})
		expect(normalizeMailThreadFilters({})).toEqual({})
		expect(mailKeys.all).toEqual(['mail'])
		expect(mailKeys.folders()).toEqual(['mail', 'folders'])
		expect(mailKeys.drafts()).toEqual(['mail', 'drafts'])
		expect(mailKeys.draft('d1')).toEqual(['mail', 'draft', 'd1'])
		expect(mailKeys.threadLists()).toEqual(['mail', 'threads'])
		expect(mailKeys.threadList()).toEqual(['mail', 'threads', {}])
		expect(mailKeys.threadDetails()).toEqual(['mail', 'thread'])
		expect(mailKeys.threadDetail('t1')).toEqual(['mail', 'thread', 't1'])
	})

	it('fails closed on malformed filters and provider identifiers', () => {
		expect(() => normalizeMailThreadFilters({ q: 'x'.repeat(501) })).toThrow('Search query too long')
		expect(() => normalizeMailThreadFilters({ q: 1 as unknown as string })).toThrow('Search query too long')
		expect(() => normalizeMailThreadFilters({ starred: 'yes' as unknown as boolean })).toThrow(
			'Invalid starred filter',
		)
		for (const id of ['', 'x'.repeat(1001), 'bad\nid']) {
			expect(() => mailKeys.threadDetail(id)).toThrow('Invalid thread')
		}
		expect(() => mailKeys.draft('bad\rdraft')).toThrow('Invalid draft')
		expect(() => mailKeys.threadList({ folderId: '' })).toThrow('Invalid folder')
	})

	it('strips grant ids from every cached mail shape', () => {
		expect(toMailMessage(message)).toEqual({ id: 'm1', thread_id: 't1', subject: 'Hello' })
		expect(toMailDraft(draft)).toEqual({ id: 'd1', thread_id: 't1', subject: 'Hello' })
		expect(toMailFolder(folder)).toEqual({ id: 'inbox', name: 'Inbox' })
		expect(toMailThread(thread)).toEqual({
			id: 't1',
			folders: ['inbox'],
			latest_draft_or_message: { id: 'm1', thread_id: 't1', subject: 'Hello' },
		})
		expect(toMailThread({ ...thread, latest_draft_or_message: undefined })).toEqual({
			id: 't1',
			folders: ['inbox'],
		})
		expect(
			toMailThreadDetail({
				thread,
				messages: [message],
				mailboxEmail: 'me@example.com',
				markedRead: false,
			}),
		).toEqual({
			thread: toMailThread(thread),
			messages: [toMailMessage(message)],
			mailboxEmail: 'me@example.com',
			markedRead: false,
		})
		expect(toMailThreadDetail({ thread, messages: [], mailboxEmail: 'me@example.com' })).not.toHaveProperty(
			'markedRead',
		)
	})

	it('builds executable finite query options with sanitized results', async () => {
		const client = new QueryClient()
		await expect(client.fetchQuery(foldersQueryOptions(async () => [folder]))).resolves.toEqual([
			{ id: 'inbox', name: 'Inbox' },
		])
		await expect(client.fetchQuery(draftsQueryOptions(async () => [draft]))).resolves.toEqual([
			toMailDraft(draft),
		])
		await expect(
			client.fetchQuery(draftQueryOptions('d1', async (id) => ({ ...draft, id }))),
		).resolves.toEqual(toMailDraft(draft))
		await expect(
			client.fetchQuery(
				threadDetailQueryOptions('t1', async (id) => ({
					thread: { ...thread, id },
					messages: [message],
					mailboxEmail: 'me@example.com',
				})),
			),
		).resolves.toEqual({
			thread: toMailThread(thread),
			messages: [toMailMessage(message)],
			mailboxEmail: 'me@example.com',
		})
	})

	it('builds paginated thread options without putting page tokens in the query key', async () => {
		const fetchPage = vi.fn(async (input: { folderId?: string; pageToken?: string }) => ({
			threads: [thread],
			...(input.pageToken ? {} : { nextCursor: 'next' }),
		}))
		const options = threadListQueryOptions({ folderId: 'inbox' }, fetchPage)
		const first = await new QueryClient().fetchInfiniteQuery(options)
		expect(options.queryKey).toEqual(['mail', 'threads', { folderId: 'inbox' }])
		expect(fetchPage).toHaveBeenCalledWith({ folderId: 'inbox' })
		expect(first.pages[0]).toEqual({ threads: [toMailThread(thread)], nextCursor: 'next' })
		const firstPage = first.pages[0]
		if (!firstPage) throw new Error('Expected first thread page')
		expect(options.getNextPageParam?.(firstPage, first.pages, undefined, first.pageParams)).toBe('next')

		const nextOptions = { ...options, initialPageParam: 'next' }
		const next = await new QueryClient().fetchInfiniteQuery(nextOptions)
		expect(fetchPage).toHaveBeenLastCalledWith({ folderId: 'inbox', pageToken: 'next' })
		expect(next.pages[0]).toEqual({ threads: [toMailThread(thread)] })

		await expect(
			new QueryClient().fetchInfiniteQuery({ ...options, initialPageParam: 'bad\ntoken' }),
		).rejects.toThrow('Invalid page token')
	})
})
