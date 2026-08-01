import type { Contact } from '@nylas-labs/cli-kit/v3'
import { describe, expect, it } from 'vitest'
import {
	contactDisplayName,
	contactFormsEqual,
	contactIdFromPath,
	contactPrimaryEmail,
	contactSubtitle,
	contactToForm,
	emptyContactForm,
	filterContacts,
	formToFields,
	removeAt,
	replaceAt,
	sortContacts,
	validateContactForm,
} from './contacts-model.js'

const base: Contact = { id: 'c1' }

describe('contactDisplayName', () => {
	it('prefers the full name', () => {
		expect(contactDisplayName({ ...base, given_name: 'Ada', surname: 'Lovelace' })).toBe('Ada Lovelace')
	})

	it('falls back to the company, then the first email, then a placeholder', () => {
		expect(contactDisplayName({ ...base, company_name: 'Analytical Engines' })).toBe('Analytical Engines')
		expect(contactDisplayName({ ...base, emails: [{ email: 'ada@x.com' }] })).toBe('ada@x.com')
		expect(contactDisplayName(base)).toBe('Unnamed contact')
	})
})

describe('contactPrimaryEmail', () => {
	it('returns the first email or undefined', () => {
		expect(contactPrimaryEmail({ ...base, emails: [{ email: 'a@x.com' }, { email: 'b@x.com' }] })).toBe(
			'a@x.com',
		)
		expect(contactPrimaryEmail(base)).toBeUndefined()
	})
})

describe('contactSubtitle', () => {
	it('joins job title and company', () => {
		expect(
			contactSubtitle({ ...base, given_name: 'Ada', job_title: 'Engineer', company_name: 'Contoso' }),
		).toBe('Engineer · Contoso')
	})

	it('shows the email when there is no role and the name is not the email', () => {
		expect(contactSubtitle({ ...base, given_name: 'Ada', emails: [{ email: 'ada@x.com' }] })).toBe(
			'ada@x.com',
		)
	})

	it('omits the email subtitle when the display name is already that email', () => {
		expect(contactSubtitle({ ...base, emails: [{ email: 'ada@x.com' }] })).toBeUndefined()
		expect(contactSubtitle(base)).toBeUndefined()
	})
})

describe('sortContacts', () => {
	it('orders by display name case-insensitively without mutating the input', () => {
		const input: Contact[] = [
			{ ...base, id: 'b', given_name: 'bea' },
			{ ...base, id: 'a', given_name: 'Ada' },
		]
		expect(sortContacts(input).map((c) => c.id)).toEqual(['a', 'b'])
		expect(input.map((c) => c.id)).toEqual(['b', 'a'])
	})
})

describe('filterContacts', () => {
	const contacts: Contact[] = [
		{ ...base, id: 'a', given_name: 'Ada', company_name: 'Engines', emails: [{ email: 'ada@x.com' }] },
		{ ...base, id: 'b', given_name: 'Bea', job_title: 'Pilot' },
	]

	it('returns all contacts for a blank query', () => {
		expect(filterContacts(contacts, '  ')).toHaveLength(2)
	})

	it('matches on name, company, job title, or email', () => {
		expect(filterContacts(contacts, 'engines').map((c) => c.id)).toEqual(['a'])
		expect(filterContacts(contacts, 'pilot').map((c) => c.id)).toEqual(['b'])
		expect(filterContacts(contacts, 'ada@x').map((c) => c.id)).toEqual(['a'])
		expect(filterContacts(contacts, 'zzz')).toEqual([])
	})
})

describe('form model', () => {
	it('starts empty with a single blank email row', () => {
		expect(emptyContactForm()).toEqual({
			givenName: '',
			surname: '',
			companyName: '',
			jobTitle: '',
			notes: '',
			emails: [{ email: '', type: '' }],
			phoneNumbers: [],
		})
	})

	it('maps a full contact into editable form state', () => {
		expect(
			contactToForm({
				...base,
				given_name: 'Ada',
				surname: 'Lovelace',
				company_name: 'Engines',
				job_title: 'Mathematician',
				notes: 'note',
				emails: [{ email: 'ada@x.com', type: 'work' }, { email: 'ada2@x.com' }],
				phone_numbers: [{ number: '555' }],
			}),
		).toEqual({
			givenName: 'Ada',
			surname: 'Lovelace',
			companyName: 'Engines',
			jobTitle: 'Mathematician',
			notes: 'note',
			// The second email has no type — it defaults to '' for the form.
			emails: [
				{ email: 'ada@x.com', type: 'work' },
				{ email: 'ada2@x.com', type: '' },
			],
			phoneNumbers: [{ number: '555', type: '' }],
		})
	})

	it('gives a contact with no emails one blank row to edit', () => {
		expect(contactToForm(base).emails).toEqual([{ email: '', type: '' }])
		expect(contactToForm(base).phoneNumbers).toEqual([])
	})

	it('projects form state onto the server input shape', () => {
		const form = emptyContactForm()
		expect(formToFields({ ...form, givenName: 'Ada' })).toEqual({
			givenName: 'Ada',
			surname: '',
			companyName: '',
			jobTitle: '',
			notes: '',
			emails: [{ email: '', type: '' }],
			phoneNumbers: [],
		})
	})

	it('compares persisted form meaning instead of transient blank rows and whitespace', () => {
		const initial = { ...emptyContactForm(), givenName: ' Ada ' }
		expect(
			contactFormsEqual(initial, {
				...initial,
				givenName: 'Ada',
				emails: [],
				phoneNumbers: [{ number: '  ', type: 'work' }],
			}),
		).toBe(true)
		expect(contactFormsEqual(initial, { ...initial, givenName: 'Grace' })).toBe(false)
		expect(
			contactFormsEqual(
				{ ...initial, emails: [{ email: 'ada@x.com', type: 'work' }] },
				{ ...initial, emails: [{ email: 'ada@x.com', type: 'home' }] },
			),
		).toBe(false)
	})

	it('provides actionable validation for blank identity and malformed email input', () => {
		const blank = emptyContactForm()
		expect(validateContactForm(blank)).toEqual({
			field: 'identity',
			message: 'Add a name, company, or email.',
		})

		expect(
			validateContactForm({
				...blank,
				givenName: 'Ada',
				emails: [{ email: 'not-an-email', type: '' }],
			}),
		).toEqual({ field: 'email', index: 0, message: 'Enter a valid email address.' })
	})

	it('accepts contacts identified by a name, company, or valid email', () => {
		const blank = emptyContactForm()
		expect(validateContactForm({ ...blank, givenName: 'Ada' })).toBeNull()
		expect(validateContactForm({ ...blank, companyName: 'Engines' })).toBeNull()
		expect(validateContactForm({ ...blank, emails: [{ email: 'ada@x.com', type: '' }] })).toBeNull()
	})
})

describe('contactIdFromPath', () => {
	it('extracts and decodes the selected id from a contacts detail URL', () => {
		expect(contactIdFromPath('/contacts/contact-1')).toBe('contact-1')
		expect(contactIdFromPath('/contacts/a%2Fb')).toBe('a/b')
	})

	it('returns undefined for the list, create, and unrelated routes', () => {
		expect(contactIdFromPath('/contacts')).toBeUndefined()
		expect(contactIdFromPath('/contacts/new')).toBeUndefined()
		expect(contactIdFromPath('/mail/f/inbox')).toBeUndefined()
	})
})

describe('list editing helpers', () => {
	it('replaces the item at an index without touching the rest', () => {
		expect(replaceAt(['a', 'b', 'c'], 1, 'B')).toEqual(['a', 'B', 'c'])
	})

	it('removes the item at an index', () => {
		expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
	})
})
