import type { Contact } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { signalLocalChange } from '../../../server/change-version.js'
import { requireNylasProviderId } from '../../../server/ids.js'
import { friendly, listData, requireMailbox } from '../../../server/mailbox-boundary.js'
import { parseRecipientEmails } from '../../mail/server/recipients.js'
import {
	type ContactFieldsInput,
	normalizeContactFields,
	normalizeContactIdInput,
	normalizeUpdateContactInput,
	type UpdateContactInput,
} from './contact-input.js'

export const getContacts = createServerFn({ method: 'GET' })
	.validator((input: { pageToken?: string }) => ({
		...(input.pageToken !== undefined
			? { pageToken: requireNylasProviderId(input.pageToken, 'page token') }
			: {}),
	}))
	.handler(async ({ data }): Promise<{ contacts: Contact[]; nextCursor?: string }> => {
		const { mailbox } = await requireMailbox()
		try {
			const res = await mailbox.listContacts({
				limit: 50,
				...(data.pageToken ? { page_token: data.pageToken } : {}),
			})
			// The contacts API may omit `data` for an empty account. Normalize the
			// untrusted response at this boundary so the UI always receives a list.
			const contacts = listData<Contact>(res.data)
			return { contacts, ...(res.next_cursor ? { nextCursor: res.next_cursor } : {}) }
		} catch (err) {
			throw friendly(err)
		}
	})

export const getContact = createServerFn({ method: 'GET' })
	.validator((input: { contactId: string }) => normalizeContactIdInput(input))
	.handler(async ({ data }): Promise<Contact> => {
		const { mailbox } = await requireMailbox()
		try {
			const res = await mailbox.getContact(data.contactId)
			return res.data
		} catch (err) {
			throw friendly(err)
		}
	})

export const createContact = createServerFn({ method: 'POST' })
	.validator((input: ContactFieldsInput) => normalizeContactFields(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const created = await mailbox.createContact(data)
			await signalLocalChange(grantId, 'contacts')
			return { contactId: created.data.id, contact: created.data }
		} catch (err) {
			throw friendly(err)
		}
	})

export const updateContact = createServerFn({ method: 'POST' })
	.validator((input: UpdateContactInput) => normalizeUpdateContactInput(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			const updated = await mailbox.updateContact(data.contactId, data.fields)
			await signalLocalChange(grantId, 'contacts')
			return { contact: updated.data }
		} catch (err) {
			throw friendly(err)
		}
	})

export const deleteContact = createServerFn({ method: 'POST' })
	.validator((input: { contactId: string }) => normalizeContactIdInput(input))
	.handler(async ({ data }) => {
		const { mailbox, grantId } = await requireMailbox()
		try {
			await mailbox.deleteContact(data.contactId)
			await signalLocalChange(grantId, 'contacts')
			return { removedContactId: data.contactId }
		} catch (err) {
			throw friendly(err)
		}
	})

// ---- Contacts (compose autocomplete) --------------------------------------------

export const searchContacts = createServerFn({ method: 'GET' })
	.validator((input: { q: string }) => {
		if (input.q.length > 100) throw new Error('Query too long')
		return input
	})
	.handler(async ({ data }): Promise<{ email: string; name?: string }[]> => {
		if (data.q.trim().length < 2) return []
		const { mailbox } = await requireMailbox()
		try {
			const res = await mailbox.listContacts({ limit: 8, email: data.q })
			return res.data
				.flatMap((c) =>
					(c.emails ?? []).map((e) => ({
						email: e.email,
						...(c.given_name || c.surname
							? { name: [c.given_name, c.surname].filter(Boolean).join(' ') }
							: {}),
					})),
				)
				.slice(0, 8)
		} catch {
			return [] // autocomplete is best-effort
		}
	})

/** Best-effort contact creation for recipients sent from the compose window. */
export const saveComposeRecipients = createServerFn({ method: 'POST' })
	.validator((input: unknown): { emails: string[] } => {
		if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid recipients')
		const emails = (input as { emails?: unknown }).emails
		if (!Array.isArray(emails) || emails.length > 20 || emails.some((email) => typeof email !== 'string')) {
			throw new Error('Invalid recipients')
		}
		const normalized = parseRecipientEmails(emails.join(','), { required: false })
		if (normalized.length !== emails.length || normalized.some((email) => email.length > 320)) {
			throw new Error('Invalid recipients')
		}
		return { emails: [...new Set(normalized.map((email) => email.toLowerCase()))] }
	})
	.handler(async ({ data }) => {
		const { mailbox, email: mailboxEmail, grantId } = await requireMailbox()
		const createdContacts: Contact[] = []
		for (const email of data.emails) {
			if (email === mailboxEmail.toLowerCase()) continue
			try {
				const existing = await mailbox.listContacts({ limit: 10, email })
				const contacts = Array.isArray(existing.data) ? existing.data : []
				const alreadySaved = contacts.some((contact) =>
					contact.emails?.some((candidate) => candidate.email.toLowerCase() === email),
				)
				if (!alreadySaved) {
					const created = await mailbox.createContact({ emails: [{ email }] })
					createdContacts.push(created.data)
				}
			} catch {
				// Contact suggestions are an enhancement; a provider-side failure must not block sending mail.
			}
		}
		if (createdContacts.length) await signalLocalChange(grantId, 'contacts')
		return { contacts: createdContacts }
	})
