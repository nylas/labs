import type { Draft, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { type InfiniteData, infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { requireValidMailSearchQuery } from '../lib/mail-search.js'

const MAX_PROVIDER_ID_LENGTH = 1000

/** Mail entities safe to keep in the browser cache. Provider grant identifiers are
 * deliberately removed at the query boundary and are never persisted. */
export type MailMessage = Omit<Message, 'grant_id' | 'ownmailDraft'> & {
	/** Server-attested provenance for messages synthesized from the drafts endpoint. */
	ownmailDraft?: true
	/** Server-attested signed proxy tokens keyed by inline attachment id. */
	ownmailImageTokens?: Record<string, string>
}
export type MailDraft = Omit<Draft, 'grant_id'>
export type MailThread = Omit<Thread, 'grant_id' | 'latest_draft_or_message'> & {
	latest_draft_or_message?: MailMessage
}
export type MailFolder = Omit<Folder, 'grant_id'>

export type MailThreadPage = { threads: MailThread[]; nextCursor?: string }
export type MailThreadListData = InfiniteData<MailThreadPage, string | undefined>
export type MailThreadDetail = {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail: string
	markedRead?: boolean
}

export type MailThreadFilters = {
	folderId?: string
	q?: string
	starred?: boolean
}

export type ThreadPageFetcher = (input: MailThreadFilters & { pageToken?: string }) => Promise<{
	threads: Thread[]
	nextCursor?: string
}>

function requireCacheId(value: string, label: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > MAX_PROVIDER_ID_LENGTH ||
		/[\r\n]/.test(value)
	) {
		throw new Error(`Invalid ${label}`)
	}
	return value
}

export function normalizeMailThreadFilters(input: MailThreadFilters): MailThreadFilters {
	const q = input.q !== undefined ? requireValidMailSearchQuery(input.q) : undefined
	if (input.starred !== undefined && typeof input.starred !== 'boolean') {
		throw new Error('Invalid starred filter')
	}
	return {
		...(input.folderId !== undefined ? { folderId: requireCacheId(input.folderId, 'folder') } : {}),
		...(q !== undefined ? { q } : {}),
		...(input.starred !== undefined ? { starred: input.starred } : {}),
	}
}

export function toMailMessage(message: Message, ownmailDraft = false): MailMessage {
	// Provider objects are untrusted at this boundary. Explicitly discard a
	// lookalike marker before attaching provenance supplied by our server result.
	const {
		grant_id: _grantId,
		ownmailDraft: _providerMarker,
		ownmailImageTokens: providerImageTokens,
		ownmailImagesAttested: imageAttestation,
		...safe
	} = message as Message & {
		ownmailDraft?: unknown
		ownmailImageTokens?: unknown
		ownmailImagesAttested?: unknown
	}
	const ownmailImageTokens =
		imageAttestation === true ? validImageTokenMap(providerImageTokens, message.attachments ?? []) : undefined
	return {
		...safe,
		...(ownmailDraft ? { ownmailDraft: true as const } : {}),
		...(ownmailImageTokens ? { ownmailImageTokens } : {}),
	}
}

function validImageTokenMap(
	value: unknown,
	attachments: NonNullable<Message['attachments']>,
): Record<string, string> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
	const inlineIds = new Set(
		attachments.filter((attachment) => attachment.is_inline).map((attachment) => attachment.id),
	)
	const entries = Object.entries(value)
	if (entries.length === 0 || entries.length > 100) return undefined
	const tokens: Record<string, string> = {}
	for (const [attachmentId, token] of entries) {
		if (
			!inlineIds.has(attachmentId) ||
			typeof token !== 'string' ||
			token.length > 12_000 ||
			!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
		) {
			return undefined
		}
		tokens[attachmentId] = token
	}
	return tokens
}

export function toMailDraft(draft: Draft): MailDraft {
	const { grant_id: _grantId, ...safe } = draft
	return safe
}

export function toMailThread(thread: Thread): MailThread {
	const { grant_id: _grantId, latest_draft_or_message: latest, ...safe } = thread
	return {
		...safe,
		...(latest ? { latest_draft_or_message: toMailMessage(latest) } : {}),
	}
}

export function toMailFolder(folder: Folder): MailFolder {
	const { grant_id: _grantId, ...safe } = folder
	return safe
}

export function toMailThreadDetail(detail: {
	thread: Thread
	messages: Message[]
	mailboxEmail: string
	markedRead?: boolean
	ownmailDraftMessageIds?: string[]
}): MailThreadDetail {
	const draftMessageIds = new Set(detail.ownmailDraftMessageIds ?? [])
	return {
		thread: toMailThread(detail.thread),
		messages: detail.messages.map((message) => toMailMessage(message, draftMessageIds.has(message.id))),
		mailboxEmail: detail.mailboxEmail,
		...(detail.markedRead !== undefined ? { markedRead: detail.markedRead } : {}),
	}
}

export const mailKeys = {
	all: ['mail'] as const,
	folders: () => ['mail', 'folders'] as const,
	drafts: () => ['mail', 'drafts'] as const,
	draft: (draftId: string) => ['mail', 'draft', requireCacheId(draftId, 'draft')] as const,
	threadLists: () => ['mail', 'threads'] as const,
	threadList: (filters: MailThreadFilters = {}) =>
		['mail', 'threads', normalizeMailThreadFilters(filters)] as const,
	threadDetails: () => ['mail', 'thread'] as const,
	threadDetail: (threadId: string) => ['mail', 'thread', requireCacheId(threadId, 'thread')] as const,
}

export function foldersQueryOptions(fetchFolders: () => Promise<Folder[]>) {
	return queryOptions({
		queryKey: mailKeys.folders(),
		queryFn: async () => (await fetchFolders()).map(toMailFolder),
	})
}

export function draftsQueryOptions(fetchDrafts: () => Promise<Draft[]>) {
	return queryOptions({
		queryKey: mailKeys.drafts(),
		queryFn: async () => (await fetchDrafts()).map(toMailDraft),
	})
}

export function draftQueryOptions(draftId: string, fetchDraft: (draftId: string) => Promise<Draft>) {
	const safeDraftId = requireCacheId(draftId, 'draft')
	return queryOptions({
		queryKey: mailKeys.draft(safeDraftId),
		queryFn: async () => toMailDraft(await fetchDraft(safeDraftId)),
	})
}

export function threadListQueryOptions(filters: MailThreadFilters, fetchPage: ThreadPageFetcher) {
	const safeFilters = normalizeMailThreadFilters(filters)
	return infiniteQueryOptions({
		queryKey: mailKeys.threadList(safeFilters),
		initialPageParam: undefined as string | undefined,
		queryFn: async ({ pageParam }) => {
			const result = await fetchPage({
				...safeFilters,
				...(pageParam !== undefined ? { pageToken: requireCacheId(pageParam, 'page token') } : {}),
			})
			return {
				threads: result.threads.map(toMailThread),
				...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
			}
		},
		getNextPageParam: (lastPage) => lastPage.nextCursor,
	})
}

export function threadDetailQueryOptions(
	threadId: string,
	fetchDetail: (threadId: string) => Promise<{
		thread: Thread
		messages: Message[]
		mailboxEmail: string
		markedRead?: boolean
		ownmailDraftMessageIds?: string[]
	}>,
) {
	const safeThreadId = requireCacheId(threadId, 'thread')
	return queryOptions({
		queryKey: mailKeys.threadDetail(safeThreadId),
		queryFn: async () => toMailThreadDetail(await fetchDetail(safeThreadId)),
	})
}
