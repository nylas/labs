const EMAILISH = /^[^\s@]+@[^\s@]+$/

export type ThreadSearchParams = {
	any_email?: string
	search_query_native?: string
}

/**
 * Nylas thread search supports participant filtering and provider-native
 * full-text search. Prefer any_email for email-like input; otherwise match the
 * reference client's broad subject/sender/body search with search_query_native.
 */
export function threadSearchParams(raw: string | undefined): ThreadSearchParams {
	const q = raw?.trim()
	if (!q) return {}
	return EMAILISH.test(q) || q.includes('@') ? { any_email: q } : { search_query_native: q }
}
