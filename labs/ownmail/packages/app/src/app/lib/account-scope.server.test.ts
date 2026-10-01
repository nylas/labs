import { describe, expect, it, vi } from 'vitest'
import { accountScope, observeAccount, onAccountChanged, SERVER_ACCOUNT_SCOPE } from './account-scope.js'

describe('account scope while rendering on the server', () => {
	it('never keeps a mailbox in module state, which every request shares', () => {
		const changed = vi.fn()
		onAccountChanged(changed)

		// Two requests for two people run through the same module instance.
		observeAccount('ada@ownmail.com')
		observeAccount('grace@ownmail.com')

		// Each request already owns a private query cache; the key segment is fixed.
		expect(accountScope()).toBe(SERVER_ACCOUNT_SCOPE)
		expect(changed).not.toHaveBeenCalled()
	})
})
