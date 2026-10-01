// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	availableTimezones,
	CALENDAR_HOUR_HEIGHTS,
	DEFAULT_CALENDAR_HOUR_HEIGHT,
	defaultUserPreferences,
	displayNameFor,
	hiddenCalendarIdsFor,
	isSupportedTimezone,
	readUserPreferences,
	USER_PREFERENCES_STORAGE_KEY,
	userPreferencesTestApi,
	useUserPreferences,
	useUserPreferencesReady,
	withDisplayName,
	withHiddenCalendarIds,
	writeUserPreferences,
} from './user-preferences.js'

beforeEach(() => {
	window.localStorage.clear()
	userPreferencesTestApi.reset()
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

describe('user preferences', () => {
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
			displayNameByAccount: { 'Ada@Example.com': '  Ada Lovelace  ' },
			autoSaveContacts: false,
			emailDarkMode: false,
			emailLayoutMode: 'original',
			emailColorMode: 'original',
			remoteImagePolicy: 'always',
			readingPane: 'horizontal',
			listDensity: 'condensed',
			primaryTimezone: 'UTC',
			secondaryTimezone: 'UTC',
			calendarHourHeight: 64,
			calendarSidebarCollapsed: true,
			hiddenCalendarsByAccount: { 'Ada@Example.com': ['cal-work', 'cal-work', 'cal-home'] },
		})
		expect(saved).toEqual({
			displayNameByAccount: { 'ada@example.com': 'Ada Lovelace' },
			autoSaveContacts: false,
			emailDarkMode: false,
			emailLayoutMode: 'original',
			emailColorMode: 'original',
			remoteImagePolicy: 'always',
			readingPane: 'horizontal',
			listDensity: 'condensed',
			primaryTimezone: 'UTC',
			secondaryTimezone: '',
			calendarHourHeight: 64,
			calendarSidebarCollapsed: true,
			hiddenCalendarsByAccount: { 'ada@example.com': ['cal-work', 'cal-home'] },
		})
		expect(readUserPreferences()).toEqual(saved)
		expect(isSupportedTimezone('not/a-timezone')).toBe(false)
	})

	it('keeps the split reading pane for unknown stored layouts', () => {
		// A layout name from a newer or tampered build must not hide the list.
		for (const readingPane of ['diagonal', 42, null]) {
			window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ readingPane }))
			expect(readUserPreferences().readingPane).toBe('vertical')
		}
		window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ readingPane: 'none' }))
		expect(readUserPreferences().readingPane).toBe('none')
	})

	it('falls back to the Default list density for unknown stored densities', () => {
		// New installs and density names from a newer or tampered build keep today's three-line row.
		expect(defaultUserPreferences().listDensity).toBe('default')
		for (const listDensity of ['micro', 42, null]) {
			window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ listDensity }))
			expect(readUserPreferences().listDensity).toBe('default')
		}
		for (const listDensity of ['compact', 'condensed']) {
			window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ listDensity }))
			expect(readUserPreferences().listDensity).toBe(listDensity)
		}
	})

	it('keeps the default hour height for stored zoom steps the grid does not offer', () => {
		// Layout math divides by the hour height, so a tampered or outdated value
		// (zero, negative, a string) must never reach the grid.
		expect(defaultUserPreferences().calendarHourHeight).toBe(DEFAULT_CALENDAR_HOUR_HEIGHT)
		for (const calendarHourHeight of [0, -52, 53, '64', null, Number.POSITIVE_INFINITY]) {
			window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ calendarHourHeight }))
			expect(readUserPreferences().calendarHourHeight).toBe(DEFAULT_CALENDAR_HOUR_HEIGHT)
		}
		for (const calendarHourHeight of CALENDAR_HOUR_HEIGHTS) {
			window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ calendarHourHeight }))
			expect(readUserPreferences().calendarHourHeight).toBe(calendarHourHeight)
		}
	})

	it('shows the calendar sidebar unless this device explicitly collapsed it', () => {
		// Anything other than a stored `true` keeps the sidebar, so calendars stay reachable.
		expect(defaultUserPreferences().calendarSidebarCollapsed).toBe(false)
		for (const calendarSidebarCollapsed of ['true', 1, null]) {
			window.localStorage.setItem('ownmail:user-preferences:v1', JSON.stringify({ calendarSidebarCollapsed }))
			expect(readUserPreferences().calendarSidebarCollapsed).toBe(false)
		}
		window.localStorage.setItem(
			'ownmail:user-preferences:v1',
			JSON.stringify({ calendarSidebarCollapsed: true }),
		)
		expect(readUserPreferences().calendarSidebarCollapsed).toBe(true)
	})

	it('recovers safely from malformed storage and invalid preference shapes', () => {
		window.localStorage.setItem('ownmail:user-preferences:v1', '{')
		expect(readUserPreferences()).toEqual(defaultUserPreferences())

		const saved = writeUserPreferences({
			displayNameByAccount: 123 as never,
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
		expect(saved.displayNameByAccount).toEqual({})
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
			writeUserPreferences({ ...defaultUserPreferences(), readingPane: 'none', primaryTimezone: 'UTC' }),
		).toMatchObject({ readingPane: 'none', primaryTimezone: 'UTC' })
		// Nothing was stored, but the choice still holds for this visit.
		expect(window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)).toBeNull()
		expect(readUserPreferences().readingPane).toBe('none')
	})

	it('falls back to defaults when browser storage cannot be read at all', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage blocked')
		})
		expect(readUserPreferences()).toEqual(defaultUserPreferences())
	})
})

describe('per-inbox display names', () => {
	it('never shows one inbox the display name saved in another', () => {
		const saved = writeUserPreferences(
			withDisplayName(defaultUserPreferences(), 'Ada@Example.com', '  Ada Lovelace '),
		)
		expect(displayNameFor(saved, ' ada@example.com ')).toBe('Ada Lovelace')
		// Grace has no name of her own; she must not be labelled "Ada Lovelace".
		expect(displayNameFor(saved, 'grace@example.com')).toBe('')

		const both = withDisplayName(saved, 'grace@example.com', 'Grace Hopper')
		expect(displayNameFor(both, 'ada@example.com')).toBe('Ada Lovelace')
		expect(displayNameFor(both, 'grace@example.com')).toBe('Grace Hopper')
	})

	it('drops the legacy single display name because it cannot be attributed to an inbox', () => {
		window.localStorage.setItem(
			USER_PREFERENCES_STORAGE_KEY,
			JSON.stringify({ ...defaultUserPreferences(), displayName: 'Ada Lovelace' }),
		)
		const read = readUserPreferences()
		expect(read.displayNameByAccount).toEqual({})
		expect(read).not.toHaveProperty('displayName')
		expect(displayNameFor(read, 'grace@example.com')).toBe('')
	})

	it('keeps only well-formed names for well-formed inboxes, so a tampered store cannot label an account', () => {
		const saved = writeUserPreferences({
			...defaultUserPreferences(),
			displayNameByAccount: {
				'ada@example.com': `  ${'A'.repeat(150)}  `,
				'not-an-email': 'Mallory',
				'blank@example.com': '   ',
				'wrong-shape@example.com': 42 as never,
				'line\nbreak@example.com': 'Mallory',
			},
		})
		expect(saved.displayNameByAccount).toEqual({ 'ada@example.com': 'A'.repeat(120) })
		expect(
			writeUserPreferences({ ...defaultUserPreferences(), displayNameByAccount: ['Ada'] as never })
				.displayNameByAccount,
		).toEqual({})
	})

	it('clears a name, ignores an unusable inbox, and caps stored inboxes to the most recent', () => {
		let preferences = withDisplayName(defaultUserPreferences(), 'ada@example.com', 'Ada')
		expect(withDisplayName(preferences, 'no-at-sign', 'Mallory')).toBe(preferences)
		expect(displayNameFor(preferences, '')).toBe('')
		expect(withDisplayName(preferences, 'ada@example.com', '  ').displayNameByAccount).toEqual({})

		for (let index = 0; index < 22; index++) {
			preferences = withDisplayName(preferences, `user${index}@example.com`, `User ${index}`)
		}
		preferences = withDisplayName(preferences, 'ada@example.com', 'Ada again')
		const saved = writeUserPreferences(preferences)
		expect(Object.keys(saved.displayNameByAccount)).toHaveLength(20)
		expect(displayNameFor(saved, 'ada@example.com')).toBe('Ada again')
		expect(displayNameFor(saved, 'user0@example.com')).toBe('')
		expect(displayNameFor(saved, 'user21@example.com')).toBe('User 21')
	})
})

describe('shared preference store', () => {
	it('has the saved values on the very first client render, with no default-then-flip', () => {
		writeUserPreferences({
			...defaultUserPreferences(),
			readingPane: 'horizontal',
			emailLayoutMode: 'original',
		})
		const renders: string[] = []

		const { result } = renderHook(() => {
			const [preferences] = useUserPreferences()
			renders.push(`${preferences.readingPane}:${preferences.emailLayoutMode}:${useUserPreferencesReady()}`)
			return preferences
		})

		// A reader that started from defaults would paint "vertical" first.
		expect(renders[0]).toBe('horizontal:original:true')
		expect(new Set(renders)).toEqual(new Set(['horizontal:original:true']))
		// The snapshot keeps its identity until the stored text changes.
		expect(readUserPreferences()).toBe(result.current)
	})

	it('renders defaults marked "not ready" on the server, so dependent regions can show a placeholder', () => {
		writeUserPreferences({ ...defaultUserPreferences(), readingPane: 'horizontal' })

		function Probe() {
			const [preferences] = useUserPreferences()
			return createElement('p', null, `${preferences.readingPane}:${useUserPreferencesReady()}`)
		}

		// The server cannot read this device's storage.
		expect(renderToString(createElement(Probe))).toBe('<p>vertical:false</p>')
	})

	it('is one store: a change saved by one reader reaches every other reader', () => {
		const first = renderHook(() => useUserPreferences())
		const second = renderHook(() => useUserPreferences())

		act(() => first.result.current[1]({ ...first.result.current[0], readingPane: 'none' }))

		expect(first.result.current[0].readingPane).toBe('none')
		expect(second.result.current[0].readingPane).toBe('none')
	})

	it('follows changes made in another tab and ignores unrelated storage keys', () => {
		const { result, unmount } = renderHook(() => useUserPreferences())
		const before = result.current[0]

		act(() => {
			window.localStorage.setItem('theme', 'dark')
			window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }))
		})
		expect(result.current[0]).toBe(before)

		act(() => {
			window.localStorage.setItem(
				USER_PREFERENCES_STORAGE_KEY,
				JSON.stringify({ ...defaultUserPreferences(), readingPane: 'horizontal' }),
			)
			window.dispatchEvent(new StorageEvent('storage', { key: USER_PREFERENCES_STORAGE_KEY }))
		})
		expect(result.current[0].readingPane).toBe('horizontal')

		// `localStorage.clear()` in another tab reports a null key and wipes the entry.
		act(() => {
			window.localStorage.clear()
			window.dispatchEvent(new StorageEvent('storage', { key: null }))
		})
		expect(result.current[0].readingPane).toBe('vertical')
		unmount()
	})
})
