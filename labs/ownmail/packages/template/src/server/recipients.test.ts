import { describe, expect, it } from 'vitest'
import { parseRecipientEmails } from './recipients.js'

describe('recipient validation', () => {
	it('normalizes comma-separated recipients', () => {
		expect(parseRecipientEmails(' grace@vercel.com, alan@hey.com ', { required: true })).toEqual([
			'grace@vercel.com',
			'alan@hey.com',
		])
	})

	it('requires recipients for sends', () => {
		expect(() => parseRecipientEmails('', { required: true })).toThrow('At least one recipient is required')
	})

	it('allows recipient-less drafts but rejects malformed recipients', () => {
		expect(parseRecipientEmails('', { required: false })).toEqual([])
		expect(() => parseRecipientEmails('not-an-email', { required: false })).toThrow(
			'Invalid recipient: not-an-email',
		)
	})
})
