import { describe, expect, it } from 'vitest'
import {
	normalizeContactFields,
	normalizeContactIdInput,
	normalizeUpdateContactInput,
} from './contact-input.js'

describe('normalizeContactFields', () => {
	it('trims strings and maps them onto the snake_case Nylas payload', () => {
		expect(
			normalizeContactFields({
				givenName: '  Ada  ',
				surname: 'Lovelace',
				companyName: 'Analytical Engines',
				jobTitle: 'Mathematician',
				notes: 'First programmer',
				emails: [{ email: ' ada@x.com ', type: 'work' }],
				phoneNumbers: [{ number: ' +1 555 0100 ', type: 'home' }],
			}),
		).toEqual({
			given_name: 'Ada',
			surname: 'Lovelace',
			company_name: 'Analytical Engines',
			job_title: 'Mathematician',
			notes: 'First programmer',
			emails: [{ email: 'ada@x.com', type: 'work' }],
			phone_numbers: [{ number: '+1 555 0100', type: 'home' }],
		})
	})

	it('drops blank rows the form leaves behind rather than rejecting them', () => {
		expect(
			normalizeContactFields({
				givenName: 'Ada',
				emails: [{ email: '' }, { email: 'ada@x.com' }],
				phoneNumbers: [{ number: '   ' }, { number: '555-0100' }],
			}),
		).toEqual({
			given_name: 'Ada',
			emails: [{ email: 'ada@x.com' }],
			phone_numbers: [{ number: '555-0100' }],
		})
	})

	it('keeps a contact identified by email alone', () => {
		expect(normalizeContactFields({ emails: [{ email: 'ada@x.com' }] })).toEqual({
			emails: [{ email: 'ada@x.com' }],
		})
	})

	it('requires at least a name, company, or email', () => {
		expect(() => normalizeContactFields({})).toThrow('Add a name, company, or email')
		// Whitespace-only names collapse to empty and do not satisfy the requirement.
		expect(() => normalizeContactFields({ givenName: '   ', jobTitle: 'Engineer' })).toThrow(
			'Add a name, company, or email',
		)
	})

	it('rejects an over-long field', () => {
		expect(() => normalizeContactFields({ givenName: 'x'.repeat(201) })).toThrow('Invalid name')
	})

	it('rejects a malformed email address', () => {
		expect(() => normalizeContactFields({ emails: [{ email: 'not-an-email' }] })).toThrow(
			'Invalid email: not-an-email',
		)
	})

	it('rejects a non-string email or phone value', () => {
		expect(() => normalizeContactFields({ emails: [{ email: 42 as unknown as string }] })).toThrow(
			'Invalid email',
		)
		expect(() =>
			normalizeContactFields({ givenName: 'Ada', phoneNumbers: [{ number: 42 as unknown as string }] }),
		).toThrow('Invalid phone number')
	})

	it('rejects a non-array or over-long list of emails or phones', () => {
		expect(() => normalizeContactFields({ emails: 'ada@x.com' as never })).toThrow('Invalid emails')
		expect(() =>
			normalizeContactFields({
				givenName: 'Ada',
				phoneNumbers: Array.from({ length: 21 }, () => ({ number: '555' })),
			}),
		).toThrow('Invalid phone numbers')
	})

	it('rejects an over-long phone number', () => {
		expect(() =>
			normalizeContactFields({ givenName: 'Ada', phoneNumbers: [{ number: '5'.repeat(61) }] }),
		).toThrow('Invalid phone number')
	})

	it('accepts allowed field types and rejects unknown ones', () => {
		expect(normalizeContactFields({ emails: [{ email: 'ada@x.com', type: 'home' }] })).toEqual({
			emails: [{ email: 'ada@x.com', type: 'home' }],
		})
		// An empty type string is treated as "no type" rather than an error.
		expect(normalizeContactFields({ emails: [{ email: 'ada@x.com', type: '' }] })).toEqual({
			emails: [{ email: 'ada@x.com' }],
		})
		expect(() => normalizeContactFields({ emails: [{ email: 'ada@x.com', type: 'bogus' }] })).toThrow(
			'Invalid contact field type',
		)
	})
})

describe('normalizeUpdateContactInput', () => {
	it('validates the contact id and returns it alongside the normalized fields', () => {
		expect(normalizeUpdateContactInput({ contactId: 'contact-1', givenName: 'Ada' })).toEqual({
			contactId: 'contact-1',
			fields: { given_name: 'Ada' },
		})
	})

	it('rejects an invalid contact id', () => {
		expect(() => normalizeUpdateContactInput({ contactId: '', givenName: 'Ada' })).toThrow('Invalid contact')
	})
})

describe('normalizeContactIdInput', () => {
	it('passes a valid id through', () => {
		expect(normalizeContactIdInput({ contactId: 'contact-1' })).toEqual({ contactId: 'contact-1' })
	})

	it('rejects an invalid id', () => {
		expect(() => normalizeContactIdInput({ contactId: 'a\nb' })).toThrow('Invalid contact')
	})
})
