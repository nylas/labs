import type { QueryClient } from '@tanstack/react-query'
import { getThreadMessages } from '#server/fns'
import { forwardDraftSearch, replyAllDraftSearch, replyDraftSearch } from '../lib/mail-ui-model.js'
import { replyBase, replyTarget } from '../lib/thread-stream.js'
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
 * the answer targets the message the reader toolbar answers: the latest one
 * that is not your own unsent draft and not a delivery report (`replyBase`),
 * and a plain Reply goes to `replyTarget`, never back to yourself.
 * Rejects when the thread cannot be loaded or has no message to answer, and
 * when part of it did not load: the last message shown may then not be the
 * last one sent, so the row says the action failed instead of answering it.
 */
export async function threadResponseSearch(client: QueryClient, threadId: string, kind: ThreadResponseKind) {
	const detail = await client.ensureQueryData(
		threadDetailQueryOptions(threadId, (id) => getThreadMessages({ data: { threadId: id } })),
	)
	if (detail.failedMessageIds?.length) throw new Error('Part of the thread could not be loaded.')
	const lastMessage = replyBase(detail.messages)
	if (!lastMessage) throw new Error('The thread has no message to answer.')
	if (kind === 'reply') {
		return {
			...replyDraftSearch(lastMessage),
			to: replyTarget(lastMessage, detail.mailboxEmail)?.email ?? '',
		}
	}
	if (kind === 'reply-all') return replyAllDraftSearch(lastMessage, detail.mailboxEmail)
	return forwardDraftSearch(lastMessage)
}
