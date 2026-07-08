import { describe, expect, it } from 'vitest'
import {
	clearSessionCookie,
	createReferenceDevSessionCookie,
	hasReferenceDevSessionCookie,
} from './session.js'

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

	it('creates and clears the reference dev auth cookie over local HTTP', () => {
		const sessionCookie = createReferenceDevSessionCookie()
		const clearCookie = clearSessionCookie()

		expect(sessionCookie).toContain('ownmail_session=authenticated')
		expect(sessionCookie).toContain('HttpOnly')
		expect(sessionCookie).toContain('SameSite=Lax')
		expect(sessionCookie).not.toContain('Secure')
		expect(clearCookie).toContain('ownmail_session=')
		expect(clearCookie).toContain('Max-Age=0')
		expect(clearCookie).not.toContain('Secure')
	})
})
