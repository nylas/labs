import { describe, expect, it } from 'vitest'
import { userAgentHeader } from './http.js'

describe('userAgentHeader', () => {
	it('accepts a fixed product marker', () => {
		expect(userAgentHeader('ownmail')).toEqual({ 'User-Agent': 'ownmail' })
	})

	it('omits the header when attribution is not configured', () => {
		expect(userAgentHeader()).toEqual({})
	})

	it.each([
		'',
		'ownmail user',
		'ownmail\r\nx-secret: leaked',
		'a'.repeat(129),
	])('rejects an unsafe marker: %j', (userAgent) => {
		expect(() => userAgentHeader(userAgent)).toThrow('userAgent must be')
	})
})
