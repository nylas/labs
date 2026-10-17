import {
	type Draft,
	type Folder,
	type Message,
	NylasApiError,
	type SendMessageRequest,
	type Thread,
} from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { signalLocalChange } from '#server/change-version'
import { requireNylasProviderId, validNylasProviderId } from '#server/ids'
import { friendly, listData, requireMailbox } from '#server/mailbox-boundary'
import { usingDevMocks } from '#server/platform'
import { timeOperation } from '#server/request-context'
import { DEV_MOCK_LIST_SIZES } from './dev-mock-lists.js'
import { protectMessageImageSources } from './email-image-sources.js'
import {
	type FolderIdInput,
	type FolderNameInput,
	normalizeFolderIdInput,
	normalizeFolderNameInput,
	normalizeUpdateFolderInput,
	type UpdateFolderInput,
} from './folder-input.js'
import {
	type MessageHeaderFacts,
	messageHeaderFacts,
	rawHeaderText,
	type ThreadHeaderFacts,
} from './header-facts.js'
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
		return listData<Folder>((await timeOperation('folders', () => mailbox.listFolders())).data)
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

/** A draft as a message of its thread: from you, in Drafts, read. */
function draftMessage(draft: Draft, email: string, displayName?: string): Message {
	const from = draft.from?.length ? draft.from : [{ email, ...(displayName ? { name: displayName } : {}) }]
	return {
		...draft,
		from,
		thread_id: draft.thread_id ?? draft.id,
		folders: draft.folders ?? ['drafts'],
		unread: false,
		starred: draft.starred ?? false,
	}
}

function draftThreadMessages(
	draft: Draft,
	email: string,
	displayName?: string,
): { thread: Thread; messages: Message[]; ownmailDraftMessageIds: string[] } {
	const message = draftMessage(draft, email, displayName)
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

/** Most drafts a thread's reader loads: one unsent reply is the common case. */
const MAX_THREAD_DRAFTS = 10

/** The drafts a provider lists on a thread (`draft_ids`), valid ids only. */
function threadDraftIds(thread: Thread): string[] {
	const ids = (thread as Thread & { draft_ids?: unknown }).draft_ids
	if (!Array.isArray(ids)) return []
	return [
		...new Set(ids.filter((id): id is string => typeof id === 'string' && validNylasProviderId(id))),
	].slice(0, MAX_THREAD_DRAFTS)
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
		const res = await timeOperation('folders', () => mailbox.listFolders())
		return listData<Folder>(res.data)
	} catch (err) {
		throw friendly(err)
	}
})

const SYSTEM_FOLDER_ATTRIBUTES = new Set([
	'\\Inbox',
	'\\Sent',
	'\\Drafts',
	'\\Junk',
	'\\Trash',
	'\\Archive',
	'\\All',
	'\\Important',
])

function isProtectedFolder(folder: Folder): boolean {
	return Boolean(
		folder.system_folder || folder.attributes?.some((attribute) => SYSTEM_FOLDER_ATTRIBUTES.has(attribute)),
	)
}

async function requireCustomFolder(mailbox: FolderLister, folderId: string): Promise<Folder> {
	const folders = listData<Folder>((await timeOperation('folders', () => mailbox.listFolders())).data)
	const folder = folders.find((candidate) => candidate.id === folderId)
	if (!folder || isProtectedFolder(folder)) throw new Error('This folder cannot be changed.')
	return folder
}

export const createFolder = createServerFn({ method: 'POST' })
	.validator((input: FolderNameInput) => normalizeFolderNameInput(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const created = await mailbox.createFolder({ name: data.name })
			return mailReceipt(mailbox, grantId, { folder: created.data })
		} catch (err) {
			throw friendly(err)
		}
	})

export const updateFolder = createServerFn({ method: 'POST' })
	.validator((input: UpdateFolderInput) => normalizeUpdateFolderInput(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			await requireCustomFolder(mailbox, data.folderId)
			const updated = await mailbox.updateFolder(data.folderId, { name: data.name })
			return mailReceipt(mailbox, grantId, { folder: updated.data })
		} catch (err) {
			if (err instanceof Error && err.message === 'This folder cannot be changed.') throw err
			throw friendly(err)
		}
	})

export const deleteFolder = createServerFn({ method: 'POST' })
	.validator((input: FolderIdInput) => normalizeFolderIdInput(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			await requireCustomFolder(mailbox, data.folderId)
			await mailbox.deleteFolder(data.folderId)
			return mailReceipt(mailbox, grantId, { removedFolderId: data.folderId })
		} catch (err) {
			if (err instanceof Error && err.message === 'This folder cannot be changed.') throw err
			throw friendly(err)
		}
	})

export const getThreads = createServerFn({ method: 'GET' })
	.validator((input: ThreadListInput) => normalizeThreadListInput(input))
	.handler(async ({ data }): Promise<{ threads: Thread[]; nextCursor?: string }> => {
		const { mailbox } = await requireMailbox()
		const search = threadSearchParams(data.q)
		try {
			const res = await timeOperation('threads', () =>
				mailbox.listThreads({
					limit: 30,
					...(data.folderId ? { in: data.folderId } : {}),
					...(data.pageToken ? { page_token: data.pageToken } : {}),
					...search,
					...(data.starred !== undefined ? { starred: data.starred } : {}),
				}),
			)
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
			ownmailDraftMessageIds?: string[]
			failedMessageIds?: string[]
		}> => {
			// Reading is side-effect free: route preloads fetch this on hover, and
			// the client marks a thread read explicitly when it is actually opened.
			const { mailbox, email, displayName } = await requireMailbox()
			try {
				const thread = await mailbox.getThread(data.threadId)
				const messageIds = thread.data.message_ids ?? []
				// One unreadable message must not hide the rest of the conversation:
				// the reader shows what loaded and names how many did not.
				const settled = await Promise.allSettled(
					messageIds.map((id) => mailbox.getMessage(id).then((r) => r.data)),
				)
				const failedMessageIds = messageIds.filter((_, index) => settled[index]?.status === 'rejected')
				const firstFailure = settled.find((result) => result.status === 'rejected')
				if (firstFailure && failedMessageIds.length === messageIds.length) throw firstFailure.reason
				const messages = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
				// Your unsent replies sit in the thread, under the message each answers. A
				// draft that cannot be read is left out: it is still in Drafts.
				const draftIds = threadDraftIds(thread.data)
				const drafts = (
					await Promise.allSettled(draftIds.map((id) => mailbox.getDraft(id).then((r) => r.data)))
				).flatMap((result) =>
					result.status === 'fulfilled' ? [draftMessage(result.value, email, displayName)] : [],
				)
				const all = [...messages, ...drafts]
				all.sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
				const protectedMessages = await Promise.all(all.map(protectMessageImageSources))
				return {
					thread: thread.data,
					messages: protectedMessages,
					mailboxEmail: email,
					...(drafts.length > 0 ? { ownmailDraftMessageIds: drafts.map((draft) => draft.id) } : {}),
					...(failedMessageIds.length > 0 ? { failedMessageIds } : {}),
				}
			} catch (err) {
				if (!isNotFound(err)) throw err
				const drafts = await mailbox.listDrafts({ limit: 50 })
				const draft = drafts.data.find((item) => item.id === data.threadId)
				if (!draft) throw friendly(err)
				const detail = draftThreadMessages(draft, email, displayName)
				return {
					...detail,
					messages: await Promise.all(detail.messages.map(protectMessageImageSources)),
					mailboxEmail: email,
				}
			}
		},
	)

/** Messages read per page when a thread's headers are looked up. */
const HEADER_LOOKUP_PAGE_SIZE = 50
/** Pages read per thread header lookup: at most 200 messages, which bounds the cost of one request. */
const HEADER_LOOKUP_MAX_PAGES = 4

type HeaderMessage = (Message & { headers?: unknown }) | null

type HeaderMessageLister = {
	listMessages(query: {
		thread_id: string
		fields: 'include_headers'
		limit: number
		page_token?: string
	}): Promise<{ data?: unknown; next_cursor?: unknown }>
}

/**
 * Every message of one thread with its untrusted provider headers, following
 * the provider's cursor for at most `HEADER_LOOKUP_MAX_PAGES` pages. A cursor
 * that is not a usable provider id, or that repeats, ends the walk. Any
 * failure rejects, so callers keep their single "no answer" fallback.
 */
async function listThreadMessagesWithHeaders(
	mailbox: HeaderMessageLister,
	threadId: string,
): Promise<HeaderMessage[]> {
	const messages: HeaderMessage[] = []
	const seenCursors = new Set<string>()
	let pageToken: string | undefined
	for (let page = 0; page < HEADER_LOOKUP_MAX_PAGES; page++) {
		const response = await mailbox.listMessages({
			thread_id: threadId,
			fields: 'include_headers',
			limit: HEADER_LOOKUP_PAGE_SIZE,
			...(pageToken ? { page_token: pageToken } : {}),
		})
		if (!Array.isArray(response.data)) throw new Error('Unexpected message list')
		messages.push(...(response.data as HeaderMessage[]))
		const cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined
		if (!validNylasProviderId(cursor) || seenCursors.has(cursor)) break
		seenCursors.add(cursor)
		pageToken = cursor
	}
	return messages
}

/** Whether untrusted provider headers include a non-empty List-Unsubscribe. Only the name is compared. */
function hasListUnsubscribe(headers: unknown): boolean {
	return (
		Array.isArray(headers) &&
		headers.some(
			(header: { name?: unknown; value?: unknown } | null) =>
				typeof header?.name === 'string' &&
				header.name.trim().toLowerCase() === 'list-unsubscribe' &&
				typeof header.value === 'string' &&
				header.value.trim() !== '',
		)
	)
}

/**
 * Which messages of a thread declare themselves bulk mail with a
 * List-Unsubscribe header. The Conversation view uses this as one more
 * classification signal. Headers are requested only here, only when that view
 * asks; their values are untrusted, are never stored, logged or returned, and
 * only the ids of matching messages leave the server. Any failure answers
 * "none", and classification falls back to the message bodies.
 */
export const getThreadListUnsubscribe = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => ({
		threadId: requireNylasProviderId(input.threadId, 'thread'),
	}))
	.handler(async ({ data }): Promise<{ messageIds: string[] }> => {
		const { mailbox } = await requireMailbox()
		try {
			const messages = await listThreadMessagesWithHeaders(mailbox, data.threadId)
			const messageIds = messages
				.filter((message) => typeof message?.id === 'string' && hasListUnsubscribe(message.headers))
				.map((message) => (message as Message).id)
			// A message can appear on two pages when the thread changes mid-walk.
			return { messageIds: [...new Set(messageIds)] }
		} catch {
			return { messageIds: [] }
		}
	})

/**
 * What a thread's headers say about each message: sender authentication,
 * Reply-To, mailing list and unsubscribe targets, and the sender's time zone.
 * Headers are requested once per thread, only when the reader asks, a page at
 * a time for at most 200 messages; facts from every page are merged. Their
 * values are untrusted, are never stored or logged, and only the derived
 * booleans and short validated strings of `messageHeaderFacts` leave the
 * server. Any failure rejects (no part of a thread's facts is answered): the
 * reader then says the checks could not be run and keeps links disabled.
 */
/** What a failed header-facts lookup says; no provider detail reaches the reader. */
const HEADER_FACTS_FAILED = 'Sender checks could not be looked up.'

export const getThreadHeaderFacts = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => ({
		threadId: requireNylasProviderId(input.threadId, 'thread'),
	}))
	.handler(async ({ data }): Promise<ThreadHeaderFacts> => {
		const { mailbox, email } = await requireMailbox()
		try {
			const messages = await listThreadMessagesWithHeaders(mailbox, data.threadId)
			const entries: Array<[string, MessageHeaderFacts]> = []
			for (const message of messages) {
				if (!message || !validNylasProviderId(message.id)) continue
				const fromEmail = Array.isArray(message.from) ? message.from[0]?.email : undefined
				// A provider may list your own recipients as the Reply-To of what you sent;
				// that is not a redirection a reader needs to be told about.
				const ownMessage = typeof fromEmail === 'string' && fromEmail.toLowerCase() === email.toLowerCase()
				const replyToEmail =
					!ownMessage && Array.isArray(message.reply_to) ? message.reply_to[0]?.email : undefined
				entries.push([
					message.id,
					messageHeaderFacts(
						message.headers,
						typeof fromEmail === 'string' ? fromEmail : undefined,
						typeof replyToEmail === 'string' ? replyToEmail : undefined,
					),
				])
			}
			// fromEntries defines own keys, so a hostile id like `__proto__` stays plain data.
			// A message seen on two pages keeps the facts of its latest copy.
			const byMessage = Object.fromEntries(entries)
			// Only the mock app knows how many people a list reaches.
			return (await usingDevMocks()) ? { byMessage, listSizes: { ...DEV_MOCK_LIST_SIZES } } : { byMessage }
		} catch {
			// Never "no facts" as an answer: the reader would take every sender as
			// unchecked-but-fine and turn their links on. A rejection keeps any
			// earlier answer, and links stay disabled for what it does not cover.
			throw new Error(HEADER_FACTS_FAILED)
		}
	})

/**
 * One message's header block as plain text, for "Show raw headers". Read from
 * the provider's raw message only on that explicit request; the body never
 * leaves the server and the text is capped at 64 KB.
 */
export const getMessageRawHeaders = createServerFn({ method: 'GET' })
	.validator((input: { messageId: string }) => ({
		messageId: requireNylasProviderId(input.messageId, 'message'),
	}))
	.handler(async ({ data }): Promise<{ text: string }> => {
		const { mailbox } = await requireMailbox()
		let rawMime: unknown
		try {
			const result = await mailbox.getRawMime(data.messageId)
			rawMime = (result as { data?: { raw_mime?: unknown } } | null)?.data?.raw_mime
		} catch (err) {
			throw friendly(err)
		}
		const text = rawHeaderText(rawMime)
		if (text === null) throw new Error('Raw headers are not available for this message.')
		return { text }
	})

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

type MessageUpdater = {
	updateMessage?: (messageId: string, body: { unread: boolean }) => Promise<unknown>
}

/** Most messages one partial-thread read marks: a reader shows at most this many. */
const MAX_MARKED_MESSAGES = 200

/**
 * Marks only the given messages of a thread read, one by one. A reader that
 * could not load every message of a thread uses this instead of
 * `markThreadRead`, so messages nobody has seen stay unread. A mailbox client
 * without per-message updates marks nothing, and the thread stays unread.
 * Answers the ids the provider confirmed.
 */
export const markMessagesRead = createServerFn({ method: 'POST' })
	.validator((input: { threadId: string; messageIds: string[] }) => {
		if (!input || !Array.isArray(input.messageIds) || input.messageIds.length > MAX_MARKED_MESSAGES) {
			throw new Error('Invalid messages')
		}
		return {
			threadId: requireNylasProviderId(input.threadId, 'thread'),
			messageIds: [...new Set(input.messageIds.map((id) => requireNylasProviderId(id, 'message')))],
		}
	})
	.handler(async ({ data }): Promise<{ threadId: string; messageIds: string[]; folders?: Folder[] }> => {
		const { mailbox, grantId } = await requireMailbox()
		const update = (mailbox as MessageUpdater).updateMessage
		if (typeof update !== 'function') return { threadId: data.threadId, messageIds: [] }
		const settled = await Promise.allSettled(
			data.messageIds.map((id) => update.call(mailbox, id, { unread: false })),
		)
		const marked = data.messageIds.filter((_, index) => settled[index]?.status === 'fulfilled')
		const failure = settled.find((result) => result.status === 'rejected')
		if (failure && marked.length === 0) throw friendly(failure.reason)
		return mailReceipt(mailbox, grantId, { threadId: data.threadId, messageIds: marked })
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

// ---- Scheduled sends ------------------------------------------------------------

/** What "Send now" answers when the provider refused the send: the message is kept as a draft. */
export const SCHEDULED_SEND_FAILED = 'Couldn’t send. Saved as a draft.'

type ScheduledMailbox = AttachmentDownloader & {
	getMessage(messageId: string): Promise<{ data: Message }>
	getThread(threadId: string): Promise<{ data: Thread }>
	createDraft(body: SendMessageRequest): Promise<{ data: Draft }>
	deleteDraft(draftId: string): Promise<void>
	cancelScheduledMessage(scheduleId: string): Promise<void>
}

type ScheduledMessage = Message & { schedule_id: string }

/** Your scheduled message as the provider holds it, read before its schedule is cancelled. */
async function scheduledMessage(mailbox: ScheduledMailbox, messageId: string): Promise<ScheduledMessage> {
	const message = (await mailbox.getMessage(messageId)).data
	if (!validNylasProviderId(message.schedule_id)) throw new Error('This message is not scheduled to send.')
	return message as ScheduledMessage
}

/** The thread message a scheduled reply answers: the one before it, so sending it now keeps the thread. */
async function scheduledReplyTarget(
	mailbox: ScheduledMailbox,
	message: Message,
): Promise<string | undefined> {
	if (!message.thread_id) return undefined
	const ids = (await mailbox.getThread(message.thread_id)).data.message_ids ?? []
	const index = ids.indexOf(message.id)
	const earlier = (index < 0 ? ids : ids.slice(0, index)).filter((id) => id !== message.id)
	return earlier.at(-1)
}

/**
 * Everything a scheduled message holds, as an outgoing message: its people
 * (To, Cc, Bcc, Reply-To), subject, HTML body, files and its place in the
 * thread. Read in full before anything is changed; any failure here leaves
 * the schedule as it was.
 */
async function scheduledOutgoing(mailbox: ScheduledMailbox, message: Message): Promise<SendMessageRequest> {
	const restored = await restoreDraftAttachments(mailbox, message)
	const replyToMessageId = await scheduledReplyTarget(mailbox, message)
	return {
		to: message.to ?? [],
		...(message.cc?.length ? { cc: message.cc } : {}),
		...(message.bcc?.length ? { bcc: message.bcc } : {}),
		...(message.reply_to?.length ? { reply_to: message.reply_to } : {}),
		subject: message.subject ?? '',
		body: message.body ?? '',
		...(restored.length > 0 ? { attachments: normalizeOutboundAttachments(restored) } : {}),
		...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
	}
}

/**
 * Cancels the schedule of a message whose full copy is already a draft, so
 * the draft is never the second thing written. When the provider refuses,
 * the message is read again: still scheduled, it sends as planned and the copy
 * is removed; otherwise the copy may be the only one left, so it stays.
 */
async function cancelWithSafetyCopy(
	mailbox: ScheduledMailbox,
	message: ScheduledMessage,
	draftId: string,
): Promise<void> {
	try {
		await mailbox.cancelScheduledMessage(message.schedule_id)
	} catch (err) {
		const stillScheduled = await mailbox.getMessage(message.id).then(
			(current) => current.data.schedule_id === message.schedule_id,
			() => false,
		)
		if (stillScheduled) await mailbox.deleteDraft(draftId).catch(() => {})
		throw err
	}
}

const scheduledInput = (input: { messageId: string }) => ({
	messageId: requireNylasProviderId(input.messageId, 'message'),
})

/**
 * Stops a scheduled message from sending, with the provider's scheduled-send
 * API. Every field of it (people, subject, HTML body, files, thread) is saved
 * as a draft first, and only then is the schedule cancelled; the reader opens
 * that draft in the composer, so nothing is lost.
 */
export const cancelScheduledSend = createServerFn({ method: 'POST' })
	.validator(scheduledInput)
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const message = await scheduledMessage(mailbox, data.messageId)
			const draft = (await mailbox.createDraft(await scheduledOutgoing(mailbox, message))).data
			await cancelWithSafetyCopy(mailbox, message, draft.id)
			return mailReceipt(mailbox, grantId, { cancelledMessageId: message.id, draftId: draft.id })
		} catch (err) {
			throw friendly(err)
		}
	})

/**
 * Sends a scheduled message now. Its content and files are read and saved as
 * a draft first, its schedule is cancelled, and the same message goes out at
 * once, in its thread. Once it has gone the safety draft is removed; when the
 * send fails the draft stays, and the receipt names it with
 * `SCHEDULED_SEND_FAILED` so the reader can open it.
 */
export const sendScheduledNow = createServerFn({ method: 'POST' })
	.validator(scheduledInput)
	.handler(
		async ({
			data,
		}): Promise<
			{ cancelledMessageId: string; folders?: Folder[] } & (
				| { message: Message }
				| { draftId: string; error: string }
			)
		> => {
			const { mailbox, grantId } = await requireMailbox()
			let copy: { message: ScheduledMessage; outgoing: SendMessageRequest; draftId: string }
			try {
				const message = await scheduledMessage(mailbox, data.messageId)
				const outgoing = await scheduledOutgoing(mailbox, message)
				const draft = (await mailbox.createDraft(outgoing)).data
				await cancelWithSafetyCopy(mailbox, message, draft.id)
				copy = { message, outgoing, draftId: draft.id }
			} catch (err) {
				throw friendly(err)
			}
			let sent: Message
			try {
				sent = (await mailbox.send(copy.outgoing)).data
			} catch (err) {
				// Recorded like any provider failure; the words are safe in the draft.
				friendly(err)
				return mailReceipt(mailbox, grantId, {
					cancelledMessageId: copy.message.id,
					draftId: copy.draftId,
					error: SCHEDULED_SEND_FAILED,
				})
			}
			// The message has gone; a copy left behind only risks sending it twice.
			await mailbox.deleteDraft(copy.draftId).catch(() => {})
			return mailReceipt(mailbox, grantId, { cancelledMessageId: copy.message.id, message: sent })
		},
	)

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

/**
 * Cc and Bcc a draft already holds (a cancelled scheduled message keeps
 * them). The composer does not edit them, but carries them through every
 * save and the send, because a draft update replaces the whole draft.
 */
type CopiedRecipientsInput = { cc?: string; bcc?: string }

function copiedRecipients(input: CopiedRecipientsInput): { ccList?: string[]; bccList?: string[] } {
	const list = (value: unknown, field: string) => {
		if (value === undefined) return undefined
		if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
		const emails = parseRecipientEmails(value, { required: false })
		return emails.length > 0 ? emails : undefined
	}
	const ccList = list(input.cc, 'Cc')
	const bccList = list(input.bcc, 'Bcc')
	return { ...(ccList ? { ccList } : {}), ...(bccList ? { bccList } : {}) }
}

function copiedRecipientsPayload(data: { ccList?: string[]; bccList?: string[] }) {
	return {
		...(data.ccList ? { cc: data.ccList.map((email) => ({ email })) } : {}),
		...(data.bccList ? { bcc: data.bccList.map((email) => ({ email })) } : {}),
	}
}

export const saveDraft = createServerFn({ method: 'POST' })
	.validator(
		(
			input: {
				draftId?: string
				to: string
				subject: string
				body: string
				replyToMessageId?: string
				attachments?: OutboundAttachment[]
			} & CopiedRecipientsInput,
		) => {
			const message = normalizeMessageFields(input)
			return {
				...message,
				...(input.draftId !== undefined ? { draftId: requireNylasProviderId(input.draftId, 'draft') } : {}),
				toList: parseRecipientEmails(message.to, { required: false }),
				...copiedRecipients(input),
				attachments: normalizeOutboundAttachments(input.attachments),
			}
		},
	)
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const payload = {
				to: data.toList.map((email) => ({ email })),
				...copiedRecipientsPayload(data),
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
		(
			input: {
				draftId: string
				to: string
				subject: string
				body: string
				replyToMessageId?: string
				attachments?: OutboundAttachment[]
			} & CopiedRecipientsInput,
		) => {
			const message = normalizeMessageFields(input)
			const to = parseRecipientEmails(message.to, { required: true })
			return {
				...message,
				draftId: requireNylasProviderId(input.draftId, 'draft'),
				toList: to,
				...copiedRecipients(input),
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
				...copiedRecipientsPayload(data),
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
