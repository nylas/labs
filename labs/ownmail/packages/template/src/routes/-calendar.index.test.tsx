// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	redirect: (opts: any) => ({ __redirect: true, ...opts }),
}))

import { Route } from './calendar.index.js'

afterEach(() => {
	vi.clearAllMocks()
})
beforeEach(() => {
	vi.clearAllMocks()
})

function beforeLoadThrow(search: Record<string, unknown>) {
	try {
		;(Route.options.beforeLoad as (ctx: { search: Record<string, unknown> }) => void)({ search })
	} catch (thrown) {
		return thrown
	}
	throw new Error('beforeLoad did not redirect')
}

describe('/calendar index search validation', () => {
	it('accepts a well-formed ISO date so deep links to a day survive validation', () => {
		expect(Route.options.validateSearch({ date: '2024-01-02' })).toEqual({ date: '2024-01-02' })
	})

	it('drops a malformed date string rather than trusting arbitrary search input', () => {
		expect(Route.options.validateSearch({ date: '01/02/2024' })).toEqual({})
	})

	it('drops a non-string date value', () => {
		expect(Route.options.validateSearch({ date: 20240102 })).toEqual({})
	})
})

describe('/calendar index redirect', () => {
	it('redirects to the default week view, preserving the requested date so the URL is deep-linkable', () => {
		expect(beforeLoadThrow({ date: '2024-01-02' })).toMatchObject({
			__redirect: true,
			to: '/calendar/$view',
			params: { view: 'week' },
			search: { date: '2024-01-02' },
			// Replaces the landing entry so Back doesn't bounce off the redirect.
			replace: true,
		})
	})

	it('redirects with empty search when no date is supplied', () => {
		expect(beforeLoadThrow({})).toMatchObject({
			to: '/calendar/$view',
			params: { view: 'week' },
			search: {},
		})
	})
})
