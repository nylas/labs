import { describe, expect, it } from 'vitest'
import {
	MAX_RECIPIENT_COUNT,
	MAX_RECIPIENT_EMAIL_LENGTH,
	MAX_RECIPIENT_INPUT_LENGTH,
	validateRecipientEmails,
} from '../lib/recipients.js'
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
		expect(() => parseRecipientEmails('not-an-email', { required: false })).toThrow('Invalid recipient')
	})

	it('fails closed before parsing an oversized recipient string', () => {
		const atLimit = ' '.repeat(MAX_RECIPIENT_INPUT_LENGTH)
		const oversized = 'a'.repeat(MAX_RECIPIENT_INPUT_LENGTH + 1)
		expect(validateRecipientEmails(atLimit, { required: false })).toEqual({ emails: [], error: null })
		expect(validateRecipientEmails(oversized, { required: false })).toEqual({
			emails: [],
			error: 'invalid',
		})
		expect(() => parseRecipientEmails(oversized, { required: false })).toThrow('Invalid recipient')
	})

	it('limits the recipient count', () => {
		const atLimit = Array.from({ length: MAX_RECIPIENT_COUNT }, (_, index) => `user${index}@x.com`).join(',')
		const tooMany = Array.from({ length: MAX_RECIPIENT_COUNT + 1 }, (_, index) => `user${index}@x.com`).join(
			',',
		)
		expect(parseRecipientEmails(atLimit, { required: true })).toHaveLength(MAX_RECIPIENT_COUNT)
		expect(validateRecipientEmails(tooMany, { required: true }).error).toBe('invalid')
		expect(() => parseRecipientEmails(tooMany, { required: true })).toThrow('Invalid recipient')
	})

	it('allows the per-address boundary and rejects a longer address without reflecting it', () => {
		const atLimit = `${'a'.repeat(MAX_RECIPIENT_EMAIL_LENGTH - 5)}@x.co`
		const tooLong = `${'a'.repeat(MAX_RECIPIENT_EMAIL_LENGTH - 4)}@x.co`
		expect(atLimit).toHaveLength(MAX_RECIPIENT_EMAIL_LENGTH)
		expect(parseRecipientEmails(atLimit, { required: true })).toEqual([atLimit])
		expect(() => parseRecipientEmails(tooLong, { required: true })).toThrowError(
			expect.objectContaining({ message: 'Invalid recipient' }),
		)
	})

	it('rejects non-string runtime input without exposing it', () => {
		expect(validateRecipientEmails({ email: 'secret@example.com' }, { required: true })).toEqual({
			emails: [],
			error: 'invalid',
		})
		expect(() => parseRecipientEmails(null, { required: true })).toThrow('Invalid recipient')
	})
})
