// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	Outlet: () => null,
}))

import { Outlet } from '@tanstack/react-router'
import { Route } from './calendar.js'

describe('/calendar layout route', () => {
	it('renders only an Outlet so nested calendar views own their own chrome', () => {
		expect(Route.options.component).toBe(Outlet)
	})
})
