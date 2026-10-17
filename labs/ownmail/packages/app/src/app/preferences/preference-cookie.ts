import { normalizePreferences, type UserPreferences } from './preference-values.js'

export const USER_PREFERENCES_COOKIE = 'ownmail-ui-v1'
export const MAX_PREFERENCE_COOKIE_LENGTH = 1024

// Versioned tuple: only bounded device preferences. Mailbox names, addresses,
// calendar IDs, message data and credentials must never enter this cookie.
const COOKIE_FIELDS = [
	'readingPane',
	'listDensity',
	'threadView',
	'emailLayoutMode',
	'emailColorMode',
	'emailDarkMode',
	'calendarHourHeight',
	'calendarSidebarCollapsed',
	'calendarDetailPaneOpen',
	'primaryTimezone',
	'secondaryTimezone',
	'autoSaveContacts',
	'remoteImagePolicy',
	'readingPaneListWidth',
	'readingPaneListHeight',
] as const satisfies readonly (keyof UserPreferences)[]

// The pane sizes joined the tuple later: a cookie written before them still
// reads, with default sizes, so the upgrade renders without a layout flip.
const LEGACY_FIELD_COUNT = COOKIE_FIELDS.length - 2

export function encodePreferenceCookie(preferences: UserPreferences): string {
	const normalized = normalizePreferences(preferences)
	return encodeURIComponent(JSON.stringify([1, ...COOKIE_FIELDS.map((key) => normalized[key])]))
}

/** Untrusted presentation data, never an authentication or authorization source. */
export function readPreferenceCookie(header: string): UserPreferences | null {
	const prefix = `${USER_PREFERENCES_COOKIE}=`
	const entries = header
		.split(';')
		.map((entry) => entry.trim())
		.filter((entry) => entry.startsWith(prefix))
	// Reject ambiguous path/domain duplicates rather than disagree with the browser.
	const [entry] = entries
	if (entries.length !== 1 || !entry) return null
	const encoded = entry.slice(prefix.length)
	if (encoded.length > MAX_PREFERENCE_COOKIE_LENGTH) return null
	try {
		const tuple: unknown = JSON.parse(decodeURIComponent(encoded))
		if (!Array.isArray(tuple) || tuple[0] !== 1) return null
		if (tuple.length !== COOKIE_FIELDS.length + 1 && tuple.length !== LEGACY_FIELD_COUNT + 1) return null
		const fields = COOKIE_FIELDS.slice(0, tuple.length - 1)
		const input = Object.fromEntries(fields.map((key, index) => [key, tuple[index + 1]]))
		const normalized = normalizePreferences(input)
		// Exact round-trip validates types, enum allow-lists, timezone names/lengths,
		// booleans, zoom ranges and pane sizes without coercing attacker-controlled values.
		if (fields.some((key) => normalized[key] !== input[key])) return null
		return normalized
	} catch {
		return null
	}
}

export function browserPreferenceCookie(): string {
	try {
		return document.cookie
			.split(';')
			.map((entry) => entry.trim())
			.filter((entry) => entry.startsWith(`${USER_PREFERENCES_COOKIE}=`))
			.join('; ')
	} catch {
		return ''
	}
}

export function writePreferenceCookie(preferences: UserPreferences): void {
	try {
		const secure = window.location.protocol === 'https:' ? '; Secure' : ''
		// biome-ignore lint/suspicious/noDocumentCookie: synchronous persistence must finish before an immediate navigation; Cookie Store is asynchronous and not universal.
		document.cookie = `${USER_PREFERENCES_COOKIE}=${encodePreferenceCookie(preferences)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
	} catch {
		// Blocked cookies do not prevent in-memory preferences or localStorage fallback.
	}
}
