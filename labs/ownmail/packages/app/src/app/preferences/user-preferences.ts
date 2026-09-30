import { useCallback, useEffect, useState } from 'react'

export const USER_PREFERENCES_STORAGE_KEY = 'ownmail:user-preferences:v1'
const MAX_DISPLAY_NAME_LENGTH = 120
const MAX_HIDDEN_CALENDAR_IDS = 200
const MAX_CALENDAR_ID_LENGTH = 1000
const MAX_HIDDEN_CALENDAR_ACCOUNTS = 20
const MAX_ACCOUNT_KEY_LENGTH = 320

export type RemoteImagePolicy = 'ask' | 'always'

export type UserPreferences = {
	displayName: string
	autoSaveContacts: boolean
	emailDarkMode: boolean
	emailLayoutMode: 'readable' | 'original'
	emailColorMode: 'automatic' | 'original'
	remoteImagePolicy: RemoteImagePolicy
	primaryTimezone: string
	secondaryTimezone: string
	/**
	 * Calendars the person unchecked in the calendar sidebar, keyed by mailbox
	 * email. Calendar ids are grant-scoped (every inbox has a `primary`), so a
	 * choice made in one inbox must never hide a calendar in another.
	 */
	hiddenCalendarsByAccount: Record<string, string[]>
}

function browserTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
	} catch {
		return 'UTC'
	}
}

export function isSupportedTimezone(value: string): boolean {
	if (!value || value.length > 100) return false
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
		return true
	} catch {
		return false
	}
}

export function availableTimezones(): string[] {
	const supported = Intl.supportedValuesOf?.('timeZone')
	const zones = supported?.length ? supported : ['UTC', browserTimezone()]
	return [...new Set(['UTC', browserTimezone(), ...zones])].sort()
}

export function defaultUserPreferences(): UserPreferences {
	return {
		displayName: '',
		autoSaveContacts: true,
		emailDarkMode: true,
		emailLayoutMode: 'readable',
		emailColorMode: 'automatic',
		remoteImagePolicy: 'ask',
		primaryTimezone: browserTimezone(),
		secondaryTimezone: '',
		hiddenCalendarsByAccount: {},
	}
}

/** Normalized preference key for a mailbox; `undefined` when the email is unusable. */
export function hiddenCalendarAccountKey(email: string): string | undefined {
	const key = email.trim().toLowerCase()
	return key.length > 0 && key.length <= MAX_ACCOUNT_KEY_LENGTH && key.includes('@') && !/[\r\n]/.test(key)
		? key
		: undefined
}

function normalizeHiddenCalendarIds(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const ids = value.filter(
		(id): id is string =>
			typeof id === 'string' && id.length > 0 && id.length <= MAX_CALENDAR_ID_LENGTH && !/[\r\n]/.test(id),
	)
	// Keep the most recent choices when the stored list exceeds the cap.
	return [...new Set(ids)].slice(-MAX_HIDDEN_CALENDAR_IDS)
}

function normalizeHiddenCalendarsByAccount(value: unknown): Record<string, string[]> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	const entries: Array<[string, string[]]> = []
	for (const [rawKey, rawIds] of Object.entries(value)) {
		const key = hiddenCalendarAccountKey(rawKey)
		const ids = normalizeHiddenCalendarIds(rawIds)
		if (key && ids.length > 0) entries.push([key, ids])
	}
	// Keep the most recently written accounts when the stored map exceeds the cap.
	return Object.fromEntries(entries.slice(-MAX_HIDDEN_CALENDAR_ACCOUNTS))
}

/** Hidden calendar ids for one mailbox. */
export function hiddenCalendarIdsFor(preferences: UserPreferences, email: string): string[] {
	const key = hiddenCalendarAccountKey(email)
	return key ? (preferences.hiddenCalendarsByAccount[key] ?? []) : []
}

/** Replaces one mailbox's hidden calendars, leaving other mailboxes untouched. */
export function withHiddenCalendarIds(
	preferences: UserPreferences,
	email: string,
	ids: readonly string[],
): UserPreferences {
	const key = hiddenCalendarAccountKey(email)
	if (!key) return preferences
	const { [key]: _previous, ...others } = preferences.hiddenCalendarsByAccount
	// Re-inserting last marks this account as most recent for the account cap.
	return { ...preferences, hiddenCalendarsByAccount: { ...others, [key]: [...ids] } }
}

function normalizePreferences(value: unknown): UserPreferences {
	const defaults = defaultUserPreferences()
	if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
	const input = value as Partial<UserPreferences>
	const displayName =
		typeof input.displayName === 'string' ? input.displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) : ''
	const primaryTimezone =
		typeof input.primaryTimezone === 'string' && isSupportedTimezone(input.primaryTimezone)
			? input.primaryTimezone
			: defaults.primaryTimezone
	const secondaryTimezone =
		typeof input.secondaryTimezone === 'string' &&
		isSupportedTimezone(input.secondaryTimezone) &&
		input.secondaryTimezone !== primaryTimezone
			? input.secondaryTimezone
			: ''
	return {
		displayName,
		autoSaveContacts: input.autoSaveContacts !== false,
		emailDarkMode: input.emailDarkMode !== false,
		emailLayoutMode: input.emailLayoutMode === 'original' ? 'original' : 'readable',
		emailColorMode: input.emailColorMode === 'original' ? 'original' : 'automatic',
		remoteImagePolicy: input.remoteImagePolicy === 'always' ? 'always' : 'ask',
		primaryTimezone,
		secondaryTimezone,
		// A flat `hiddenCalendarIds` list from before per-account storage cannot be
		// attributed to an inbox, so it is deliberately dropped rather than applied
		// to whichever inbox happens to be active.
		hiddenCalendarsByAccount: normalizeHiddenCalendarsByAccount(input.hiddenCalendarsByAccount),
	}
}

export function readUserPreferences(): UserPreferences {
	/* v8 ignore next -- exercised during server rendering, outside jsdom's browser environment. -- @preserve */
	if (typeof window === 'undefined') return defaultUserPreferences()
	try {
		return normalizePreferences(
			JSON.parse(window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? 'null'),
		)
	} catch {
		return defaultUserPreferences()
	}
}

export function writeUserPreferences(value: UserPreferences): UserPreferences {
	const normalized = normalizePreferences(value)
	/* v8 ignore else -- @preserve writes only run from browser interactions; server rendering never persists preferences */
	if (typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
			window.dispatchEvent(new Event('ownmail:user-preferences'))
		} catch {
			// Preferences are an enhancement; private browsing/storage policies must not break mail.
		}
	}
	return normalized
}

/**
 * A `storage` event fires for every key written by another tab in this origin, so an unrelated write
 * (the `theme` key, say) must not be mistaken for a preferences edit.
 *
 * A null `key` is deliberately treated as a preferences change: browsers emit it for
 * `localStorage.clear()`, which wipes the preferences entry too, so the in-memory copy really is stale.
 * Non-storage events (our own `ownmail:user-preferences` signal) always pass.
 */
export function affectsUserPreferences(event: Event): boolean {
	if (!(event instanceof StorageEvent)) return true
	return event.key === null || event.key === USER_PREFERENCES_STORAGE_KEY
}

export function useUserPreferences(): [UserPreferences, (next: UserPreferences) => void] {
	const [preferences, setPreferences] = useState(defaultUserPreferences)

	useEffect(() => {
		const update = (event?: Event) => {
			if (event && !affectsUserPreferences(event)) return
			setPreferences(readUserPreferences())
		}
		update()
		window.addEventListener('storage', update)
		window.addEventListener('ownmail:user-preferences', update)
		return () => {
			window.removeEventListener('storage', update)
			window.removeEventListener('ownmail:user-preferences', update)
		}
	}, [])

	const save = useCallback((next: UserPreferences) => setPreferences(writeUserPreferences(next)), [])
	return [preferences, save]
}
