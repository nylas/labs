import { describe, expect, it } from 'vitest'
import { OWNMAIL_USER_AGENT, requireOwnmailPackageVersion } from './usage-attribution.js'

describe('OwnMail usage attribution', () => {
	it('includes the public package version without identifying user data', () => {
		expect(OWNMAIL_USER_AGENT).toMatch(/^ownmail\/[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/)
	})

	it.each([
		undefined,
		null,
		{},
		{ version: 7 },
		{ version: 'invalid/version' },
	])('rejects unsafe package metadata (%j)', (value) => {
		expect(() => requireOwnmailPackageVersion(value)).toThrow('OwnMail package version is invalid')
	})
})
