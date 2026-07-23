import { describe, expect, it } from 'vitest'
import { bodyRequestId, responseRequestId, sanitizeRequestId, userAgentHeader } from './http.js'

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

describe('request ID extraction', () => {
	it('prefers a validated response header over body fields', () => {
		const response = new Response(null, { headers: { 'x-request-id': 'req-header-123' } })
		expect(responseRequestId(response, { request_id: 'req-body-456' })).toBe('req-header-123')
	})

	it.each([
		[{ request_id: 'req-envelope' }, 'req-envelope'],
		[{ requestId: 'req-camel' }, 'req-camel'],
		[{ support_id: 'support-snake' }, 'support-snake'],
		[{ supportId: 'support-camel' }, 'support-camel'],
		[{ error: { request_id: 'req-nested' } }, 'req-nested'],
		[{ errors: [{ extensions: { supportId: 'support-graphql' } }] }, 'support-graphql'],
	])('reads known request ID shapes from response bodies', (body, expected) => {
		expect(bodyRequestId(body)).toBe(expected)
	})

	it('skips malformed error list members and invalid identifiers', () => {
		expect(bodyRequestId({ errors: [null, 'bad', { supportId: 'valid-id' }] })).toBe('valid-id')
		expect(bodyRequestId({ request_id: 'bad\nheader' })).toBeUndefined()
		expect(bodyRequestId('not-an-object')).toBeUndefined()
		expect(sanitizeRequestId('a'.repeat(129))).toBeUndefined()
	})

	it('uses alternate request headers and falls back to the body', () => {
		expect(responseRequestId(new Response(null, { headers: { 'x-nylas-request-id': 'req-nylas' } }))).toBe(
			'req-nylas',
		)
		expect(responseRequestId(new Response(null, { headers: { 'request-id': 'req-generic' } }))).toBe(
			'req-generic',
		)
		expect(responseRequestId(new Response(null), { supportId: 'support-body' })).toBe('support-body')
	})
})
