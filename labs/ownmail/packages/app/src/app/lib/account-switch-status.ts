import { useSyncExternalStore } from 'react'

/* The switching state outlives the control that started it: the mobile
 * switcher unmounts as its navigation sheet closes, and the root route replaces
 * the whole app with a loader until the next inbox is ready. */
let switchingTo: string | null = null
const listeners = new Set<() => void>()

export function setSwitchingTo(email: string | null) {
	switchingTo = email
	for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export function readSwitchingTo() {
	return switchingTo
}

export class AccountSwitchInProgressError extends Error {
	constructor() {
		super('Switching inboxes')
		this.name = 'AccountSwitchInProgressError'
	}
}

/** Account-scoped writes started while the session cookie rotates could land in
 * either inbox, so every tracked write is rejected until the switch settles. */
export function assertAccountWritable(): void {
	if (switchingTo !== null) throw new AccountSwitchInProgressError()
}

/** The email of the inbox currently being switched to, or null when idle. */
export function useAccountSwitchStatus(): string | null {
	return useSyncExternalStore(subscribe, readSwitchingTo, readSwitchingTo)
}
