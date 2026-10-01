// @vitest-environment jsdom
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { accountScope, resetAccountScope, UNKNOWN_ACCOUNT_SCOPE } from '#app/lib/account-scope'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { getRouter } from './router.js'

afterEach(() => resetAccountScope())

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

	it('tells the browser which mailbox the server rendered, so hydration builds account-partitioned keys', () => {
		const router = getRouter()
		const { dehydrate, hydrate } = router.options
		if (!dehydrate || !hydrate) throw new Error('Expected the router to carry the account across hydration')

		// Nothing is known before a mailbox loader has run.
		expect(dehydrate()).toEqual({ accountEmail: undefined })

		router.options.context.queryClient.setQueryData(mailboxInfoQueryOptions().queryKey, {
			email: 'Ada@OwnMail.com',
			appName: 'OwnMail',
			accounts: [],
		})
		const dehydrated = dehydrate()
		expect(dehydrated).toEqual({ accountEmail: 'Ada@OwnMail.com' })

		// The value crosses the wire, so the browser validates it like any other input.
		hydrate({ accountEmail: 'not-a-mailbox' })
		expect(accountScope()).toBe(UNKNOWN_ACCOUNT_SCOPE)
		hydrate(dehydrated)
		expect(accountScope()).toBe('ada@ownmail.com')
	})
})
