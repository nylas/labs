/**
 * Server functions — the only place the app talks to Nylas. The grant id is
 * always resolved from the session cookie (see server/session.ts); clients
 * never supply it.
 */

import { type Folder, type Message, NylasApiError, type Thread } from '@nylas-labs/cli-kit/v3'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { mailboxFromRequest } from './nylas.js'

async function requireMailbox() {
	const request = getRequest()
	const resolved = await mailboxFromRequest(request)
	if (!resolved) throw redirect({ to: '/auth' })
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
	.validator((input: { folderId?: string; pageToken?: string; q?: string }) => {
		if (input.folderId !== undefined && input.folderId.length > 200) throw new Error('Invalid folder')
		if (input.pageToken !== undefined && input.pageToken.length > 500) throw new Error('Invalid page token')
		if (input.q !== undefined && input.q.length > 500) throw new Error('Search query too long')
		return input
	})
	.handler(async ({ data }): Promise<{ threads: Thread[]; nextCursor?: string }> => {
		const { mailbox } = await requireMailbox()
		const res = await mailbox.listThreads({
			limit: 30,
			...(data.folderId ? { in: data.folderId } : {}),
			...(data.pageToken ? { page_token: data.pageToken } : {}),
			...(data.q ? { search_query_native: data.q } : {}),
		})
		return { threads: res.data, ...(res.next_cursor ? { nextCursor: res.next_cursor } : {}) }
	})

export const getThreadMessages = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => input)
	.handler(async ({ data }): Promise<{ thread: Thread; messages: Message[] }> => {
		const { mailbox } = await requireMailbox()
		const thread = await mailbox.getThread(data.threadId)
		const messageIds = thread.data.message_ids ?? []
		const messages = await Promise.all(messageIds.map((id) => mailbox.getMessage(id).then((r) => r.data)))
		messages.sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
		if (thread.data.unread) {
			// Fire-and-forget read marking; a failure only affects the badge.
			mailbox.updateThread(data.threadId, { unread: false }).catch(() => {})
		}
		return { thread: thread.data, messages }
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
			await mailbox.updateThread(data.threadId, {
				...(data.unread !== undefined ? { unread: data.unread } : {}),
				...(data.starred !== undefined ? { starred: data.starred } : {}),
				...(data.folder ? { folders: [data.folder] } : {}),
			})
		} catch (err) {
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
		const res = await mailbox.listDrafts({ limit: 50 })
		const draft = res.data.find((d) => d.id === data.draftId)
		if (!draft) throw friendly(new NylasApiError('draft not found', 404))
		return draft
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
