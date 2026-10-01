// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Match = { id: string; routeId: string; status: string }

const router = vi.hoisted(() => ({ matches: [] as Match[], mounts: 0 }))

vi.mock('@tanstack/react-router', () => ({
	useRouterState: (options: { select: (state: { matches: Match[] }) => unknown }) =>
		options.select({ matches: router.matches }),
	Outlet: function Outlet() {
		useEffect(() => {
			router.mounts += 1
		}, [])
		return <div data-testid="outlet" />
	},
}))

import { ContentReadyOutlet } from './ContentReadyOutlet.js'

const parent: Match = { id: '/mail', routeId: '/mail', status: 'success' }
const child = (id: string, status: string): Match => ({ id, routeId: '/mail/f/$folderId', status })

afterEach(() => {
	cleanup()
	router.matches = []
	router.mounts = 0
})

describe('ContentReadyOutlet', () => {
	it('keeps the child mounted across navigations that never show a pending view', () => {
		router.matches = [parent, child('/mail/f/inbox', 'success')]
		const { rerender } = render(<ContentReadyOutlet parentRouteId="/mail" />)

		// A cached destination commits as loaded: remounting would only throw
		// away scroll and focus the person still wants.
		router.matches = [parent, child('/mail/f/sent', 'success')]
		rerender(<ContentReadyOutlet parentRouteId="/mail" />)

		expect(router.mounts).toBe(1)
	})

	it('replaces the child while its successor is pending, so React cannot keep the old content hidden in the DOM', () => {
		router.matches = [parent, child('/mail/f/inbox', 'success')]
		const { rerender } = render(<ContentReadyOutlet parentRouteId="/mail" />)

		router.matches = [parent, child('/mail/f/sent', 'pending')]
		rerender(<ContentReadyOutlet parentRouteId="/mail" />)
		expect(router.mounts).toBe(2)

		router.matches = [parent, child('/mail/f/sent', 'success')]
		rerender(<ContentReadyOutlet parentRouteId="/mail" />)
		expect(router.mounts).toBe(3)
	})

	it('renders a plain outlet when its route is not matched or has no child yet', () => {
		const { rerender, getByTestId } = render(<ContentReadyOutlet parentRouteId="/mail" />)
		expect(getByTestId('outlet')).toBeInTheDocument()

		router.matches = [parent]
		rerender(<ContentReadyOutlet parentRouteId="/mail" />)

		expect(router.mounts).toBe(1)
	})
})
