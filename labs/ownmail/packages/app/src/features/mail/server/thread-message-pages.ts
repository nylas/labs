import { validNylasProviderId } from '#server/ids'

/** Messages read per page when one thread's messages are listed. */
export const THREAD_PAGE_SIZE = 50
/** Pages read per thread lookup: at most 200 messages, which bounds the cost of one request. */
export const THREAD_MAX_PAGES = 4

export type ThreadMessageLister = {
	listMessages(query: {
		thread_id: string
		limit: number
		page_token?: string
		[key: string]: string | number | undefined
	}): Promise<{ data?: unknown; next_cursor?: unknown }>
}

/**
 * One thread's messages, newest first as the provider lists them, following
 * its cursor for at most `THREAD_MAX_PAGES` pages, each asked with `query`. A
 * cursor that is not a usable provider id, or that repeats, ends the walk;
 * `more` says the cap ended it with a page still to read. A page that is not
 * a list rejects, so callers keep their single "no answer" fallback.
 */
export async function listThreadMessagePages<T>(
	mailbox: ThreadMessageLister,
	threadId: string,
	query: Record<string, string>,
): Promise<{ messages: T[]; more: boolean }> {
	const messages: T[] = []
	const seenCursors = new Set<string>()
	let pageToken: string | undefined
	for (let page = 0; page < THREAD_MAX_PAGES; page++) {
		const response = await mailbox.listMessages({
			...query,
			thread_id: threadId,
			limit: THREAD_PAGE_SIZE,
			...(pageToken ? { page_token: pageToken } : {}),
		})
		if (!Array.isArray(response.data)) throw new Error('Unexpected message list')
		messages.push(...(response.data as T[]))
		const cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined
		if (!validNylasProviderId(cursor) || seenCursors.has(cursor)) return { messages, more: false }
		seenCursors.add(cursor)
		pageToken = cursor
	}
	return { messages, more: true }
}
