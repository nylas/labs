// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { resetAccountScope } from '#app/lib/account-scope'

const getMailboxInfo = vi.hoisted(() => vi.fn())
vi.mock('#server/fns', () => ({ getMailboxInfo }))

import { ensureMailboxInfo, mailboxInfoQueryOptions } from './mailbox-info.js'

afterEach(() => {
	resetAccountScope()
	vi.clearAllMocks()
})

it('does not seed the shared profile cache after a cancelled bootstrap resolves', async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const response = Promise.withResolvers<{ email: string; appName: string }>()
	getMailboxInfo.mockReturnValue(response.promise)
	const pending = ensureMailboxInfo(client, true)
	const rejected = expect(pending).rejects.toThrow()
	await client.cancelQueries()
	await rejected
	client.clear()
	response.resolve({ email: 'previous@example.test', appName: 'OwnMail' })
	await response.promise
	await Promise.resolve()
	expect(client.getQueryData(mailboxInfoQueryOptions().queryKey)).toBeUndefined()
	client.clear()
})
