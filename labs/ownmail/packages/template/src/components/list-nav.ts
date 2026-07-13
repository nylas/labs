/**
 * Keyboard-navigation helpers for vertical lists (the mail thread list today).
 * Kept as pure functions so the wiring stays a thin React shell and the cursor
 * logic can be unit-tested directly.
 */

/** What a key press asks a list to do, or null when the key isn't a nav key. */
export type ListNavAction = 'down' | 'up' | 'first' | 'last' | 'open'

/**
 * Map a raw keyboard key to a list-navigation action. Vim-style `j`/`k` and the
 * arrow keys move the cursor; `Enter` and `o` open the cursored row. Any other
 * key returns null so the caller leaves the event alone.
 */
export function listNavAction(key: string): ListNavAction | null {
	if (key === 'j' || key === 'ArrowDown') return 'down'
	if (key === 'k' || key === 'ArrowUp') return 'up'
	if (key === 'Home') return 'first'
	if (key === 'End') return 'last'
	if (key === 'Enter' || key === 'o') return 'open'
	return null
}

/**
 * Compute the next cursor index for a list of `length` items.
 *
 * - An empty list has no cursor (-1).
 * - From the unselected state (-1), moving down lands on the first row and
 *   moving up lands on the last row, so a single key press always selects
 *   something sensible.
 * - Otherwise the cursor steps by `delta` and clamps at both ends (no wrap),
 *   which keeps `j`/`k` from surprising the user by jumping across the list.
 */
export function moveCursor(current: number, delta: number, length: number): number {
	if (length <= 0) return -1
	const last = length - 1
	if (current < 0) return delta > 0 ? 0 : last
	const next = current + delta
	if (next < 0) return 0
	if (next > last) return last
	return next
}

/** Return the first or last usable row in a list, or -1 when it is empty. */
export function edgeCursor(edge: 'first' | 'last', length: number): number {
	if (length <= 0) return -1
	return edge === 'first' ? 0 : length - 1
}
