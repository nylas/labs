import type { Message } from '@nylas-labs/cli-kit/v3'
import { createServerFn } from '@tanstack/react-start'
import { requireNylasProviderId, validNylasProviderId } from '#server/ids'
import { friendly, requireMailbox } from '#server/mailbox-boundary'
import { type ThreadUnreadSummary, unreadSummary } from '../lib/thread-list-model.js'
import type { MailMessage } from '../state/mail-queries.js'

/** The newest messages a row counts: unread mail is the newest, so a long thread needs no more. */
export const UNREAD_SUMMARY_LOOKUP_LIMIT = 50

/** Only what counting and naming the newest file read: never a body. */
const UNREAD_SUMMARY_FIELDS = 'id,thread_id,unread,date,from,attachments'

/**
 * How many of a thread's messages are unread, and its newest file, for a list
 * row's "3 new" and file pill. One message listing per thread, without bodies,
 * where opening the conversation would fetch every message in full.
 */
export const getThreadUnreadSummary = createServerFn({ method: 'GET' })
	.validator((input: { threadId: string }) => ({
		threadId: requireNylasProviderId(input.threadId, 'thread'),
	}))
	.handler(async ({ data }): Promise<ThreadUnreadSummary> => {
		const { mailbox, email } = await requireMailbox()
		try {
			const response = await mailbox.listMessages({
				thread_id: data.threadId,
				select: UNREAD_SUMMARY_FIELDS,
				limit: UNREAD_SUMMARY_LOOKUP_LIMIT,
			})
			const listed = (Array.isArray(response.data) ? response.data : []) as Array<Message | null>
			// A listing can name messages of other threads only by a provider fault; they are not counted.
			const messages = listed.filter(
				(message): message is Message =>
					validNylasProviderId(message?.id) && message?.thread_id === data.threadId,
			)
			return unreadSummary(messages as MailMessage[], email)
		} catch (err) {
			throw friendly(err)
		}
	})
