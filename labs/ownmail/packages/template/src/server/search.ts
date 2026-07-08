const EMAILISH = /^[^\s@]+@[^\s@]+$/

export type ThreadSearchParams = {
	subject?: string
	any_email?: string
}

/**
 * Ownmail is built for Nylas Agent Accounts. Agent Accounts do not support
 * provider-native full-text search, so keep UI search to supported thread
 * filters: subject text or participant email.
 */
export function threadSearchParams(raw: string | undefined): ThreadSearchParams {
	const q = raw?.trim()
	if (!q) return {}
	return EMAILISH.test(q) || q.includes('@') ? { any_email: q } : { subject: q }
}
