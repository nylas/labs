import { describe, expect, it } from 'vitest'
import {
	applyMailSearchSuggestion,
	MAIL_SEARCH_MAX_BYTES,
	mailSearchSuggestions,
	requireValidMailSearchQuery,
	validateMailSearchQuery,
} from './mail-search.js'

describe('Agent Account mail search grammar', () => {
	it.each([
		'invoice overdue',
		'invoice AND overdue',
		'"quarterly invoice" overdue -paid',
		'(invoice OR receipt) AND (overdue OR disputed)',
		'charger -(my OR book)',
		'alice+receipts@example.com',
	])('accepts %s', (query) => {
		expect(validateMailSearchQuery(query)).toEqual({ valid: true, query })
	})

	it.each([
		['-resolved', 'Add a positive term'],
		['-resolved OR invoice', 'Each OR alternative'],
		['charger OR -resolved', 'Each OR alternative'],
		['charger - resolved', 'Attach “-” directly'],
		['charger --resolved', 'Attach “-” directly'],
		['invoice OR', 'Finish the search expression'],
		['AND invoice', 'Add a term, phrase, or group'],
		['invoice AND AND receipt', 'Add a term, phrase, or group'],
		['invoice -)', 'Add a term, phrase, or group'],
		['"invoice', 'Close the quoted phrase'],
		['""', 'Quoted phrases need'],
		['"invoice:paid"', "“:” isn't supported"],
		['invoice"paid', 'Start a quoted phrase'],
		['...', 'Add a searchable word or email address'],
		['()', 'Search groups cannot be empty'],
		['(invoice OR receipt', 'Close every search group'],
		['invoice)', 'Remove the unmatched'],
		['from:alice@example.com', "“:” isn't supported"],
		['charg*', "“*” isn't supported"],
	])('rejects %s with useful recovery guidance', (query, message) => {
		const result = validateMailSearchQuery(query)
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.message).toContain(message)
	})

	it('enforces the decoded UTF-8 byte limit, including multibyte input', () => {
		expect(validateMailSearchQuery('x'.repeat(MAIL_SEARCH_MAX_BYTES)).valid).toBe(true)
		expect(validateMailSearchQuery('x'.repeat(MAIL_SEARCH_MAX_BYTES + 1)).valid).toBe(false)
		expect(validateMailSearchQuery('é'.repeat(MAIL_SEARCH_MAX_BYTES / 2)).valid).toBe(true)
		expect(validateMailSearchQuery(`é${'x'.repeat(MAIL_SEARCH_MAX_BYTES - 1)}`).valid).toBe(false)
	})

	it('enforces nesting and expression-size limits', () => {
		expect(validateMailSearchQuery(`${'('.repeat(8)}invoice${')'.repeat(8)}`).valid).toBe(true)
		expect(validateMailSearchQuery(`${'('.repeat(9)}invoice${')'.repeat(9)}`).valid).toBe(false)
		expect(
			validateMailSearchQuery(Array.from({ length: 63 }, (_, index) => `t${index}`).join(' ')).valid,
		).toBe(true)
		expect(
			validateMailSearchQuery(Array.from({ length: 64 }, (_, index) => `t${index}`).join(' ')).valid,
		).toBe(false)
	})

	it('normalizes valid input and fails closed with a generic server error', () => {
		expect(requireValidMailSearchQuery('  invoice  ')).toBe('invoice')
		expect(() => requireValidMailSearchQuery('from:alice@example.com')).toThrow('Invalid search query')
		expect(() => requireValidMailSearchQuery(42)).toThrow('Invalid search query')
	})

	it('accepts an exclusion before an implicit positive term', () => {
		expect(validateMailSearchQuery('-paid invoice')).toEqual({ valid: true, query: '-paid invoice' })
	})
})

describe('mail search suggestions', () => {
	it('offers discoverable advanced-search templates for an empty input', () => {
		expect(mailSearchSuggestions('').map(({ id }) => id)).toEqual(['phrase', 'either'])
		const suggestion = mailSearchSuggestions('')[0]
		if (!suggestion) throw new Error('Expected an exact-phrase suggestion')
		const applied = applyMailSearchSuggestion('', suggestion)
		expect(applied).toEqual({ value: '""', cursor: 1 })
	})

	it('predicts operators without replacing ordinary query text', () => {
		const value = 'invoice o'
		const suggestion = mailSearchSuggestions(value).find(({ id }) => id === 'complete-or')
		expect(suggestion).toBeDefined()
		if (!suggestion) throw new Error('Expected an OR completion')
		expect(applyMailSearchSuggestion(value, suggestion)).toEqual({ value: 'invoice OR ', cursor: 11 })
	})

	it('suggests the next valid grammar operations after a complete expression', () => {
		expect(mailSearchSuggestions('invoice').map(({ id }) => id)).toEqual(['or', 'exclude'])
		expect(mailSearchSuggestions('invoice ').map(({ id }) => id)).toEqual(['or', 'exclude'])
		expect(mailSearchSuggestions('a', 2).map(({ id }) => id)).toEqual(['complete-and', 'or', 'exclude'])
		expect(mailSearchSuggestions('invoice overdue').map(({ id }) => id)).toEqual(['or', 'exclude', 'group'])
	})

	it('does not offer continuation helpers for an invalid expression', () => {
		expect(mailSearchSuggestions('invoice :')).toEqual([])
	})
})
