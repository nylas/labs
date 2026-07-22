import { type Draft, type Folder, type Message, NylasApiError, type Thread } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { signalLocalChange } from '#server/change-version'
import { requireNylasProviderId } from '#server/ids'
import { friendly, listData, requireMailbox } from '#server/mailbox-boundary'
import { threadFoldersAfterMove } from './mail-folders.js'
import { normalizeOutboundAttachments, type OutboundAttachment } from './outbound-attachments.js'
import { parseRecipientEmails } from './recipients.js'
import { threadSearchParams } from './search.js'
import { normalizeThreadListInput, type ThreadListInput } from './thread-list.js'
import { normalizeThreadStateInput } from './thread-state.js'

const MAX_MESSAGE_BODY_LENGTH = 500_000
const MAX_MESSAGE_SUBJECT_LENGTH = 500

type MessageFieldsInput = {
	to: string
	subject: string
	body: string
	replyToMessageId?: string
}

function normalizeMessageFields(input: MessageFieldsInput): MessageFieldsInput {
	if (
		!input ||
		typeof input.to !== 'string' ||
		typeof input.subject !== 'string' ||
		typeof input.body !== 'string'
	) {
		throw new Error('Invalid message')
	}
	if (input.subject.length > MAX_MESSAGE_SUBJECT_LENGTH) throw new Error('Message subject too large')
	if (input.body.length > MAX_MESSAGE_BODY_LENGTH) throw new Error('Message body too large')
	if (
		input.replyToMessageId !== undefined &&
		(typeof input.replyToMessageId !== 'string' ||
			input.replyToMessageId.length > 500 ||
			/[\r\n]/.test(input.replyToMessageId))
	) {
		throw new Error('Invalid reply reference')
	}
	return input
}

type AttachmentDownloader = {
	downloadAttachment(attachmentId: string, messageId: string): Promise<Response>
}

type FolderLister = {
	listFolders(): Promise<{ data?: unknown }>
}

/** Folder metadata is reconciliation data, so a failed follow-up read must not
 * turn an already-successful provider mutation into a reported failure. */
async function freshFolders(mailbox: FolderLister): Promise<Folder[] | undefined> {
	try {
		return listData<Folder>((await mailbox.listFolders()).data)
	} catch {
		return undefined
	}
}

async function mailReceipt<T extends object>(
	mailbox: FolderLister,
	grantId: string,
	receipt: T,
): Promise<T & { folders?: Folder[] }> {
	const [folders] = await Promise.all([freshFolders(mailbox), signalLocalChange(grantId, 'mail')])
	return { ...receipt, ...(folders ? { folders } : {}) }
}

/** Re-encode provider attachments because draft updates are full PUT replacements. */
async function restoreDraftAttachments(
	mailbox: AttachmentDownloader,
	draft: Draft,
): Promise<OutboundAttachment[]> {
	const attachments = draft.attachments ?? []
	const restored: OutboundAttachment[] = []
	for (const attachment of attachments) {
		const response = await mailbox.downloadAttachment(attachment.id, draft.id)
		if (!response.ok) throw new Error('Unable to restore draft attachment')
		const bytes = new Uint8Array(await response.arrayBuffer())
		restored.push({
			filename: attachment.filename ?? 'attachment',
			content_type: attachment.content_type ?? 'application/octet-stream',
			content: bytesToBase64(bytes),
			...(attachment.is_inline ? { is_inline: true } : {}),
			...(attachment.content_id ? { content_id: attachment.content_id } : {}),
		})
	}
	return restored
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
	}
	return btoa(binary)
}

function isNotFound(err: unknown): boolean {
	return err instanceof NylasApiError
		? err.status === 404
		: err instanceof Error && /not found|deleted/i.test(err.message)
}

function draftThreadMessages(
	draft: Draft,
	email: string,
	displayName?: string,
): { thread: Thread; messages: Message[]; ownmailDraftMessageIds: string[] } {
	const from = draft.from?.length ? draft.from : [{ email, ...(displayName ? { name: displayName } : {}) }]
	const message: Message = {
		...draft,
		from,
		thread_id: draft.thread_id ?? draft.id,
		folders: draft.folders ?? ['drafts'],
		unread: false,
		starred: draft.starred ?? false,
	}
	const thread: Thread = {
		id: draft.id,
		grant_id: draft.grant_id,
		subject: draft.subject,
		snippet: draft.snippet ?? stripHtml(draft.body ?? '').slice(0, 140),
		participants: draft.to ?? [],
		message_ids: [draft.id],
		latest_draft_or_message: message,
		earliest_message_date: draft.date,
		latest_message_sent_date: draft.date,
		has_attachments: Boolean(draft.attachments?.some((attachment) => !attachment.is_inline)),
		unread: false,
		starred: draft.starred ?? false,
		folders: draft.folders ?? ['drafts'],
	}
	return { thread, messages: [message], ownmailDraftMessageIds: [message.id] }
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

export const getFolders = createServerFn({ method: 'GET' }).handler(async (): Promise<Folder[]> => {
	const { mailbox } = await requireMailbox()
	try {
		const res = await mailbox.listFolders()
		return listData<Folder>(res.data)
	} catch (err) {
		throw friendly(err)
	}
})

export const getThreads = createServerFn({ method: 'GET' })
	.validator((input: ThreadListInput) => normalizeThreadListInput(input))
	.handler(async ({ data }): Promise<{ threads: Thread[]; nextCursor?: string }> => {
		const { mailbox } = await requireMailbox()
		const search = threadSearchParams(data.q)
		try {
			const res = await mailbox.listThreads({
				limit: 30,
				...(data.folderId ? { in: data.folderId } : {}),
				...(data.pageToken ? { page_token: data.pageToken } : {}),
				...search,
				...(data.starred !== undefined ? { starred: data.starred } : {}),
			})
			return {
				threads: listData<Thread>(res.data),
				...(res.next_cursor ? { nextCursor: res.next_cursor } : {}),
			}
		} catch (err) {
			throw friendly(err)
		}
	})

export const getThreadMessages = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => ({
		threadId: requireNylasProviderId(input.threadId, 'thread'),
	}))
	.handler(
		async ({
			data,
		}): Promise<{
			thread: Thread
			messages: Message[]
			mailboxEmail: string
			markedRead?: boolean
			ownmailDraftMessageIds?: string[]
		}> => {
			const { mailbox, email, displayName, grantId } = await requireMailbox()
			try {
				const thread = await mailbox.getThread(data.threadId)
				const messageIds = thread.data.message_ids ?? []
				const messages = await Promise.all(messageIds.map((id) => mailbox.getMessage(id).then((r) => r.data)))
				messages.sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
				if (thread.data.unread) {
					const updated = await mailbox.updateThread(data.threadId, { unread: false })
					await signalLocalChange(grantId, 'mail')
					return {
						thread: updated.data,
						messages,
						mailboxEmail: email,
						markedRead: true,
					}
				}
				return { thread: thread.data, messages, mailboxEmail: email }
			} catch (err) {
				if (!isNotFound(err)) throw err
				const drafts = await mailbox.listDrafts({ limit: 50 })
				const draft = drafts.data.find((item) => item.id === data.threadId)
				if (!draft) throw friendly(err)
				return { ...draftThreadMessages(draft, email, displayName), mailboxEmail: email }
			}
		},
	)

/** Explicit read-state mutation for callers that keep data loading side-effect free. */
export const markThreadRead = createServerFn({ method: 'POST' })
	.validator((input: { threadId: string }) => ({
		threadId: requireNylasProviderId(input.threadId, 'thread'),
	}))
	.handler(async ({ data }): Promise<{ thread: Thread; folders?: Folder[] }> => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const updated = await mailbox.updateThread(data.threadId, { unread: false })
			return mailReceipt(mailbox, grantId, { thread: updated.data })
		} catch (err) {
			throw friendly(err)
		}
	})

export const sendMessage = createServerFn({ method: 'POST' })
	.validator(
		(input: {
			to: string
			subject: string
			body: string
			replyToMessageId?: string
			attachments?: OutboundAttachment[]
		}) => {
			const message = normalizeMessageFields(input)
			const to = parseRecipientEmails(message.to, { required: true })
			return { ...message, toList: to, attachments: normalizeOutboundAttachments(input.attachments) }
		},
	)
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const sent = await mailbox.send({
				to: data.toList.map((email) => ({ email })),
				subject: data.subject,
				body: data.body,
				...(data.attachments ? { attachments: data.attachments } : {}),
				...(data.replyToMessageId ? { reply_to_message_id: data.replyToMessageId } : {}),
			})
			return mailReceipt(mailbox, grantId, { message: sent.data })
		} catch (err) {
			throw friendly(err)
		}
	})

// ---- Thread actions -----------------------------------------------------------

export const updateThreadState = createServerFn({ method: 'POST' })
	.validator(normalizeThreadStateInput)
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const folders = data.folder
				? threadFoldersAfterMove((await mailbox.getThread(data.threadId)).data.folders, data.folder)
				: undefined
			const updated = await mailbox.updateThread(data.threadId, {
				...(data.unread !== undefined ? { unread: data.unread } : {}),
				...(data.starred !== undefined ? { starred: data.starred } : {}),
				...(folders ? { folders } : {}),
			})
			return mailReceipt(mailbox, grantId, { thread: updated.data })
		} catch (err) {
			if (isNotFound(err) && data.folder && ['archive', 'trash'].includes(data.folder)) {
				try {
					await mailbox.deleteDraft(data.threadId)
					return mailReceipt(mailbox, grantId, { removedDraftId: data.threadId })
				} catch {
					// fall through to the original, user-safe thread action error
				}
			}
			throw friendly(err)
		}
	})

// ---- Drafts ---------------------------------------------------------------------

export const saveDraft = createServerFn({ method: 'POST' })
	.validator(
		(input: {
			draftId?: string
			to: string
			subject: string
			body: string
			replyToMessageId?: string
			attachments?: OutboundAttachment[]
		}) => {
			const message = normalizeMessageFields(input)
			return {
				...message,
				...(input.draftId !== undefined ? { draftId: requireNylasProviderId(input.draftId, 'draft') } : {}),
				toList: parseRecipientEmails(message.to, { required: false }),
				attachments: normalizeOutboundAttachments(input.attachments),
			}
		},
	)
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const payload = {
				to: data.toList.map((email) => ({ email })),
				subject: data.subject,
				body: data.body,
				...(data.attachments ? { attachments: data.attachments } : {}),
				...(data.replyToMessageId ? { reply_to_message_id: data.replyToMessageId } : {}),
			}
			const saved = data.draftId
				? await mailbox.updateDraft(data.draftId, payload)
				: await mailbox.createDraft(payload)
			return mailReceipt(mailbox, grantId, {
				draftId: saved.data.id,
				draft: saved.data,
				created: data.draftId === undefined,
			})
		} catch (err) {
			throw friendly(err)
		}
	})

export const getDraft = createServerFn({ method: 'GET' })
	.validator((input: { draftId: string }) => ({
		draftId: requireNylasProviderId(input.draftId, 'draft'),
	}))
	.handler(async ({ data }) => {
		const { mailbox } = await requireMailbox()
		try {
			const res = await mailbox.getDraft(data.draftId)
			return res.data
		} catch (err) {
			throw friendly(err)
		}
	})

export const sendDraft = createServerFn({ method: 'POST' })
	.validator(
		(input: {
			draftId: string
			to: string
			subject: string
			body: string
			replyToMessageId?: string
			attachments?: OutboundAttachment[]
		}) => {
			const message = normalizeMessageFields(input)
			const to = parseRecipientEmails(message.to, { required: true })
			return {
				...message,
				draftId: requireNylasProviderId(input.draftId, 'draft'),
				toList: to,
				attachments: normalizeOutboundAttachments(input.attachments),
			}
		},
	)
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const draft = await mailbox.getDraft(data.draftId)
			const restoredAttachments = await restoreDraftAttachments(mailbox, draft.data)
			const attachments = normalizeOutboundAttachments([...restoredAttachments, ...(data.attachments ?? [])])
			await mailbox.updateDraft(data.draftId, {
				to: data.toList.map((email) => ({ email })),
				subject: data.subject,
				body: data.body,
				...(attachments ? { attachments } : {}),
				...(data.replyToMessageId ? { reply_to_message_id: data.replyToMessageId } : {}),
			})
			const sent = await mailbox.sendDraft(data.draftId)
			return mailReceipt(mailbox, grantId, {
				removedDraftId: data.draftId,
				message: sent.data,
			})
		} catch (err) {
			throw friendly(err)
		}
	})

export const deleteDraft = createServerFn({ method: 'POST' })
	.validator((input: { draftId: string }) => ({
		draftId: requireNylasProviderId(input.draftId, 'draft'),
	}))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			await mailbox.deleteDraft(data.draftId)
			return mailReceipt(mailbox, grantId, { removedDraftId: data.draftId })
		} catch (err) {
			throw friendly(err)
		}
	})

export const listDrafts = createServerFn({ method: 'GET' }).handler(async () => {
	const { mailbox } = await requireMailbox()
	try {
		const res = await mailbox.listDrafts({ limit: 50 })
		return listData<Draft>(res.data)
	} catch (err) {
		throw friendly(err)
	}
})

// ---- Contacts -------------------------------------------------------------------
