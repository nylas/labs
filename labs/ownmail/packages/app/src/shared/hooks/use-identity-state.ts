import { useCallback, useRef, useState } from 'react'

type Stored<T> = { identity: readonly unknown[]; value: T }

function sameIdentity(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((part, index) => Object.is(part, right[index]))
}

/**
 * State that belongs to an identity (design.md, "Content-ready transitions",
 * clause 6). The value is stored together with the identity it was set for and
 * read back only while that identity still matches; for any other identity the
 * state is `initial()` on that very render.
 *
 * This replaces "reset it in an effect when a prop changes", which paints one
 * frame with the previous identity's state. A setter created for an earlier
 * identity writes under that identity, so a late update can never land in the
 * state of what is on screen now.
 */
export function useIdentityState<T>(
	identity: readonly unknown[],
	initial: () => T,
): [T, (next: T | ((current: T) => T)) => void] {
	// One array per identity, so the setter below is stable while it lasts.
	const keyRef = useRef(identity)
	if (!sameIdentity(keyRef.current, identity)) keyRef.current = identity
	const key = keyRef.current
	const initialRef = useRef(initial)
	initialRef.current = initial
	const [stored, setStored] = useState<Stored<T>>(() => ({ identity: key, value: initial() }))
	const value = sameIdentity(stored.identity, key) ? stored.value : initial()
	const setValue = useCallback(
		(next: T | ((current: T) => T)) => {
			setStored((previous) => {
				const current = sameIdentity(previous.identity, key) ? previous.value : initialRef.current()
				return {
					identity: key,
					value: typeof next === 'function' ? (next as (current: T) => T)(current) : next,
				}
			})
		},
		[key],
	)
	return [value, setValue]
}
