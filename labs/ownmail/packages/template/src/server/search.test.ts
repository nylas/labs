import { describe, expect, it } from 'vitest'
import { threadSearchParams } from './search.js'

describe('Nylas Agent Account search params', () => {
	it('uses supported thread filters instead of provider-native full-text search', () => {
		expect(threadSearchParams(' roadmap ')).toEqual({ subject: 'roadmap' })
		expect(threadSearchParams('grace@vercel.com')).toEqual({ any_email: 'grace@vercel.com' })
		expect(threadSearchParams('')).toEqual({})
	})
})
