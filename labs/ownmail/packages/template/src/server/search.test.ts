import { describe, expect, it } from 'vitest'
import { threadSearchParams } from './search.js'

describe('Nylas thread search params', () => {
	it('uses email filtering for email-like input and native full-text otherwise', () => {
		expect(threadSearchParams(' roadmap ')).toEqual({ search_query_native: 'roadmap' })
		expect(threadSearchParams('grace@vercel.com')).toEqual({ any_email: 'grace@vercel.com' })
		expect(threadSearchParams('')).toEqual({})
	})
})
