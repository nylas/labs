import { createRouter } from '@tanstack/react-router'
import { NavigationMotion } from '#app/components/NavigationMotion'
import { observeAccount } from '#app/lib/account-scope'
import { rememberReaderHistory } from '#app/lib/reader-history'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { createOwnmailQueryClient, OwnmailQueryProvider } from '#app/query/query-provider'
import { routeTree } from './routeTree.gen'

export function getRouter() {
	const queryClient = createOwnmailQueryClient()
	const router = createRouter({
		routeTree,
		context: { queryClient },
		// Query keys are partitioned by account. The server tells the browser
		// which mailbox it rendered, so the first client render builds the same
		// keys every later one will.
		dehydrate: () => ({
			accountEmail: queryClient.getQueryData(mailboxInfoQueryOptions().queryKey)?.email,
		}),
		hydrate: (dehydrated: { accountEmail?: unknown }) => observeAccount(dehydrated.accountEmail),
		/* v8 ignore next -- the wrapper executes only inside TanStack Start's router runtime -- @preserve */
		InnerWrap: ({ children }) => (
			<OwnmailQueryProvider client={queryClient}>
				<NavigationMotion />
				{children}
			</OwnmailQueryProvider>
		),
		defaultPreload: 'intent',
		scrollRestoration: true,
		defaultPendingMinMs: 0,
		defaultPendingMs: 0,
	})
	rememberReaderHistory(router)
	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
