import { createServerFn } from '@tanstack/react-start'
import {
	isCalendarInvitationAttachment,
	MAX_ICS_ATTACHMENT_BYTES,
	parseCalendarInvitation,
} from '#features/calendar/lib/calendar-invitation'
import { normalizeInvitationReference } from '#features/calendar/server/calendar-invitation-fns'
import { requireMailbox } from '#server/mailbox-boundary'

export type InvitationFileTime = { start: number; end: number } | null

/**
 * The time one invitation file proposes, read from the file itself. The
 * invitation card's details describe the event as the calendar has it now;
 * an earlier version of an updated invitation needs the time it carried, so
 * the reader can strike it through beside the current one. Only two numbers
 * leave the server; a missing, oversized or unreadable file answers null.
 */
export const getInvitationFileTime = createServerFn({ method: 'GET' })
	.validator(normalizeInvitationReference)
	.handler(async ({ data }): Promise<InvitationFileTime> => {
		const { mailbox } = await requireMailbox()
		try {
			const message = await mailbox.getMessage(data.messageId)
			const attachment = message.data.attachments?.find((candidate) => candidate.id === data.attachmentId)
			if (!attachment || !isCalendarInvitationAttachment(attachment)) return null
			if (attachment.size !== undefined && attachment.size > MAX_ICS_ATTACHMENT_BYTES) return null
			const response = await mailbox.downloadAttachment(attachment.id, data.messageId)
			if (!response.ok) return null
			const bytes = await response.arrayBuffer()
			if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICS_ATTACHMENT_BYTES) return null
			const parsed = parseCalendarInvitation(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
			return parsed?.start !== undefined && parsed.end !== undefined
				? { start: parsed.start, end: parsed.end }
				: null
		} catch {
			return null
		}
	})
