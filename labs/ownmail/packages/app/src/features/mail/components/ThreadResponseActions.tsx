import { MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID } from '#app/components/MobileTabBar'
import { useMounted } from '#shared/components/ClientTime'

/**
 * The thread slot of the mobile tab bar (design.md "Mobile surface rules": one
 * bottom surface at a time), or null until mounted on the client or when the
 * bar is not showing thread actions.
 */
export function useMobileThreadActionsTarget(): HTMLElement | null {
	const mounted = useMounted()
	return mounted ? document.getElementById(MOBILE_BOTTOM_BAR_THREAD_ACTIONS_ID) : null
}
