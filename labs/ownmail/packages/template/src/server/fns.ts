/**
 * Server functions — the only place the app talks to Nylas. The grant id is
 * always resolved from the session cookie (see server/session.ts); clients
 * never supply it.
 */

import { type Draft, type Folder, type Message, NylasApiError, type Thread } from '@nylas-labs/cli-kit/v3'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { LOGIN_PATH } from '../components/route-paths.js'
import { threadFoldersAfterMove } from './mail-folders.js'
import { mailboxFromRequest } from './nylas.js'
import { threadSearchParams } from './search.js'

async function requireMailbox() {
	const request = getRequest()
	const resolved = await mailboxFromRequest(request)
	if (!resolved) throw redirect({ to: LOGIN_PATH })
	return resolved
}

/**
 * Maps Nylas API failures to user-safe messages (no internals leak) while
 * keeping quota errors recognizable so the UI can show plan-limit banners.
 */
function friendly(err: unknown): Error {
	if (err instanceof NylasApiError) {
		if (err.status === 429 || /quota|limit exceeded/i.test(err.message)) {
			return new Error(
				'QUOTA: You’ve hit a plan limit (free inboxes can send 200 messages/day). Try again later.',
			)
		}
		if (err.status === 404) return new Error('Not found — it may have been deleted.')
	}
	return new Error('Something went wrong talking to your mailbox. Please try again.')
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
): { thread: Thread; messages: Message[] } {
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
	return { thread, messages: [message] }
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

export const getMailboxInfo = createServerFn({ method: 'GET' }).handler(async () => {
	const { platform } = await import('./platform.js')
	const { env } = await platform()
	const { email, displayName } = await requireMailbox()
	return { email, ...(displayName ? { displayName } : {}), appName: env.APP_NAME }
})

export const getFolders = createServerFn({ method: 'GET' }).handler(async (): Promise<Folder[]> => {
	const { mailbox } = await requireMailbox()
	const res = await mailbox.listFolders()
	return res.data
})

export const getThreads = createServerFn({ method: 'GET' })
	.validator((input: { folderId?: string; pageToken?: string; q?: string; starred?: boolean }) => {
		if (input.folderId !== undefined && input.folderId.length > 200) throw new Error('Invalid folder')
		if (input.pageToken !== undefined && input.pageToken.length > 500) throw new Error('Invalid page token')
		if (input.q !== undefined && input.q.length > 500) throw new Error('Search query too long')
		if (input.starred !== undefined && typeof input.starred !== 'boolean')
			throw new Error('Invalid starred filter')
		return input
	})
	.handler(async ({ data }): Promise<{ threads: Thread[]; nextCursor?: string }> => {
		const { mailbox } = await requireMailbox()
		const search = threadSearchParams(data.q)
		const res = await mailbox.listThreads({
			limit: 30,
			...(data.folderId ? { in: data.folderId } : {}),
			...(data.pageToken ? { page_token: data.pageToken } : {}),
			...search,
			...(data.starred !== undefined ? { starred: data.starred } : {}),
		})
		return { threads: res.data, ...(res.next_cursor ? { nextCursor: res.next_cursor } : {}) }
	})

export const getThreadMessages = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => input)
	.handler(async ({ data }): Promise<{ thread: Thread; messages: Message[]; markedRead?: boolean }> => {
		const { mailbox, email, displayName } = await requireMailbox()
		try {
			const thread = await mailbox.getThread(data.threadId)
			const messageIds = thread.data.message_ids ?? []
			const messages = await Promise.all(messageIds.map((id) => mailbox.getMessage(id).then((r) => r.data)))
			messages.sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
			if (thread.data.unread) {
				await mailbox.updateThread(data.threadId, { unread: false })
				return { thread: { ...thread.data, unread: false }, messages, markedRead: true }
			}
			return { thread: thread.data, messages }
		} catch (err) {
			if (!isNotFound(err)) throw err
			const drafts = await mailbox.listDrafts({ limit: 50 })
			const draft = drafts.data.find((item) => item.id === data.threadId)
			if (!draft) throw friendly(err)
			return draftThreadMessages(draft, email, displayName)
		}
	})

export const sendMessage = createServerFn({ method: 'POST' })
	.validator((input: { to: string; subject: string; body: string; replyToMessageId?: string }) => {
		const to = input.to
			.split(',')
			.map((e) => e.trim())
			.filter(Boolean)
		if (to.length === 0) throw new Error('At least one recipient is required')
		for (const email of to) {
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid recipient: ${email}`)
		}
		if (input.body.length > 500_000) throw new Error('Message body too large')
		if (input.replyToMessageId !== undefined && input.replyToMessageId.length > 500) {
			throw new Error('Invalid reply reference')
		}
		return { ...input, toList: to }
	})
	.handler(async ({ data }) => {
		const { mailbox } = await requireMailbox()
		try {
			await mailbox.send({
				to: data.toList.map((email) => ({ email })),
				subject: data.subject,
				body: data.body,
				...(data.replyToMessageId ? { reply_to_message_id: data.replyToMessageId } : {}),
			})
		} catch (err) {
			throw friendly(err)
		}
		return { ok: true }
	})

// ---- Thread actions -----------------------------------------------------------

export const updateThreadState = createServerFn({ method: 'POST' })
	.validator((input: { threadId: string; unread?: boolean; starred?: boolean; folder?: string }) => input)
	.handler(async ({ data }) => {
		const { mailbox } = await requireMailbox()
		try {
			const folders = data.folder
				? threadFoldersAfterMove((await mailbox.getThread(data.threadId)).data.folders, data.folder)
				: undefined
			await mailbox.updateThread(data.threadId, {
				...(data.unread !== undefined ? { unread: data.unread } : {}),
				...(data.starred !== undefined ? { starred: data.starred } : {}),
				...(folders ? { folders } : {}),
			})
		} catch (err) {
			if (isNotFound(err) && data.folder && ['archive', 'trash'].includes(data.folder)) {
				try {
					await mailbox.deleteDraft(data.threadId)
					return { ok: true }
				} catch {
					// fall through to the original, user-safe thread action error
				}
			}
			throw friendly(err)
		}
		return { ok: true }
	})

// ---- Drafts ---------------------------------------------------------------------

export const saveDraft = createServerFn({ method: 'POST' })
	.validator((input: { draftId?: string; to: string; subject: string; body: string }) => input)
	.handler(async ({ data }) => {
		const { mailbox } = await requireMailbox()
		const to = data.to
			.split(',')
			.map((e) => e.trim())
			.filter(Boolean)
			.map((email) => ({ email }))
		try {
			const payload = { to, subject: data.subject, body: data.body }
			const saved = data.draftId
				? await mailbox.updateDraft(data.draftId, payload)
				: await mailbox.createDraft(payload)
			return { draftId: saved.data.id }
		} catch (err) {
			throw friendly(err)
		}
	})

export const getDraft = createServerFn({ method: 'GET' })
	.validator((input: { draftId: string }) => input)
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
	.validator((input: { draftId: string }) => input)
	.handler(async ({ data }) => {
		const { mailbox } = await requireMailbox()
		try {
			await mailbox.sendDraft(data.draftId)
		} catch (err) {
			throw friendly(err)
		}
		return { ok: true }
	})

export const deleteDraft = createServerFn({ method: 'POST' })
	.validator((input: { draftId: string }) => input)
	.handler(async ({ data }) => {
		const { mailbox } = await requireMailbox()
		try {
			await mailbox.deleteDraft(data.draftId)
		} catch (err) {
			throw friendly(err)
		}
		return { ok: true }
	})

export const listDrafts = createServerFn({ method: 'GET' }).handler(async () => {
	const { mailbox } = await requireMailbox()
	const res = await mailbox.listDrafts({ limit: 50 })
	return res.data
})

// ---- Contacts (compose autocomplete) --------------------------------------------

export const searchContacts = createServerFn({ method: 'GET' })
	.validator((input: { q: string }) => {
		if (input.q.length > 100) throw new Error('Query too long')
		return input
	})
	.handler(async ({ data }): Promise<{ email: string; name?: string }[]> => {
		if (data.q.trim().length < 2) return []
		const { mailbox } = await requireMailbox()
		try {
			const res = await mailbox.listContacts({ limit: 8, email: data.q })
			return res.data
				.flatMap((c) =>
					(c.emails ?? []).map((e) => ({
						email: e.email,
						...(c.given_name || c.surname
							? { name: [c.given_name, c.surname].filter(Boolean).join(' ') }
							: {}),
					})),
				)
				.slice(0, 8)
		} catch {
			return [] // autocomplete is best-effort
		}
	})
