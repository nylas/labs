import { memo, useId, useMemo } from 'react'
import type { EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import {
	emptyBodyNote,
	messageNewText,
	type Person,
	personName,
	senderPerson,
} from '../lib/thread-reading-model.js'
import { chipAttachments, isTrashed, messageHeadings } from '../lib/thread-stream.js'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'
import { AttachmentChip } from './AttachmentChip.js'
import { CalendarInvitationCard } from './CalendarInvitationCard.js'
import type { EmailDisplayStatus } from './EmailHtml.js'
import { EmptyBody } from './EmptyBody.js'
import { LongMessageFrame } from './LongMessageFrame.js'
import { MessageBody } from './MessageBody.js'
import { MessageHeader } from './MessageHeader.js'
import { linksDisabled, MessageNotices } from './MessageNotices.js'
import { OutgoingStatus } from './OutgoingStatus.js'
import { SupersededInviteNote } from './SupersededInvite.js'
import { ThreadColumn, ThreadColumnInset } from './ThreadColumn.js'
import { InTrash } from './ThreadStreamRows.js'

/** How an invitation message shows its card: the newest of several, or one that was replaced. */
export type InviteVersion =
	| { kind: 'latest'; updateCount: number; earlierVersions: MailMessage[] }
	| { kind: 'superseded'; latestId: string }

export type OpenMessageActions = {
	/** Part of the thread did not load: Reply, Forward, Quote and Add back wait, unavailable, like the toolbar's. */
	repliesPaused: boolean
	onToggle: (messageId: string) => void
	onReply: (message: MailMessage) => void
	onForward: (message: MailMessage) => void
	onQuote: (message: MailMessage) => void
	onMuteThread: () => void
	onAddBack: (message: MailMessage, person: Person) => void
	/** Opens your bounced message, files and all, as a new draft to the address that bounced. */
	onEditResend: (message: MailMessage, address: string) => Promise<void>
	onShowMessage: (messageId: string) => void
	/** Opens the thread message a quoted history entry of `message` came from. */
	onGoToQuoted: (message: MailMessage, quote: { name: string; email?: string; date?: number }) => void
	/** Sends your scheduled message now; null where the reader cannot. */
	onSendNow: ((message: MailMessage) => void) | null
	/** Cancels your scheduled message; null where the reader cannot. */
	onCancelSchedule: ((message: MailMessage) => void) | null
	onDisplayStatus: (messageId: string, status: EmailDisplayStatus | null) => void
}

export type OpenMessageDisplay = {
	darkenEmail: boolean
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	loadRemoteImagesForThread: boolean
	loadRemoteImagesForSender: boolean
	retryRevision: number
	bodyFontSize: 16 | 17
}

/**
 * One open message in the standard reader: the one-line header (with its
 * hover actions, details and right-click menu), any notice about the sender or the list, the
 * invitation card, the body (or what to say when it is empty), the files it
 * carries and, for your own mail, whether it went.
 */
export const ThreadOpenMessage = memo(function ThreadOpenMessage({
	message,
	prev,
	earlier,
	listNotice,
	owner,
	facts,
	listSizes,
	knownSenders,
	lookalike,
	unchecked,
	muted,
	invite,
	bounce,
	attachmentDetails,
	display,
	actions,
	current,
	latest = false,
}: {
	message: MailMessage
	/** The message before, when it is open directly above (the header compares recipients with it). */
	prev?: MailMessage
	/** The message before in the thread, however it is shown (a notice says who this reply dropped). */
	earlier?: MailMessage
	/** Whether this message carries the thread's one mailing-list notice. */
	listNotice: boolean
	owner: string
	facts?: MessageHeaderFacts
	/** Member counts of mailing lists the mailbox knows, for the details panel's list chips. */
	listSizes?: Readonly<Record<string, number>>
	knownSenders: Person[]
	lookalike: boolean
	/**
	 * The sender checks have not answered for this message: still `pending`
	 * (links wait, disabled) or `failed` (links stay disabled, and a notice says so).
	 */
	unchecked?: 'pending' | 'failed' | undefined
	/** Whether the thread is muted, so a list notice offers "Unmute thread". */
	muted: boolean
	invite?: InviteVersion
	bounce?: { address: string }
	attachmentDetails: ReadonlyMap<string, string>
	display: OpenMessageDisplay
	actions: OpenMessageActions
	current: boolean
	/** The thread's latest message, which closes the stream (board 01 gives it less room below). */
	latest?: boolean
}) {
	const sender = senderPerson(message, owner)
	const senderLabel = personName(sender, 'full')
	const longText = useMemo(() => messageNewText(message), [message])
	const headings = useMemo(() => messageHeadings(message), [message])
	const attachments = chipAttachments(message)
	const own = sender.isOwner
	const { onSendNow, onCancelSchedule } = actions
	const inert = linksDisabled(facts, lookalike, unchecked !== undefined)
	// An empty body says so and lists its files as quiet compact chips.
	const empty = emptyBodyNote(message, owner) !== null
	const headingId = useId()
	const contentId = useId()
	const inviteHistory =
		invite?.kind === 'latest'
			? { updateCount: invite.updateCount, earlierVersions: invite.earlierVersions }
			: {}

	return (
		<article
			data-slot="thread-message"
			data-state="open"
			data-current={current || undefined}
			data-latest={latest || undefined}
			aria-label={`Message from ${senderLabel}`}
			className="reader-message"
		>
			<ThreadColumn>
				{/* The header owns its right-click menu (collapse, reply, forward, raw download). */}
				<MessageHeader
					message={message}
					{...(prev ? { prev } : {})}
					owner={owner}
					{...(facts ? { facts } : {})}
					{...(listSizes ? { listSizes } : {})}
					expanded={true}
					headingId={headingId}
					contentId={contentId}
					senderFlagged={lookalike}
					knownPeople={knownSenders}
					onToggle={() => actions.onToggle(message.id)}
					actions={
						actions.repliesPaused
							? null
							: {
									onReply: () => actions.onReply(message),
									onForward: () => actions.onForward(message),
									onQuote: () => actions.onQuote(message),
								}
					}
				/>
			</ThreadColumn>

			<div
				id={contentId}
				data-slot="expanded-message-content"
				data-links-disabled={inert || undefined}
				className="reader-message-content"
			>
				<ThreadColumnInset>
					<ThreadColumn>
						{isTrashed(message) ? (
							<p className="reader-trash-note">
								<InTrash />
							</p>
						) : null}
						<MessageNotices
							message={message}
							{...(earlier ? { prev: earlier } : {})}
							listNotice={listNotice}
							owner={owner}
							{...(facts ? { facts } : {})}
							knownSenders={knownSenders}
							muted={muted}
							checksUnavailable={unchecked === 'failed'}
							onMuteThread={actions.onMuteThread}
							{...(actions.repliesPaused
								? {}
								: { onAddBack: (person: Person) => actions.onAddBack(message, person) })}
						/>
						{invite?.kind === 'superseded' ? (
							<SupersededInviteNote
								message={message}
								onShowLatest={() => actions.onShowMessage(invite.latestId)}
							/>
						) : (
							<CalendarInvitationCard message={message} {...inviteHistory} />
						)}
						<EmptyBody message={message} owner={owner} />
					</ThreadColumn>
					<LongMessageFrame messageId={message.id} text={longText} headings={headings}>
						<MessageBody
							message={message}
							darkenEmail={display.darkenEmail}
							layoutMode={display.layoutMode}
							colorMode={display.colorMode}
							loadRemoteImagesForThread={display.loadRemoteImagesForThread}
							loadRemoteImagesForSender={display.loadRemoteImagesForSender}
							retryRevision={display.retryRevision}
							onDisplayStatus={actions.onDisplayStatus}
							linksDisabled={inert}
							bodyFontSize={display.bodyFontSize}
							onGoToQuoted={(quote) => actions.onGoToQuoted(message, quote)}
						/>
					</LongMessageFrame>
					<ThreadColumn>
						{attachments.length > 0 ? (
							<section
								aria-label={`Attachments from ${senderLabel}`}
								data-slot="message-attachments"
								className="reader-attachments"
							>
								{attachments.map((attachment) => {
									const detail = attachmentDetails.get(`${message.id}|${attachment.id}`)
									return (
										<AttachmentChip
											key={attachment.id}
											attachment={attachment}
											messageId={message.id}
											compact={empty}
											{...(detail && !empty ? { detail } : {})}
										/>
									)
								})}
							</section>
						) : null}
						{own ? (
							<OutgoingStatus
								message={message}
								{...(bounce ? { bounce } : {})}
								onEditResend={(address) => actions.onEditResend(message, address)}
								{...(onSendNow ? { onSendNow: () => onSendNow(message) } : {})}
								{...(onCancelSchedule ? { onCancelSchedule: () => onCancelSchedule(message) } : {})}
							/>
						) : null}
					</ThreadColumn>
				</ThreadColumnInset>
			</div>
		</article>
	)
})
