import { accountKey } from '#shared/lib/account-key'

/** Key segment used before the mailbox is known. No account ever adopts it. */
export const UNKNOWN_ACCOUNT_SCOPE = 'unknown'
/** Key segment used while rendering on the server, where every request already
 * owns a private query cache and no identity may be kept in module state. */
export const SERVER_ACCOUNT_SCOPE = 'server'

/* The account whose data this tab is showing. Every query key root, the
 * optimistic journal and the per-account stores read it, so data fetched for
 * one inbox can never be served to another, even if the cache is not cleared.
 *
 * It is browser-only state: one tab shows one inbox. The value is a normalized
 * email address and is never logged. */
let scope: string | undefined
const changeListeners = new Set<(email: string) => void>()

/** The account segment for query keys and per-account storage. */
export function accountScope(): string {
	if (typeof window === 'undefined') return SERVER_ACCOUNT_SCOPE
	return scope ?? UNKNOWN_ACCOUNT_SCOPE
}

/** Forget the account, as part of clearing every trace of the previous inbox. */
export function resetAccountScope(): void {
	scope = undefined
}

/**
 * Records the mailbox a server response belongs to.
 *
 * The first usable email becomes the scope. A later response for a different
 * mailbox means the session changed outside this tab's switcher (another tab,
 * or signing in again): the scope is left alone and the listeners are told, so
 * the app can drop the previous inbox instead of blending the two.
 */
export function observeAccount(email: unknown): void {
	if (typeof window === 'undefined') return
	const key = accountKey(email)
	if (!key || key === scope) return
	if (scope === undefined) {
		scope = key
		return
	}
	for (const listener of changeListeners) listener(email as string)
}

/** States the account outright, once a switch has loaded the next inbox and the
 * mailbox in the cache is known to be the one the session points at. */
export function setAccountScope(email: unknown): void {
	scope = accountKey(email)
}

/** Subscribe to a mailbox change made outside this tab's switcher. */
export function onAccountChanged(listener: (email: string) => void): () => void {
	changeListeners.add(listener)
	return () => {
		changeListeners.delete(listener)
	}
}
