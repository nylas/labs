const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_RECIPIENT_INPUT_LENGTH = 32_768
export const MAX_RECIPIENT_COUNT = 100
export const MAX_RECIPIENT_EMAIL_LENGTH = 320

export type RecipientEmailValidation =
	| { emails: string[]; error: null }
	| { emails: string[]; error: 'required' | 'invalid' }

/**
 * Validates the comma-separated recipient contract shared by the composer and
 * server functions. The result deliberately identifies only the error class so
 * clients can use static guidance without reflecting recipient data.
 */
export function validateRecipientEmails(
	input: unknown,
	options: { required: boolean },
): RecipientEmailValidation {
	if (typeof input !== 'string') return { emails: [], error: 'invalid' }
	if (input.length > MAX_RECIPIENT_INPUT_LENGTH) return { emails: [], error: 'invalid' }
	const emails = input
		.split(',')
		.map((email) => email.trim())
		.filter(Boolean)

	if (options.required && emails.length === 0) return { emails, error: 'required' }
	if (
		emails.length > MAX_RECIPIENT_COUNT ||
		emails.some((email) => email.length > MAX_RECIPIENT_EMAIL_LENGTH || !EMAIL_RE.test(email))
	) {
		return { emails, error: 'invalid' }
	}
	return { emails, error: null }
}

export function parseRecipientEmails(input: unknown, options: { required: boolean }): string[] {
	const result = validateRecipientEmails(input, options)
	if (result.error === 'required') throw new Error('At least one recipient is required')
	if (result.error === 'invalid') throw new Error('Invalid recipient')
	return result.emails
}
