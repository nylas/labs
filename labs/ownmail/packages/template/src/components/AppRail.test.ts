import { describe, expect, it } from 'vitest'
import { initialThemeIsDark } from './AppRail.js'

describe('AppRail theme defaults', () => {
	it('defaults to the reference light theme without a saved preference', () => {
		expect(initialThemeIsDark(null)).toBe(false)
	})

	it('honors saved dark preference', () => {
		expect(initialThemeIsDark('dark')).toBe(true)
		expect(initialThemeIsDark('light')).toBe(false)
	})
})
