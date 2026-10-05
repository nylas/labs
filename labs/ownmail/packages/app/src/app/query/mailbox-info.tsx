import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { observeAccount } from '#app/lib/account-scope'
import { getMailboxInfo } from '#server/fns'

/**
 * The mailbox the session belongs to. This is the one query that is not
 * partitioned by account, because it is how the account is learned: every
 * response is reported to the account scope, which adopts the first mailbox
 * and raises a change when a later response names a different one.
 */
export const mailboxInfoQueryOptions = () =>
	queryOptions({
		queryKey: ['account', 'mailbox-info'] as const,
		queryFn: async () => {
			const info = await getMailboxInfo()
			observeAccount(info.email)
			return info
		},
		staleTime: 30_000,
	})

/** Resolves the mailbox before a loader builds account-partitioned query keys. */
export function ensureMailboxInfo(queryClient: QueryClient, bootstrap = false) {
	// Full-profile consumers must not reuse the abbreviated mail bootstrap result.
	if (!bootstrap) return queryClient.fetchQuery(mailboxInfoQueryOptions())
	return queryClient.ensureQueryData({
		...mailboxInfoQueryOptions(),
		queryKey: ['account', 'mailbox-info-bootstrap'],
		queryFn: async ({ signal }) => {
			const info = await getMailboxInfo({ data: { bootstrap: true } })
			observeAccount(info.email)
			// Seed identity immediately, but keep this abbreviated profile stale.
			if (!signal.aborted && !queryClient.getQueryData(mailboxInfoQueryOptions().queryKey)) {
				queryClient.setQueryData(mailboxInfoQueryOptions().queryKey, info, { updatedAt: 0 })
			}
			return info
		},
	})
}
