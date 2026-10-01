import { Outlet, useRouterState } from '@tanstack/react-router'

/**
 * The outlet for a route whose child declares a `pendingComponent`.
 *
 * React keeps the children of a boundary that suspends again in the DOM,
 * hidden, until the replacement is ready. Keying the outlet by the pending
 * child match removes the previous identity's content instead, so only the
 * pending view exists while the destination loads. Navigations that resolve
 * without a pending view keep the same key and the same mounted child.
 */
export function ContentReadyOutlet({ parentRouteId }: { parentRouteId: string }) {
	const key = useRouterState({
		select: (state) => {
			const index = state.matches.findIndex((match) => match.routeId === parentRouteId)
			const child = index < 0 ? undefined : state.matches[index + 1]
			return child?.status === 'pending' ? child.id : 'ready'
		},
	})
	return <Outlet key={key} />
}
