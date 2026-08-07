export type ThreadSearchParams = {
	search_query_native?: string
}

/**
 * Agent Account full-text search includes participants alongside subject, body,
 * and attachment filenames. Keep the complete grammar in search_query_native;
 * structured participant filters would change the meaning of an email term.
 */
export function threadSearchParams(raw: string | undefined): ThreadSearchParams {
	const q = raw?.trim()
	if (!q) return {}
	return { search_query_native: q }
}
