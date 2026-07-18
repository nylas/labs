import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
	applyMailCacheEffect,
	captureMailCacheSnapshot,
	createMailOptimisticManager,
	dedupeThreadPages,
	dedupeThreads,
	findCachedThread,
	type MailCacheEffect,
	reduceMailCacheEntry,
	restoreMailCacheSnapshot,
	safeSentMessage,
	sentThreadFromMessage,
	threadFoldersAfterCacheMove,
	updateDrafts,
	updateFolderCounts,
	updateThreadList,
} from './mail-cache.js'
import {
	type MailDraft,
	type MailFolder,
	type MailMessage,
	type MailThread,
	type MailThreadDetail,
	type MailThreadListData,
	mailKeys,
} from './mail-queries.js'

const t1: MailThread = {
	id: 't1',
	subject: 'First',
	unread: true,
	starred: false,
	folders: ['inbox', 'work'],
}
const d1: MailDraft = { id: 'd1', thread_id: 'draft-thread', subject: 'Draft' }
const folders: MailFolder[] = [
	{ id: 'inbox', name: 'Inbox', total_count: 2, unread_count: 1 },
	{ id: 'work', name: 'Work', total_count: 1, unread_count: 1 },
	{ id: 'starred', name: 'Starred', total_count: 0, unread_count: 0 },
	{ id: 'drafts', name: 'Drafts', total_count: 1, unread_count: 0 },
	{ id: 'sent', name: 'Sent', total_count: 0, unread_count: 0 },
	{ id: 'trash', name: 'Trash', total_count: 0, unread_count: 0 },
]

function list(...threads: MailThread[]): MailThreadListData {
	return { pages: [{ threads, nextCursor: 'next' }], pageParams: [undefined] }
}

function seedClient() {
	const client = new QueryClient()
	client.setQueryData(mailKeys.folders(), folders)
	client.setQueryData(mailKeys.drafts(), [d1])
	client.setQueryData(mailKeys.draft('d1'), d1)
	client.setQueryData(mailKeys.threadList({ folderId: 'inbox' }), list(t1))
	client.setQueryData(mailKeys.threadList({ folderId: 'work' }), list(t1))
	client.setQueryData(mailKeys.threadList({ starred: true }), list())
	client.setQueryData(mailKeys.threadList({ folderId: 'sent' }), list())
	client.setQueryData(mailKeys.threadList({ folderId: 'trash' }), list())
	client.setQueryData(mailKeys.threadList({ q: 'First' }), list(t1))
	client.setQueryData(mailKeys.threadDetail('t1'), {
		thread: t1,
		messages: [],
		mailboxEmail: 'me@example.com',
	} satisfies MailThreadDetail)
	return client
}

function cachedFolders(client: QueryClient) {
	const value = client.getQueryData<MailFolder[]>(mailKeys.folders())
	if (!value) throw new Error('Expected seeded folder cache')
	return value
}

function cachedList(client: QueryClient, filters: Parameters<typeof mailKeys.threadList>[0]) {
	const value = client.getQueryData<MailThreadListData>(mailKeys.threadList(filters))
	if (!value) throw new Error('Expected seeded thread-list cache')
	return value
}

describe('mail cache collection reducers', () => {
	it('deduplicates flat and paginated results while retaining the first occurrence', () => {
		const newer = { ...t1, subject: 'Newer' }
		expect(dedupeThreads([t1, newer])).toEqual([t1])
		expect(
			dedupeThreadPages({
				pages: [{ threads: [t1], nextCursor: '2' }, { threads: [newer, { ...t1, id: 't2' }] }],
				pageParams: [undefined, '2'],
			}).pages.map((page) => page.threads.map((thread) => thread.id)),
		).toEqual([['t1'], ['t2']])
	})

	it('patches, removes, and inserts threads according to filters', () => {
		const paged: MailThreadListData = {
			pages: [{ threads: [t1] }, { threads: [{ ...t1 }, { ...t1, id: 't2' }] }],
			pageParams: [undefined, 'next'],
		}
		const starred = { ...t1, starred: true }
		expect(updateThreadList(paged, { starred: true }, 't1', starred).pages[0]?.threads).toEqual([starred])
		expect(updateThreadList(list(t1), { starred: true }, 't1', t1).pages[0]?.threads).toEqual([])
		expect(updateThreadList(list(), { folderId: 'inbox' }, 't1', t1).pages[0]?.threads).toEqual([t1])
		expect(updateThreadList(list(), { q: 'First' }, 't1', t1).pages[0]?.threads).toEqual([])
		expect(updateThreadList({ pages: [], pageParams: [] }, {}, 't1', t1).pages).toEqual([])
		expect(updateThreadList(list(t1), {}, 't1', undefined).pages[0]?.threads).toEqual([])
	})

	it('keeps custom labels while moving between system folders', () => {
		expect(threadFoldersAfterCacheMove(['inbox', 'work', 'trash', 'work'], 'archive')).toEqual([
			'archive',
			'work',
		])
		expect(threadFoldersAfterCacheMove(undefined, 'project')).toEqual(['project'])
		expect(threadFoldersAfterCacheMove(['inbox', 'project'], 'project')).toEqual(['project', 'inbox'])
	})

	it('upserts saved drafts and removes sent or deleted drafts', () => {
		const saved = { ...d1, subject: 'Saved' }
		expect(updateDrafts([d1], { type: 'draft.saved', draft: saved, created: false })).toEqual([saved])
		expect(updateDrafts([d1], { type: 'draft.sent', draftId: 'd1' })).toEqual([])
		expect(updateDrafts([d1], { type: 'draft.deleted', draftId: 'd1' })).toEqual([])
		expect(updateDrafts([d1], { type: 'folders.reconciled', folders })).toEqual([d1])
	})
})

describe('mail folder count transitions', () => {
	it('updates draft counts and clamps stale counts at zero', () => {
		expect(
			updateFolderCounts(folders, { type: 'draft.saved', draft: d1, created: true }).find(
				(folder) => folder.id === 'drafts',
			)?.total_count,
		).toBe(2)
		expect(updateFolderCounts(folders, { type: 'draft.saved', draft: d1, created: false })).toEqual(folders)
		expect(
			updateFolderCounts([{ id: 'drafts', name: 'Drafts', total_count: 0 }], {
				type: 'draft.deleted',
				draftId: 'd1',
			})[0]?.total_count,
		).toBe(0)
		expect(
			updateFolderCounts([{ id: 'drafts', name: 'Drafts' }], {
				type: 'draft.saved',
				draft: d1,
				created: true,
			})[0]?.total_count,
		).toBe(1)
	})

	it('moves a sent draft from Drafts to Sent exactly once', () => {
		const message: MailMessage = {
			id: 'm2',
			thread_id: 't2',
			to: [{ email: 'you@example.com' }],
			date: 123,
			attachments: [{ id: 'a1' }],
		}
		const sent = sentThreadFromMessage(message)
		expect(sent).toMatchObject({
			id: 't2',
			folders: ['sent'],
			latest_message_sent_date: 123,
			has_attachments: true,
			unread: false,
			starred: false,
		})
		const updated = updateFolderCounts(folders, { type: 'draft.sent', draftId: 'd1', message })
		expect(updated.find((folder) => folder.id === 'drafts')?.total_count).toBe(0)
		expect(updated.find((folder) => folder.id === 'sent')?.total_count).toBe(1)
		expect(
			sentThreadFromMessage({ id: 'm3', folders: ['sent'], starred: true, subject: 'Hi' }),
		).toMatchObject({ id: 'm3', folders: ['sent'], starred: true, subject: 'Hi' })
		const canonicalThread = { ...sent, subject: 'Canonical sent' }
		expect(
			updateFolderCounts(folders, {
				type: 'draft.sent',
				draftId: 'd1',
				thread: canonicalThread,
			}).find((folder) => folder.id === 'sent')?.total_count,
		).toBe(1)
		expect(
			updateFolderCounts(folders, { type: 'draft.sent', draftId: 'd1' }).find(
				(folder) => folder.id === 'sent',
			)?.total_count,
		).toBe(0)
	})

	it('updates star, read, and move counts from before/after membership', () => {
		const starred = updateFolderCounts(folders, { type: 'thread.starred', threadId: 't1', starred: true }, t1)
		expect(starred.find((folder) => folder.id === 'starred')?.total_count).toBe(1)
		expect(
			updateFolderCounts(
				starred,
				{ type: 'thread.starred', threadId: 't1', starred: true },
				{
					...t1,
					starred: true,
				},
			),
		).toEqual(starred)
		const read = updateFolderCounts(folders, { type: 'thread.read', threadId: 't1', unread: false }, t1)
		expect(read.find((folder) => folder.id === 'inbox')?.unread_count).toBe(0)
		expect(read.find((folder) => folder.id === 'work')?.unread_count).toBe(0)
		const moved = updateFolderCounts(
			folders,
			{ type: 'thread.moved', threadId: 't1', targetFolderId: 'trash' },
			t1,
		)
		expect(moved.find((folder) => folder.id === 'inbox')).toMatchObject({
			total_count: 1,
			unread_count: 0,
		})
		expect(moved.find((folder) => folder.id === 'trash')).toMatchObject({
			total_count: 1,
			unread_count: 1,
		})
		expect(moved.find((folder) => folder.id === 'work')).toMatchObject({
			total_count: 1,
			unread_count: 1,
		})
		expect(
			updateFolderCounts(
				folders,
				{ type: 'thread.reconciled', thread: { ...t1, folders: undefined } },
				t1,
			).find((folder) => folder.id === 'inbox')?.total_count,
		).toBe(1)
	})

	it('prefers canonical folder receipts over optimistic deltas', () => {
		const canonical = [{ id: 'drafts', name: 'Drafts', total_count: 99 }]
		expect(
			updateFolderCounts(folders, {
				type: 'draft.deleted',
				draftId: 'd1',
				folders: canonical,
			}),
		).toEqual(canonical)
		expect(updateFolderCounts(folders, { type: 'folders.reconciled', folders: canonical })).toEqual(canonical)
		expect(updateFolderCounts(folders, { type: 'thread.reconciled', thread: t1 }, t1)).toEqual(folders)
	})
})

describe('mail query cache effects', () => {
	it('synchronizes star, read, and move effects across detail, lists, searches, and counts', () => {
		const client = seedClient()
		expect(findCachedThread(client, 't1')).toEqual(t1)
		expect(findCachedThread(client, 'missing')).toBeUndefined()

		applyMailCacheEffect(client, { type: 'thread.starred', threadId: 't1', starred: true })
		expect(cachedList(client, { starred: true }).pages[0]?.threads[0]?.starred).toBe(true)
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads[0]?.starred).toBe(true)
		expect(cachedFolders(client).find((folder) => folder.id === 'starred')?.total_count).toBe(1)

		applyMailCacheEffect(client, { type: 'thread.read', threadId: 't1', unread: false })
		expect(client.getQueryData<MailThreadDetail>(mailKeys.threadDetail('t1'))?.thread.unread).toBe(false)
		expect(cachedList(client, { q: 'First' }).pages[0]?.threads[0]?.unread).toBe(false)
		expect(cachedFolders(client).find((folder) => folder.id === 'inbox')?.unread_count).toBe(0)

		applyMailCacheEffect(client, { type: 'thread.moved', threadId: 't1', targetFolderId: 'trash' })
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads).toEqual([])
		expect(cachedList(client, { folderId: 'trash' }).pages[0]?.threads[0]?.folders).toEqual(['trash', 'work'])
		expect(cachedList(client, { starred: true }).pages[0]?.threads).toHaveLength(1)
	})

	it('synchronizes draft save, send, and delete with draft detail and sent membership', () => {
		const client = seedClient()
		const d2: MailDraft = { id: 'd2', subject: 'Second draft' }
		applyMailCacheEffect(client, { type: 'draft.saved', draft: d2, created: true })
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())?.map((draft) => draft.id)).toEqual([
			'd2',
			'd1',
		])
		expect(cachedFolders(client).find((folder) => folder.id === 'drafts')?.total_count).toBe(2)

		const sentMessage: MailMessage = { id: 'm2', thread_id: 't2', folders: ['sent'] }
		applyMailCacheEffect(client, { type: 'draft.sent', draftId: 'd1', message: sentMessage })
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())?.map((draft) => draft.id)).toEqual(['d2'])
		expect(client.getQueryData(mailKeys.draft('d1'))).toBeUndefined()
		expect(cachedList(client, { folderId: 'sent' }).pages[0]?.threads[0]?.id).toBe('t2')

		applyMailCacheEffect(client, { type: 'draft.deleted', draftId: 'd2' })
		expect(client.getQueryData<MailDraft[]>(mailKeys.drafts())).toEqual([])
	})

	it('reconciles canonical threads and folders and ignores unrelated cache entries', () => {
		const client = seedClient()
		client.setQueryData(['not-mail'], { unchanged: true })
		const canonical = { ...t1, subject: 'Canonical', unread: false }
		applyMailCacheEffect(client, { type: 'thread.reconciled', thread: canonical })
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads[0]?.subject).toBe('Canonical')
		const nextFolders = [{ id: 'inbox', name: 'Inbox', total_count: 10 }]
		applyMailCacheEffect(client, { type: 'folders.reconciled', folders: nextFolders })
		expect(cachedFolders(client)).toEqual(nextFolders)
		expect(client.getQueryData(['not-mail'])).toEqual({ unchanged: true })
	})

	it('reduces absent and unrelated entries without creating cache data', () => {
		const effect: MailCacheEffect = { type: 'draft.deleted', draftId: 'd1' }
		expect(reduceMailCacheEntry(['mail', 'draft', 'other'], d1, effect)).toEqual(d1)
		expect(reduceMailCacheEntry(['elsewhere'], { value: true }, effect)).toEqual({ value: true })
		expect(reduceMailCacheEntry(mailKeys.drafts(), undefined, effect)).toBeUndefined()
		expect(
			reduceMailCacheEntry(
				mailKeys.threadDetail('t1'),
				{
					thread: t1,
					messages: [],
					mailboxEmail: 'me@example.com',
				},
				effect,
			),
		).toMatchObject({ thread: t1 })
		expect(reduceMailCacheEntry(mailKeys.threadList({ folderId: 'sent' }), list(), effect)).toEqual(list())
		expect(
			reduceMailCacheEntry(mailKeys.draft('d1'), d1, {
				type: 'draft.saved',
				draft: { ...d1, subject: 'Updated' },
				created: false,
			}),
		).toMatchObject({ subject: 'Updated' })
		expect(
			reduceMailCacheEntry(['mail', 'threads'], list(), {
				type: 'thread.reconciled',
				thread: t1,
			}),
		).toEqual(list(t1))
		expect(
			reduceMailCacheEntry(mailKeys.threadList({ folderId: 'sent' }), list(), {
				type: 'draft.sent',
				draftId: 'd1',
			}),
		).toEqual(list())
		expect(
			reduceMailCacheEntry(mailKeys.threadList({ starred: true }), list(), {
				type: 'thread.starred',
				threadId: 'missing',
				starred: true,
			}),
		).toEqual(list())
		for (const missingEffect of [
			{ type: 'thread.read', threadId: 'missing', unread: false },
			{ type: 'thread.moved', threadId: 'missing', targetFolderId: 'trash' },
		] satisfies MailCacheEffect[]) {
			expect(reduceMailCacheEntry(mailKeys.threadList({}), list(), missingEffect)).toEqual(list())
		}
	})

	it('finds a thread held only in its detail query', () => {
		const client = new QueryClient()
		client.setQueryData(mailKeys.threadDetail('t1'), {
			thread: t1,
			messages: [],
			mailboxEmail: 'me@example.com',
		} satisfies MailThreadDetail)
		expect(findCachedThread(client, 't1')).toEqual(t1)
	})

	it('uses canonical thread payloads for star, read, and move reconciliation', () => {
		const canonical = { ...t1, subject: 'Canonical' }
		for (const effect of [
			{ type: 'thread.starred', threadId: 't1', starred: true, thread: canonical },
			{ type: 'thread.read', threadId: 't1', unread: false, thread: canonical },
			{ type: 'thread.moved', threadId: 't1', targetFolderId: 'trash', thread: canonical },
		] satisfies MailCacheEffect[]) {
			const result = reduceMailCacheEntry(mailKeys.threadList({ folderId: 'inbox' }), list(t1), effect)
			expect((result as MailThreadListData).pages[0]?.threads[0]?.subject).toBe('Canonical')
		}
	})
})

describe('mail optimistic transaction journal', () => {
	it('captures and restores rollback snapshots', () => {
		const client = seedClient()
		const snapshot = captureMailCacheSnapshot(client)
		applyMailCacheEffect(client, { type: 'thread.starred', threadId: 't1', starred: true })
		restoreMailCacheSnapshot(client, snapshot)
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads[0]?.starred).toBe(false)
	})

	it('rolls back one failed operation without erasing a newer optimistic operation', async () => {
		const client = seedClient()
		const manager = createMailOptimisticManager(client)
		const star = await manager.begin({ type: 'thread.starred', threadId: 't1', starred: true })
		const read = await manager.begin({ type: 'thread.read', threadId: 't1', unread: false })
		expect(manager.pendingCount()).toBe(2)
		expect(star.rollback()).toBe(true)
		expect(star.rollback()).toBe(false)
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads[0]).toMatchObject({
			starred: false,
			unread: false,
		})
		expect(read.commit()).toBe(true)
		expect(read.commit()).toBe(false)
		expect(manager.pendingCount()).toBe(0)
	})

	it('replaces optimistic state with a canonical receipt while other work is pending', async () => {
		const client = seedClient()
		const manager = createMailOptimisticManager(client)
		const star = await manager.begin({ type: 'thread.starred', threadId: 't1', starred: true })
		const read = await manager.begin({ type: 'thread.read', threadId: 't1', unread: false })
		const canonical = { ...t1, starred: true, subject: 'From server' }
		expect(star.commit({ type: 'thread.reconciled', thread: canonical })).toBe(true)
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads[0]).toMatchObject({
			subject: 'From server',
			unread: false,
		})
		expect(read.rollback()).toBe(true)
		expect(read.rollback()).toBe(false)
		expect(cachedList(client, { folderId: 'inbox' }).pages[0]?.threads[0]).toMatchObject({
			subject: 'From server',
			unread: true,
			starred: true,
		})
	})

	it('sanitizes provider send receipts before caching', () => {
		expect(safeSentMessage({ id: 'm1', grant_id: 'secret-grant', thread_id: 't1' })).toEqual({
			id: 'm1',
			thread_id: 't1',
		})
	})
})
