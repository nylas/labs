import type { QueryClient } from '@tanstack/react-query'
import { getThreadMessages } from '#server/fns'
import { forwardDraftSearch, replyAllDraftSearch, replyDraftSearch } from '../lib/mail-ui-model.js'
import { threadDetailQueryOptions } from './mail-queries.js'

export type ThreadResponseKind = 'reply' | 'reply-all' | 'forward'

/** A reply or reply-all is written in its thread; a forward starts a new conversation. */
export function composeKindForResponse(kind: ThreadResponseKind): 'reply' | 'forward' {
	return kind === 'forward' ? 'forward' : 'reply'
}

/**
 * The composer search for answering a thread from its list row. A row carries
 * no messages, so the thread is loaded through the same detail query the
 * reader uses (served from the cache when the thread was opened before) and
 * the answer targets its last message, exactly as the reader toolbar does.
 * Rejects when the thread cannot be loaded or has no message to answer.
 */
export async function threadResponseSearch(client: QueryClient, threadId: string, kind: ThreadResponseKind) {
	const detail = await client.ensureQueryData(
		threadDetailQueryOptions(threadId, (id) => getThreadMessages({ data: { threadId: id } })),
	)
	const lastMessage = detail.messages.at(-1)
	if (!lastMessage) throw new Error('The thread has no message to answer.')
	if (kind === 'reply') return replyDraftSearch(lastMessage)
	if (kind === 'reply-all') return replyAllDraftSearch(lastMessage, detail.mailboxEmail)
	return forwardDraftSearch(lastMessage)
}
