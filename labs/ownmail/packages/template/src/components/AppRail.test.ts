import { describe, expect, it } from 'vitest'
import { initialThemeIsDark } from './AppRail.js'
import { MAIL_HOME_PATH } from './route-paths.js'

describe('AppRail theme defaults', () => {
	it('links mail navigation to the reference root inbox route', () => {
		expect(MAIL_HOME_PATH).toBe('/')
	})

	it('defaults to the reference light theme without a saved preference', () => {
		expect(initialThemeIsDark(null)).toBe(false)
	})

	it('honors saved dark preference', () => {
		expect(initialThemeIsDark('dark')).toBe(true)
		expect(initialThemeIsDark('light')).toBe(false)
	})
})
