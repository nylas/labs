import { describe, expect, it } from 'vitest'
import { AUTH_PATH, LOGIN_PATH, MAIL_HOME_PATH } from './route-paths.js'
import {
	INITIAL_ROOT_CLASS_NAME,
	initialThemeIsDark,
	ROOT_BACKGROUND_CLASS,
	rootThemeClassNames,
	THEME_STORAGE_KEY,
	themeClassName,
	themeToggleLabel,
} from './theme.js'

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

	it('uses the reference next-themes storage key', () => {
		expect(THEME_STORAGE_KEY).toBe('theme')
	})

	it('honors saved dark preference', () => {
		expect(initialThemeIsDark('dark')).toBe(true)
		expect(initialThemeIsDark('light')).toBe(false)
	})

	it('uses reference light and dark document class names', () => {
		expect(themeClassName(false)).toBe('light')
		expect(themeClassName(true)).toBe('dark')
	})

	it('uses the reference theme toggle labels before and after mount', () => {
		expect(themeToggleLabel(false, false)).toBe('Toggle theme')
		expect(themeToggleLabel(true, false)).toBe('Switch to dark mode')
		expect(themeToggleLabel(true, true)).toBe('Switch to light mode')
	})

	it('keeps the reference root background class with the theme class', () => {
		expect(ROOT_BACKGROUND_CLASS).toBe('bg-background')
		expect(rootThemeClassNames(false)).toEqual(['bg-background', 'light'])
		expect(rootThemeClassNames(true)).toEqual(['bg-background', 'dark'])
		expect(INITIAL_ROOT_CLASS_NAME).toBe('bg-background light')
	})
})
