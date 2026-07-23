import { describe, expect, it } from 'vitest'
import { OWNMAIL_VERSION, requireOwnmailPackageVersion } from './version.js'

describe('OwnMail version', () => {
	it('accepts the public package version used by the app build', () => {
		expect(requireOwnmailPackageVersion(OWNMAIL_VERSION)).toBe(OWNMAIL_VERSION)
	})

	it.each([undefined, 'invalid/version'])('rejects unsafe package metadata (%j)', (value) => {
		expect(() => requireOwnmailPackageVersion(value)).toThrow('OwnMail package version is invalid')
	})
})
