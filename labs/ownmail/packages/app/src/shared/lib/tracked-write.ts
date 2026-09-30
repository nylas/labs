import { MutationObserver, type QueryClient } from '@tanstack/react-query'

/** Runs a write that has no feature mutation hook through the mutation cache,
 * so app-wide write guards and `isMutating` (the inbox-switch lock) see it. */
export function runTrackedWrite<T>(queryClient: QueryClient, write: () => Promise<T>): Promise<T> {
	return new MutationObserver<T, Error, void>(queryClient, { mutationFn: write }).mutate()
}
