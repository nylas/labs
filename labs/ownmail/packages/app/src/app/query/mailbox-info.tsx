import { queryOptions } from '@tanstack/react-query'
import { getMailboxInfo } from '#server/fns'

export const mailboxInfoQueryOptions = () =>
	queryOptions({
		queryKey: ['account', 'mailbox-info'] as const,
		queryFn: () => getMailboxInfo(),
		staleTime: 30_000,
	})
