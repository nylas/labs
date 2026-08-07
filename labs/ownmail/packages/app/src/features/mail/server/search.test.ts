import { describe, expect, it } from 'vitest'
import { threadSearchParams } from './search.js'

describe('Nylas thread search params', () => {
	it('preserves the Agent Account grammar for terms, expressions, and addresses', () => {
		expect(threadSearchParams(' roadmap ')).toEqual({ search_query_native: 'roadmap' })
		expect(threadSearchParams('grace@vercel.com')).toEqual({ search_query_native: 'grace@vercel.com' })
		expect(threadSearchParams('(invoice OR receipt) -paid')).toEqual({
			search_query_native: '(invoice OR receipt) -paid',
		})
		expect(threadSearchParams('')).toEqual({})
	})
})
