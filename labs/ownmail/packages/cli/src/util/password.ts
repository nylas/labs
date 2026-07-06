import { randomInt } from 'node:crypto'

const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const LOWER = 'abcdefghjkmnpqrstuvwxyz'
const DIGIT = '23456789'
const ALL = UPPER + LOWER + DIGIT

/**
 * Generates a 24-char app password satisfying the Nylas agent-account policy:
 * 18–40 printable ASCII with at least one uppercase, lowercase, and digit.
 * Ambiguous glyphs (I/l/1/O/0) are excluded for readability.
 */
export function generateAppPassword(): string {
	const chars: string[] = [
		UPPER[randomInt(UPPER.length)]!,
		LOWER[randomInt(LOWER.length)]!,
		DIGIT[randomInt(DIGIT.length)]!,
	]
	while (chars.length < 24) chars.push(ALL[randomInt(ALL.length)]!)
	// Fisher–Yates with a CSPRNG
	for (let i = chars.length - 1; i > 0; i--) {
		const j = randomInt(i + 1)
		;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
	}
	return chars.join('')
}

/** Mirrors UAS ValidateAppPassword. Returns an error message or undefined. */
export function validateAppPassword(value: string): string | undefined {
	if (value.length < 18 || value.length > 40) return 'Must be 18–40 characters'
	if (!/^[\x20-\x7E]+$/.test(value)) return 'Printable ASCII only'
	if (!/[A-Z]/.test(value)) return 'Needs at least one uppercase letter'
	if (!/[a-z]/.test(value)) return 'Needs at least one lowercase letter'
	if (!/[0-9]/.test(value)) return 'Needs at least one digit'
	return undefined
}
