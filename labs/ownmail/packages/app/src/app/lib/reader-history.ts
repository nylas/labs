import type { AnyRouter, ParsedLocation } from '@tanstack/react-router'

// Scoped to the router: a direct reader load has no known list behind it.
const origins = new WeakMap<AnyRouter, ParsedLocation | undefined>()

export function rememberReaderHistory(router: AnyRouter) {
	router.subscribe('onBeforeNavigate', ({ fromLocation }) => origins.set(router, fromLocation))
}

export function returnToPreviousFolder(router: AnyRouter, folderId: string): boolean {
	const origin = origins.get(router)
	if (
		!origin ||
		origin.pathname !== `/mail/f/${encodeURIComponent(folderId)}` ||
		origin.state.__TSR_index !== router.state.location.state.__TSR_index - 1
	)
		return false
	router.history.back()
	return true
}
