import type { Folder, Thread } from '@nylas-labs/cli-kit/v3'
import {
	MutationObserver,
	type QueryClient,
	type QueryKey,
	useMutation,
	useQueryClient,
} from '@tanstack/react-query'
import type { OutboundAttachment } from '#features/mail/server/outbound-attachments'
import { deleteDraft, markThreadRead, saveDraft, sendDraft, updateThreadState } from '#server/fns'
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
	subject: string
	body: string
	replyToMessageId?: string
	attachments?: OutboundAttachment[]
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

function startReadOnOpen(
	client: QueryClient,
	threadId: string,
	knownThread?: MailThread,
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
		mutationFn: () => markThreadRead({ data: { threadId } }),
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
 * reader agree immediately. A detail fetched before the read landed is aligned
 * with it, unless that read has already failed. */
export async function openThreadDetail<T extends { thread: { unread?: boolean } }>(
	client: QueryClient,
	threadId: string,
	{
		preload,
		queryKey,
		cacheAs = (detail) => detail,
	}: { preload: boolean; queryKey?: QueryKey; cacheAs?: (detail: T) => unknown },
	load: () => Promise<T>,
): Promise<T> {
	const attempt = preload ? undefined : startReadOnOpen(client, threadId)
	const detail = await load()
	if (!attempt || attempt.failed || !detail.thread.unread) return detail
	const read = { ...detail, thread: { ...detail.thread, unread: false } }
	// Cache the aligned detail immediately so a later rejection can return it
	// to unread before any route installs it as initial data.
	if (queryKey) client.setQueryData(queryKey, cacheAs(read))
	return read
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

export const mailMutationTestApi = {
	managerFor,
	optimisticDraft,
	optimisticDraftId,
	updateThreadEffect,
	updateThreadReceiptEffect,
}
