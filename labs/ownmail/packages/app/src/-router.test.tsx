import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
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

	it('renders the query provider inside router context during SSR', () => {
		const router = getRouter()
		router.update({ ...router.options, history: createMemoryHistory({ initialEntries: ['/'] }) })
		const InnerWrap = router.options.InnerWrap

		// OwnmailQueryProvider calls useRouterState. TanStack Router's outer Wrap is
		// above RouterContextProvider, so putting it there crashes SSR while reading
		// router.stores. Keep this provider on the hook-safe side of the boundary.
		expect(router.options.Wrap).toBeUndefined()
		expect(InnerWrap).toBeTypeOf('function')
		expect(() =>
			renderToString(
				<RouterContextProvider router={router}>
					{InnerWrap ? (
						<InnerWrap>
							<div>mailbox</div>
						</InnerWrap>
					) : null}
				</RouterContextProvider>,
			),
		).not.toThrow()
	})
})
