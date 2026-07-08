const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseRecipientEmails(input: string, options: { required: boolean }): string[] {
	const emails = input
		.split(',')
		.map((email) => email.trim())
		.filter(Boolean)

	if (options.required && emails.length === 0) throw new Error('At least one recipient is required')
	for (const email of emails) {
		if (!EMAIL_RE.test(email)) throw new Error(`Invalid recipient: ${email}`)
	}
	return emails
}
