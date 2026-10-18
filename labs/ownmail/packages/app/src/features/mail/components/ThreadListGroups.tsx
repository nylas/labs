import { QueryClientContext } from '@tanstack/react-query'
import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'
import { mutedThreadIdsFor } from '#app/preferences/preference-values'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { ownerFromMailbox, type ThreadListEnv } from '../lib/thread-list-model.js'

/** The list clock moves once a minute: often enough for "Today", rarely enough to leave rows alone. */
export const LIST_CLOCK_MS = 60_000
const MAILBOX_BOOTSTRAP_KEY = ['account', 'mailbox-info-bootstrap'] as const

const NO_MUTED: ReadonlySet<string> = new Set()

function browserZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone
}

const ThreadListContext = createContext<ThreadListEnv | null>(null)

/**
 * Who reads the list, in which zone, at what minute, and what they muted.
 * Rows read it from the list around them; a row outside one (a list that has
 * not adopted it yet) still reads the time and zone, and attributes nothing
 * to "you".
 */
export function useThreadListEnv(): ThreadListEnv {
	return (
		useContext(ThreadListContext) ?? {
			owner: '',
			ownerFirstName: '',
			now: Date.now(),
			tz: browserZone(),
			mutedIds: NO_MUTED,
			grouped: false,
		}
	)
}

/** Gives the rows beneath it the list's environment, from `useThreadListEnvValue`. */
export function ThreadListEnvironment({ value, children }: { value: ThreadListEnv; children: ReactNode }) {
	return <ThreadListContext.Provider value={value}>{children}</ThreadListContext.Provider>
}

/** The attribute the list renders its clock into, so hydration starts from the server's minute. */
export const LIST_CLOCK_ATTRIBUTE = 'data-list-clock'

/**
 * The clock the list was rendered with: the server's, read back from the page
 * while hydrating, so day groups and bundles agree with the server's HTML.
 * Elsewhere (and on the server) it is now.
 */
function renderedClock(): number {
	if (typeof document === 'undefined') return Date.now()
	const stamp = Number(
		document.querySelector(`[${LIST_CLOCK_ATTRIBUTE}]`)?.getAttribute(LIST_CLOCK_ATTRIBUTE),
	)
	return Number.isFinite(stamp) && stamp > 0 ? stamp : Date.now()
}

/**
 * The list's environment; its identity changes only when the minute, zone,
 * owner or mutes do. `grouped` is false for a list without day-group headings
 * (search results), whose rows then carry their own day.
 */
export function useThreadListEnvValue({ grouped = true }: { grouped?: boolean } = {}): ThreadListEnv {
	const [preferences] = useUserPreferences()
	const queryClient = useContext(QueryClientContext)
	const info =
		queryClient?.getQueryData<{ email?: string; displayName?: string }>(mailboxInfoQueryOptions().queryKey) ??
		queryClient?.getQueryData<{ email?: string; displayName?: string }>(MAILBOX_BOOTSTRAP_KEY)
	const { owner, ownerFirstName } = ownerFromMailbox(info)
	const [now, setNow] = useState(renderedClock)
	useEffect(() => {
		// Hydrated on the server's minute; the reader's own clock takes over at once.
		setNow(Date.now())
		const timer = window.setInterval(() => setNow(Date.now()), LIST_CLOCK_MS)
		return () => window.clearInterval(timer)
	}, [])
	const tz = preferences.primaryTimezone
	// The preferences snapshot keeps its identity until the stored text changes.
	// Mutes belong to the signed-in mailbox. Keyed by their text, the set is
	// rebuilt only when that mailbox's mutes change.
	const mutedKey = mutedThreadIdsFor(preferences, owner).join('\n')
	const mutedIds = useMemo(() => new Set(mutedKey ? mutedKey.split('\n') : []), [mutedKey])
	return useMemo(
		() => ({ owner, ownerFirstName, now, tz, mutedIds, grouped }),
		[owner, ownerFirstName, now, tz, mutedIds, grouped],
	)
}

/** A day group's heading: "Today", "Yesterday", "This week", then month names. */
export function ThreadListGroupHeading({ label }: { label: string }) {
	return <h2 className="thread-list-group text-xs font-semibold text-muted-foreground">{label}</h2>
}

/**
 * True once the element has scrolled into view, and from then on. Rows use it
 * to load what they show lazily. Where the browser cannot tell (no
 * IntersectionObserver), nothing is loaded.
 */
export function useSeen(ref: RefObject<Element | null>, enabled = true): boolean {
	const [seen, setSeen] = useState(false)
	useEffect(() => {
		const element = ref.current
		if (!enabled || seen || !element || typeof IntersectionObserver === 'undefined') return
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setSeen(true)
				observer.disconnect()
			}
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [enabled, ref, seen])
	return seen
}
