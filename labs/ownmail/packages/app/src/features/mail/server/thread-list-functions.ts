import type { Message } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { requireNylasProviderId, validNylasProviderId } from '#server/ids'
import { friendly, requireMailbox } from '#server/mailbox-boundary'
import { type ThreadUnreadSummary, unreadSummary } from '../lib/thread-list-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { listThreadMessagePages } from './thread-message-pages.js'

/** Only what counting and naming the newest file read: never a body. */
const UNREAD_SUMMARY_FIELDS = 'id,thread_id,unread,date,from,attachments'

/**
 * How many of a thread's messages are unread, and its newest file, for a list
 * row's "3 new" and file pill. A bodiless message listing per thread, newest
 * first and for at most 200 messages, where opening the conversation would
 * fetch every message in full. When every message read was unread and more
 * remain, the count is a floor (`moreUnread`), and the row says "200+ new".
 */
export const getThreadUnreadSummary = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => ({
		threadId: requireNylasProviderId(input.threadId, 'thread'),
	}))
	.handler(async ({ data }): Promise<ThreadUnreadSummary> => {
		const { mailbox, email } = await requireMailbox()
		try {
			const { messages: listed, more } = await listThreadMessagePages<Message | null>(
				mailbox,
				data.threadId,
				{ select: UNREAD_SUMMARY_FIELDS },
			)
			// A listing can name messages of other threads only by a provider fault, and
			// a thread that changes mid-walk can list one twice; each is counted once.
			const seen = new Set<string>()
			const messages = listed.filter((message): message is Message => {
				if (!validNylasProviderId(message?.id) || message?.thread_id !== data.threadId) return false
				if (seen.has(message.id)) return false
				seen.add(message.id)
				return true
			})
			return unreadSummary(messages as MailMessage[], email, more)
		} catch (err) {
			throw friendly(err)
		}
	})
