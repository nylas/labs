// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	availableTimezones,
	defaultUserPreferences,
	isSupportedTimezone,
	readUserPreferences,
	writeUserPreferences,
} from './user-preferences.js'

describe('user preferences', () => {
	beforeEach(() => window.localStorage.clear())

	it('uses safe local defaults when no preference has been saved', () => {
		const preferences = defaultUserPreferences()
		expect(preferences.autoSaveContacts).toBe(true)
		expect(preferences.emailDarkMode).toBe(true)
		expect(isSupportedTimezone(preferences.primaryTimezone)).toBe(true)
		expect(readUserPreferences()).toEqual(preferences)
	})

	it('normalizes saved values and drops invalid or duplicate timezones', () => {
		const saved = writeUserPreferences({
			displayName: '  Ada Lovelace  ',
			autoSaveContacts: false,
			emailDarkMode: false,
			primaryTimezone: 'UTC',
			secondaryTimezone: 'UTC',
		})
		expect(saved).toEqual({
			displayName: 'Ada Lovelace',
			autoSaveContacts: false,
			emailDarkMode: false,
			primaryTimezone: 'UTC',
			secondaryTimezone: '',
		})
		expect(readUserPreferences()).toEqual(saved)
		expect(isSupportedTimezone('not/a-timezone')).toBe(false)
	})

	it('recovers safely from malformed storage and invalid preference shapes', () => {
		window.localStorage.setItem('ownmail:user-preferences:v1', '{')
		expect(readUserPreferences()).toEqual(defaultUserPreferences())

		const saved = writeUserPreferences({
			displayName: 123 as never,
			autoSaveContacts: true,
			emailDarkMode: true,
			primaryTimezone: 'not/a-timezone',
			secondaryTimezone: 'UTC',
		})
		expect(saved.displayName).toBe('')
		expect(saved.primaryTimezone).toBe(defaultUserPreferences().primaryTimezone)
		// CI commonly uses UTC as the browser timezone. In that case the
		// normalizer correctly removes the duplicate secondary timezone.
		expect(saved.secondaryTimezone).toBe(saved.primaryTimezone === 'UTC' ? '' : 'UTC')
	})

	it('uses UTC when the runtime cannot provide a timezone list or browser timezone', () => {
		const dateTimeFormat = Intl.DateTimeFormat
		const supportedValuesOf = Intl.supportedValuesOf
		try {
			Object.defineProperty(Intl, 'supportedValuesOf', { configurable: true, value: undefined })
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function DateTimeFormatMock() {
				return { resolvedOptions: () => ({ timeZone: '' }), format: () => '' } as Intl.DateTimeFormat
			})
			expect(defaultUserPreferences().primaryTimezone).toBe('UTC')
			expect(availableTimezones()).toContain('UTC')
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function UnsupportedDateTimeFormatMock() {
				throw new Error('unsupported')
			})
			expect(defaultUserPreferences().primaryTimezone).toBe('UTC')
			expect(isSupportedTimezone('UTC')).toBe(false)
		} finally {
			vi.restoreAllMocks()
			Object.defineProperty(Intl, 'supportedValuesOf', { configurable: true, value: supportedValuesOf })
			Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: dateTimeFormat })
		}
	})

	it('returns normalized preferences when browser storage rejects the write', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
			throw new Error('storage unavailable')
		})
		expect(
			writeUserPreferences({
				displayName: 'Ada',
				autoSaveContacts: true,
				emailDarkMode: true,
				primaryTimezone: 'UTC',
				secondaryTimezone: '',
			}),
		).toMatchObject({ displayName: 'Ada', primaryTimezone: 'UTC' })
	})
})
