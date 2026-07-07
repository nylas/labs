import { randomInt } from 'node:crypto'

const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const DIGIT = '23456789'
const SYMBOL = '!@#$%^&*_-+='
const ALL = UPPER + LOWER + DIGIT + SYMBOL

/**
 * Generates a 24-char app password satisfying the Nylas agent-account policy:
 * 18–40 standard non-space ASCII with upper/lower/digit/symbol.
 * Ambiguous glyphs (I/l/1/O/0) are excluded for readability.
 */
export function generateAppPassword(mailboxName?: string): string {
	for (let attempt = 0; attempt < 1000; attempt++) {
		const chars: string[] = [pickChar(UPPER), pickChar(LOWER), pickChar(DIGIT), pickChar(SYMBOL)]
		while (chars.length < 24) chars.push(pickChar(ALL))
		// Fisher-Yates with a CSPRNG
		for (let i = chars.length - 1; i > 0; i--) {
			const j = randomInt(i + 1)
			const left = chars[i]
			const right = chars[j]
			if (left === undefined || right === undefined) throw new Error('Password generation failed')
			chars[i] = right
			chars[j] = left
		}
		const password = chars.join('')
		if (!validateAppPassword(password, mailboxName)) return password
	}
	throw new Error('Could not generate a valid password')
}

/** Mirrors UAS ValidateAppPassword. Returns an error message or undefined. */
export function validateAppPassword(value: string, mailboxName?: string): string | undefined {
	if (value.length < 18 || value.length > 40) return 'Must be 18–40 characters'
	if (!/^[\x21-\x7E]+$/.test(value)) return 'Only standard characters, no spaces'
	if (!/[A-Z]/.test(value)) return 'Needs at least one uppercase letter'
	if (!/[a-z]/.test(value)) return 'Needs at least one lowercase letter'
	if (!/[0-9]/.test(value)) return 'Needs at least one digit'
	if (!/[^A-Za-z0-9]/.test(value)) return 'Needs at least one symbol'
	const normalizedMailbox = mailboxLocalPart(mailboxName)
	if (normalizedMailbox && value.toLowerCase().includes(normalizedMailbox)) {
		return 'Must not contain the mailbox name'
	}
	return undefined
}

function pickChar(chars: string): string {
	const picked = chars[randomInt(chars.length)]
	if (!picked) throw new Error('Password generation failed')
	return picked
}

function mailboxLocalPart(mailboxName: string | undefined): string {
	return mailboxName?.split('@')[0]?.trim().toLowerCase() ?? ''
}
