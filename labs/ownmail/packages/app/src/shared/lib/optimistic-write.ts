import type { QueryClient, QueryKey } from '@tanstack/react-query'

/** What one optimistic write changed: each entry's value before and after it. */
export type OptimisticWrite = Array<{ queryKey: QueryKey; before: unknown; after: unknown }>

/** Runs an optimistic cache write under `root` and records only the entries it
 * changed, so a rollback has nothing to say about the rest of the cache. */
export function recordOptimisticWrite(
	queryClient: QueryClient,
	root: QueryKey,
	write: () => void,
): OptimisticWrite {
	const before = queryClient.getQueriesData({ queryKey: root })
	write()
	return before.flatMap(([queryKey, data]) => {
		const after = queryClient.getQueryData(queryKey)
		return after === data ? [] : [{ queryKey, before: data, after }]
	})
}

/**
 * Undoes an optimistic write after its request failed.
 *
 * An entry that no longer holds the optimistic value has been replaced since,
 * by a refetch that landed mid-mutation or by a later write. That newer data is
 * left alone: restoring the older snapshot over it would regress the screen.
 * Callers follow this with a refetch of the active queries.
 */
export function undoOptimisticWrite(queryClient: QueryClient, written: OptimisticWrite | undefined): void {
	for (const { queryKey, before, after } of written ?? []) {
		if (queryClient.getQueryData(queryKey) === after) queryClient.setQueryData(queryKey, before)
	}
}
