import { describe, expect, it } from 'vitest'
import { accountKey } from './account-key.js'

describe('accountKey', () => {
	it('gives one key to every spelling of the same mailbox', () => {
		expect(accountKey('Ada@OwnMail.com')).toBe('ada@ownmail.com')
		expect(accountKey('  ada@ownmail.com\t')).toBe('ada@ownmail.com')
	})

	it('refuses anything that cannot name a mailbox, rather than guessing a key', () => {
		// A guessed or shared key would file one inbox's data under another's.
		for (const value of [undefined, null, 7, {}, '', '   ', 'ada', 'ada@x\ny', `${'a'.repeat(320)}@x.com`]) {
			expect(accountKey(value)).toBeUndefined()
		}
	})
})
