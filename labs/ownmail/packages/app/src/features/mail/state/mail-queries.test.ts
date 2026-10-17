import type { Draft, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { accountScope, SERVER_ACCOUNT_SCOPE } from '#app/lib/account-scope'
import {
	draftQueryOptions,
	draftsQueryOptions,
	foldersQueryOptions,
	MAIL_KEY_ARGUMENT,
	MAIL_KEY_KIND,
	mailKeys,
	messageHeaderFactsFor,
	messageRawHeadersQueryOptions,
	normalizeMailThreadFilters,
	threadDetailQueryOptions,
	threadHeaderFactsQueryOptions,
	threadListQueryOptions,
	threadListUnsubscribeQueryOptions,
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
	it('keeps the header lookup of a thread per account, asks once, and never retries a failure', async () => {
		// The answer says which messages are bulk mail. It belongs to one inbox's
		// thread: another account opening a thread with the same id must not read it.
		const fetchIds = vi.fn(async (threadId: string) => [`${threadId}-newsletter`])
		const options = threadListUnsubscribeQueryOptions('t1', fetchIds)
		expect(options.queryKey).toEqual(['mail', accountScope(), 'thread-list-unsubscribe', 't1'])
		expect(mailKeys.threadListUnsubscribe('t1')).toEqual(options.queryKey)
		expect(options.staleTime).toBe(Number.POSITIVE_INFINITY)
		expect(options.retry).toBe(false)

		const queryClient = new QueryClient()
		expect(await queryClient.fetchQuery(options)).toEqual(['t1-newsletter'])
		expect(await queryClient.fetchQuery(options)).toEqual(['t1-newsletter'])
		expect(fetchIds).toHaveBeenCalledTimes(1)
		expect(() => threadListUnsubscribeQueryOptions('bad\nid', fetchIds)).toThrow()
	})

	it('keeps header facts per account and thread for the session and never retries a failure', async () => {
		const facts = { byMessage: { m1: { verified: true, authFailed: false, listUnsubscribe: false } } }
		const fetchFacts = vi.fn(async () => facts)
		const options = threadHeaderFactsQueryOptions('t1', fetchFacts)
		expect(options.queryKey).toEqual(['mail', accountScope(), 'thread-header-facts', 't1'])
		expect(mailKeys.threadHeaderFacts('t1')).toEqual(options.queryKey)
		expect(options.staleTime).toBe(Number.POSITIVE_INFINITY)
		expect(options.retry).toBe(false)

		const queryClient = new QueryClient()
		expect(await queryClient.fetchQuery(options)).toEqual(facts)
		await queryClient.fetchQuery(options)
		expect(fetchFacts).toHaveBeenCalledTimes(1)
		expect(fetchFacts).toHaveBeenCalledWith('t1')
		expect(() => threadHeaderFactsQueryOptions('bad\nid', fetchFacts)).toThrow()

		expect(messageHeaderFactsFor(facts, 'm1')?.verified).toBe(true)
		expect(messageHeaderFactsFor(facts, 'toString')).toBeUndefined()
		expect(messageHeaderFactsFor(undefined, 'm1')).toBeUndefined()
	})

	it('fetches raw headers per account and message only on request and keeps them briefly', async () => {
		const fetchHeaders = vi.fn(async () => ({ text: 'From: a@b.co' }))
		const options = messageRawHeadersQueryOptions('m1', fetchHeaders)
		expect(options.queryKey).toEqual(['mail', accountScope(), 'message-raw-headers', 'm1'])
		expect(mailKeys.messageRawHeaders('m1')).toEqual(options.queryKey)
		expect(options.retry).toBe(false)
		expect(options.gcTime).toBe(60_000)
		expect(await new QueryClient().fetchQuery(options)).toBe('From: a@b.co')
		expect(fetchHeaders).toHaveBeenCalledWith('m1')
		expect(() => messageRawHeadersQueryOptions('', fetchHeaders)).toThrow('Invalid message')
	})

	it('carries the ids of messages that failed to load into the cache, validated', () => {
		const detail = toMailThreadDetail({
			thread,
			messages: [message],
			mailboxEmail: 'ada@example.com',
			failedMessageIds: ['m2', 'm2', 'bad\nid', '', 7 as never, 'm3'],
		})
		expect(detail.failedMessageIds).toEqual(['m2', 'm3'])
		expect(
			toMailThreadDetail({ thread, messages: [], mailboxEmail: 'a@b.co', failedMessageIds: 'm2' as never }),
		).not.toHaveProperty('failedMessageIds')
		expect(
			toMailThreadDetail({ thread, messages: [], mailboxEmail: 'a@b.co', failedMessageIds: [] }),
		).not.toHaveProperty('failedMessageIds')
	})

	it('normalizes stable filters and query keys', () => {
		expect(normalizeMailThreadFilters({ folderId: 'inbox', q: 'roadmap', starred: false })).toEqual({
			folderId: 'inbox',
			q: 'roadmap',
			starred: false,
		})
		expect(normalizeMailThreadFilters({})).toEqual({})
		// Every key is rooted in the account, so one inbox's entries can never
		// be read as another's. (Server rendering uses a fixed segment.)
		const account = accountScope()
		expect(account).toBe(SERVER_ACCOUNT_SCOPE)
		expect(mailKeys.all).toEqual(['mail', account])
		expect(mailKeys.folders()).toEqual(['mail', account, 'folders'])
		expect(mailKeys.drafts()).toEqual(['mail', account, 'drafts'])
		expect(mailKeys.draft('d1')).toEqual(['mail', account, 'draft', 'd1'])
		expect(mailKeys.threadLists()).toEqual(['mail', account, 'threads'])
		expect(mailKeys.threadList()).toEqual(['mail', account, 'threads', {}])
		expect(mailKeys.threadDetails()).toEqual(['mail', account, 'thread'])
		expect(mailKeys.threadDetail('t1')).toEqual(['mail', account, 'thread', 't1'])
		expect(mailKeys.threadDetail('t1')[MAIL_KEY_KIND]).toBe('thread')
		expect(mailKeys.threadDetail('t1')[MAIL_KEY_ARGUMENT]).toBe('t1')
	})

	it('fails closed on malformed filters and provider identifiers', () => {
		expect(() => normalizeMailThreadFilters({ q: 'x'.repeat(513) })).toThrow('Invalid search query')
		expect(() => normalizeMailThreadFilters({ q: 'subject:roadmap' })).toThrow('Invalid search query')
		expect(() => normalizeMailThreadFilters({ q: 1 as unknown as string })).toThrow('Invalid search query')
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
			}),
		).toEqual({
			thread: toMailThread(thread),
			messages: [toMailMessage(message)],
			mailboxEmail: 'me@example.com',
		})
	})

	it('strips provider-injected draft provenance and only accepts server-attested ids', () => {
		const providerSpoof = { ...message, ownmailDraft: true } as Message

		expect(toMailMessage(providerSpoof)).not.toHaveProperty('ownmailDraft')
		expect(toMailThread({ ...thread, latest_draft_or_message: providerSpoof })).toEqual({
			id: 't1',
			folders: ['inbox'],
			latest_draft_or_message: { id: 'm1', thread_id: 't1', subject: 'Hello' },
		})
		expect(
			toMailThreadDetail({
				thread,
				messages: [providerSpoof],
				mailboxEmail: 'me@example.com',
			}),
		).toMatchObject({ messages: [{ id: 'm1', subject: 'Hello' }] })
		expect(
			toMailThreadDetail({
				thread,
				messages: [providerSpoof],
				mailboxEmail: 'me@example.com',
				ownmailDraftMessageIds: ['m1'],
			}),
		).toMatchObject({ messages: [{ id: 'm1', subject: 'Hello', ownmailDraft: true }] })
	})

	it('accepts only bounded server-attested inline image token maps', () => {
		const attachmentMessage = {
			...message,
			attachments: [{ id: 'inline-1', is_inline: true }],
			ownmailImagesAttested: true,
			ownmailImageTokens: { 'inline-1': 'signed.payload' },
		} as unknown as Message
		expect(toMailMessage(attachmentMessage).ownmailImageTokens).toEqual({
			'inline-1': 'signed.payload',
		})
		expect(
			toMailMessage({
				...attachmentMessage,
				ownmailImagesAttested: false,
			} as unknown as Message),
		).not.toHaveProperty('ownmailImageTokens')
		expect(
			toMailMessage({
				...attachmentMessage,
				ownmailImageTokens: { unknown: 'signed.payload' },
			} as unknown as Message),
		).not.toHaveProperty('ownmailImageTokens')
	})

	it('rejects absent, empty, and oversized attested image token maps', () => {
		const base = {
			...message,
			attachments: [{ id: 'inline-1', is_inline: true }],
			ownmailImagesAttested: true,
		}
		const oversized = Object.fromEntries(
			Array.from({ length: 101 }, (_, index) => [`inline-${index}`, 'signed.payload']),
		)
		for (const ownmailImageTokens of [null, [], {}, oversized]) {
			expect(toMailMessage({ ...base, ownmailImageTokens } as never)).not.toHaveProperty('ownmailImageTokens')
		}
		expect(
			toMailMessage({ ...message, ownmailImagesAttested: true, ownmailImageTokens: {} } as never),
		).not.toHaveProperty('ownmailImageTokens')
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

	it('loads a conversation even offline, so one not saved on this device fails instead of waiting', async () => {
		const options = threadDetailQueryOptions('t1', async () => {
			throw new Error('offline')
		})
		expect(options.networkMode).toBe('always')
		onlineManager.setOnline(false)
		try {
			await expect(new QueryClient().fetchQuery({ ...options, retry: false })).rejects.toThrow('offline')
		} finally {
			onlineManager.setOnline(true)
		}
	})

	it('builds paginated thread options without putting page tokens in the query key', async () => {
		const fetchPage = vi.fn(async (input: { folderId?: string; pageToken?: string }) => ({
			threads: [thread],
			...(input.pageToken ? {} : { nextCursor: 'next' }),
		}))
		const options = threadListQueryOptions({ folderId: 'inbox' }, fetchPage)
		const first = await new QueryClient().fetchInfiniteQuery(options)
		expect(options.queryKey).toEqual(mailKeys.threadList({ folderId: 'inbox' }))
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
