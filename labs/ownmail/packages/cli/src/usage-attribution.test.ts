import { describe, expect, it } from 'vitest'
import { OWNMAIL_USER_AGENT, OWNMAIL_VERSION, requireOwnmailPackageVersion } from './usage-attribution.js'

describe('OwnMail usage attribution', () => {
	it('includes the public package version without identifying user data', () => {
		expect(OWNMAIL_VERSION).toMatch(/^[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/)
		expect(OWNMAIL_USER_AGENT).toBe(`ownmail/${OWNMAIL_VERSION}`)
	})

	it.each([undefined, null, {}, { version: 7 }, { version: 'invalid/version' }])(
		'rejects unsafe package metadata (%j)',
		(value) => {
			expect(() => requireOwnmailPackageVersion(value)).toThrow('OwnMail package version is invalid')
		},
	)
})
