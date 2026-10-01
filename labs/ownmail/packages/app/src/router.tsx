import { createRouter } from '@tanstack/react-router'
import { observeAccount } from '#app/lib/account-scope'
import { mailboxInfoQueryOptions } from '#app/query/mailbox-info'
import { createOwnmailQueryClient, OwnmailQueryProvider } from '#app/query/query-provider'
import { routeTree } from './routeTree.gen'

export function getRouter() {
	const queryClient = createOwnmailQueryClient()
	return createRouter({
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
		InnerWrap: ({ children }) => <OwnmailQueryProvider client={queryClient}>{children}</OwnmailQueryProvider>,
		defaultPreload: 'intent',
		scrollRestoration: true,
		defaultPendingMinMs: 0,
		defaultPendingMs: 0,
	})
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
