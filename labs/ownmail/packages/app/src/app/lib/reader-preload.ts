import type { AnyRouter } from '@tanstack/react-router'

/** The thread reader's route, whose code a folder fetches ahead of the first open. */
const READER_ROUTE_ID = '/mail/f/$folderId/t/$threadId'

/**
 * Fetches the reader's code (the conversation and its error card) while a
 * folder is on screen, so a thread opened after the connection drops still
 * shows what is saved on this device, or says it cannot load with Try again,
 * instead of a page that never arrives. Best effort: a failure here is the
 * same as not preloading.
 */
export function preloadReaderCode(router: AnyRouter): void {
	const route = router.routesById[READER_ROUTE_ID]
	if (!route) return
	void Promise.all([router.loadRouteChunk(route), router.loadRouteChunk(route, 'errorComponent')]).catch(
		() => {},
	)
}
