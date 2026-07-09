/**
 * Pure helpers backing the recipient/guest chip input. The React component
 * (RecipientInput) keeps the comma-separated `value: string` contract that
 * compose drafts and calendar guests already speak; these functions translate
 * between that string and the committed-token list, and drive dropdown
 * highlighting. Kept side-effect free so every branch is unit-testable.
 */

/** Split a comma-separated recipient string into trimmed, non-empty tokens. */
export function valueToTokens(value: string): string[] {
	return value
		.split(',')
		.map((token) => token.trim())
		.filter(Boolean)
}

/** Join committed tokens back into the canonical comma-separated string. */
export function tokensToValue(tokens: string[]): string {
	return tokens.join(', ')
}

/** Append a token, trimming and skipping empties and case-insensitive duplicates. */
export function addToken(tokens: string[], raw: string): string[] {
	const next = raw.trim()
	if (!next) return tokens
	if (tokens.some((token) => token.toLowerCase() === next.toLowerCase())) return tokens
	return [...tokens, next]
}

/** Remove the token at the given index (no-op for out-of-range indices). */
export function removeTokenAt(tokens: string[], index: number): string[] {
	return tokens.filter((_, tokenIndex) => tokenIndex !== index)
}

/**
 * Move a highlight index by delta within [0, count), wrapping around. Returns
 * -1 when there is nothing to highlight; from the "nothing highlighted" state a
 * downward move lands on the first row and an upward move on the last.
 */
export function moveHighlight(current: number, delta: number, count: number): number {
	if (count <= 0) return -1
	if (current < 0) return delta > 0 ? 0 : count - 1
	return (current + delta + count) % count
}
