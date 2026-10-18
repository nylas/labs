import { describe, expect, it } from 'vitest'
// Imported by its package path: the local builds resolve `./dev-mailbox.js` to the mock mailbox.
import { devMocks } from '#server/dev-mailbox'

describe('dev-mailbox', () => {
	it('carries no mock mailbox in deployed builds and the packed template', () => {
		expect(devMocks).toBeNull()
	})
})
