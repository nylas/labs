// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	availableTimezones,
	defaultUserPreferences,
	hiddenCalendarIdsFor,
	isSupportedTimezone,
	readUserPreferences,
	withHiddenCalendarIds,
	writeUserPreferences,
} from './user-preferences.js'

describe('user preferences', () => {
	beforeEach(() => window.localStorage.clear())

	it('uses safe local defaults when no preference has been saved', () => {
		const preferences = defaultUserPreferences()
		expect(preferences.autoSaveContacts).toBe(true)
		expect(preferences.emailDarkMode).toBe(true)
		expect(preferences.emailLayoutMode).toBe('readable')
		expect(preferences.emailColorMode).toBe('automatic')
		expect(preferences.remoteImagePolicy).toBe('ask')
		expect(isSupportedTimezone(preferences.primaryTimezone)).toBe(true)
		expect(readUserPreferences()).toEqual(preferences)
	})

	it('normalizes saved values and drops invalid or duplicate timezones', () => {
		const saved = writeUserPreferences({
			displayName: '  Ada Lovelace  ',
			autoSaveContacts: false,
			emailDarkMode: false,
			emailLayoutMode: 'original',
			emailColorMode: 'original',
			remoteImagePolicy: 'always',
			primaryTimezone: 'UTC',
			secondaryTimezone: 'UTC',
			hiddenCalendarsByAccount: { 'Ada@Example.com': ['cal-work', 'cal-work', 'cal-home'] },
		})
		expect(saved).toEqual({
			displayName: 'Ada Lovelace',
			autoSaveContacts: false,
			emailDarkMode: false,
			emailLayoutMode: 'original',
			emailColorMode: 'original',
			remoteImagePolicy: 'always',
			primaryTimezone: 'UTC',
			secondaryTimezone: '',
			hiddenCalendarsByAccount: { 'ada@example.com': ['cal-work', 'cal-home'] },
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
			emailLayoutMode: 'invalid' as never,
			emailColorMode: 'invalid' as never,
			remoteImagePolicy: 'invalid' as never,
			primaryTimezone: 'not/a-timezone',
			secondaryTimezone: 'UTC',
			hiddenCalendarsByAccount: ['cal-work'] as never,
		})
		expect(saved.hiddenCalendarsByAccount).toEqual({})
		expect(saved.displayName).toBe('')
		expect(saved.remoteImagePolicy).toBe('ask')
		expect(saved.emailLayoutMode).toBe('readable')
		expect(saved.emailColorMode).toBe('automatic')
		expect(saved.primaryTimezone).toBe(defaultUserPreferences().primaryTimezone)
		// CI commonly uses UTC as the browser timezone. In that case the
		// normalizer correctly removes the duplicate secondary timezone.
		expect(saved.secondaryTimezone).toBe(saved.primaryTimezone === 'UTC' ? '' : 'UTC')
	})

	it('keeps only well-formed hidden calendar ids so a tampered store cannot hide arbitrary data', () => {
		const saved = writeUserPreferences({
			...defaultUserPreferences(),
			hiddenCalendarsByAccount: {
				'ada@example.com': ['ok', '', 'x'.repeat(1001), 'line\nbreak', 42 as never],
				'not-an-email': ['cal-work'],
				[`${'x'.repeat(320)}@example.com`]: ['cal-work'],
				'line\nbreak@example.com': ['cal-work'],
				'empty@example.com': [],
				'wrong-shape@example.com': 'cal-work' as never,
			},
		})
		expect(saved.hiddenCalendarsByAccount).toEqual({ 'ada@example.com': ['ok'] })
	})

	it('caps hidden calendar ids and keeps the most recent choices', () => {
		const ids = Array.from({ length: 205 }, (_, index) => `cal-${index}`)
		const saved = writeUserPreferences(
			withHiddenCalendarIds(defaultUserPreferences(), 'ada@example.com', ids),
		)
		const kept = hiddenCalendarIdsFor(saved, 'ada@example.com')
		expect(kept).toHaveLength(200)
		expect(kept[0]).toBe('cal-5')
		expect(kept.at(-1)).toBe('cal-204')
	})

	it('scopes hidden calendars per inbox because every grant has its own `primary` calendar', () => {
		let preferences = withHiddenCalendarIds(defaultUserPreferences(), 'Ada@Example.com', ['primary'])
		preferences = withHiddenCalendarIds(preferences, 'grace@example.com', ['cal-team'])
		const saved = writeUserPreferences(preferences)
		// Hiding `primary` in one inbox must not hide the other inbox's `primary`.
		expect(hiddenCalendarIdsFor(saved, ' ada@example.com ')).toEqual(['primary'])
		expect(hiddenCalendarIdsFor(saved, 'grace@example.com')).toEqual(['cal-team'])
		expect(hiddenCalendarIdsFor(saved, 'linus@example.com')).toEqual([])
		// An unusable mailbox identity neither reads nor writes any account's choices.
		expect(hiddenCalendarIdsFor(saved, '')).toEqual([])
		expect(withHiddenCalendarIds(saved, 'no-at-sign', ['primary'])).toBe(saved)
	})

	it('drops the legacy flat hidden list because it cannot be attributed to an inbox', () => {
		window.localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ ...defaultUserPreferences(), hiddenCalendarIds: ['primary'] }),
		)
		const read = readUserPreferences()
		expect(read.hiddenCalendarsByAccount).toEqual({})
		expect(read).not.toHaveProperty('hiddenCalendarIds')
	})

	it('caps stored inboxes and keeps the most recently changed ones', () => {
		let preferences = defaultUserPreferences()
		for (let index = 0; index < 22; index++) {
			preferences = withHiddenCalendarIds(preferences, `user${index}@example.com`, ['primary'])
		}
		// Touching an older inbox makes it the most recent one again.
		preferences = withHiddenCalendarIds(preferences, 'user0@example.com', ['cal-a'])
		const saved = writeUserPreferences(preferences)
		expect(Object.keys(saved.hiddenCalendarsByAccount)).toHaveLength(20)
		expect(hiddenCalendarIdsFor(saved, 'user0@example.com')).toEqual(['cal-a'])
		expect(hiddenCalendarIdsFor(saved, 'user1@example.com')).toEqual([])
		expect(hiddenCalendarIdsFor(saved, 'user2@example.com')).toEqual([])
		expect(hiddenCalendarIdsFor(saved, 'user3@example.com')).toEqual(['primary'])
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
				emailLayoutMode: 'readable',
				emailColorMode: 'automatic',
				remoteImagePolicy: 'ask',
				primaryTimezone: 'UTC',
				secondaryTimezone: '',
			}),
		).toMatchObject({ displayName: 'Ada', primaryTimezone: 'UTC' })
	})
})
