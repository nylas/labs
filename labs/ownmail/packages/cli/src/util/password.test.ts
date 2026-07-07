import { describe, expect, it } from 'vitest'
import { generateAppPassword, validateAppPassword } from './password.js'

/**
 * These rules mirror UAS ValidateAppPassword (uas/infra/helpers/token.go).
 * If they drift, created inboxes reject IMAP/SMTP and hosted-auth logins.
 */
describe('generateAppPassword', () => {
	it('always satisfies the UAS app-password policy', () => {
		for (let i = 0; i < 200; i++) {
			const pw = generateAppPassword('contact')
			expect(validateAppPassword(pw, 'contact')).toBeUndefined()
			expect(pw).toHaveLength(24)
		}
	})

	it('generates distinct passwords', () => {
		const seen = new Set(Array.from({ length: 50 }, () => generateAppPassword('contact')))
		expect(seen.size).toBe(50)
	})
})

describe('validateAppPassword', () => {
	it('rejects passwords outside 18–40 chars', () => {
		expect(validateAppPassword('Short1short1')).toMatch(/18–40/)
		expect(validateAppPassword(`A1${'a'.repeat(40)}`)).toMatch(/18–40/)
	})

	it('requires upper, lower, and digit', () => {
		expect(validateAppPassword('alllowercase12345678!')).toMatch(/uppercase/)
		expect(validateAppPassword('ALLUPPERCASE12345678!')).toMatch(/lowercase/)
		expect(validateAppPassword('NoDigitsHereAtAllOk!')).toMatch(/digit/)
	})

	it('requires a symbol', () => {
		expect(validateAppPassword('CorrectHorse42Battery')).toMatch(/symbol/)
	})

	it('rejects spaces and non-standard characters', () => {
		expect(validateAppPassword('Correct Horse42!Battery')).toMatch(/no spaces/)
		expect(validateAppPassword('Пароль1234567890Ab!')).toMatch(/standard/)
	})

	it('rejects passwords that contain the mailbox name', () => {
		expect(validateAppPassword('CorrectHorse42!contact', 'contact')).toMatch(/mailbox name/)
		expect(validateAppPassword('CorrectHorse42!contact', 'contact@example.com')).toMatch(/mailbox name/)
	})

	it('accepts a valid password', () => {
		expect(validateAppPassword('CorrectHorse42!Battery', 'contact')).toBeUndefined()
	})
})
