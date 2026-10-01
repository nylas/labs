import { useSyncExternalStore } from 'react'
import { accountKey } from '#shared/lib/account-key'

export const USER_PREFERENCES_STORAGE_KEY = 'ownmail:user-preferences:v1'
const MAX_DISPLAY_NAME_LENGTH = 120
const MAX_HIDDEN_CALENDAR_IDS = 200
const MAX_CALENDAR_ID_LENGTH = 1000
const MAX_HIDDEN_CALENDAR_ACCOUNTS = 20
const MAX_DISPLAY_NAME_ACCOUNTS = 20

export type RemoteImagePolicy = 'ask' | 'always'

/** How a conversation opens beside the mail list on wide screens. Narrow
 * screens always replace the list with the conversation. */
export type ReadingPane = 'none' | 'vertical' | 'horizontal'

export const READING_PANES: readonly ReadingPane[] = ['none', 'vertical', 'horizontal']

/** How much of each conversation a mail-list row shows. Compact and Condensed
 * apply only with a mouse or trackpad on desktop layouts; touch and mobile
 * layouts always keep the Default row. */
export type ListDensity = 'default' | 'compact' | 'condensed'

export const LIST_DENSITIES: readonly ListDensity[] = ['default', 'compact', 'condensed']

export type UserPreferences = {
	/**
	 * The name each mailbox signs with, keyed by mailbox email. A name saved in
	 * one inbox must never label another, so it is stored per account in the
	 * same way as hidden calendars.
	 */
	displayNameByAccount: Record<string, string>
	autoSaveContacts: boolean
	emailDarkMode: boolean
	emailLayoutMode: 'readable' | 'original'
	emailColorMode: 'automatic' | 'original'
	remoteImagePolicy: RemoteImagePolicy
	readingPane: ReadingPane
	listDensity: ListDensity
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
		displayNameByAccount: {},
		autoSaveContacts: true,
		emailDarkMode: true,
		emailLayoutMode: 'readable',
		emailColorMode: 'automatic',
		remoteImagePolicy: 'ask',
		readingPane: 'vertical',
		listDensity: 'default',
		primaryTimezone: browserTimezone(),
		secondaryTimezone: '',
		hiddenCalendarsByAccount: {},
	}
}

/** Normalized preference key for a mailbox; `undefined` when the email is unusable. */
export function hiddenCalendarAccountKey(email: string): string | undefined {
	return accountKey(email)
}

function normalizeDisplayName(value: unknown): string {
	return typeof value === 'string' ? value.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) : ''
}

function normalizeDisplayNameByAccount(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	const entries: Array<[string, string]> = []
	for (const [rawKey, rawName] of Object.entries(value)) {
		const key = accountKey(rawKey)
		const name = normalizeDisplayName(rawName)
		if (key && name) entries.push([key, name])
	}
	// Keep the most recently written accounts when the stored map exceeds the cap.
	return Object.fromEntries(entries.slice(-MAX_DISPLAY_NAME_ACCOUNTS))
}

/** The display name saved for one mailbox; empty when none was saved for it. */
export function displayNameFor(preferences: UserPreferences, email: string): string {
	const key = accountKey(email)
	return key ? (preferences.displayNameByAccount[key] ?? '') : ''
}

/** Replaces one mailbox's display name, leaving other mailboxes untouched. */
export function withDisplayName(preferences: UserPreferences, email: string, name: string): UserPreferences {
	const key = accountKey(email)
	if (!key) return preferences
	const { [key]: _previous, ...others } = preferences.displayNameByAccount
	const displayName = normalizeDisplayName(name)
	// Re-inserting last marks this account as most recent for the account cap.
	return {
		...preferences,
		displayNameByAccount: displayName ? { ...others, [key]: displayName } : others,
	}
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
		// A single `displayName` from before per-account storage cannot be
		// attributed to an inbox, so it is deliberately dropped rather than applied
		// to whichever inbox happens to be active. The server-held name still
		// labels the inbox; only this device's fallback copy is lost.
		displayNameByAccount: normalizeDisplayNameByAccount(input.displayNameByAccount),
		autoSaveContacts: input.autoSaveContacts !== false,
		emailDarkMode: input.emailDarkMode !== false,
		emailLayoutMode: input.emailLayoutMode === 'original' ? 'original' : 'readable',
		emailColorMode: input.emailColorMode === 'original' ? 'original' : 'automatic',
		remoteImagePolicy: input.remoteImagePolicy === 'always' ? 'always' : 'ask',
		readingPane: READING_PANES.includes(input.readingPane as ReadingPane)
			? (input.readingPane as ReadingPane)
			: 'vertical',
		listDensity: LIST_DENSITIES.includes(input.listDensity as ListDensity)
			? (input.listDensity as ListDensity)
			: 'default',
		primaryTimezone,
		secondaryTimezone,
		// A flat `hiddenCalendarIds` list from before per-account storage cannot be
		// attributed to an inbox, so it is deliberately dropped rather than applied
		// to whichever inbox happens to be active.
		hiddenCalendarsByAccount: normalizeHiddenCalendarsByAccount(input.hiddenCalendarsByAccount),
	}
}

/* One shared store: every component reads the same snapshot, synchronously, on
 * its first client render. The parsed value is cached against the stored text
 * so the snapshot keeps its identity until the stored text changes. */
let snapshot: { stored: string | null; preferences: UserPreferences } | undefined

function storedPreferences(): string | null {
	try {
		return window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)
	} catch {
		return null
	}
}

function parsePreferences(stored: string | null): UserPreferences {
	try {
		return normalizePreferences(JSON.parse(stored ?? 'null'))
	} catch {
		return defaultUserPreferences()
	}
}

export function readUserPreferences(): UserPreferences {
	/* v8 ignore next -- exercised during server rendering, outside jsdom's browser environment. -- @preserve */
	if (typeof window === 'undefined') return serverPreferences()
	const stored = storedPreferences()
	if (snapshot?.stored !== stored) snapshot = { stored, preferences: parsePreferences(stored) }
	return snapshot.preferences
}

export function writeUserPreferences(value: UserPreferences): UserPreferences {
	const normalized = normalizePreferences(value)
	/* v8 ignore else -- @preserve writes only run from browser interactions; server rendering never persists preferences */
	if (typeof window !== 'undefined') {
		try {
			window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
		} catch {
			// Preferences are an enhancement; private browsing/storage policies must not break mail.
			// The choice still applies for this visit: it is held against whatever is stored.
			snapshot = { stored: storedPreferences(), preferences: normalized }
		}
		window.dispatchEvent(new Event('ownmail:user-preferences'))
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

let serverSnapshot: UserPreferences | undefined

/** The server cannot read this device's preferences. Its snapshot is the
 * defaults, kept as one object so hydration sees a stable value; regions that
 * would look different with the real values check `useUserPreferencesReady`
 * and render a neutral placeholder instead of these. */
function serverPreferences(): UserPreferences {
	serverSnapshot ??= defaultUserPreferences()
	return serverSnapshot
}

function subscribeToPreferences(onChange: () => void): () => void {
	const update = (event: Event) => {
		if (affectsUserPreferences(event)) onChange()
	}
	window.addEventListener('storage', update)
	window.addEventListener('ownmail:user-preferences', update)
	return () => {
		window.removeEventListener('storage', update)
		window.removeEventListener('ownmail:user-preferences', update)
	}
}

function savePreferences(next: UserPreferences): void {
	writeUserPreferences(next)
}

/**
 * This device's preferences, read synchronously: the first client render
 * already has the saved values, so nothing paints with a default and then
 * flips. While rendering on the server and hydrating, the value is the
 * defaults and `useUserPreferencesReady` is false.
 */
export function useUserPreferences(): [UserPreferences, (next: UserPreferences) => void] {
	const preferences = useSyncExternalStore(subscribeToPreferences, readUserPreferences, serverPreferences)
	return [preferences, savePreferences]
}

const subscribeToNothing = () => () => {}
const readyOnClient = () => true
const notReadyOnServer = () => false

/** False while rendering on the server and hydrating, when the preferences are
 * not known yet. A region whose first paint depends on them renders a neutral
 * placeholder until this is true. */
export function useUserPreferencesReady(): boolean {
	return useSyncExternalStore(subscribeToNothing, readyOnClient, notReadyOnServer)
}

export const userPreferencesTestApi = {
	/** Drops the cached snapshot, as a fresh page load would. */
	reset() {
		snapshot = undefined
	},
}
