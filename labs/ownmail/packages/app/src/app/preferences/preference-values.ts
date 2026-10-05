import { accountKey } from '#shared/lib/account-key'

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

/** Pixel height of one hour in the calendar day and week grid: the grid's zoom steps. */
export const CALENDAR_HOUR_HEIGHTS = [40, 52, 64, 80] as const

export type CalendarHourHeight = (typeof CALENDAR_HOUR_HEIGHTS)[number]

export const DEFAULT_CALENDAR_HOUR_HEIGHT: CalendarHourHeight = 52

/**
 * How designed mail is laid out. `clean` is the Conversation view's article
 * rendering; the standard reader, and any older build, reads it as `readable`.
 */
export type EmailLayoutPreference = 'readable' | 'original' | 'clean'

export const EMAIL_LAYOUT_PREFERENCES: readonly EmailLayoutPreference[] = ['readable', 'original', 'clean']

/** How a thread is read: the standard message list, or the optional chat-style
 * Conversation view. Unknown stored values fall back to the standard reader. */
export type ThreadView = 'messages' | 'conversation'

export const THREAD_VIEWS: readonly ThreadView[] = ['messages', 'conversation']

export type UserPreferences = {
	/**
	 * The name each mailbox signs with, keyed by mailbox email. A name saved in
	 * one inbox must never label another, so it is stored per account in the
	 * same way as hidden calendars.
	 */
	displayNameByAccount: Record<string, string>
	autoSaveContacts: boolean
	emailDarkMode: boolean
	emailLayoutMode: EmailLayoutPreference
	emailColorMode: 'automatic' | 'original'
	remoteImagePolicy: RemoteImagePolicy
	readingPane: ReadingPane
	listDensity: ListDensity
	threadView: ThreadView
	primaryTimezone: string
	secondaryTimezone: string
	calendarHourHeight: CalendarHourHeight
	/** Whether the desktop calendar sidebar is hidden on this device. */
	calendarSidebarCollapsed: boolean
	/** Whether the desktop event details pane is shown beside the calendar grid on this device. */
	calendarDetailPaneOpen: boolean
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
		threadView: 'messages',
		primaryTimezone: browserTimezone(),
		secondaryTimezone: '',
		calendarHourHeight: DEFAULT_CALENDAR_HOUR_HEIGHT,
		calendarSidebarCollapsed: false,
		calendarDetailPaneOpen: false,
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

export function normalizePreferences(value: unknown): UserPreferences {
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
		emailLayoutMode: EMAIL_LAYOUT_PREFERENCES.includes(input.emailLayoutMode as EmailLayoutPreference)
			? (input.emailLayoutMode as EmailLayoutPreference)
			: 'readable',
		emailColorMode: input.emailColorMode === 'original' ? 'original' : 'automatic',
		remoteImagePolicy: input.remoteImagePolicy === 'always' ? 'always' : 'ask',
		readingPane: READING_PANES.includes(input.readingPane as ReadingPane)
			? (input.readingPane as ReadingPane)
			: 'vertical',
		listDensity: LIST_DENSITIES.includes(input.listDensity as ListDensity)
			? (input.listDensity as ListDensity)
			: 'default',
		threadView: THREAD_VIEWS.includes(input.threadView as ThreadView)
			? (input.threadView as ThreadView)
			: 'messages',
		primaryTimezone,
		secondaryTimezone,
		calendarHourHeight: CALENDAR_HOUR_HEIGHTS.includes(input.calendarHourHeight as CalendarHourHeight)
			? (input.calendarHourHeight as CalendarHourHeight)
			: DEFAULT_CALENDAR_HOUR_HEIGHT,
		calendarSidebarCollapsed: input.calendarSidebarCollapsed === true,
		calendarDetailPaneOpen: input.calendarDetailPaneOpen === true,
		// A flat `hiddenCalendarIds` list from before per-account storage cannot be
		// attributed to an inbox, so it is deliberately dropped rather than applied
		// to whichever inbox happens to be active.
		hiddenCalendarsByAccount: normalizeHiddenCalendarsByAccount(input.hiddenCalendarsByAccount),
	}
}
