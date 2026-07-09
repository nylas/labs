/**
 * Contact create/update input validation. Same trust-boundary discipline as
 * calendar-input.ts: every field is bounded, emails are format-checked, and the
 * normalized result is the snake_case `Partial<Contact>` the Nylas API expects.
 * Blank rows the form leaves behind are dropped, not rejected.
 */
import type { Contact } from '@nylas-labs/cli-kit/v3'
import { requireNylasProviderId } from './ids.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME_LENGTH = 200
const MAX_COMPANY_LENGTH = 200
const MAX_TITLE_LENGTH = 200
const MAX_NOTES_LENGTH = 10_000
const MAX_PHONE_LENGTH = 60
const MAX_ENTRIES = 20
const CONTACT_TYPES = ['work', 'home', 'other'] as const

type ContactType = (typeof CONTACT_TYPES)[number]

export type ContactEmailInput = { email: string; type?: string }
export type ContactPhoneInput = { number: string; type?: string }

export type ContactFieldsInput = {
	givenName?: string
	surname?: string
	companyName?: string
	jobTitle?: string
	notes?: string
	emails?: ContactEmailInput[]
	phoneNumbers?: ContactPhoneInput[]
}

export type UpdateContactInput = ContactFieldsInput & { contactId: string }
export type ContactIdInput = { contactId: string }

/** Validates the form fields and returns the snake_case payload sent to Nylas. */
export function normalizeContactFields(input: ContactFieldsInput): Partial<Contact> {
	const given_name = optionalBoundedString(input.givenName, 'name', MAX_NAME_LENGTH)
	const surname = optionalBoundedString(input.surname, 'name', MAX_NAME_LENGTH)
	const company_name = optionalBoundedString(input.companyName, 'company', MAX_COMPANY_LENGTH)
	const job_title = optionalBoundedString(input.jobTitle, 'job title', MAX_TITLE_LENGTH)
	const notes = optionalBoundedString(input.notes, 'notes', MAX_NOTES_LENGTH)
	const emails = normalizeEmails(input.emails)
	const phone_numbers = normalizePhones(input.phoneNumbers)

	if (!given_name && !surname && !company_name && emails.length === 0) {
		throw new Error('Add a name, company, or email to save a contact')
	}

	return {
		...(given_name ? { given_name } : {}),
		...(surname ? { surname } : {}),
		...(company_name ? { company_name } : {}),
		...(job_title ? { job_title } : {}),
		...(notes ? { notes } : {}),
		...(emails.length ? { emails } : {}),
		...(phone_numbers.length ? { phone_numbers } : {}),
	}
}

export function normalizeUpdateContactInput(input: UpdateContactInput): {
	contactId: string
	fields: Partial<Contact>
} {
	return {
		contactId: requireNylasProviderId(input.contactId, 'contact'),
		fields: normalizeContactFields(input),
	}
}

export function normalizeContactIdInput(input: ContactIdInput): ContactIdInput {
	return { contactId: requireNylasProviderId(input.contactId, 'contact') }
}

function optionalBoundedString(
	value: string | undefined,
	label: string,
	maxLength: number,
): string | undefined {
	if (value === undefined) return undefined
	if (typeof value !== 'string' || value.length > maxLength) throw new Error(`Invalid ${label}`)
	const trimmed = value.trim()
	return trimmed.length ? trimmed : undefined
}

function normalizeEmails(entries: ContactEmailInput[] | undefined): { email: string; type?: string }[] {
	if (entries === undefined) return []
	if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Invalid emails')
	const result: { email: string; type?: string }[] = []
	for (const entry of entries) {
		if (typeof entry.email !== 'string') throw new Error('Invalid email')
		const email = entry.email.trim()
		if (!email) continue
		if (!EMAIL_RE.test(email)) throw new Error(`Invalid email: ${entry.email}`)
		const type = normalizeType(entry.type)
		result.push({ email, ...(type ? { type } : {}) })
	}
	return result
}

function normalizePhones(entries: ContactPhoneInput[] | undefined): { number: string; type?: string }[] {
	if (entries === undefined) return []
	if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Invalid phone numbers')
	const result: { number: string; type?: string }[] = []
	for (const entry of entries) {
		if (typeof entry.number !== 'string') throw new Error('Invalid phone number')
		const number = entry.number.trim()
		if (!number) continue
		if (number.length > MAX_PHONE_LENGTH) throw new Error('Invalid phone number')
		const type = normalizeType(entry.type)
		result.push({ number, ...(type ? { type } : {}) })
	}
	return result
}

function normalizeType(type: string | undefined): ContactType | undefined {
	if (type === undefined || type === '') return undefined
	if (!CONTACT_TYPES.includes(type as ContactType)) throw new Error('Invalid contact field type')
	return type as ContactType
}
