import { describe, expect, it } from 'vitest'
import { initialThemeIsDark } from './AppRail.js'
import { AUTH_PATH, LOGIN_PATH, MAIL_HOME_PATH } from './route-paths.js'

describe('AppRail theme defaults', () => {
	it('links mail navigation to the reference root inbox route', () => {
		expect(MAIL_HOME_PATH).toBe('/')
	})

	it('sends sign-out to the reference login route', () => {
		expect(LOGIN_PATH).toBe('/login')
	})

	it('uses the auth route for the reference sign-in handoff', () => {
		expect(AUTH_PATH).toBe('/auth')
	})

	it('defaults to the reference light theme without a saved preference', () => {
		expect(initialThemeIsDark(null)).toBe(false)
	})

	it('honors saved dark preference', () => {
		expect(initialThemeIsDark('dark')).toBe(true)
		expect(initialThemeIsDark('light')).toBe(false)
	})
})
