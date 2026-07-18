import type { Folder, Thread } from '@nylas-labs/cli-kit/v3'
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteDraft, saveDraft, sendDraft, updateThreadState } from '../server/fns.js'
import type { OutboundAttachment } from '../server/outbound-attachments.js'
import {
	createMailOptimisticManager,
	type MailCacheEffect,
	type MailOptimisticOperation,
	safeSentMessage,
} from './mail-cache.js'
import { type MailDraft, mailKeys, toMailDraft, toMailFolder, toMailThread } from './mail-queries.js'

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

const managerByClient = new WeakMap<QueryClient, ReturnType<typeof createMailOptimisticManager>>()

function managerFor(client: QueryClient) {
	let manager = managerByClient.get(client)
	if (!manager) {
		manager = createMailOptimisticManager(client)
		managerByClient.set(client, manager)
	}
	return manager
}

function safeFolders(folders: Folder[] | undefined) {
	return folders?.map(toMailFolder)
}

function reconcileInBackground(client: QueryClient) {
	// The mutation receipt is authoritative for the immediate UI. Reconciliation
	// is deliberately detached so a later read failure cannot undo confirmed work.
	void client.invalidateQueries({ queryKey: mailKeys.all, refetchType: 'inactive' }).catch(() => {})
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
