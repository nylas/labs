import type { Folder, Thread } from '@nylas-labs/cli-kit/v3'
import {
	MutationObserver,
	type QueryClient,
	type QueryKey,
	useMutation,
	useQueryClient,
} from '@tanstack/react-query'
import { useCallback } from 'react'
import type { OutboundAttachment } from '#features/mail/server/outbound-attachments'
import {
	cancelScheduledSend,
	deleteDraft,
	markMessagesRead,
	markThreadRead,
	saveDraft,
	sendDraft,
	sendScheduledNow,
	updateThreadState,
} from '#server/fns'
import {
	createMailOptimisticManager,
	findCachedThread,
	type MailCacheEffect,
	type MailOptimisticOperation,
	safeSentMessage,
} from './mail-cache.js'
import {
	type MailDraft,
	type MailThread,
	type MailThreadDetail,
	mailKeys,
	toMailDraft,
	toMailFolder,
	toMailThread,
} from './mail-queries.js'

type UpdateThreadInput = {
	threadId: string
	unread?: boolean
	starred?: boolean
	folder?: string
}

type DraftFields = {
	draftId?: string
	to: string
	/** Cc and Bcc a draft already holds; the composer carries them, it does not edit them. */
	cc?: string
	bcc?: string
	subject: string
	body: string
	replyToMessageId?: string
	attachments?: OutboundAttachment[]
	/** Names of files the draft already holds; the composer carries them, the server keeps them. */
	keepAttachments?: string[]
}

type SendDraftFields = DraftFields & { draftId: string }

type OptimisticContext = { operation: MailOptimisticOperation }

type MailOptimisticManager = ReturnType<typeof createMailOptimisticManager>

// One journal per account: an operation begun in one inbox is settled against
// that inbox's keys, whichever inbox the tab is showing when its receipt lands.
const managersByClient = new WeakMap<QueryClient, Map<string, MailOptimisticManager>>()

function managerFor(client: QueryClient) {
	let managers = managersByClient.get(client)
	if (!managers) {
		managers = new Map()
		managersByClient.set(client, managers)
	}
	const root = mailKeys.all
	let manager = managers.get(root[1])
	if (!manager) {
		manager = createMailOptimisticManager(client, root)
		managers.set(root[1], manager)
	}
	return manager
}

/** Detach the optimistic journals from a cache that is being cleared for another
 * inbox, so in-flight receipts cannot replay the previous inbox's values. */
export function resetMailOptimisticJournal(client: QueryClient): void {
	for (const manager of managersByClient.get(client)?.values() ?? []) manager.reset()
	managersByClient.delete(client)
}

function safeFolders(folders: Folder[] | undefined) {
	return folders?.map(toMailFolder)
}

function reconcileInBackground(client: QueryClient) {
	// The mutation receipt is authoritative for the immediate UI. Reconciliation
	// is deliberately detached so a later read failure cannot undo confirmed work.
	void client.invalidateQueries({ queryKey: mailKeys.all, refetchType: 'inactive' }).catch(
		/* v8 ignore next -- @preserve background reconciliation failures are intentionally detached and have no observable mutation result */
		() => {},
	)
}

function updateThreadEffect(
	input: UpdateThreadInput,
	receipt?: { thread?: Thread; folders?: Folder[] },
): MailCacheEffect {
	const canonical = receipt?.thread ? toMailThread(receipt.thread) : undefined
	const folders = safeFolders(receipt?.folders)
	if (input.folder !== undefined) {
		return {
			type: 'thread.moved',
			threadId: input.threadId,
			targetFolderId: input.folder,
			...(canonical ? { thread: canonical } : {}),
			...(folders ? { folders } : {}),
		}
	}
	if (input.starred !== undefined) {
		return {
			type: 'thread.starred',
			threadId: input.threadId,
			starred: input.starred,
			...(canonical ? { thread: canonical } : {}),
			...(folders ? { folders } : {}),
		}
	}
	return {
		type: 'thread.read',
		threadId: input.threadId,
		unread: input.unread ?? false,
		...(canonical ? { thread: canonical } : {}),
		...(folders ? { folders } : {}),
	}
}

function updateThreadReceiptEffect(
	input: UpdateThreadInput,
	receipt: { thread: Thread; folders?: Folder[] } | { removedDraftId: string; folders?: Folder[] },
): MailCacheEffect {
	if ('removedDraftId' in receipt) {
		return {
			type: 'draft.deleted',
			draftId: receipt.removedDraftId,
			...(receipt.folders ? { folders: receipt.folders.map(toMailFolder) } : {}),
		}
	}
	return updateThreadEffect(input, receipt)
}

export function useUpdateThreadMutation() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (input: UpdateThreadInput) => updateThreadState({ data: input }),
		onMutate: async (input): Promise<OptimisticContext> => ({
			operation: await managerFor(client).begin(updateThreadEffect(input)),
		}),
		onError: (_error, _input, context) => context?.operation.rollback(),
		onSuccess: (receipt, input, context) => {
			context?.operation.commit(updateThreadReceiptEffect(input, receipt))
			reconcileInBackground(client)
		},
	})
}

type ReadAttempt = { failed: boolean }

const openingReads = new WeakMap<QueryClient, Map<string, ReadAttempt>>()

/** What a loaded conversation says about itself for read state: which messages did not load. */
type LoadedForRead = { failedMessageIds?: readonly string[] }

/** Whether a loaded conversation is missing messages that could not be read. */
const partlyLoaded = (detail: LoadedForRead | undefined): boolean =>
	(detail?.failedMessageIds?.length ?? 0) > 0

/** A thread read held back because its conversation did not load in full. */
class IncompleteLoad extends Error {
	constructor() {
		super('The conversation did not load in full.')
	}
}

/** Opening an unread thread marks it read at once in every cached list, folder
 * badge, and detail, then confirms with the provider. It runs through the
 * mutation cache so it counts as pending work, and it never cancels the detail
 * fetch that is loading the same thread. Returns whether a read is in flight. */
export function markThreadReadOnOpen(
	client: QueryClient,
	threadId: string,
	knownThread?: MailThread,
): boolean {
	return startReadOnOpen(client, threadId, knownThread) !== undefined
}

/** `after`, when given, holds the request to the provider until it settles:
 * a conversation being opened is loaded first, so the provider's read cannot
 * reach the messages before the reader sees which of them were unread. The
 * thread is marked read only when that load is complete: a load that failed,
 * or left messages out, rolls the optimistic read back, so messages nobody has
 * seen keep their unread state (the reader then marks only the ones it shows,
 * `markOpenedThreadRead`). */
function startReadOnOpen(
	client: QueryClient,
	threadId: string,
	knownThread?: MailThread,
	after?: Promise<LoadedForRead | undefined>,
): ReadAttempt | undefined {
	if (typeof window === 'undefined') return undefined
	let pending = openingReads.get(client)
	if (!pending) {
		pending = new Map()
		openingReads.set(client, pending)
	}
	const existing = pending.get(threadId)
	if (existing) return existing
	const thread = knownThread ?? findCachedThread(client, threadId)
	if (!thread?.unread) return undefined
	const inFlight = pending
	const attempt: ReadAttempt = { failed: false }
	inFlight.set(threadId, attempt)
	const input = { threadId, unread: false }
	// Resolved now, so a failure that lands after an inbox switch cannot be
	// applied to a conversation in the next inbox.
	const detailKey = mailKeys.threadDetail(threadId)
	const observer = new MutationObserver(client, {
		mutationFn: async () => {
			if (after) {
				const loaded = await after
				if (!loaded || partlyLoaded(loaded)) throw new IncompleteLoad()
			}
			return markThreadRead({ data: { threadId } })
		},
		onMutate: async (): Promise<OptimisticContext> => ({
			operation: await managerFor(client).begin(updateThreadEffect(input), { preserveThreadDetails: true }),
		}),
		onError: (_error, _variables, context) => {
			attempt.failed = true
			context?.operation.rollback()
			// A detail loaded after the journal's snapshot was aligned outside it;
			// return it to unread so the reader agrees with the restored row.
			client.setQueryData<MailThreadDetail>(detailKey, (detail) =>
				detail && !detail.thread.unread ? { ...detail, thread: { ...detail.thread, unread: true } } : detail,
			)
		},
		onSuccess: (receipt, _variables, context) => {
			context?.operation.commit(updateThreadEffect(input, receipt))
			reconcileInBackground(client)
		},
		onSettled: () => inFlight.delete(threadId),
	})
	// A failed read rolls back to unread; the row returning to bold is the signal.
	void observer.mutate().catch(() => {})
	return attempt
}

/** Loads a thread for a real (non-preload) open, starting the optimistic read
 * from the cached row before the detail request so the list, folder badge, and
 * reader agree immediately. The provider is asked to mark it read only once
 * the detail has loaded in full, so the messages still say which were unread
 * (the reader's "new since" divider is built from them). The loaded detail is
 * aligned with the read, unless that read has already failed or the detail is
 * missing messages (then the thread stays unread everywhere). */
export async function openThreadDetail<T extends { thread: { unread?: boolean } } & LoadedForRead>(
	client: QueryClient,
	threadId: string,
	{
		preload,
		queryKey,
		cacheAs = (detail) => detail,
	}: { preload: boolean; queryKey?: QueryKey; cacheAs?: (detail: T) => unknown },
	load: () => Promise<T>,
): Promise<T> {
	let loaded!: (detail: T | undefined) => void
	const gate = new Promise<T | undefined>((resolve) => (loaded = resolve))
	const attempt = preload ? undefined : startReadOnOpen(client, threadId, undefined, gate)
	const detail = await load().then(
		(value) => {
			loaded(value)
			return value
		},
		(error: unknown) => {
			loaded(undefined)
			throw error
		},
	)
	if (!attempt || attempt.failed || !detail.thread.unread || partlyLoaded(detail)) return detail
	const read = { ...detail, thread: { ...detail.thread, unread: false } }
	// Cache the aligned detail immediately so a later rejection can return it
	// to unread before any route installs it as initial data.
	if (queryKey) client.setQueryData(queryKey, cacheAs(read))
	return read
}

type OpenedThread = {
	thread: MailThread
	messages: readonly { id: string; unread?: boolean; ownmailDraft?: boolean }[]
	failedMessageIds?: readonly string[]
}

const shownReads = new WeakMap<QueryClient, Set<string>>()

/**
 * The reader's read for a thread it shows (a server-rendered open, or one the
 * loader could not mark): the whole thread when every message loaded, else
 * only the unread messages on screen, one by one, so the ones that did not
 * load stay unread and so does the thread, in its row and folder badge. The
 * reader's detail is updated with the messages the provider confirmed. A
 * mailbox client that cannot mark one message marks nothing.
 */
export function markOpenedThreadRead(client: QueryClient, threadId: string, detail: OpenedThread): void {
	if (!detail.thread.unread) return
	if (!partlyLoaded(detail)) {
		markThreadReadOnOpen(client, threadId, detail.thread)
		return
	}
	if (typeof window === 'undefined') return
	const messageIds = detail.messages
		.filter((message) => message.unread === true && message.ownmailDraft !== true)
		.map((message) => message.id)
	let pending = shownReads.get(client)
	if (!pending) {
		pending = new Set()
		shownReads.set(client, pending)
	}
	if (messageIds.length === 0 || pending.has(threadId)) return
	const inFlight = pending
	inFlight.add(threadId)
	const detailKey = mailKeys.threadDetail(threadId)
	const observer = new MutationObserver(client, {
		mutationFn: () => markMessagesRead({ data: { threadId, messageIds } }),
		onSuccess: (receipt) => {
			const marked = new Set(receipt.messageIds)
			client.setQueryData<MailThreadDetail>(detailKey, (current) =>
				current && marked.size > 0
					? {
							...current,
							messages: current.messages.map((message) =>
								marked.has(message.id) ? { ...message, unread: false } : message,
							),
						}
					: current,
			)
			reconcileInBackground(client)
		},
		onSettled: () => inFlight.delete(threadId),
	})
	// A failed read leaves the messages unread, as they still are.
	void observer.mutate().catch(() => {})
}

function optimisticDraft(input: DraftFields, draftId: string): MailDraft {
	return {
		id: draftId,
		to: input.to
			.split(',')
			.map((email) => email.trim())
			.filter(Boolean)
			.map((email) => ({ email })),
		subject: input.subject,
		body: input.body,
		snippet: input.body
			.replace(/<[^>]*>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 140),
		date: Math.floor(Date.now() / 1000),
		...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
	} as MailDraft
}

function optimisticDraftId(): string {
	const bytes = new Uint8Array(16)
	globalThis.crypto.getRandomValues(bytes)
	return `optimistic-draft-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function useSaveDraftMutation() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (input: DraftFields) => saveDraft({ data: input }),
		onMutate: async (input) => {
			const optimisticId = input.draftId ?? optimisticDraftId()
			const operation = await managerFor(client).begin({
				type: 'draft.saved',
				draft: optimisticDraft(input, optimisticId),
				created: input.draftId === undefined,
			})
			return { operation, optimisticId }
		},
		onError: (_error, _input, context) => context?.operation.rollback(),
		onSuccess: (receipt, input, context) => {
			const canonical = receipt.draft ? toMailDraft(receipt.draft) : optimisticDraft(input, receipt.draftId)
			context?.operation.commit({
				type: 'draft.saved',
				draft: canonical,
				created: receipt.created,
				...(receipt.folders ? { folders: receipt.folders.map(toMailFolder) } : {}),
			})
			reconcileInBackground(client)
		},
	})
}

export function useSendDraftMutation() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (input: SendDraftFields) => sendDraft({ data: input }),
		onMutate: async (input): Promise<OptimisticContext> => ({
			operation: await managerFor(client).begin({ type: 'draft.sent', draftId: input.draftId }),
		}),
		onError: (_error, _input, context) => context?.operation.rollback(),
		onSuccess: (receipt, input, context) => {
			context?.operation.commit({
				type: 'draft.sent',
				draftId: input.draftId,
				...(receipt.message ? { message: safeSentMessage(receipt.message) } : {}),
				...(receipt.folders ? { folders: receipt.folders.map(toMailFolder) } : {}),
			})
			reconcileInBackground(client)
		},
	})
}

export function useDeleteDraftMutation() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (draftId: string) => deleteDraft({ data: { draftId } }),
		onMutate: async (draftId): Promise<OptimisticContext> => ({
			operation: await managerFor(client).begin({ type: 'draft.deleted', draftId }),
		}),
		onError: (_error, _draftId, context) => context?.operation.rollback(),
		onSuccess: (receipt, draftId, context) => {
			context?.operation.commit({
				type: 'draft.deleted',
				draftId,
				...(receipt.folders ? { folders: receipt.folders.map(toMailFolder) } : {}),
			})
			reconcileInBackground(client)
		},
	})
}

/** What can be done to your scheduled message: send it now, or cancel it. */
export type ScheduledSendAction = 'send-now' | 'cancel'

/**
 * How a scheduled-send action ended: `draftId` is a draft holding the whole
 * message for the composer to open (a cancelled message, or one that could not
 * be sent now), and `error` says why it is a draft when that was not asked for.
 * `warning` is said after a send that went but left its safety copy in Drafts.
 */
export type ScheduledSendOutcome = { draftId?: string; error?: string; warning?: string }

/**
 * Sends a scheduled message now or cancels it. Either changes which messages
 * the thread holds, so the mail cache (when there is one) is reloaded from the
 * provider afterwards. Rejects when nothing was changed.
 */
export async function runScheduledSend(
	client: QueryClient | undefined,
	{ messageId, action }: { messageId: string; action: ScheduledSendAction },
): Promise<ScheduledSendOutcome> {
	let outcome: ScheduledSendOutcome
	if (action === 'send-now') {
		const receipt = await sendScheduledNow({ data: { messageId } })
		outcome =
			'error' in receipt
				? { draftId: receipt.draftId, error: receipt.error }
				: receipt.warning
					? { warning: receipt.warning }
					: {}
	} else {
		const receipt = await cancelScheduledSend({ data: { messageId } })
		outcome = { draftId: receipt.draftId }
	}
	await client?.invalidateQueries({ queryKey: mailKeys.all })
	return outcome
}

/** `runScheduledSend` as a mutation of the app's query client. */
export function useScheduledSendMutation() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (input: { messageId: string; action: ScheduledSendAction }) =>
			runScheduledSend(client, input),
	})
}

/**
 * The reader's scheduled-send handler: runs the action and answers the draft
 * the composer should open, if any. Failures, a send that became a draft, and
 * a send whose safety copy stayed in Drafts are reported through `onError`.
 */
export function useScheduledSendAction(onError: (message: string) => void) {
	const { mutateAsync } = useScheduledSendMutation()
	return useCallback(
		(messageId: string, action: ScheduledSendAction): Promise<string | undefined> =>
			mutateAsync({ messageId, action }).then(
				(outcome) => {
					const said = outcome.error ?? outcome.warning
					if (said) onError(said)
					return outcome.draftId
				},
				() => {
					onError(action === 'cancel' ? 'Could not cancel the scheduled send' : 'Could not send it now')
					return undefined
				},
			),
		[mutateAsync, onError],
	)
}

export const mailMutationTestApi = {
	managerFor,
	optimisticDraft,
	optimisticDraftId,
	updateThreadEffect,
	updateThreadReceiptEffect,
}
