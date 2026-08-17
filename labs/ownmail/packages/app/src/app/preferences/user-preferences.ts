import { useCallback, useEffect, useState } from 'react'

export const USER_PREFERENCES_STORAGE_KEY = 'ownmail:user-preferences:v1'
const MAX_DISPLAY_NAME_LENGTH = 120

export type RemoteImagePolicy = 'ask' | 'always'

export type UserPreferences = {
	displayName: string
	autoSaveContacts: boolean
	emailDarkMode: boolean
	remoteImagePolicy: RemoteImagePolicy
	primaryTimezone: string
	secondaryTimezone: string
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
		remoteImagePolicy: 'ask',
		primaryTimezone: browserTimezone(),
		secondaryTimezone: '',
	}
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
		remoteImagePolicy: input.remoteImagePolicy === 'always' ? 'always' : 'ask',
		primaryTimezone,
		secondaryTimezone,
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
