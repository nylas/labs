import type { Message } from '@nylas-labs/cli-kit/v3'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
	type MailDraft,
	type MailFolder,
	type MailMessage,
	type MailThread,
	type MailThreadDetail,
	type MailThreadFilters,
	type MailThreadListData,
	mailKeys,
	toMailMessage,
} from './mail-queries.js'

type FolderReceipt = { folders?: MailFolder[] }

export type MailCacheEffect =
	| ({ type: 'draft.saved'; draft: MailDraft; created: boolean } & FolderReceipt)
	| ({ type: 'draft.sent'; draftId: string; message?: MailMessage; thread?: MailThread } & FolderReceipt)
	| ({ type: 'draft.deleted'; draftId: string } & FolderReceipt)
	| ({ type: 'thread.starred'; threadId: string; starred: boolean; thread?: MailThread } & FolderReceipt)
	| ({ type: 'thread.read'; threadId: string; unread: boolean; thread?: MailThread } & FolderReceipt)
	| ({ type: 'thread.moved'; threadId: string; targetFolderId: string; thread?: MailThread } & FolderReceipt)
	| ({ type: 'thread.reconciled'; thread: MailThread } & FolderReceipt)
	| { type: 'folders.reconciled'; folders: MailFolder[] }

export type MailCacheSnapshot = ReadonlyArray<readonly [QueryKey, unknown]>

const SYSTEM_FOLDER_IDS = new Set(['inbox', 'sent', 'drafts', 'archive', 'trash', 'junk', 'spam', 'starred'])

function clampCount(value: number | undefined, delta: number): number {
	return Math.max(0, (value ?? 0) + delta)
}

function unique(values: readonly string[] | undefined): string[] {
	return [...new Set(values ?? [])]
}

export function threadFoldersAfterCacheMove(
	currentFolders: readonly string[] | undefined,
	targetFolderId: string,
): string[] {
	const replacingSystemFolder = SYSTEM_FOLDER_IDS.has(targetFolderId)
	return [
		targetFolderId,
		...unique(currentFolders).filter(
			(folderId) =>
				folderId !== targetFolderId && (!replacingSystemFolder || !SYSTEM_FOLDER_IDS.has(folderId)),
		),
	]
}

export function sentThreadFromMessage(message: MailMessage): MailThread {
	return {
		id: message.thread_id ?? message.id,
		subject: message.subject,
		snippet: message.snippet,
		participants: message.to,
		message_ids: [message.id],
		latest_draft_or_message: message,
		latest_message_sent_date: message.date,
		has_attachments: Boolean(message.attachments?.length),
		unread: false,
		starred: message.starred ?? false,
		folders: unique([...(message.folders ?? []), 'sent']),
	}
}

export function dedupeThreads(threads: readonly MailThread[]): MailThread[] {
	const seen = new Set<string>()
	return threads.filter((thread) => {
		if (seen.has(thread.id)) return false
		seen.add(thread.id)
		return true
	})
}

export function dedupeThreadPages(data: MailThreadListData): MailThreadListData {
	const seen = new Set<string>()
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			threads: page.threads.filter((thread) => {
				if (seen.has(thread.id)) return false
				seen.add(thread.id)
				return true
			}),
		})),
	}
}

function threadMatchesFilter(thread: MailThread, filters: MailThreadFilters): boolean {
	if (filters.folderId !== undefined && !thread.folders?.includes(filters.folderId)) return false
	if (filters.starred !== undefined && Boolean(thread.starred) !== filters.starred) return false
	return true
}

export function updateThreadList(
	data: MailThreadListData,
	filters: MailThreadFilters,
	threadId: string,
	nextThread: MailThread | undefined,
): MailThreadListData {
	const existed = data.pages.some((page) => page.threads.some((thread) => thread.id === threadId))
	const canInsert = filters.q === undefined
	const shouldInclude = nextThread !== undefined && threadMatchesFilter(nextThread, filters)
	const pages = data.pages.map((page) => ({
		...page,
		threads: page.threads.flatMap((thread) => {
			if (thread.id !== threadId) return [thread]
			return shouldInclude ? [nextThread] : []
		}),
	}))
	if (!existed && canInsert && shouldInclude) {
		const firstPage = pages[0]
		if (firstPage) pages[0] = { ...firstPage, threads: [nextThread, ...firstPage.threads] }
	}
	return dedupeThreadPages({ ...data, pages })
}

function effectThreadId(effect: MailCacheEffect): string | undefined {
	switch (effect.type) {
		case 'thread.starred':
		case 'thread.read':
		case 'thread.moved':
			return effect.threadId
		case 'thread.reconciled':
			return effect.thread.id
		default:
			return undefined
	}
}

function nextThreadForEffect(effect: MailCacheEffect, current?: MailThread): MailThread | undefined {
	switch (effect.type) {
		case 'draft.sent':
			return effect.thread ?? (effect.message ? sentThreadFromMessage(effect.message) : undefined)
		case 'thread.reconciled':
			return effect.thread
		case 'thread.starred': {
			if (effect.thread) return effect.thread
			const source = current
			return source ? { ...source, starred: effect.starred } : undefined
		}
		case 'thread.read': {
			if (effect.thread) return effect.thread
			const source = current
			return source ? { ...source, unread: effect.unread } : undefined
		}
		case 'thread.moved': {
			if (effect.thread) return effect.thread
			const source = current
			return source
				? { ...source, folders: threadFoldersAfterCacheMove(source.folders, effect.targetFolderId) }
				: undefined
		}
		/* v8 ignore next 2 -- callers only invoke this helper for the cases above */
		default:
			return undefined
	}
}

export function updateDrafts(drafts: readonly MailDraft[], effect: MailCacheEffect): MailDraft[] {
	switch (effect.type) {
		case 'draft.saved':
			return [effect.draft, ...drafts.filter((draft) => draft.id !== effect.draft.id)]
		case 'draft.sent':
			return drafts.filter((draft) => draft.id !== effect.draftId)
		case 'draft.deleted':
			return drafts.filter((draft) => draft.id !== effect.draftId)
		default:
			return [...drafts]
	}
}

function folderTransition(
	folders: readonly MailFolder[],
	before: MailThread | undefined,
	after: MailThread | undefined,
): MailFolder[] {
	if (!before && !after) return [...folders]
	const beforeFolders = new Set(before?.folders ?? [])
	const afterFolders = new Set(after?.folders ?? [])
	const beforeUnread = Boolean(before?.unread)
	const afterUnread = Boolean(after?.unread)
	return folders.map((folder) => {
		const wasMember = beforeFolders.has(folder.id)
		const isMember = afterFolders.has(folder.id)
		const totalDelta = Number(isMember) - Number(wasMember)
		const unreadDelta = Number(isMember && afterUnread) - Number(wasMember && beforeUnread)
		return {
			...folder,
			...(totalDelta !== 0 ? { total_count: clampCount(folder.total_count, totalDelta) } : {}),
			...(unreadDelta !== 0 ? { unread_count: clampCount(folder.unread_count, unreadDelta) } : {}),
		}
	})
}

export function updateFolderCounts(
	folders: readonly MailFolder[],
	effect: MailCacheEffect,
	beforeThread?: MailThread,
): MailFolder[] {
	if (effect.type === 'folders.reconciled') return [...effect.folders]
	if (effect.folders) return [...effect.folders]
	switch (effect.type) {
		case 'draft.saved':
			if (!effect.created) return [...folders]
			return folders.map((folder) =>
				folder.id === 'drafts' ? { ...folder, total_count: clampCount(folder.total_count, 1) } : folder,
			)
		case 'draft.sent': {
			const sentThread = nextThreadForEffect(effect)
			return folderTransition(
				folders.map((folder) =>
					folder.id === 'drafts' ? { ...folder, total_count: clampCount(folder.total_count, -1) } : folder,
				),
				undefined,
				sentThread,
			)
		}
		case 'draft.deleted':
			return folders.map((folder) =>
				folder.id === 'drafts' ? { ...folder, total_count: clampCount(folder.total_count, -1) } : folder,
			)
		case 'thread.starred': {
			const beforeStarred = Boolean(beforeThread?.starred)
			const delta = Number(effect.starred) - Number(beforeStarred)
			if (delta === 0) return [...folders]
			return folders.map((folder) =>
				folder.id === 'starred' ? { ...folder, total_count: clampCount(folder.total_count, delta) } : folder,
			)
		}
		case 'thread.read':
		case 'thread.moved':
		case 'thread.reconciled':
			return folderTransition(folders, beforeThread, nextThreadForEffect(effect, beforeThread))
	}
}

function keyPart(queryKey: QueryKey, index: number): unknown {
	return queryKey[index]
}

function isMailKey(queryKey: QueryKey, kind: string): boolean {
	return keyPart(queryKey, 0) === 'mail' && keyPart(queryKey, 1) === kind
}

function keyFilters(queryKey: QueryKey): MailThreadFilters {
	const value = keyPart(queryKey, 2)
	return value && typeof value === 'object' ? (value as MailThreadFilters) : {}
}

function entryThread(data: unknown, queryKey: QueryKey, threadId: string): MailThread | undefined {
	if (isMailKey(queryKey, 'thread')) {
		return (data as MailThreadDetail | undefined)?.thread.id === threadId
			? (data as MailThreadDetail).thread
			: undefined
	}
	if (isMailKey(queryKey, 'threads')) {
		return (data as MailThreadListData | undefined)?.pages
			.flatMap((page) => page.threads)
			.find((thread) => thread.id === threadId)
	}
	return undefined
}

export function findCachedThread(client: QueryClient, threadId: string): MailThread | undefined {
	for (const [queryKey, data] of client.getQueriesData({ queryKey: mailKeys.all })) {
		const thread = entryThread(data, queryKey, threadId)
		if (thread) return thread
	}
	return undefined
}

export function reduceMailCacheEntry(
	queryKey: QueryKey,
	data: unknown,
	effect: MailCacheEffect,
	beforeThread?: MailThread,
): unknown {
	if (data === undefined) return data
	if (isMailKey(queryKey, 'folders')) {
		return updateFolderCounts(data as MailFolder[], effect, beforeThread)
	}
	if (isMailKey(queryKey, 'drafts')) return updateDrafts(data as MailDraft[], effect)
	if (isMailKey(queryKey, 'draft')) {
		const draft = data as MailDraft
		const cachedDraftId = keyPart(queryKey, 2)
		if (effect.type === 'draft.saved' && cachedDraftId === effect.draft.id && draft.id === effect.draft.id) {
			return effect.draft
		}
		if (
			(effect.type === 'draft.sent' || effect.type === 'draft.deleted') &&
			cachedDraftId === effect.draftId &&
			draft.id === effect.draftId
		) {
			return undefined
		}
		return data
	}
	if (isMailKey(queryKey, 'thread')) {
		const detail = data as MailThreadDetail
		const id = effectThreadId(effect)
		if (!id || detail.thread.id !== id) return data
		const nextThread = nextThreadForEffect(effect, detail.thread)
		/* v8 ignore next -- a matching thread effect always has the cached detail as its source */
		if (!nextThread) return data
		return { ...detail, thread: nextThread }
	}
	if (isMailKey(queryKey, 'threads')) {
		const list = data as MailThreadListData
		if (effect.type === 'draft.sent') {
			const sentThread = nextThreadForEffect(effect)
			return sentThread ? updateThreadList(list, keyFilters(queryKey), sentThread.id, sentThread) : data
		}
		const id = effectThreadId(effect)
		if (!id) return data
		const current = list.pages.flatMap((page) => page.threads).find((thread) => thread.id === id)
		return updateThreadList(
			list,
			keyFilters(queryKey),
			id,
			nextThreadForEffect(effect, current ?? beforeThread),
		)
	}
	return data
}

export function applyMailCacheEffect(client: QueryClient, inputEffect: MailCacheEffect): void {
	const effect = inputEffect
	const threadId = effectThreadId(effect)
	const beforeThread = threadId ? findCachedThread(client, threadId) : undefined
	for (const [queryKey, data] of client.getQueriesData({ queryKey: mailKeys.all })) {
		const next = reduceMailCacheEntry(queryKey, data, effect, beforeThread)
		if (next === undefined && data !== undefined) {
			client.removeQueries({ queryKey, exact: true })
		} else if (next !== data) {
			client.setQueryData(queryKey, next)
		}
	}
}

export function captureMailCacheSnapshot(client: QueryClient): MailCacheSnapshot {
	return client
		.getQueriesData({ queryKey: mailKeys.all })
		.map(([queryKey, data]) => [queryKey, data] as const)
}

export function restoreMailCacheSnapshot(client: QueryClient, snapshot: MailCacheSnapshot): void {
	for (const [queryKey, data] of snapshot) client.setQueryData(queryKey, data)
}

export type MailOptimisticOperation = {
	id: number
	commit(reconciledEffect?: MailCacheEffect): boolean
	rollback(): boolean
}

type JournalEntry = {
	id: number
	effect: MailCacheEffect
	status: 'pending' | 'confirmed'
}

/** A per-QueryClient optimistic journal. Rebuilding from the base snapshot and
 * replaying surviving effects prevents one failed request from rolling back a
 * newer, unrelated optimistic change. */
export function createMailOptimisticManager(client: QueryClient) {
	let nextId = 1
	let base: MailCacheSnapshot | undefined
	let entries: JournalEntry[] = []

	function rebuild() {
		/* v8 ignore next -- rebuild is private and is only called after begin captures the base */
		if (!base) return
		restoreMailCacheSnapshot(client, base)
		for (const entry of entries) applyMailCacheEffect(client, entry.effect)
	}

	function finishIfSettled() {
		if (entries.some((entry) => entry.status === 'pending')) return
		entries = []
		base = undefined
	}

	return {
		async begin(effect: MailCacheEffect): Promise<MailOptimisticOperation> {
			await client.cancelQueries({ queryKey: mailKeys.all })
			base ??= captureMailCacheSnapshot(client)
			const entry: JournalEntry = { id: nextId++, effect, status: 'pending' }
			entries.push(entry)
			applyMailCacheEffect(client, effect)
			let settled = false
			return {
				id: entry.id,
				commit(reconciledEffect) {
					if (settled) return false
					settled = true
					entry.status = 'confirmed'
					if (reconciledEffect) entry.effect = reconciledEffect
					rebuild()
					finishIfSettled()
					return true
				},
				rollback() {
					if (settled) return false
					settled = true
					entries = entries.filter((candidate) => candidate !== entry)
					rebuild()
					finishIfSettled()
					return true
				},
			}
		},
		pendingCount() {
			return entries.filter((entry) => entry.status === 'pending').length
		},
	}
}

/** Convert a canonical provider send result without retaining its grant id. */
export function safeSentMessage(message: Message): MailMessage {
	return toMailMessage(message)
}
