import type { Draft, Folder, Message, Thread } from '@nylas-labs/cli-kit/v3'
import { type InfiniteData, infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { accountScope } from '#app/lib/account-scope'
import { requireValidMailSearchQuery } from '../lib/mail-search.js'
import type { MessageHeaderFacts, ThreadHeaderFacts } from '../server/header-facts.js'

export type { MessageHeaderFacts, ThreadHeaderFacts }

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
	/** Messages of the thread that could not be loaded; the rest are shown. */
	failedMessageIds?: string[]
}

/** What the server answers for one thread, before it enters the browser cache. */
export type ThreadDetailResult = {
	thread: Thread
	messages: Message[]
	mailboxEmail: string
	ownmailDraftMessageIds?: string[]
	failedMessageIds?: string[]
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

function validCacheId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_PROVIDER_ID_LENGTH &&
		!/[\r\n]/.test(value)
	)
}

function requireCacheId(value: string, label: string): string {
	if (!validCacheId(value)) throw new Error(`Invalid ${label}`)
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

export function toMailThreadDetail(detail: ThreadDetailResult): MailThreadDetail {
	const draftMessageIds = new Set(detail.ownmailDraftMessageIds ?? [])
	const failedMessageIds = Array.isArray(detail.failedMessageIds)
		? [...new Set(detail.failedMessageIds.filter(validCacheId))]
		: []
	return {
		thread: toMailThread(detail.thread),
		messages: detail.messages.map((message) => toMailMessage(message, draftMessageIds.has(message.id))),
		mailboxEmail: detail.mailboxEmail,
		...(failedMessageIds.length > 0 ? { failedMessageIds } : {}),
	}
}

/** Every mail key starts with `['mail', <account>]`, so one inbox's folders,
 * lists and conversations can never be read as another's. The kind of entry
 * and its argument follow at `MAIL_KEY_KIND` and `MAIL_KEY_ARGUMENT`. */
export const MAIL_KEY_KIND = 2
export const MAIL_KEY_ARGUMENT = 3

export const mailKeys = {
	get all() {
		return ['mail', accountScope()] as const
	},
	folders: () => [...mailKeys.all, 'folders'] as const,
	drafts: () => [...mailKeys.all, 'drafts'] as const,
	draft: (draftId: string) => [...mailKeys.all, 'draft', requireCacheId(draftId, 'draft')] as const,
	threadLists: () => [...mailKeys.all, 'threads'] as const,
	threadList: (filters: MailThreadFilters = {}) =>
		[...mailKeys.all, 'threads', normalizeMailThreadFilters(filters)] as const,
	threadDetails: () => [...mailKeys.all, 'thread'] as const,
	threadDetail: (threadId: string) =>
		[...mailKeys.all, 'thread', requireCacheId(threadId, 'thread')] as const,
	/** Which messages of a thread carry a List-Unsubscribe header (Conversation view only). */
	threadListUnsubscribe: (threadId: string) =>
		[...mailKeys.all, 'thread-list-unsubscribe', requireCacheId(threadId, 'thread')] as const,
	/** Facts derived from a thread's headers: authentication, Reply-To, list, sender time zone. */
	threadHeaderFacts: (threadId: string) =>
		[...mailKeys.all, 'thread-header-facts', requireCacheId(threadId, 'thread')] as const,
	/** One message's raw header block, fetched only for "Show raw headers". */
	messageRawHeaders: (messageId: string) =>
		[...mailKeys.all, 'message-raw-headers', requireCacheId(messageId, 'message')] as const,
}

/**
 * Kinds of read-only lookups: no cache effect writes them, so nothing needs to
 * cancel them (the thread list's per-row unread summary is one of them).
 */
export const MAIL_HEADER_LOOKUP_KINDS: ReadonlySet<string> = new Set([
	'thread-list-unsubscribe',
	'thread-header-facts',
	'message-raw-headers',
	'thread-unread-summary',
])

/**
 * The ids of a thread's messages that declare themselves bulk mail. Headers do
 * not change, so one answer per account and thread is kept for the session; a
 * failed lookup is not retried, and the Conversation view then classifies on
 * the message bodies alone.
 */
export function threadListUnsubscribeQueryOptions(
	threadId: string,
	fetchMessageIds: (threadId: string) => Promise<string[]>,
) {
	const safeThreadId = requireCacheId(threadId, 'thread')
	return queryOptions({
		queryKey: mailKeys.threadListUnsubscribe(safeThreadId),
		queryFn: () => fetchMessageIds(safeThreadId),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
}

/**
 * The header facts of a thread's messages. Headers do not change, so one
 * answer per account and thread is kept for the session, like the
 * List-Unsubscribe lookup; a failed lookup is not retried and the reader then
 * shows messages without those facts.
 */
export function threadHeaderFactsQueryOptions(
	threadId: string,
	fetchFacts: (threadId: string) => Promise<ThreadHeaderFacts>,
) {
	const safeThreadId = requireCacheId(threadId, 'thread')
	return queryOptions({
		queryKey: mailKeys.threadHeaderFacts(safeThreadId),
		queryFn: () => fetchFacts(safeThreadId),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
}

/** The facts for one message, or none when the lookup has not answered for it. */
export function messageHeaderFactsFor(
	facts: ThreadHeaderFacts | undefined,
	messageId: string,
): MessageHeaderFacts | undefined {
	return facts && Object.hasOwn(facts.byMessage, messageId) ? facts.byMessage[messageId] : undefined
}

/**
 * One message's raw header text. Fetched only when the reader asks to see it
 * and kept briefly: the text is sender-controlled and only shown, never parsed
 * by the client.
 */
export function messageRawHeadersQueryOptions(
	messageId: string,
	fetchHeaders: (messageId: string) => Promise<{ text: string }>,
) {
	const safeMessageId = requireCacheId(messageId, 'message')
	return queryOptions({
		queryKey: mailKeys.messageRawHeaders(safeMessageId),
		queryFn: async () => (await fetchHeaders(safeMessageId)).text,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 60_000,
		retry: false,
	})
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
	fetchDetail: (threadId: string) => Promise<ThreadDetailResult>,
) {
	const safeThreadId = requireCacheId(threadId, 'thread')
	return queryOptions({
		queryKey: mailKeys.threadDetail(safeThreadId),
		queryFn: async () => toMailThreadDetail(await fetchDetail(safeThreadId)),
		// Offline, a conversation that is not saved on this device fails at once
		// (the reader says so, with Try again) instead of waiting, paused, for a
		// connection behind a loading skeleton.
		networkMode: 'always',
	})
}
