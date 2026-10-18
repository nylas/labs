// @vitest-environment jsdom
import { onlineManager, QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { accountScope, resetAccountScope, UNKNOWN_ACCOUNT_SCOPE } from '#app/lib/account-scope'

const getMailboxInfo = vi.hoisted(() => vi.fn())
vi.mock('#server/fns', () => ({ getMailboxInfo }))

import { ensureMailboxInfo, mailboxInfoQueryOptions } from './mailbox-info.js'

afterEach(() => {
	resetAccountScope()
	vi.clearAllMocks()
})
it.each(['bootstrap', 'refresh'])(
	'ignores a cancelled %s identity response even when its transport completes after the switch',
	async (kind) => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const old = Promise.withResolvers<{ email: string; appName: string }>()
		getMailboxInfo.mockReturnValueOnce(old.promise)
		const pending =
			kind === 'bootstrap' ? ensureMailboxInfo(client, true) : client.fetchQuery(mailboxInfoQueryOptions())
		const rejected = expect(pending).rejects.toThrow()
		await client.cancelQueries()
		await rejected
		client.clear()
		resetAccountScope()
		old.resolve({ email: 'previous@example.test', appName: 'OwnMail' })
		await old.promise
		await Promise.resolve()
		expect(accountScope()).toBe(UNKNOWN_ACCOUNT_SCOPE)
		expect(client.getQueryData(mailboxInfoQueryOptions().queryKey)).toBeUndefined()
		getMailboxInfo.mockResolvedValue({ email: 'next@example.test', appName: 'OwnMail' })
		await ensureMailboxInfo(client)
		expect(accountScope()).toBe('next@example.test')
		client.clear()
	},
)

it('fails at once offline instead of waiting for a connection', async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	onlineManager.setOnline(false)
	getMailboxInfo.mockRejectedValueOnce(new TypeError('Failed to fetch'))
	await expect(ensureMailboxInfo(client, true)).rejects.toThrow('Failed to fetch')
	onlineManager.setOnline(true)
	client.clear()
})
