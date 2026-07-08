import { describe, expect, it } from 'vitest'
import { hasReferenceDevSessionCookie } from './session.js'

describe('session helpers', () => {
	it('recognizes the reference app dev auth cookie without treating other values as authenticated', () => {
		expect(
			hasReferenceDevSessionCookie(
				new Request('http://ownmail.local/login', {
					headers: { cookie: 'ownmail_session=authenticated; theme=dark' },
				}),
			),
		).toBe(true)
		expect(
			hasReferenceDevSessionCookie(
				new Request('http://ownmail.local/login', {
					headers: { cookie: 'ownmail_session=not-authenticated' },
				}),
			),
		).toBe(false)
		expect(hasReferenceDevSessionCookie(new Request('http://ownmail.local/login'))).toBe(false)
	})
})
