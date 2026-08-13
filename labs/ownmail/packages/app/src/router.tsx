import { createRouter } from '@tanstack/react-router'
import { createOwnmailQueryClient, OwnmailQueryProvider } from '#app/query/query-provider'
import { routeTree } from './routeTree.gen'

export function getRouter() {
	const queryClient = createOwnmailQueryClient()
	return createRouter({
		routeTree,
		context: { queryClient },
		/* v8 ignore next -- the wrapper executes only inside TanStack Start's router runtime -- @preserve */
		Wrap: ({ children }) => <OwnmailQueryProvider client={queryClient}>{children}</OwnmailQueryProvider>,
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
