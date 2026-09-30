import type { Folder, Thread } from '@nylas-labs/cli-kit/v3'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { mailMutationTestApi, resetMailOptimisticJournal } from './mail-mutations.js'

describe('mail mutation receipt effects', () => {
	it('maps a server-side draft removal and canonical folder counts into one cache effect', () => {
		const folders = [{ id: 'drafts', grant_id: 'private-grant', total_count: 0 }] as Folder[]
		expect(
			mailMutationTestApi.updateThreadReceiptEffect(
				{ threadId: 'draft-1', folder: 'trash' },
				{ removedDraftId: 'draft-1', folders },
			),
		).toEqual({
			type: 'draft.deleted',
			draftId: 'draft-1',
			folders: [{ id: 'drafts', total_count: 0 }],
		})
	})

	it('maps a canonical thread receipt without caching its provider grant', () => {
		const thread = { id: 'thread-1', grant_id: 'private-grant', starred: true } as Thread
		expect(
			mailMutationTestApi.updateThreadReceiptEffect({ threadId: thread.id, starred: true }, { thread }),
		).toEqual({
			type: 'thread.starred',
			threadId: thread.id,
			starred: true,
			thread: { id: thread.id, starred: true },
		})
	})

	it('creates an unpredictable, fixed-length optimistic draft id', () => {
		const first = mailMutationTestApi.optimisticDraftId()
		const second = mailMutationTestApi.optimisticDraftId()
		expect(first).toMatch(/^optimistic-draft-[0-9a-f]{32}$/)
		expect(second).not.toBe(first)
	})

	it('includes canonical folders across move, star, read, and removal receipts', () => {
		const receiptFolders = [{ id: 'inbox', grant_id: 'private', unread_count: 0 }] as Folder[]
		expect(
			mailMutationTestApi.updateThreadEffect(
				{ threadId: 'thread-1', folder: 'archive' },
				{ folders: receiptFolders },
			),
		).toMatchObject({ type: 'thread.moved', folders: [{ id: 'inbox', unread_count: 0 }] })
		expect(
			mailMutationTestApi.updateThreadEffect(
				{ threadId: 'thread-1', starred: true },
				{ folders: receiptFolders },
			),
		).toMatchObject({ type: 'thread.starred', folders: [{ id: 'inbox', unread_count: 0 }] })
		expect(mailMutationTestApi.updateThreadEffect({ threadId: 'thread-1' })).toEqual({
			type: 'thread.read',
			threadId: 'thread-1',
			unread: false,
		})
		expect(
			mailMutationTestApi.updateThreadReceiptEffect(
				{ threadId: 'draft-1', folder: 'trash' },
				{ removedDraftId: 'draft-1' },
			),
		).toEqual({ type: 'draft.deleted', draftId: 'draft-1' })
	})
})

describe('mail optimistic journal reset', () => {
	it('gives a cleared client a fresh journal so pending work from another inbox is forgotten', async () => {
		const client = new QueryClient()
		const previous = mailMutationTestApi.managerFor(client)
		await previous.begin({ type: 'thread.read', threadId: 't1', unread: false })
		expect(previous.pendingCount()).toBe(1)

		resetMailOptimisticJournal(client)

		expect(previous.pendingCount()).toBe(0)
		expect(mailMutationTestApi.managerFor(client)).not.toBe(previous)
		// Resetting a client without a journal is a harmless no-op.
		resetMailOptimisticJournal(new QueryClient())
	})
})
