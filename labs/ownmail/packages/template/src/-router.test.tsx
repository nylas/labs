import { describe, expect, it } from 'vitest'
import { getRouter } from './router.js'

describe('getRouter', () => {
	it('builds a router wired to the generated route tree with intent preloading', () => {
		const router = getRouter()

		// The app relies on these defaults: intent-based preloading for snappy nav and
		// scroll restoration across route changes. A regression here degrades UX silently.
		expect(router.options.defaultPreload).toBe('intent')
		expect(router.options.scrollRestoration).toBe(true)
		// The route tree must be attached or every route 404s.
		expect(router.routeTree).toBeDefined()
	})
})
