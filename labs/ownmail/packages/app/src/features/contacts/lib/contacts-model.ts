/**
 * Pure helpers for the contacts UI: how a contact is named, searched, and sorted,
 * plus the form model that bridges a Nylas `Contact` and the create/edit fields.
 * Kept side-effect-free so the list/detail/modal components stay thin.
 */
import type { Contact } from '@nylas-labs/cli-kit/v3'
import type { ContactFieldsInput } from '#features/contacts/server/contact-input'

// Form rows always carry a `type` string ('' means "no type"); this keeps the
// inputs fully controlled with no undefined fallbacks in the modal.
export type FormEmail = { email: string; type: string }
export type FormPhone = { number: string; type: string }

export type ContactForm = {
	givenName: string
	surname: string
	companyName: string
	jobTitle: string
	notes: string
	emails: FormEmail[]
	phoneNumbers: FormPhone[]
}

export type ContactFormValidation =
	| { field: 'identity'; message: 'Add a name, company, or email.' }
	| { field: 'email'; index: number; message: 'Enter a valid email address.' }

const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The name shown in the list/detail: full name, else company, else first email. */
export function contactDisplayName(contact: Contact): string {
	const name = [contact.given_name, contact.surname].filter(Boolean).join(' ').trim()
	if (name) return name
	if (contact.company_name) return contact.company_name
	return contactPrimaryEmail(contact) ?? 'Unnamed contact'
}

export function contactPrimaryEmail(contact: Contact): string | undefined {
	return contact.emails?.[0]?.email
}

/** Secondary line under the name — role/company, or the email when it isn't the title. */
export function contactSubtitle(contact: Contact): string | undefined {
	const role = [contact.job_title, contact.company_name].filter(Boolean).join(' · ')
	if (role) return role
	const email = contactPrimaryEmail(contact)
	return email && email !== contactDisplayName(contact) ? email : undefined
}

export function sortContacts(contacts: Contact[]): Contact[] {
	return [...contacts].sort((a, b) =>
		contactDisplayName(a).localeCompare(contactDisplayName(b), undefined, { sensitivity: 'base' }),
	)
}

export function filterContacts(contacts: Contact[], query: string): Contact[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return contacts
	return contacts.filter((contact) => contactHaystack(contact).includes(needle))
}

function contactHaystack(contact: Contact): string {
	return [
		contact.given_name,
		contact.surname,
		contact.company_name,
		contact.job_title,
		...(contact.emails ?? []).map((entry) => entry.email),
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase()
}

export function emptyContactForm(): ContactForm {
	return {
		givenName: '',
		surname: '',
		companyName: '',
		jobTitle: '',
		notes: '',
		emails: [{ email: '', type: '' }],
		phoneNumbers: [],
	}
}

export function contactToForm(contact: Contact): ContactForm {
	return {
		givenName: contact.given_name ?? '',
		surname: contact.surname ?? '',
		companyName: contact.company_name ?? '',
		jobTitle: contact.job_title ?? '',
		notes: contact.notes ?? '',
		// Always keep at least one email row so the form has an editable field.
		emails: contact.emails?.length
			? contact.emails.map((entry) => ({ email: entry.email, type: entry.type ?? '' }))
			: [{ email: '', type: '' }],
		phoneNumbers: (contact.phone_numbers ?? []).map((entry) => ({
			number: entry.number,
			type: entry.type ?? '',
		})),
	}
}

/** Maps the form state onto the camelCase input the server validator expects. */
export function formToFields(form: ContactForm): ContactFieldsInput {
	return {
		givenName: form.givenName,
		surname: form.surname,
		companyName: form.companyName,
		jobTitle: form.jobTitle,
		notes: form.notes,
		emails: form.emails,
		phoneNumbers: form.phoneNumbers,
	}
}

/**
 * Compares the contact values that would survive server normalization.
 * Whitespace-only edits and empty repeatable rows are not meaningful changes,
 * while ordering and every persisted value remain significant.
 */
export function contactFormsEqual(left: ContactForm, right: ContactForm): boolean {
	return JSON.stringify(comparableContactForm(left)) === JSON.stringify(comparableContactForm(right))
}

function comparableContactForm(form: ContactForm) {
	return {
		givenName: form.givenName.trim(),
		surname: form.surname.trim(),
		companyName: form.companyName.trim(),
		jobTitle: form.jobTitle.trim(),
		notes: form.notes.trim(),
		emails: form.emails
			.map((entry) => ({ email: entry.email.trim(), type: entry.type }))
			.filter((entry) => entry.email),
		phoneNumbers: form.phoneNumbers
			.map((entry) => ({ number: entry.number.trim(), type: entry.type }))
			.filter((entry) => entry.number),
	}
}

/** Returns actionable validation for locally knowable form errors only. */
export function validateContactForm(form: ContactForm): ContactFormValidation | null {
	for (const [index, row] of form.emails.entries()) {
		const email = row.email.trim()
		if (email && !CONTACT_EMAIL_RE.test(email)) {
			return { field: 'email', index, message: 'Enter a valid email address.' }
		}
	}

	const hasIdentity =
		Boolean(form.givenName.trim()) ||
		Boolean(form.surname.trim()) ||
		Boolean(form.companyName.trim()) ||
		form.emails.some((row) => Boolean(row.email.trim()))
	return hasIdentity ? null : { field: 'identity', message: 'Add a name, company, or email.' }
}

/** The selected contact id encoded in a `/contacts/<id>` URL, or undefined. */
export function contactIdFromPath(pathname: string): string | undefined {
	const match = /^\/contacts\/([^/]+)/.exec(pathname)
	if (!match?.[1]) return undefined
	const id = decodeURIComponent(match[1])
	// `/contacts/new` is the create route, not a selected record.
	return id === 'new' ? undefined : id
}

export function replaceAt<T>(list: T[], index: number, value: T): T[] {
	return list.map((item, i) => (i === index ? value : item))
}

export function removeAt<T>(list: T[], index: number): T[] {
	return list.filter((_, i) => i !== index)
}
