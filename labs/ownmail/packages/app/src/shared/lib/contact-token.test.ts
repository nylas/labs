import { describe, expect, it } from 'vitest'
import { addToken, moveHighlight, removeTokenAt, tokensToValue, valueToTokens } from './contact-token.js'

describe('valueToTokens', () => {
	it('splits, trims, and drops empty fragments', () => {
		expect(valueToTokens('a@x.com, b@x.com')).toEqual(['a@x.com', 'b@x.com'])
		expect(valueToTokens('  a@x.com ,, , b@x.com ,')).toEqual(['a@x.com', 'b@x.com'])
		expect(valueToTokens('')).toEqual([])
	})
})

describe('tokensToValue', () => {
	it('joins with a comma and space, round-tripping with valueToTokens', () => {
		expect(tokensToValue(['a@x.com', 'b@x.com'])).toBe('a@x.com, b@x.com')
		expect(tokensToValue([])).toBe('')
		expect(valueToTokens(tokensToValue(['a@x.com', 'b@x.com']))).toEqual(['a@x.com', 'b@x.com'])
	})
})

describe('addToken', () => {
	it('appends a trimmed token', () => {
		expect(addToken(['a@x.com'], '  b@x.com ')).toEqual(['a@x.com', 'b@x.com'])
	})

	it('ignores empty or whitespace-only input', () => {
		expect(addToken(['a@x.com'], '   ')).toEqual(['a@x.com'])
	})

	it('skips case-insensitive duplicates', () => {
		expect(addToken(['a@x.com'], 'A@X.com')).toEqual(['a@x.com'])
	})
})

describe('removeTokenAt', () => {
	it('removes the token at the index', () => {
		expect(removeTokenAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
	})

	it('is a no-op for an out-of-range index', () => {
		expect(removeTokenAt(['a', 'b'], 5)).toEqual(['a', 'b'])
	})
})

describe('moveHighlight', () => {
	it('returns -1 when there is nothing to highlight', () => {
		expect(moveHighlight(0, 1, 0)).toBe(-1)
	})

	it('lands on the first row moving down from nothing highlighted', () => {
		expect(moveHighlight(-1, 1, 3)).toBe(0)
	})

	it('lands on the last row moving up from nothing highlighted', () => {
		expect(moveHighlight(-1, -1, 3)).toBe(2)
	})

	it('wraps around within the list', () => {
		expect(moveHighlight(0, 1, 3)).toBe(1)
		expect(moveHighlight(2, 1, 3)).toBe(0)
		expect(moveHighlight(0, -1, 3)).toBe(2)
	})
})
