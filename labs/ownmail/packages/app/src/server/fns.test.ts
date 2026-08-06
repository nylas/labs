import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * fns.ts holds every server function. We mock TanStack's createServerFn with a
 * pass-through that captures the inline validator and handler so both can be
 * invoked directly, and mock the request/mailbox layer so we exercise the
 * business logic (grant resolution, error mapping, draft synthesis) in isolation.
 */

// createServerFn().validator(v).handler(h)  and  createServerFn().handler(h).
// Capture validator + handler on the returned object so tests can call each.
vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({
		validator: (validator: unknown) => ({
			handler: (handler: unknown) => ({ validator, handler }),
		}),
		handler: (handler: unknown) => ({ handler }),
	}),
}))

const getRequestMock = vi.fn()
vi.mock('@tanstack/react-start/server', () => ({ getRequest: () => getRequestMock() }))

// redirect() must be identifiable when thrown from an unauthenticated call.
class RedirectSignal extends Error {
	constructor(readonly to: unknown) {
		super('redirect')
	}
}
vi.mock('@tanstack/react-router', () => ({
	redirect: (opts: { to: string }) => new RedirectSignal(opts.to),
}))

const mailboxFromRequestMock = vi.fn()
const nylasMock = vi.fn()
vi.mock('./nylas.js', () => ({
	mailboxFromRequest: (r: Request) => mailboxFromRequestMock(r),
	nylas: () => nylasMock(),
}))

const platformMock = vi.fn()
const usingDevMocksMock = vi.fn()
vi.mock('./platform.js', () => ({ platform: () => platformMock(), usingDevMocks: () => usingDevMocksMock() }))

import { LOGIN_PATH } from '#app/config/route-paths'
import * as fns from './fns.js'

/** A mailbox with every method stubbed; tests override per-case. */
function makeMailbox() {
	return {
		listFolders: vi.fn(),
		listThreads: vi.fn(),
		getThread: vi.fn(),
		getMessage: vi.fn(),
		updateThread: vi.fn(),
		listDrafts: vi.fn(),
		send: vi.fn(),
		deleteDraft: vi.fn(),
		updateDraft: vi.fn(),
		createDraft: vi.fn(),
		getDraft: vi.fn(),
		downloadAttachment: vi.fn(),
		sendDraft: vi.fn(),
		listContacts: vi.fn(),
		getContact: vi.fn(),
		createContact: vi.fn(),
		updateContact: vi.fn(),
		deleteContact: vi.fn(),
	}
}

let mailbox: ReturnType<typeof makeMailbox>

function resolveMailbox(extra: Record<string, unknown> = {}) {
	mailboxFromRequestMock.mockResolvedValue({
		mailbox,
		grantId: 'grant-123',
		email: 'ada@ownmail.com',
		...extra,
	})
}

beforeEach(() => {
	mailbox = makeMailbox()
	getRequestMock.mockReset().mockReturnValue(new Request('http://ownmail.local/'))
	mailboxFromRequestMock.mockReset()
	nylasMock.mockReset().mockResolvedValue({
		getGrant: vi.fn().mockResolvedValue({
			data: { id: 'grant-123', provider: 'nylas' },
		}),
	})
	usingDevMocksMock.mockReset().mockResolvedValue(false)
	mailbox.getDraft.mockResolvedValue({ data: { id: 'd1' } })
	mailbox.listFolders.mockResolvedValue({ data: [] })
	mailbox.updateThread.mockImplementation(async (threadId, fields) => ({
		data: { id: threadId, ...fields },
	}))
	mailbox.send.mockResolvedValue({ data: { id: 'message-sent' } })
	mailbox.sendDraft.mockResolvedValue({ data: { id: 'message-sent-draft' } })
	mailbox.createContact.mockImplementation(async (fields) => ({
		data: { id: 'contact-created', ...fields },
	}))
	platformMock.mockReset().mockResolvedValue({ env: { APP_NAME: 'ownmail' }, kv: null })
})

describe('account settings security', () => {
	it('validates and persists only the session-owned account display name', async () => {
		expect(() => fns.updateMailboxDisplayName.validator(null)).toThrow('Invalid display name')
		expect(() => fns.updateMailboxDisplayName.validator({ displayName: 123 })).toThrow('Invalid display name')
		expect(() => fns.updateMailboxDisplayName.validator({ displayName: '   ' })).toThrow(
			'Invalid display name',
		)
		expect(() => fns.updateMailboxDisplayName.validator({ displayName: 'a'.repeat(121) })).toThrow(
			'Invalid display name',
		)
		expect(() => fns.updateMailboxDisplayName.validator({ displayName: 'Ada\nAdmin' })).toThrow(
			'Invalid display name',
		)
		expect(() =>
			fns.updateMailboxDisplayName.validator({ displayName: 'Ada', grantId: 'other-grant' } as never),
		).toThrow('Invalid display name')

		const updateGrant = vi
			.fn()
			.mockResolvedValue({ data: { id: 'grant-from-session', name: 'Ada Lovelace' } })
		const getGrant = vi.fn().mockResolvedValue({
			data: { id: 'grant-from-session', provider: 'nylas', name: 'Ada Lovelace' },
		})
		nylasMock.mockResolvedValue({ updateGrant, getGrant })
		resolveMailbox({ grantId: 'grant-from-session' })
		const data = fns.updateMailboxDisplayName.validator({ displayName: '  Ada Lovelace  ' })

		expect(await fns.updateMailboxDisplayName.handler({ data })).toEqual({ displayName: 'Ada Lovelace' })
		expect(updateGrant).toHaveBeenCalledWith('grant-from-session', { name: 'Ada Lovelace' })
		expect(getGrant).toHaveBeenCalledWith('grant-from-session')
	})

	it('rejects unauthenticated and stale accounts without exposing upstream details', async () => {
		mailboxFromRequestMock.mockResolvedValue(null)
		await expect(
			fns.updateMailboxDisplayName.handler({ data: { displayName: 'Ada' } }),
		).rejects.toMatchObject({ to: LOGIN_PATH })
		expect(nylasMock).not.toHaveBeenCalled()

		const updateGrant = vi.fn().mockRejectedValue(new NylasApiError('secret upstream account detail', 404))
		nylasMock.mockResolvedValue({ updateGrant, getGrant: vi.fn() })
		resolveMailbox({ grantId: 'stale-session-grant' })
		await expect(fns.updateMailboxDisplayName.handler({ data: { displayName: 'Ada' } })).rejects.toThrow(
			'We could not update this account. Try again.',
		)
	})

	it('fails closed when the provider does not confirm the persisted account name and supports dev mocks', async () => {
		const updateGrant = vi.fn().mockResolvedValue({ data: { id: 'grant-123', name: 'Ada' } })
		const getGrant = vi
			.fn()
			.mockResolvedValueOnce({ data: { id: 'different-grant', name: 'Ada' } })
			.mockResolvedValueOnce({ data: { id: 'grant-123', name: 'Grace' } })
		nylasMock.mockResolvedValue({ updateGrant, getGrant })
		resolveMailbox()
		await expect(fns.updateMailboxDisplayName.handler({ data: { displayName: 'Ada' } })).rejects.toThrow(
			'We could not update this account. Try again.',
		)
		await expect(fns.updateMailboxDisplayName.handler({ data: { displayName: 'Ada' } })).rejects.toThrow(
			'We could not update this account. Try again.',
		)

		usingDevMocksMock.mockResolvedValue(true)
		await expect(
			fns.updateMailboxDisplayName.handler({ data: { displayName: 'Dev Account' } }),
		).resolves.toEqual({ displayName: 'Dev Account' })
	})

	it('keeps password changes disabled unless the administrator explicitly enables them', async () => {
		resolveMailbox()
		platformMock.mockResolvedValue({ env: { APP_NAME: 'ownmail', OWNMAIL_ALLOW_PASSWORD_RESET: 'false' } })
		expect(await fns.getAccountCapabilities.handler({})).toEqual({ passwordResetEnabled: false })
		await expect(
			fns.resetMailboxPassword.handler({ data: { password: 'ValidPassword123!More' } }),
		).rejects.toThrow('Password changes are unavailable')
		expect(nylasMock).not.toHaveBeenCalled()
	})

	it('validates password strength and updates only the session grant when enabled', async () => {
		expect(() => fns.resetMailboxPassword.validator(null)).toThrow('Invalid password')
		expect(() => fns.resetMailboxPassword.validator({ password: 'short' })).toThrow('required security rules')
		const updateGrant = vi.fn().mockResolvedValue({ data: {} })
		nylasMock.mockResolvedValue({ updateGrant })
		resolveMailbox({ grantId: 'grant-from-session' })
		platformMock.mockResolvedValue({ env: { APP_NAME: 'ownmail', OWNMAIL_ALLOW_PASSWORD_RESET: 'true' } })
		const data = fns.resetMailboxPassword.validator({ password: 'ValidPassword123!More' })
		expect(await fns.resetMailboxPassword.handler({ data })).toEqual({ ok: true })
		expect(updateGrant).toHaveBeenCalledWith('grant-from-session', {
			settings: { email: 'ada@ownmail.com', app_password: 'ValidPassword123!More' },
		})
	})

	it('does not expose a provider failure or update development mailboxes', async () => {
		resolveMailbox()
		platformMock.mockResolvedValue({ env: { APP_NAME: 'ownmail', OWNMAIL_ALLOW_PASSWORD_RESET: 'true' } })
		const updateGrant = vi.fn().mockRejectedValue(new Error('provider detail'))
		nylasMock.mockResolvedValue({ updateGrant })
		await expect(
			fns.resetMailboxPassword.handler({ data: { password: 'ValidPassword123!More' } }),
		).rejects.toThrow('Something went wrong')

		usingDevMocksMock.mockResolvedValue(true)
		await expect(
			fns.resetMailboxPassword.handler({ data: { password: 'ValidPassword123!More' } }),
		).resolves.toEqual({ ok: true })
		expect(updateGrant).toHaveBeenCalledTimes(1)
	})
})

describe('requireMailbox (auth gate)', () => {
	it('redirects unauthenticated callers to the login page', async () => {
		mailboxFromRequestMock.mockResolvedValue(null)
		await expect(fns.getFolders.handler({})).rejects.toMatchObject({ to: LOGIN_PATH })
	})
})

describe('getMailboxInfo', () => {
	it('uses the session-owned development display name without calling the provider', async () => {
		usingDevMocksMock.mockResolvedValue(true)
		resolveMailbox({ displayName: 'Dev Ada' })

		expect(await fns.getMailboxInfo.handler({})).toMatchObject({
			email: 'ada@ownmail.com',
			displayName: 'Dev Ada',
		})
		expect(nylasMock).not.toHaveBeenCalled()
	})

	it('returns the email, app name, and display name when present', async () => {
		const getGrant = vi.fn().mockResolvedValue({
			data: { id: 'grant-123', provider: 'nylas', name: 'Ada Lovelace' },
		})
		nylasMock.mockResolvedValue({ getGrant })
		resolveMailbox()
		expect(await fns.getMailboxInfo.handler({})).toEqual({
			email: 'ada@ownmail.com',
			displayName: 'Ada Lovelace',
			appName: 'ownmail',
			accounts: [],
		})
	})

	it('returns the configured site name instead of the worker project identifier', async () => {
		resolveMailbox()
		platformMock.mockResolvedValue({ env: { APP_NAME: 'mail-worker-42', OWNMAIL_SITE_NAME: 'Acme Mail' } })
		expect(await fns.getMailboxInfo.handler({})).toMatchObject({ appName: 'Acme Mail' })
	})

	it('omits displayName when the mailbox has none', async () => {
		resolveMailbox()
		const info = await fns.getMailboxInfo.handler({})
		expect(info).toEqual({ email: 'ada@ownmail.com', appName: 'ownmail', accounts: [] })
	})

	it('fails closed on malformed or mismatched grant metadata', async () => {
		resolveMailbox()
		const getGrant = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ data: { id: 'grant-123', name: 123 } })
			.mockResolvedValueOnce({ data: { id: 'another-grant', name: 'Mallory' } })
		nylasMock.mockResolvedValue({ getGrant })
		await expect(fns.getMailboxInfo.handler({})).rejects.toThrow('Something went wrong')
		await expect(fns.getMailboxInfo.handler({})).rejects.toThrow('Something went wrong')
		await expect(fns.getMailboxInfo.handler({})).rejects.toThrow('Something went wrong')
		await expect(fns.getMailboxInfo.handler({})).rejects.toThrow('Something went wrong')
	})
})

describe('getFolders', () => {
	it('returns the mailbox folder list', async () => {
		resolveMailbox()
		mailbox.listFolders.mockResolvedValue({ data: [{ id: 'inbox' }] })
		expect(await fns.getFolders.handler({})).toEqual([{ id: 'inbox' }])
	})

	it('normalizes malformed provider lists and maps fetch failures to recovery guidance', async () => {
		resolveMailbox()
		mailbox.listFolders.mockResolvedValueOnce({ data: undefined })
		expect(await fns.getFolders.handler({})).toEqual([])

		mailbox.listFolders.mockRejectedValueOnce(new NylasApiError('expired', 401))
		await expect(fns.getFolders.handler({})).rejects.toThrow(
			'Your mailbox session expired. Sign in again and retry.',
		)
	})
})

describe('getThreads', () => {
	it('validates and passes through folder/search/paging/starred filters', () => {
		const data = fns.getThreads.validator({
			folderId: 'work',
			pageToken: 'tok',
			q: 'hello',
			starred: true,
		})
		expect(data).toMatchObject({ folderId: 'work', pageToken: 'tok', q: 'hello', starred: true })
	})

	it('applies all optional query params and surfaces the next cursor', async () => {
		resolveMailbox()
		mailbox.listThreads.mockResolvedValue({ data: [{ id: 't1' }], next_cursor: 'next' })
		const res = await fns.getThreads.handler({
			data: { folderId: 'work', pageToken: 'tok', q: 'a@b.com', starred: true },
		})
		expect(mailbox.listThreads).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 30,
				in: 'work',
				page_token: 'tok',
				starred: true,
				any_email: 'a@b.com',
			}),
		)
		expect(res).toEqual({ threads: [{ id: 't1' }], nextCursor: 'next' })
	})

	it('omits optional params and the cursor when unset', async () => {
		resolveMailbox()
		mailbox.listThreads.mockResolvedValue({ data: [] })
		const res = await fns.getThreads.handler({ data: {} })
		expect(mailbox.listThreads).toHaveBeenCalledWith({ limit: 30 })
		expect(res).toEqual({ threads: [] })
	})

	it('maps provider fetch failures to recovery guidance', async () => {
		resolveMailbox()
		mailbox.listThreads.mockRejectedValue(new Error('offline'))

		await expect(fns.getThreads.handler({ data: {} })).rejects.toThrow(
			'Something went wrong talking to your mailbox. Check your connection and try again.',
		)
	})
})

describe('getThreadMessages', () => {
	it('validates the thread id', () => {
		expect(fns.getThreadMessages.validator({ threadId: 'thread-1' })).toEqual({ threadId: 'thread-1' })
	})

	it('marks an unread thread read and returns sorted messages', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { message_ids: ['m2', 'm1'], unread: true } })
		mailbox.getMessage.mockImplementation((id: string) =>
			Promise.resolve({ data: { id, date: id === 'm1' ? 1 : 2 } }),
		)
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })

		expect(mailbox.updateThread).toHaveBeenCalledWith('t1', { unread: false })
		expect(res.markedRead).toBe(true)
		expect(res.thread.unread).toBe(false)
		expect(res.messages.map((m) => m.id)).toEqual(['m1', 'm2']) // sorted by date
	})

	it('returns a read thread untouched (no message_ids -> empty list)', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { unread: false } })
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })
		expect(mailbox.updateThread).not.toHaveBeenCalled()
		expect(res).toEqual({ thread: { unread: false }, messages: [], mailboxEmail: 'ada@ownmail.com' })
	})

	it('sorts messages with missing dates as 0', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { message_ids: ['a', 'b'], unread: false } })
		mailbox.getMessage.mockImplementation((id: string) => Promise.resolve({ data: { id } }))
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })
		expect(res.messages).toHaveLength(2)
	})

	it('supports an explicit read mutation with a canonical thread and folder receipt', async () => {
		resolveMailbox()
		mailbox.listFolders.mockResolvedValue({ data: [{ id: 'inbox', name: 'Inbox' }] })

		const result = await fns.markThreadRead.handler({ data: { threadId: 't1' } })

		expect(mailbox.updateThread).toHaveBeenCalledWith('t1', { unread: false })
		expect(result).toEqual({
			thread: { id: 't1', unread: false },
			folders: [{ id: 'inbox', name: 'Inbox' }],
		})
		expect(fns.markThreadRead.validator({ threadId: 't1' })).toEqual({ threadId: 't1' })
	})

	it('keeps explicit mark-read provider failures generic', async () => {
		resolveMailbox()
		mailbox.updateThread.mockRejectedValue(new Error('sensitive provider detail'))
		await expect(fns.markThreadRead.handler({ data: { threadId: 't1' } })).rejects.toThrow(
			'Something went wrong talking to your mailbox.',
		)
	})

	it('falls back to a synthesized draft thread when the thread 404s but a draft matches', async () => {
		resolveMailbox({ displayName: 'Ada' })
		mailbox.getThread.mockRejectedValue(new NylasApiError('gone', 404))
		const body = '<pre data-ownmail-markdown="1"># hello\n**world**</pre>'
		mailbox.listDrafts.mockResolvedValue({
			data: [
				{
					id: 't1',
					grant_id: 'g',
					subject: 'Hi',
					body,
					to: [{ email: 'x@y.com' }],
					attachments: [{ is_inline: false }],
				},
			],
		})
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })
		expect(res.thread.subject).toBe('Hi')
		expect(res.thread.snippet).toBe('# hello **world**') // stripHtml fallback
		expect(res.thread.has_attachments).toBe(true)
		expect(res.messages[0]).toMatchObject({
			body,
			folders: ['drafts'],
			from: [{ email: 'ada@ownmail.com', name: 'Ada' }],
		})
		expect(res.ownmailDraftMessageIds).toEqual(['t1'])
		expect(res.mailboxEmail).toBe('ada@ownmail.com')
	})

	it('synthesizes a draft thread using draft-provided fields when present', async () => {
		resolveMailbox()
		mailbox.getThread.mockRejectedValue(new NylasApiError('gone', 404))
		mailbox.listDrafts.mockResolvedValue({
			data: [
				{
					id: 'd1',
					grant_id: 'g',
					thread_id: 'th',
					subject: 'S',
					snippet: 'preset snippet',
					from: [{ email: 'sender@x.com' }],
					folders: ['custom'],
					starred: true,
					date: 123,
					attachments: [{ is_inline: true }],
				},
			],
		})
		const res = await fns.getThreadMessages.handler({ data: { threadId: 'd1' } })
		expect(res.thread.snippet).toBe('preset snippet')
		expect(res.thread.folders).toEqual(['custom'])
		expect(res.thread.starred).toBe(true)
		expect(res.thread.has_attachments).toBe(false) // only inline attachment
		expect(res.messages[0].from).toEqual([{ email: 'sender@x.com' }])
		expect(res.messages[0].thread_id).toBe('th')
		expect(res.ownmailDraftMessageIds).toEqual(['d1'])
	})

	it('synthesizes a draft thread with defaults when the draft and mailbox lack optional fields', async () => {
		resolveMailbox() // no displayName
		mailbox.getThread.mockRejectedValue(new NylasApiError('gone', 404))
		mailbox.listDrafts.mockResolvedValue({ data: [{ id: 't1', grant_id: 'g' }] })
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })

		// from falls back to the mailbox email with no name; snippet derives from an empty body.
		expect(res.messages[0].from).toEqual([{ email: 'ada@ownmail.com' }])
		expect(res.thread.snippet).toBe('')
		expect(res.thread.folders).toEqual(['drafts'])
		expect(res.thread.has_attachments).toBe(false)
	})

	it('maps a 404 with no matching draft to a friendly not-found error', async () => {
		resolveMailbox()
		mailbox.getThread.mockRejectedValue(new NylasApiError('gone', 404))
		mailbox.listDrafts.mockResolvedValue({ data: [] })
		await expect(fns.getThreadMessages.handler({ data: { threadId: 't1' } })).rejects.toThrow(/Not found/)
	})

	it('rethrows non-not-found errors from getThread', async () => {
		resolveMailbox()
		mailbox.getThread.mockRejectedValue(new NylasApiError('server', 500))
		await expect(fns.getThreadMessages.handler({ data: { threadId: 't1' } })).rejects.toThrow('server')
	})
})

describe('sendMessage', () => {
	it('rejects malformed message fields with a controlled validation error', () => {
		expect(() => fns.sendMessage.validator({ to: 'a@b.com', subject: 123, body: 'b' } as never)).toThrow(
			'Invalid message',
		)
		expect(() => fns.sendMessage.validator({ to: 'a@b.com', subject: 's', body: null } as never)).toThrow(
			'Invalid message',
		)
	})

	it('rejects an over-long subject and unsafe reply reference', () => {
		expect(() => fns.sendMessage.validator({ to: 'a@b.com', subject: 's'.repeat(501), body: 'b' })).toThrow(
			'Message subject too large',
		)
		expect(() =>
			fns.sendMessage.validator({ to: 'a@b.com', subject: 's', body: 'b', replyToMessageId: 'id\nnext' }),
		).toThrow('Invalid reply reference')
	})

	it('rejects an over-large body', () => {
		expect(() =>
			fns.sendMessage.validator({ to: 'a@b.com', subject: 's', body: 'x'.repeat(500_001) }),
		).toThrow('too large')
	})

	it('rejects an over-long reply reference', () => {
		expect(() =>
			fns.sendMessage.validator({
				to: 'a@b.com',
				subject: 's',
				body: 'b',
				replyToMessageId: 'x'.repeat(501),
			}),
		).toThrow('Invalid reply reference')
	})

	it('normalizes recipients and attachments', () => {
		const data = fns.sendMessage.validator({
			to: 'a@b.com, c@d.com',
			subject: 's',
			body: 'b',
			replyToMessageId: 'r1',
		})
		expect(data.toList).toEqual(['a@b.com', 'c@d.com'])
	})

	it('sends with attachments and a reply reference', async () => {
		resolveMailbox()
		await fns.sendMessage.handler({
			data: {
				subject: 's',
				body: 'b',
				toList: ['a@b.com'],
				attachments: [{ filename: 'f', content_type: 'text/plain', content: 'AAAA' }],
				replyToMessageId: 'r1',
			},
		})
		expect(mailbox.send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: [{ email: 'a@b.com' }],
				reply_to_message_id: 'r1',
				attachments: [{ filename: 'f', content_type: 'text/plain', content: 'AAAA' }],
			}),
		)
	})

	it('sends without optional fields', async () => {
		resolveMailbox()
		const res = await fns.sendMessage.handler({ data: { subject: 's', body: 'b', toList: ['a@b.com'] } })
		expect(res).toEqual({ message: { id: 'message-sent' }, folders: [] })
		expect(mailbox.send.mock.calls[0][0]).not.toHaveProperty('reply_to_message_id')
	})

	it('signals both the mail domain and legacy counter after a successful local mutation', async () => {
		resolveMailbox()
		const increment = vi.fn().mockResolvedValue(1)
		platformMock.mockResolvedValue({ env: { APP_NAME: 'ownmail' }, kv: { increment } })

		await fns.sendMessage.handler({ data: { subject: 's', body: 'b', toList: ['a@b.com'] } })

		expect(increment).toHaveBeenCalledWith('version:grant-123')
		expect(increment).toHaveBeenCalledWith('version:grant-123:mail')
	})

	it('does not report a confirmed send as failed when reconciliation storage is unavailable', async () => {
		resolveMailbox()
		mailbox.listFolders.mockRejectedValue(new Error('folder refresh unavailable'))
		platformMock.mockRejectedValue(new Error('shared storage unavailable'))

		await expect(
			fns.sendMessage.handler({ data: { subject: 's', body: 'b', toList: ['a@b.com'] } }),
		).resolves.toEqual({ message: { id: 'message-sent' } })
	})

	it('maps a quota error to a recognizable QUOTA message', async () => {
		resolveMailbox()
		mailbox.send.mockRejectedValue(new NylasApiError('rate', 429))
		await expect(
			fns.sendMessage.handler({ data: { subject: 's', body: 'b', toList: ['a@b.com'] } }),
		).rejects.toThrow(/QUOTA/)
	})
})

describe('updateThreadState', () => {
	it('validates state input', () => {
		expect(fns.updateThreadState.validator({ threadId: 't1', unread: true })).toMatchObject({
			threadId: 't1',
		})
	})

	it('moves a thread between folders, computing the new folder set', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { folders: ['inbox'] } })
		await fns.updateThreadState.handler({
			data: { threadId: 't1', folder: 'archive', unread: false, starred: true },
		})
		expect(mailbox.updateThread).toHaveBeenCalledWith('t1', {
			unread: false,
			starred: true,
			folders: ['archive'],
		})
	})

	it('updates flags without a folder move', async () => {
		resolveMailbox()
		await fns.updateThreadState.handler({ data: { threadId: 't1', starred: false } })
		expect(mailbox.getThread).not.toHaveBeenCalled()
		expect(mailbox.updateThread).toHaveBeenCalledWith('t1', { starred: false })
	})

	it('deletes a draft when archiving a not-found thread', async () => {
		resolveMailbox()
		mailbox.getThread.mockRejectedValue(new NylasApiError('gone', 404))
		mailbox.deleteDraft.mockResolvedValue(undefined)
		const res = await fns.updateThreadState.handler({ data: { threadId: 't1', folder: 'trash' } })
		expect(mailbox.deleteDraft).toHaveBeenCalledWith('t1')
		expect(res).toEqual({ removedDraftId: 't1', folders: [] })
	})

	it('falls through to a friendly error when the draft delete also fails', async () => {
		resolveMailbox()
		mailbox.getThread.mockRejectedValue(new NylasApiError('gone', 404))
		mailbox.deleteDraft.mockRejectedValue(new Error('nope'))
		await expect(
			fns.updateThreadState.handler({ data: { threadId: 't1', folder: 'archive' } }),
		).rejects.toThrow(/Not found/)
	})

	it('maps other errors to a friendly message', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { folders: [] } })
		mailbox.updateThread.mockRejectedValue(new NylasApiError('boom', 500))
		await expect(fns.updateThreadState.handler({ data: { threadId: 't1', folder: 'work' } })).rejects.toThrow(
			/Something went wrong/,
		)
	})
})

describe('saveDraft', () => {
	it('applies the same message bounds before storing a draft', () => {
		expect(() => fns.saveDraft.validator({ to: 'a@b.com', subject: 's', body: 'x'.repeat(500_001) })).toThrow(
			'Message body too large',
		)
		expect(() => fns.saveDraft.validator({ to: 123, subject: 's', body: 'b' } as never)).toThrow(
			'Invalid message',
		)
	})

	it('validates and normalizes with a draft id', () => {
		const data = fns.saveDraft.validator({ draftId: 'd1', to: 'a@b.com', subject: 's', body: 'b' })
		expect(data.draftId).toBe('d1')
		expect(data.toList).toEqual(['a@b.com'])
	})

	it('normalizes a new draft (no draft id) without minting one', () => {
		const data = fns.saveDraft.validator({ to: 'a@b.com', subject: 's', body: 'b' })
		expect(data).not.toHaveProperty('draftId')
		expect(data.toList).toEqual(['a@b.com'])
	})

	it('rejects an over-long reply reference', () => {
		expect(() =>
			fns.saveDraft.validator({
				to: 'a@b.com',
				subject: 's',
				body: 'b',
				replyToMessageId: 'x'.repeat(501),
			}),
		).toThrow('Invalid reply reference')
	})

	it('updates an existing draft', async () => {
		resolveMailbox()
		mailbox.updateDraft.mockResolvedValue({ data: { id: 'd1' } })
		const res = await fns.saveDraft.handler({
			data: { draftId: 'd1', toList: ['a@b.com'], subject: 's', body: 'b' },
		})
		expect(mailbox.updateDraft).toHaveBeenCalled()
		expect(res).toEqual({ draftId: 'd1', draft: { id: 'd1' }, created: false, folders: [] })
	})

	it('persists a reply reference with an autosaved draft', async () => {
		resolveMailbox()
		mailbox.createDraft.mockResolvedValue({ data: { id: 'd1' } })
		await fns.saveDraft.handler({
			data: { toList: ['a@b.com'], subject: 'Re: Hi', body: 'b', replyToMessageId: 'm9' },
		})
		expect(mailbox.createDraft).toHaveBeenCalledWith(expect.objectContaining({ reply_to_message_id: 'm9' }))
	})

	it('creates a new draft with attachments when there is no draft id', async () => {
		resolveMailbox()
		mailbox.createDraft.mockResolvedValue({ data: { id: 'new' } })
		const res = await fns.saveDraft.handler({
			data: {
				toList: ['a@b.com'],
				subject: 's',
				body: 'b',
				attachments: [{ filename: 'f', content_type: 'text/plain', content: 'AAAA' }],
			},
		})
		expect(mailbox.createDraft).toHaveBeenCalled()
		expect(res).toEqual({ draftId: 'new', draft: { id: 'new' }, created: true, folders: [] })
	})

	it('maps failures to a friendly error', async () => {
		resolveMailbox()
		mailbox.createDraft.mockRejectedValue(new Error('x'))
		await expect(fns.saveDraft.handler({ data: { toList: [], subject: 's', body: 'b' } })).rejects.toThrow(
			/Something went wrong/,
		)
	})
})

describe('getDraft', () => {
	it('validates the draft id', () => {
		expect(fns.getDraft.validator({ draftId: 'd1' })).toEqual({ draftId: 'd1' })
	})

	it('returns draft data', async () => {
		resolveMailbox()
		mailbox.getDraft.mockResolvedValue({ data: { id: 'd1' } })
		expect(await fns.getDraft.handler({ data: { draftId: 'd1' } })).toEqual({ id: 'd1' })
	})

	it('maps failures to a friendly error', async () => {
		resolveMailbox()
		mailbox.getDraft.mockRejectedValue(new NylasApiError('gone', 404))
		await expect(fns.getDraft.handler({ data: { draftId: 'd1' } })).rejects.toThrow(/Not found/)
	})
})

describe('sendDraft', () => {
	it('validates the draft id', () => {
		expect(fns.sendDraft.validator({ draftId: 'd1', to: 'a@b.com', subject: 's', body: 'b' })).toMatchObject({
			draftId: 'd1',
			toList: ['a@b.com'],
		})
	})

	it('rejects an oversized draft body before updating or sending it', () => {
		expect(() =>
			fns.sendDraft.validator({ draftId: 'd1', to: 'a@b.com', subject: 's', body: 'x'.repeat(500_001) }),
		).toThrow('Message body too large')
	})

	it('rejects an over-long reply reference', () => {
		expect(() =>
			fns.sendDraft.validator({
				draftId: 'd1',
				to: 'a@b.com',
				subject: 's',
				body: 'b',
				replyToMessageId: 'x'.repeat(501),
			}),
		).toThrow('Invalid reply reference')
	})

	it('updates and sends a draft', async () => {
		resolveMailbox()
		expect(
			await fns.sendDraft.handler({
				data: { draftId: 'd1', toList: ['a@b.com'], subject: 's', body: '<p>b</p>' },
			}),
		).toEqual({
			removedDraftId: 'd1',
			message: { id: 'message-sent-draft' },
			folders: [],
		})
		expect(mailbox.updateDraft).toHaveBeenCalledWith('d1', {
			to: [{ email: 'a@b.com' }],
			subject: 's',
			body: '<p>b</p>',
		})
		expect(mailbox.sendDraft).toHaveBeenCalledWith('d1')
	})

	it('preserves a reply reference when updating and sending a draft', async () => {
		resolveMailbox()
		await fns.sendDraft.handler({
			data: {
				draftId: 'd1',
				toList: ['a@b.com'],
				subject: 'Re: Hi',
				body: '<p>b</p>',
				replyToMessageId: 'm9',
			},
		})
		expect(mailbox.updateDraft).toHaveBeenCalledWith(
			'd1',
			expect.objectContaining({ reply_to_message_id: 'm9' }),
		)
	})

	it('keeps newly attached files when updating the draft before sending it', async () => {
		resolveMailbox()
		const attachments = [{ filename: 'f.txt', content_type: 'text/plain', content: 'AAAA' }]
		await fns.sendDraft.handler({
			data: { draftId: 'd1', toList: ['a@b.com'], subject: 's', body: '<p>b</p>', attachments },
		})
		expect(mailbox.updateDraft).toHaveBeenCalledWith('d1', expect.objectContaining({ attachments }))
	})

	it('rehydrates provider attachments before replacing a draft', async () => {
		resolveMailbox()
		mailbox.getDraft.mockResolvedValue({
			data: {
				id: 'd1',
				attachments: [
					{ id: 'a1', filename: 'notes.txt', content_type: 'text/plain' },
					{ id: 'a2', is_inline: true, content_id: 'inline-2' },
				],
			},
		})
		mailbox.downloadAttachment
			.mockResolvedValueOnce(new Response('hello'))
			.mockResolvedValueOnce(new Response('image'))
		await fns.sendDraft.handler({
			data: { draftId: 'd1', toList: ['a@b.com'], subject: 's', body: '<p>b</p>' },
		})
		expect(mailbox.downloadAttachment).toHaveBeenCalledWith('a1', 'd1')
		expect(mailbox.updateDraft).toHaveBeenCalledWith(
			'd1',
			expect.objectContaining({
				attachments: [
					{ filename: 'notes.txt', content_type: 'text/plain', content: btoa('hello') },
					{
						filename: 'attachment',
						content_type: 'application/octet-stream',
						content: btoa('image'),
					},
				],
			}),
		)
	})

	it('does not replace a draft when an existing attachment cannot be retrieved', async () => {
		resolveMailbox()
		mailbox.getDraft.mockResolvedValue({ data: { id: 'd1', attachments: [{ id: 'a1' }] } })
		mailbox.downloadAttachment.mockResolvedValue(new Response(null, { status: 404 }))
		await expect(
			fns.sendDraft.handler({ data: { draftId: 'd1', toList: ['a@b.com'], subject: 's', body: '<p>b</p>' } }),
		).rejects.toThrow(/Something went wrong/)
		expect(mailbox.updateDraft).not.toHaveBeenCalled()
		expect(mailbox.sendDraft).not.toHaveBeenCalled()
	})

	it('maps failures to a friendly error', async () => {
		resolveMailbox()
		mailbox.sendDraft.mockRejectedValue(new Error('x'))
		await expect(
			fns.sendDraft.handler({ data: { draftId: 'd1', toList: ['a@b.com'], subject: 's', body: 'b' } }),
		).rejects.toThrow(/Something went wrong/)
	})
})

describe('deleteDraft', () => {
	it('validates the draft id', () => {
		expect(fns.deleteDraft.validator({ draftId: 'd1' })).toEqual({ draftId: 'd1' })
	})

	it('deletes a draft', async () => {
		resolveMailbox()
		expect(await fns.deleteDraft.handler({ data: { draftId: 'd1' } })).toEqual({
			removedDraftId: 'd1',
			folders: [],
		})
	})

	it('maps failures to a friendly error', async () => {
		resolveMailbox()
		mailbox.deleteDraft.mockRejectedValue(new Error('x'))
		await expect(fns.deleteDraft.handler({ data: { draftId: 'd1' } })).rejects.toThrow(/Something went wrong/)
	})
})

describe('listDrafts', () => {
	it('lists drafts', async () => {
		resolveMailbox()
		mailbox.listDrafts.mockResolvedValue({ data: [{ id: 'd1' }] })
		expect(await fns.listDrafts.handler({})).toEqual([{ id: 'd1' }])
	})

	it('maps provider failures to recovery guidance', async () => {
		resolveMailbox()
		mailbox.listDrafts.mockRejectedValue(new Error('offline'))

		await expect(fns.listDrafts.handler({})).rejects.toThrow(
			'Something went wrong talking to your mailbox. Check your connection and try again.',
		)
	})
})

describe('getContacts', () => {
	it('rejects a page token that is not a valid provider id', () => {
		expect(() => fns.getContacts.validator({ pageToken: 'x\n' })).toThrow('Invalid page token')
	})

	it('omits the page token from the query when none is supplied', () => {
		expect(fns.getContacts.validator({})).toEqual({})
	})

	it('lists the first page and surfaces the next cursor', async () => {
		resolveMailbox()
		mailbox.listContacts.mockResolvedValue({
			data: [{ id: 'contact-1', given_name: 'Ada' }],
			next_cursor: 'cursor-2',
		})
		const res = await fns.getContacts.handler({ data: {} })
		expect(mailbox.listContacts).toHaveBeenCalledWith({ limit: 50 })
		expect(res).toEqual({ contacts: [{ id: 'contact-1', given_name: 'Ada' }], nextCursor: 'cursor-2' })
	})

	it('passes the page token through and omits an absent cursor', async () => {
		resolveMailbox()
		mailbox.listContacts.mockResolvedValue({ data: [] })
		const res = await fns.getContacts.handler({ data: { pageToken: 'cursor-2' } })
		expect(mailbox.listContacts).toHaveBeenCalledWith({ limit: 50, page_token: 'cursor-2' })
		expect(res).toEqual({ contacts: [] })
	})

	it('normalizes an absent contacts list to an empty list', async () => {
		resolveMailbox()
		mailbox.listContacts.mockResolvedValue({ data: null } as never)
		expect(await fns.getContacts.handler({ data: {} })).toEqual({ contacts: [] })
	})

	it('maps API failures to a user-safe error', async () => {
		resolveMailbox()
		mailbox.listContacts.mockRejectedValue(new Error('down'))
		await expect(fns.getContacts.handler({ data: {} })).rejects.toThrow('Something went wrong')
	})
})

describe('getContact', () => {
	it('rejects an invalid contact id', () => {
		expect(() => fns.getContact.validator({ contactId: '' })).toThrow('Invalid contact')
	})

	it('returns the contact record', async () => {
		resolveMailbox()
		mailbox.getContact.mockResolvedValue({ data: { id: 'contact-1', given_name: 'Ada' } })
		expect(await fns.getContact.handler({ data: { contactId: 'contact-1' } })).toEqual({
			id: 'contact-1',
			given_name: 'Ada',
		})
	})

	it('maps a missing contact to a not-found error', async () => {
		resolveMailbox()
		mailbox.getContact.mockRejectedValue(new NylasApiError('gone', 404))
		await expect(fns.getContact.handler({ data: { contactId: 'contact-1' } })).rejects.toThrow('Not found')
	})
})

describe('createContact', () => {
	it('rejects a contact with no identifying fields', () => {
		expect(() => fns.createContact.validator({})).toThrow('Add a name, company, or email')
	})

	it('normalizes the form fields into a Nylas payload', () => {
		expect(fns.createContact.validator({ givenName: '  Ada  ', emails: [{ email: 'ada@x.com' }] })).toEqual({
			given_name: 'Ada',
			emails: [{ email: 'ada@x.com' }],
		})
	})

	it('creates the contact and returns its id', async () => {
		resolveMailbox()
		mailbox.createContact.mockResolvedValue({ data: { id: 'contact-new' } })
		const res = await fns.createContact.handler({ data: { given_name: 'Ada' } })
		expect(mailbox.createContact).toHaveBeenCalledWith({ given_name: 'Ada' })
		expect(res).toEqual({ contactId: 'contact-new', contact: { id: 'contact-new' } })
	})

	it('maps API failures to a user-safe error', async () => {
		resolveMailbox()
		mailbox.createContact.mockRejectedValue(new Error('down'))
		await expect(fns.createContact.handler({ data: { given_name: 'Ada' } })).rejects.toThrow(
			'Something went wrong',
		)
	})
})

describe('updateContact', () => {
	it('rejects an invalid contact id before validating fields', () => {
		expect(() => fns.updateContact.validator({ contactId: '', givenName: 'Ada' })).toThrow('Invalid contact')
	})

	it('splits the id from the normalized fields', () => {
		expect(fns.updateContact.validator({ contactId: 'contact-1', givenName: 'Ada' })).toEqual({
			contactId: 'contact-1',
			fields: { given_name: 'Ada' },
		})
	})

	it('sends the full field set on update (PUT replaces the contact)', async () => {
		resolveMailbox()
		mailbox.updateContact.mockResolvedValue({ data: { id: 'contact-1' } })
		const res = await fns.updateContact.handler({
			data: { contactId: 'contact-1', fields: { given_name: 'Ada' } },
		})
		expect(mailbox.updateContact).toHaveBeenCalledWith('contact-1', { given_name: 'Ada' })
		expect(res).toEqual({ contact: { id: 'contact-1' } })
	})

	it('maps API failures to a user-safe error', async () => {
		resolveMailbox()
		mailbox.updateContact.mockRejectedValue(new Error('down'))
		await expect(
			fns.updateContact.handler({ data: { contactId: 'contact-1', fields: { given_name: 'Ada' } } }),
		).rejects.toThrow('Something went wrong')
	})
})

describe('deleteContact', () => {
	it('rejects an invalid contact id', () => {
		expect(() => fns.deleteContact.validator({ contactId: '' })).toThrow('Invalid contact')
	})

	it('deletes the contact', async () => {
		resolveMailbox()
		mailbox.deleteContact.mockResolvedValue(undefined)
		const res = await fns.deleteContact.handler({ data: { contactId: 'contact-1' } })
		expect(mailbox.deleteContact).toHaveBeenCalledWith('contact-1')
		expect(res).toEqual({ removedContactId: 'contact-1' })
	})

	it('maps API failures to a user-safe error', async () => {
		resolveMailbox()
		mailbox.deleteContact.mockRejectedValue(new Error('down'))
		await expect(fns.deleteContact.handler({ data: { contactId: 'contact-1' } })).rejects.toThrow(
			'Something went wrong',
		)
	})
})

describe('saveComposeRecipients', () => {
	it('validates addresses, deduplicates them, and saves only new external contacts', async () => {
		expect(() => fns.saveComposeRecipients.validator(null)).toThrow('Invalid recipients')
		expect(() => fns.saveComposeRecipients.validator({ emails: Array(21).fill('a@x.com') })).toThrow(
			'Invalid recipients',
		)
		expect(() => fns.saveComposeRecipients.validator({ emails: [123] })).toThrow('Invalid recipients')
		expect(() => fns.saveComposeRecipients.validator({ emails: [''] })).toThrow('Invalid recipients')
		expect(() => fns.saveComposeRecipients.validator({ emails: ['not-an-email'] })).toThrow(
			'Invalid recipient',
		)
		expect(() => fns.saveComposeRecipients.validator({ emails: [`${'a'.repeat(315)}@x.com`] })).toThrow(
			'Invalid recipient',
		)
		expect(fns.saveComposeRecipients.validator({ emails: ['ADA@x.com', 'ada@x.com'] })).toEqual({
			emails: ['ada@x.com'],
		})

		resolveMailbox()
		mailbox.listContacts
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [{ emails: [{ email: 'already@x.com' }] }] })
			.mockRejectedValueOnce(new Error('optional contact failure'))
		await expect(
			fns.saveComposeRecipients.handler({
				data: { emails: ['new@x.com', 'already@x.com', 'ada@ownmail.com', 'skip@x.com'] },
			}),
		).resolves.toEqual({
			contacts: [{ id: 'contact-created', emails: [{ email: 'new@x.com' }] }],
		})
		expect(mailbox.createContact).toHaveBeenCalledWith({ emails: [{ email: 'new@x.com' }] })
		expect(mailbox.createContact).toHaveBeenCalledTimes(1)
	})

	it('saves a recipient when the provider returns no contacts data', async () => {
		resolveMailbox()
		mailbox.listContacts.mockResolvedValue({ data: null } as never)
		await expect(fns.saveComposeRecipients.handler({ data: { emails: ['new@x.com'] } })).resolves.toEqual({
			contacts: [{ id: 'contact-created', emails: [{ email: 'new@x.com' }] }],
		})
		expect(mailbox.createContact).toHaveBeenCalledWith({ emails: [{ email: 'new@x.com' }] })
	})
})

describe('searchContacts', () => {
	it('rejects an over-long query', () => {
		expect(() => fns.searchContacts.validator({ q: 'x'.repeat(101) })).toThrow('too long')
	})

	it('passes short-enough queries through validation', () => {
		expect(fns.searchContacts.validator({ q: 'ada' })).toEqual({ q: 'ada' })
	})

	it('short-circuits queries under two characters without hitting the API', async () => {
		resolveMailbox()
		expect(await fns.searchContacts.handler({ data: { q: ' a ' } })).toEqual([])
		expect(mailbox.listContacts).not.toHaveBeenCalled()
	})

	it('maps contacts to email + name, capped at eight results', async () => {
		resolveMailbox()
		mailbox.listContacts.mockResolvedValue({
			data: [
				{ given_name: 'Ada', surname: 'Lovelace', emails: [{ email: 'ada@x.com' }] },
				{ surname: 'Solo', emails: [{ email: 'solo@x.com' }] },
				{ given_name: 'Emailless' }, // contact with no emails array -> yields nothing
				{ emails: [{ email: 'noname@x.com' }] },
			],
		})
		const res = await fns.searchContacts.handler({ data: { q: 'ada' } })
		expect(res).toEqual([
			{ email: 'ada@x.com', name: 'Ada Lovelace' },
			{ email: 'solo@x.com', name: 'Solo' },
			{ email: 'noname@x.com' },
		])
	})

	it('returns [] on API failure (autocomplete is best-effort)', async () => {
		resolveMailbox()
		mailbox.listContacts.mockRejectedValue(new Error('down'))
		expect(await fns.searchContacts.handler({ data: { q: 'ada' } })).toEqual([])
	})
})

describe('error mapping edge cases', () => {
	it('maps a NylasApiError whose message mentions a quota to QUOTA even without a 429', async () => {
		resolveMailbox()
		mailbox.send.mockRejectedValue(new NylasApiError('quota exceeded for today', 400))
		await expect(
			fns.sendMessage.handler({ data: { subject: 's', body: 'b', toList: ['a@b.com'] } }),
		).rejects.toThrow(/QUOTA/)
	})

	it('treats a plain Error whose message says "deleted" as not-found for archive cleanup', async () => {
		resolveMailbox()
		mailbox.getThread.mockRejectedValue(new Error('thread was deleted'))
		mailbox.deleteDraft.mockResolvedValue(undefined)
		const res = await fns.updateThreadState.handler({ data: { threadId: 't1', folder: 'archive' } })
		expect(res).toEqual({ removedDraftId: 't1', folders: [] })
	})
})
