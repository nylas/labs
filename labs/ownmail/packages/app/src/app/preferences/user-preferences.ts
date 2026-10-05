import {
	createContext,
	createElement,
	type ReactNode,
	useContext,
	useEffect,
	useSyncExternalStore,
} from 'react'
import { browserPreferenceCookie, readPreferenceCookie, writePreferenceCookie } from './preference-cookie.js'
import { defaultUserPreferences, normalizePreferences, type UserPreferences } from './preference-values.js'

export * from './preference-values.js'
export const USER_PREFERENCES_STORAGE_KEY = 'ownmail:user-preferences:v1'

/* One shared store: every component reads the same snapshot, synchronously, on
 * its first client render. The parsed value is cached against the stored text
 * so the snapshot keeps its identity until the stored text changes. */
let snapshot: { stored: string | null; cookie: string; preferences: UserPreferences } | undefined

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
	const cookie = browserPreferenceCookie()
	if (snapshot?.stored !== stored || snapshot.cookie !== cookie) {
		const local = parsePreferences(stored)
		const presentation = readPreferenceCookie(cookie) ?? local
		snapshot = {
			stored,
			cookie,
			preferences: {
				...presentation,
				displayNameByAccount: local.displayNameByAccount,
				hiddenCalendarsByAccount: local.hiddenCalendarsByAccount,
			},
		}
	}
	return snapshot.preferences
}

export function writeUserPreferences(value: UserPreferences): UserPreferences {
	const normalized = normalizePreferences(value)
	/* v8 ignore else -- @preserve writes only run from browser interactions; server rendering never persists preferences */
	if (typeof window !== 'undefined') {
		// Write the authoritative cookie before the cross-tab storage notification.
		writePreferenceCookie(normalized)
		try {
			window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
		} catch {
			// Preferences are an enhancement; private browsing/storage policies must not break mail.
			// The choice still applies for this visit: it is held against whatever is stored.
		}
		// Keep this visit responsive even if either persistence mechanism is blocked.
		snapshot = { stored: storedPreferences(), cookie: browserPreferenceCookie(), preferences: normalized }
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

/** Only the neutral fallback is shared. Request preferences live in React context. */
function serverPreferences(): UserPreferences {
	serverSnapshot ??= { ...defaultUserPreferences(), primaryTimezone: 'UTC' }
	return serverSnapshot
}

const PreferencesContext = createContext<UserPreferences | null>(null)

/** The root loader serializes this request's cookie for matching SSR/hydration snapshots. */
export function UserPreferencesProvider({
	initialPreferences,
	children,
}: {
	initialPreferences: UserPreferences | null
	children: ReactNode
}) {
	useEffect(() => {
		if (readPreferenceCookie(browserPreferenceCookie())) return
		// A legacy browser must visit once before the server can know its preferences.
		writePreferenceCookie(readUserPreferences())
		window.dispatchEvent(new Event('ownmail:user-preferences'))
	}, [])
	return createElement(PreferencesContext.Provider, { value: initialPreferences }, children)
}

function subscribeToPreferences(onChange: () => void): () => void {
	const update = (event: Event) => {
		if (affectsUserPreferences(event)) onChange()
	}
	window.addEventListener('storage', update)
	window.addEventListener('ownmail:user-preferences', update)
	window.addEventListener('focus', update)
	return () => {
		window.removeEventListener('storage', update)
		window.removeEventListener('ownmail:user-preferences', update)
		window.removeEventListener('focus', update)
	}
}

function savePreferences(next: UserPreferences): void {
	writeUserPreferences(next)
}

/**
 * This device's preferences, read synchronously: the first client render
 * already has the saved values, so nothing paints with a default and then
 * flips. While rendering on the server and hydrating, the value is the
 * request's cookie snapshot. Without a valid cookie, readiness stays false
 * until the first browser render can migrate the legacy preferences.
 */
export function useUserPreferences(): [UserPreferences, (next: UserPreferences) => void] {
	const initial = useContext(PreferencesContext)
	const preferences = useSyncExternalStore(
		subscribeToPreferences,
		readUserPreferences,
		() => initial ?? serverPreferences(),
	)
	return [preferences, savePreferences]
}

const subscribeToNothing = () => () => {}
const readyOnClient = () => true
const notReadyOnServer = () => false

/** False while rendering on the server and hydrating, when the preferences are
 * not known yet. A region whose first paint depends on them renders a neutral
 * placeholder until this is true. */
export function useUserPreferencesReady(): boolean {
	const initial = useContext(PreferencesContext)
	return useSyncExternalStore(subscribeToNothing, readyOnClient, () => initial !== null)
}

/** Account-owned maps remain local and must not be assumed ready just because layout is known. */
export function useLocalPreferencesReady(): boolean {
	return useSyncExternalStore(subscribeToNothing, readyOnClient, notReadyOnServer)
}

export const userPreferencesTestApi = {
	/** Drops the cached snapshot, as a fresh page load would. */
	reset() {
		snapshot = undefined
	},
}
