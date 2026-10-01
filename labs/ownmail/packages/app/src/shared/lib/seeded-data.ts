/**
 * The data of a query seeded with loader data, never `undefined`.
 *
 * React Query applies `initialData` when it creates a cache entry, and to an
 * entry that already exists only in an effect. So when the entry for a key was
 * created or replaced by a fetch that carries no seed (a hover preload, a
 * refetch after the entry was removed, a key that changed once the account
 * became known), one render sees no data even though the hook was given a seed.
 * Fall back to the seed for that render; it belongs to the same identity.
 */
export function seededData<T>(data: T | undefined, seed: T): T {
	return data === undefined ? seed : data
}
