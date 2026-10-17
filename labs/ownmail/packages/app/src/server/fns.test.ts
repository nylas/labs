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
const setResponseHeaderMock = vi.fn()
vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () => getRequestMock(),
	setResponseHeader: (name: string, value: string) => setResponseHeaderMock(name, value),
}))

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
		getRawMime: vi.fn(),
		listMessages: vi.fn(),
		updateThread: vi.fn(),
		listDrafts: vi.fn(),
		send: vi.fn(),
		cancelScheduledMessage: vi.fn(),
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
	setResponseHeaderMock.mockReset()
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
	platformMock
		.mockReset()
		.mockResolvedValue({ env: { APP_NAME: 'ownmail', SESSION_SECRET: 'test-session-secret' }, kv: null })
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

	it('sends the refreshed session cookie when activity slid the expiry', async () => {
		resolveMailbox({ refreshCookie: 'ownmail_session=slid; Max-Age=1209600' })
		mailbox.listFolders.mockResolvedValue({ data: [] })

		await fns.getFolders.handler({})
		// Without the Set-Cookie the browser would still drop the session on the old deadline.
		expect(setResponseHeaderMock).toHaveBeenCalledWith('set-cookie', 'ownmail_session=slid; Max-Age=1209600')
	})

	it('leaves the response headers untouched when the expiry was not due to slide', async () => {
		resolveMailbox()
		mailbox.listFolders.mockResolvedValue({ data: [] })

		await fns.getFolders.handler({})
		expect(setResponseHeaderMock).not.toHaveBeenCalled()
	})
})

describe('getMailboxInfo', () => {
	it('validates bootstrap input and skips optional provider metadata during initial loading', async () => {
		expect(fns.getMailboxInfo.validator(undefined)).toEqual({ bootstrap: false })
		expect(fns.getMailboxInfo.validator({ bootstrap: true })).toEqual({ bootstrap: true })
		for (const input of [null, 'true', [], {}, { bootstrap: true, secret: 'x' }])
			expect(() => fns.getMailboxInfo.validator(input as any)).toThrow('Invalid request')
		resolveMailbox()
		expect(await fns.getMailboxInfo.handler({ data: { bootstrap: true } })).toMatchObject({
			email: 'ada@ownmail.com',
		})
		expect(nylasMock).not.toHaveBeenCalled()
	})

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
				search_query_native: 'a@b.com',
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

describe('getThreadListUnsubscribe', () => {
	it('validates the thread id', () => {
		expect(fns.getThreadListUnsubscribe.validator({ threadId: 'thread-1' })).toEqual({ threadId: 'thread-1' })
		expect(() => fns.getThreadListUnsubscribe.validator({ threadId: 'bad\nid' })).toThrow()
	})

	it('asks for headers on one thread and returns only the ids of bulk messages, never a header value', async () => {
		resolveMailbox()
		mailbox.listMessages.mockResolvedValue({
			data: [
				{
					id: 'news',
					headers: [{ name: 'List-Unsubscribe', value: '<https://secret.example/u?token=abc>' }],
				},
				{ id: 'lower', headers: [{ name: ' list-unsubscribe ', value: '<mailto:leave@example.com>' }] },
				{ id: 'person', headers: [{ name: 'Message-ID', value: '<1@example.com>' }] },
				{ id: 'blank', headers: [{ name: 'List-Unsubscribe', value: '  ' }] },
				{
					id: 'odd',
					headers: [
						null,
						'List-Unsubscribe',
						{ name: 7, value: 'x' },
						{ name: 'List-Unsubscribe', value: 9 },
					],
				},
				{ id: 'none' },
				{ id: 'not-a-list', headers: { 'List-Unsubscribe': 'x' } },
				{ id: 42, headers: [{ name: 'List-Unsubscribe', value: 'x' }] },
				null,
			],
		})
		const result = await fns.getThreadListUnsubscribe.handler({ data: { threadId: 't1' } })

		expect(mailbox.listMessages).toHaveBeenCalledWith({
			thread_id: 't1',
			fields: 'include_headers',
			limit: 50,
		})
		expect(result).toEqual({ messageIds: ['news', 'lower'] })
		expect(JSON.stringify(result)).not.toContain('secret.example')
	})

	it('answers "none" when the lookup fails or returns something unexpected, so the reader still works', async () => {
		resolveMailbox()
		mailbox.listMessages.mockRejectedValue(new NylasApiError('fields is not supported', 400))
		expect(await fns.getThreadListUnsubscribe.handler({ data: { threadId: 't1' } })).toEqual({
			messageIds: [],
		})

		mailbox.listMessages.mockResolvedValue({ data: 'unexpected' })
		expect(await fns.getThreadListUnsubscribe.handler({ data: { threadId: 't1' } })).toEqual({
			messageIds: [],
		})
	})

	it('follows the cursor through every page of a long thread and lists each bulk message once', async () => {
		resolveMailbox()
		const bulk = (id: string) => ({
			id,
			headers: [{ name: 'List-Unsubscribe', value: '<https://u.example>' }],
		})
		mailbox.listMessages
			.mockResolvedValueOnce({ data: [bulk('page-1'), { id: 'person' }], next_cursor: 'cursor-2' })
			// A message that moved between pages mid-walk is reported once.
			.mockResolvedValueOnce({ data: [bulk('page-1'), bulk('page-2')], next_cursor: null })
		const result = await fns.getThreadListUnsubscribe.handler({ data: { threadId: 't1' } })

		expect(mailbox.listMessages).toHaveBeenCalledTimes(2)
		expect(mailbox.listMessages).toHaveBeenLastCalledWith({
			thread_id: 't1',
			fields: 'include_headers',
			limit: 50,
			page_token: 'cursor-2',
		})
		expect(result).toEqual({ messageIds: ['page-1', 'page-2'] })
	})
})

describe('getThreadHeaderFacts', () => {
	it('validates the thread id', () => {
		expect(fns.getThreadHeaderFacts.validator({ threadId: 'thread-1' })).toEqual({ threadId: 'thread-1' })
		expect(() => fns.getThreadHeaderFacts.validator({ threadId: 'bad\nid' })).toThrow()
	})

	it('asks for headers once per thread and returns only derived facts, never a raw header value', async () => {
		resolveMailbox()
		mailbox.listMessages.mockResolvedValue({
			data: [
				{
					id: 'alan',
					from: [{ email: 'alan@bletchley.dev' }],
					headers: [
						{ name: 'Received', value: 'from mail.bletchley.dev by mx1.example.net with ESMTPS id 1' },
						{
							name: 'Authentication-Results',
							value: 'mx1.example.net; dmarc=pass header.from=bletchley.dev',
						},
						{ name: 'Date', value: 'Wed, 14 Oct 2026 07:12:00 -0700' },
						{ name: 'X-Secret', value: 'token=abc123' },
					],
				},
				{
					id: 'grace',
					from: [{ email: 'grace.hopper@vercel.com' }],
					headers: [{ name: 'Reply-To', value: 'Private Name <grace.personal@fastmail.com>' }],
				},
				{
					id: 'parsed-reply-to',
					from: [{ email: 'help@bank.com' }],
					reply_to: [{ name: 'Support <help@bank.com>', email: 'collect@evil.example' }],
					headers: [{ name: 'Reply-To', value: '"Support <help@bank.com>" <collect@evil.example>' }],
				},
				{
					id: 'own',
					from: [{ email: 'Ada@OwnMail.com' }],
					reply_to: [{ email: 'grace.hopper@vercel.com' }],
				},
				{
					id: 'list',
					from: 'not-a-list',
					headers: [
						{ name: 'List-Id', value: 'Eng <eng-all.vercel.com>' },
						{ name: 'List-Unsubscribe', value: '<https://lists.example/u?token=secret>' },
					],
				},
				{ id: '__proto__', from: [{ email: 7 }] },
				{ id: 'bad\nid', headers: [] },
				{ id: 42 },
				null,
			],
		})
		const result = await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })

		expect(mailbox.listMessages).toHaveBeenCalledWith({
			thread_id: 't1',
			fields: 'include_headers',
			limit: 50,
		})
		expect(Object.keys(result.byMessage)).toEqual([
			'alan',
			'grace',
			'parsed-reply-to',
			'own',
			'list',
			'__proto__',
		])
		expect(result.byMessage.alan).toEqual({
			verified: true,
			authFailed: false,
			listUnsubscribe: false,
			dateOffsetMinutes: -420,
		})
		expect(result.byMessage.grace?.replyTo).toBe('grace.personal@fastmail.com')
		expect(result.byMessage['parsed-reply-to']?.replyTo).toBe('collect@evil.example')
		// Your own sent mail lists its recipients as Reply-To; that is no redirection.
		expect(result.byMessage.own?.replyTo).toBeUndefined()
		expect(result.byMessage.list).toMatchObject({
			listId: 'eng-all.vercel.com',
			listUnsubscribe: true,
			unsubscribeUrl: 'https://lists.example/u?token=secret',
		})
		expect(Object.getPrototypeOf(result.byMessage)).toBe(Object.prototype)
		const serialized = JSON.stringify(result)
		expect(serialized).not.toContain('abc123')
		expect(serialized).not.toContain('Private Name')
	})

	it('answers "no facts" when the lookup fails or returns something unexpected', async () => {
		resolveMailbox()
		mailbox.listMessages.mockRejectedValue(new NylasApiError('fields is not supported', 400))
		expect(await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })).toEqual({ byMessage: {} })

		mailbox.listMessages.mockResolvedValue({ data: 'unexpected' })
		expect(await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })).toEqual({ byMessage: {} })
	})

	it('merges facts from every page of a long thread', async () => {
		resolveMailbox()
		const listMessage = (id: string, list: string) => ({
			id,
			from: [{ email: 'news@vercel.com' }],
			headers: [{ name: 'List-Id', value: `<${list}>` }],
		})
		mailbox.listMessages
			.mockResolvedValueOnce({ data: [listMessage('m1', 'one.vercel.com')], next_cursor: 'cursor-2' })
			.mockResolvedValueOnce({ data: [listMessage('m2', 'two.vercel.com')], next_cursor: 'cursor-3' })
			// The newest copy of a message that reappears on a later page wins.
			.mockResolvedValueOnce({
				data: [listMessage('m1', 'moved.vercel.com'), listMessage('m3', 'three.vercel.com')],
			})
		const result = await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })

		expect(mailbox.listMessages.mock.calls.map(([query]) => query)).toEqual([
			{ thread_id: 't1', fields: 'include_headers', limit: 50 },
			{ thread_id: 't1', fields: 'include_headers', limit: 50, page_token: 'cursor-2' },
			{ thread_id: 't1', fields: 'include_headers', limit: 50, page_token: 'cursor-3' },
		])
		expect(Object.keys(result.byMessage)).toEqual(['m1', 'm2', 'm3'])
		expect(result.byMessage.m1?.listId).toBe('moved.vercel.com')
		expect(result.byMessage.m2?.listId).toBe('two.vercel.com')
		expect(result.byMessage.m3?.listId).toBe('three.vercel.com')
	})

	it('reads at most four pages (200 messages) of one thread', async () => {
		resolveMailbox()
		let page = 0
		mailbox.listMessages.mockImplementation(async () => {
			page += 1
			return {
				data: Array.from({ length: 50 }, (_, index) => ({ id: `p${page}-${index}` })),
				next_cursor: `cursor-${page + 1}`,
			}
		})
		const result = await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })

		expect(mailbox.listMessages).toHaveBeenCalledTimes(4)
		expect(mailbox.listMessages).toHaveBeenLastCalledWith({
			thread_id: 't1',
			fields: 'include_headers',
			limit: 50,
			page_token: 'cursor-4',
		})
		expect(Object.keys(result.byMessage)).toHaveLength(200)
		expect(result.byMessage['p5-0']).toBeUndefined()
	})

	it('stops at an unusable or repeated cursor', async () => {
		resolveMailbox()
		mailbox.listMessages.mockResolvedValueOnce({ data: [{ id: 'm1' }], next_cursor: 'bad\ncursor' })
		expect(
			Object.keys((await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })).byMessage),
		).toEqual(['m1'])
		expect(mailbox.listMessages).toHaveBeenCalledTimes(1)

		mailbox.listMessages.mockReset()
		mailbox.listMessages.mockResolvedValueOnce({ data: [{ id: 'm1' }], next_cursor: 42 })
		await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })
		expect(mailbox.listMessages).toHaveBeenCalledTimes(1)

		mailbox.listMessages.mockReset()
		mailbox.listMessages.mockResolvedValue({ data: [{ id: 'm1' }], next_cursor: 'same' })
		await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })
		// The second page hands back the cursor it was read with; the walk ends there.
		expect(mailbox.listMessages).toHaveBeenCalledTimes(2)
	})

	it('answers "no facts" when a later page fails, rather than facts for part of the thread', async () => {
		resolveMailbox()
		mailbox.listMessages
			.mockResolvedValueOnce({ data: [{ id: 'm1' }], next_cursor: 'cursor-2' })
			.mockRejectedValueOnce(new NylasApiError('rate limited', 429))
		expect(await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })).toEqual({ byMessage: {} })

		mailbox.listMessages
			.mockResolvedValueOnce({ data: [{ id: 'm1' }], next_cursor: 'cursor-2' })
			.mockResolvedValueOnce({ data: 'unexpected' })
		expect(await fns.getThreadHeaderFacts.handler({ data: { threadId: 't1' } })).toEqual({ byMessage: {} })
	})
})

describe('getMessageRawHeaders', () => {
	const encode = (text: string) => btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

	it('validates the message id', () => {
		expect(fns.getMessageRawHeaders.validator({ messageId: 'm1' })).toEqual({ messageId: 'm1' })
		expect(() => fns.getMessageRawHeaders.validator({ messageId: '' })).toThrow('Invalid message')
	})

	it('returns only the header block of the raw message', async () => {
		resolveMailbox()
		mailbox.getRawMime.mockResolvedValue({
			data: { id: 'm1', raw_mime: encode('From: a@b.co\r\nSubject: Hi\r\n\r\nSecret body') },
		})
		const result = await fns.getMessageRawHeaders.handler({ data: { messageId: 'm1' } })

		expect(mailbox.getRawMime).toHaveBeenCalledWith('m1')
		expect(result).toEqual({ text: 'From: a@b.co\r\nSubject: Hi' })
	})

	it('maps provider failures and unusable payloads to user-safe errors', async () => {
		resolveMailbox()
		mailbox.getRawMime.mockRejectedValueOnce(new NylasApiError('gone', 404))
		await expect(fns.getMessageRawHeaders.handler({ data: { messageId: 'm1' } })).rejects.toThrow(/Not found/)

		mailbox.getRawMime.mockResolvedValueOnce(null)
		await expect(fns.getMessageRawHeaders.handler({ data: { messageId: 'm1' } })).rejects.toThrow(
			'Raw headers are not available for this message.',
		)
		mailbox.getRawMime.mockResolvedValueOnce({ data: { raw_mime: '***' } })
		await expect(fns.getMessageRawHeaders.handler({ data: { messageId: 'm1' } })).rejects.toThrow(
			'Raw headers are not available',
		)
	})
})

describe('getThreadMessages', () => {
	it('validates the thread id', () => {
		expect(fns.getThreadMessages.validator({ threadId: 'thread-1' })).toEqual({ threadId: 'thread-1' })
	})

	it('reads an unread thread without changing its read state and returns sorted messages', async () => {
		// Route preloads run this GET on hover; only an explicit open may mark mail read.
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { message_ids: ['m2', 'm1'], unread: true } })
		mailbox.getMessage.mockImplementation((id: string) =>
			Promise.resolve({ data: { id, date: id === 'm1' ? 1 : 2 } }),
		)
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })

		expect(mailbox.updateThread).not.toHaveBeenCalled()
		expect(res).not.toHaveProperty('markedRead')
		expect(res.thread.unread).toBe(true)
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

	it('shows the messages that loaded and names the ones that failed', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { message_ids: ['m1', 'gone', 'm2', 'broken'] } })
		mailbox.getMessage.mockImplementation((id: string) =>
			id === 'gone' || id === 'broken'
				? Promise.reject(new NylasApiError('gone', id === 'gone' ? 404 : 500))
				: Promise.resolve({ data: { id, date: id === 'm1' ? 1 : 2 } }),
		)
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })

		expect(res.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
		expect(res.failedMessageIds).toEqual(['gone', 'broken'])
	})

	it('places your unsent replies in the thread with its messages, leaving out drafts it cannot read', async () => {
		resolveMailbox({ displayName: 'Ada' })
		mailbox.getThread.mockResolvedValue({
			data: { message_ids: ['m1', 'm2'], draft_ids: ['d1', 'd1', 'gone', 7, 'bad\nid'] },
		})
		mailbox.getMessage.mockImplementation((id: string) =>
			Promise.resolve({ data: { id, date: id === 'm1' ? 1 : 3 } }),
		)
		mailbox.getDraft.mockImplementation((id: string) =>
			id === 'gone'
				? Promise.reject(new NylasApiError('gone', 404))
				: Promise.resolve({
						data: { id, grant_id: 'g', thread_id: 't1', date: 2, to: [{ email: 'mary@x.com' }] },
					}),
		)
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })

		expect(mailbox.getDraft).toHaveBeenCalledTimes(2)
		expect(res.messages.map((m) => m.id)).toEqual(['m1', 'd1', 'm2'])
		expect(res.messages[1]).toMatchObject({
			from: [{ email: 'ada@ownmail.com', name: 'Ada' }],
			folders: ['drafts'],
			unread: false,
		})
		expect(res.ownmailDraftMessageIds).toEqual(['d1'])
	})

	it('reads no drafts for a thread whose draft list is not a list', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { message_ids: ['m1'], draft_ids: 'd1' } })
		mailbox.getMessage.mockResolvedValue({ data: { id: 'm1' } })
		const res = await fns.getThreadMessages.handler({ data: { threadId: 't1' } })
		expect(mailbox.getDraft).not.toHaveBeenCalled()
		expect(res).not.toHaveProperty('ownmailDraftMessageIds')
	})

	it('fails the whole read only when no message could be loaded', async () => {
		resolveMailbox()
		mailbox.getThread.mockResolvedValue({ data: { message_ids: ['a', 'b'] } })
		mailbox.getMessage.mockRejectedValue(new NylasApiError('server', 500))
		await expect(fns.getThreadMessages.handler({ data: { threadId: 't1' } })).rejects.toThrow('server')

		mailbox.getMessage.mockRejectedValue(new NylasApiError('gone', 404))
		mailbox.listDrafts.mockResolvedValue({ data: [] })
		await expect(fns.getThreadMessages.handler({ data: { threadId: 't1' } })).rejects.toThrow(/Not found/)
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

describe('copied recipients', () => {
	it('carries a draft’s Cc and Bcc through a save and a send', async () => {
		const saved = fns.saveDraft.validator({
			draftId: 'd1',
			to: 'a@b.com',
			cc: 'c@d.com',
			bcc: 'e@f.com, g@h.com',
			subject: 's',
			body: 'b',
		})
		expect(saved).toMatchObject({ ccList: ['c@d.com'], bccList: ['e@f.com', 'g@h.com'] })
		resolveMailbox()
		mailbox.updateDraft.mockResolvedValue({ data: { id: 'd1' } })
		await fns.saveDraft.handler({ data: saved })
		expect(mailbox.updateDraft).toHaveBeenCalledWith('d1', {
			to: [{ email: 'a@b.com' }],
			cc: [{ email: 'c@d.com' }],
			bcc: [{ email: 'e@f.com' }, { email: 'g@h.com' }],
			subject: 's',
			body: 'b',
		})
		const sending = fns.sendDraft.validator({
			draftId: 'd1',
			to: 'a@b.com',
			cc: 'c@d.com',
			subject: 's',
			body: 'b',
		})
		await fns.sendDraft.handler({ data: sending })
		expect(mailbox.updateDraft).toHaveBeenLastCalledWith('d1', {
			to: [{ email: 'a@b.com' }],
			cc: [{ email: 'c@d.com' }],
			subject: 's',
			body: 'b',
		})
	})

	it('leaves out empty lists and refuses ones that are not text or not addresses', () => {
		expect(
			fns.saveDraft.validator({ to: 'a@b.com', cc: ' ', bcc: '', subject: 's', body: 'b' }),
		).not.toHaveProperty('ccList')
		expect(() => fns.saveDraft.validator({ to: 'a@b.com', cc: 5, subject: 's', body: 'b' } as never)).toThrow(
			'Invalid Cc',
		)
		expect(() =>
			fns.sendDraft.validator({ draftId: 'd1', to: 'a@b.com', bcc: [], subject: 's', body: 'b' } as never),
		).toThrow('Invalid Bcc')
		expect(() =>
			fns.saveDraft.validator({ to: 'a@b.com', cc: 'not an address', subject: 's', body: 'b' }),
		).toThrow()
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

describe('scheduled sends', () => {
	const scheduled = {
		id: 'm2',
		thread_id: 't1',
		schedule_id: 'sched-1',
		send_at: 2_000_000_000,
		from: [{ email: 'ada@ownmail.com' }],
		to: [{ email: 'grace@example.com' }],
		subject: 'Re: Q3 offsite agenda',
		body: '<p>Thanks</p>',
	}

	it('validates the message id', () => {
		expect(fns.cancelScheduledSend.validator({ messageId: 'm2' })).toEqual({ messageId: 'm2' })
		expect(() => fns.sendScheduledNow.validator({ messageId: '' })).toThrow('Invalid message')
	})

	const fullScheduled = {
		...scheduled,
		cc: [{ email: 'alan@example.com' }],
		bcc: [{ email: 'katherine@example.com' }],
		reply_to: [{ email: 'ada.personal@example.com' }],
		attachments: [{ id: 'a1', filename: 'agenda.txt', content_type: 'text/plain' }],
	}
	const fullOutgoing = {
		to: [{ email: 'grace@example.com' }],
		cc: [{ email: 'alan@example.com' }],
		bcc: [{ email: 'katherine@example.com' }],
		reply_to: [{ email: 'ada.personal@example.com' }],
		subject: 'Re: Q3 offsite agenda',
		body: '<p>Thanks</p>',
		attachments: [{ filename: 'agenda.txt', content_type: 'text/plain', content: btoa('agenda') }],
		reply_to_message_id: 'm1',
	}

	/** Records the order of the provider writes a scheduled-send action makes. */
	function recordWrites() {
		const order: string[] = []
		mailbox.createDraft.mockImplementation(async () => {
			order.push('draft')
			return { data: { id: 'd-safe' } }
		})
		mailbox.cancelScheduledMessage.mockImplementation(async () => void order.push('cancel'))
		mailbox.send.mockImplementation(async () => {
			order.push('send')
			return { data: { id: 'message-sent' } }
		})
		mailbox.deleteDraft.mockImplementation(async () => void order.push('delete draft'))
		return order
	}

	function withFullScheduled() {
		resolveMailbox()
		mailbox.getMessage.mockResolvedValue({ data: fullScheduled })
		mailbox.getThread.mockResolvedValue({ data: { id: 't1', message_ids: ['m0', 'm1', 'm2', 'm3'] } })
		mailbox.downloadAttachment.mockImplementation(async () => new Response('agenda'))
	}

	it('saves every field as a draft before cancelling, and answers the draft', async () => {
		withFullScheduled()
		const order = recordWrites()
		expect(await fns.cancelScheduledSend.handler({ data: { messageId: 'm2' } })).toEqual({
			cancelledMessageId: 'm2',
			draftId: 'd-safe',
			folders: [],
		})
		expect(order).toEqual(['draft', 'cancel'])
		expect(mailbox.createDraft).toHaveBeenCalledWith(fullOutgoing)
		expect(mailbox.cancelScheduledMessage).toHaveBeenCalledWith('sched-1')
		expect(mailbox.downloadAttachment).toHaveBeenCalledWith('a1', 'm2')
		expect(mailbox.send).not.toHaveBeenCalled()
	})

	it('refuses a message that is not scheduled, without writing anything', async () => {
		resolveMailbox()
		mailbox.getMessage.mockResolvedValue({ data: { ...scheduled, schedule_id: undefined } })
		await expect(fns.cancelScheduledSend.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		await expect(fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		expect(mailbox.createDraft).not.toHaveBeenCalled()
		expect(mailbox.cancelScheduledMessage).not.toHaveBeenCalled()
	})

	it('keeps the schedule when the draft copy cannot be saved', async () => {
		withFullScheduled()
		mailbox.createDraft.mockRejectedValue(new Error('drafts unavailable'))
		await expect(fns.cancelScheduledSend.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		await expect(fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		expect(mailbox.cancelScheduledMessage).not.toHaveBeenCalled()
		expect(mailbox.send).not.toHaveBeenCalled()
	})

	it('removes the copy when the schedule could not be cancelled and still stands', async () => {
		withFullScheduled()
		const order = recordWrites()
		mailbox.cancelScheduledMessage.mockRejectedValue(new Error('provider down'))
		await expect(fns.cancelScheduledSend.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		await expect(fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		expect(order).toEqual(['draft', 'delete draft', 'draft', 'delete draft'])
		expect(mailbox.deleteDraft).toHaveBeenCalledWith('d-safe')
		expect(mailbox.send).not.toHaveBeenCalled()
	})

	it('still reports the cancel failure when the copy cannot be removed', async () => {
		withFullScheduled()
		recordWrites()
		mailbox.cancelScheduledMessage.mockRejectedValue(new Error('provider down'))
		mailbox.deleteDraft.mockRejectedValue(new Error('also down'))
		await expect(fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		expect(mailbox.send).not.toHaveBeenCalled()
	})

	it('keeps the copy when a failed cancel leaves the schedule unknown or gone', async () => {
		withFullScheduled()
		recordWrites()
		mailbox.cancelScheduledMessage.mockRejectedValue(new Error('timeout'))
		mailbox.getMessage
			.mockResolvedValueOnce({ data: fullScheduled })
			.mockRejectedValueOnce(new Error('cannot read it again'))
			.mockResolvedValueOnce({ data: fullScheduled })
			.mockResolvedValueOnce({ data: { ...fullScheduled, schedule_id: undefined } })
		await expect(fns.cancelScheduledSend.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		await expect(fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		expect(mailbox.deleteDraft).not.toHaveBeenCalled()
		expect(mailbox.send).not.toHaveBeenCalled()
	})

	it('sends it now in its thread, with its people and files, then removes the safety draft', async () => {
		withFullScheduled()
		const order = recordWrites()
		expect(await fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).toEqual({
			cancelledMessageId: 'm2',
			message: { id: 'message-sent' },
			folders: [],
		})
		expect(order).toEqual(['draft', 'cancel', 'send', 'delete draft'])
		expect(mailbox.createDraft).toHaveBeenCalledWith(fullOutgoing)
		expect(mailbox.send).toHaveBeenCalledWith(fullOutgoing)
		expect(mailbox.deleteDraft).toHaveBeenCalledWith('d-safe')
	})

	it('reports the send as done even when the safety draft cannot be removed', async () => {
		withFullScheduled()
		recordWrites()
		mailbox.deleteDraft.mockRejectedValue(new Error('drafts unavailable'))
		expect(await fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).toEqual({
			cancelledMessageId: 'm2',
			message: { id: 'message-sent' },
			folders: [],
		})
	})

	it('keeps the draft and names it when the send fails after the schedule is cancelled', async () => {
		withFullScheduled()
		const order = recordWrites()
		mailbox.send.mockRejectedValue(new Error('rejected'))
		expect(await fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).toEqual({
			cancelledMessageId: 'm2',
			draftId: 'd-safe',
			error: fns.SCHEDULED_SEND_FAILED,
			folders: [],
		})
		expect(fns.SCHEDULED_SEND_FAILED).toBe('Couldn’t send. Saved as a draft.')
		expect(order).toEqual(['draft', 'cancel'])
		expect(mailbox.deleteDraft).not.toHaveBeenCalled()
	})

	it('answers the thread’s last message when the scheduled one is not listed in it', async () => {
		resolveMailbox()
		recordWrites()
		mailbox.getMessage.mockResolvedValue({ data: scheduled })
		mailbox.getThread.mockResolvedValue({ data: { id: 't1', message_ids: ['m0', 'm1'] } })
		await fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })
		expect(mailbox.send).toHaveBeenCalledWith(expect.objectContaining({ reply_to_message_id: 'm1' }))
	})

	it('starts no reply chain for a message alone in its thread, or outside one', async () => {
		resolveMailbox()
		recordWrites()
		mailbox.getMessage.mockResolvedValueOnce({ data: scheduled })
		mailbox.getThread.mockResolvedValue({ data: { id: 't1' } })
		await fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })
		mailbox.getMessage.mockResolvedValueOnce({
			data: { id: 'm2', schedule_id: 'sched-1', to: undefined, subject: undefined, body: undefined },
		})
		await fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })
		expect(mailbox.getThread).toHaveBeenCalledTimes(1)
		expect(mailbox.send).toHaveBeenNthCalledWith(1, {
			to: [{ email: 'grace@example.com' }],
			subject: 'Re: Q3 offsite agenda',
			body: '<p>Thanks</p>',
		})
		expect(mailbox.send).toHaveBeenNthCalledWith(2, { to: [], subject: '', body: '' })
	})

	it('keeps the schedule when a file cannot be read first', async () => {
		resolveMailbox()
		mailbox.getMessage.mockResolvedValue({ data: { ...scheduled, attachments: [{ id: 'a1' }] } })
		mailbox.downloadAttachment.mockResolvedValue(new Response(null, { status: 404 }))
		await expect(fns.sendScheduledNow.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		await expect(fns.cancelScheduledSend.handler({ data: { messageId: 'm2' } })).rejects.toThrow(
			/Something went wrong/,
		)
		expect(mailbox.createDraft).not.toHaveBeenCalled()
		expect(mailbox.cancelScheduledMessage).not.toHaveBeenCalled()
		expect(mailbox.send).not.toHaveBeenCalled()
	})
})

describe('markMessagesRead', () => {
	it('validates the thread and message ids, without repeats', () => {
		expect(fns.markMessagesRead.validator({ threadId: 't1', messageIds: ['m1', 'm2', 'm1'] })).toEqual({
			threadId: 't1',
			messageIds: ['m1', 'm2'],
		})
		expect(() => fns.markMessagesRead.validator({ threadId: 't1', messageIds: 'm1' } as never)).toThrow(
			'Invalid messages',
		)
		expect(() => fns.markMessagesRead.validator(null as never)).toThrow('Invalid messages')
		expect(() =>
			fns.markMessagesRead.validator({
				threadId: 't1',
				messageIds: Array.from({ length: 201 }, (_, index) => `m${index}`),
			}),
		).toThrow('Invalid messages')
		expect(() => fns.markMessagesRead.validator({ threadId: 't1', messageIds: ['bad id\n'] })).toThrow()
	})

	it('marks each given message read, never the thread', async () => {
		resolveMailbox()
		const updateMessage = vi.fn(async (id: string) => ({ data: { id } }))
		Object.assign(mailbox, { updateMessage })
		expect(
			await fns.markMessagesRead.handler({ data: { threadId: 't1', messageIds: ['m1', 'm2'] } }),
		).toEqual({
			threadId: 't1',
			messageIds: ['m1', 'm2'],
			folders: [],
		})
		expect(updateMessage).toHaveBeenNthCalledWith(1, 'm1', { unread: false })
		expect(updateMessage).toHaveBeenNthCalledWith(2, 'm2', { unread: false })
		expect(mailbox.updateThread).not.toHaveBeenCalled()
	})

	it('answers only the messages the provider confirmed', async () => {
		resolveMailbox()
		const updateMessage = vi
			.fn()
			.mockResolvedValueOnce({ data: { id: 'm1' } })
			.mockRejectedValueOnce(new Error('busy'))
		Object.assign(mailbox, { updateMessage })
		expect(
			await fns.markMessagesRead.handler({ data: { threadId: 't1', messageIds: ['m1', 'm2'] } }),
		).toEqual({
			threadId: 't1',
			messageIds: ['m1'],
			folders: [],
		})
	})

	it('fails when no message could be marked', async () => {
		resolveMailbox()
		Object.assign(mailbox, { updateMessage: vi.fn().mockRejectedValue(new Error('provider detail')) })
		await expect(
			fns.markMessagesRead.handler({ data: { threadId: 't1', messageIds: ['m1'] } }),
		).rejects.toThrow('Something went wrong talking to your mailbox.')
	})

	it('marks nothing when the mailbox client cannot update one message', async () => {
		resolveMailbox()
		expect(await fns.markMessagesRead.handler({ data: { threadId: 't1', messageIds: ['m1'] } })).toEqual({
			threadId: 't1',
			messageIds: [],
		})
		expect(mailbox.updateThread).not.toHaveBeenCalled()
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
