import { ChevronDown, Download } from 'lucide-react'
import { memo, useMemo } from 'react'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import type { EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import { messageNewText, type Person, personName, senderPerson } from '../lib/thread-reading-model.js'
import { chipAttachments, messageHeadings } from '../lib/thread-stream.js'
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

/** How an invitation message shows its card: the newest of several, or one that was replaced. */
export type InviteVersion =
	| { kind: 'latest'; updateCount: number; earlierVersions: MailMessage[] }
	| { kind: 'superseded'; latestId: string }

export type OpenMessageActions = {
	onToggle: (messageId: string) => void
	onReply: (message: MailMessage) => void
	onForward: (message: MailMessage) => void
	onQuote: (message: MailMessage) => void
	onMuteThread: () => void
	onAddBack: (message: MailMessage, person: Person) => void
	onEditResend: (message: MailMessage) => void
	onSendNow: (message: MailMessage) => void
	onCancelSchedule: (message: MailMessage) => void
	onShowMessage: (messageId: string) => void
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
 * hover actions and details), any notice about the sender or the list, the
 * invitation card, the body (or what to say when it is empty), the files it
 * carries and, for your own mail, whether it went.
 */
export const ThreadOpenMessage = memo(function ThreadOpenMessage({
	message,
	prev,
	owner,
	facts,
	knownSenders,
	lookalike,
	invite,
	bounce,
	attachmentDetails,
	display,
	actions,
	current,
}: {
	message: MailMessage
	prev?: MailMessage
	owner: string
	facts?: MessageHeaderFacts
	knownSenders: Person[]
	lookalike: boolean
	invite?: InviteVersion
	bounce?: { address: string }
	attachmentDetails: ReadonlyMap<string, string>
	display: OpenMessageDisplay
	actions: OpenMessageActions
	current: boolean
}) {
	const sender = senderPerson(message, owner)
	const senderLabel = personName(sender, 'full')
	// Drafts are never open messages (they sit in the stream as drafts), so every one has a raw email.
	const downloadHref = `/messages/${encodeURIComponent(message.id)}/download`
	const longText = useMemo(() => messageNewText(message), [message])
	const headings = useMemo(() => messageHeadings(message), [message])
	const attachments = chipAttachments(message)
	const own = sender.isOwner
	// Optional props of the body and the invitation card that arrive with the
	// body's edge states; spread so this file compiles against either version.
	const bodyExtras = { linksDisabled: linksDisabled(facts, lookalike), bodyFontSize: display.bodyFontSize }
	const inviteExtras =
		invite?.kind === 'latest'
			? { updateCount: invite.updateCount, earlierVersions: invite.earlierVersions }
			: {}

	return (
		<article
			data-slot="thread-message"
			data-state="open"
			data-current={current || undefined}
			aria-label={`Message from ${senderLabel}`}
			className="reader-message"
		>
			<ThreadColumn>
				{/* The header's right-click menu mirrors what the header and toolbar do.
				    The body below keeps the browser's own menu. */}
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<div data-slot="message-header" className="message-header-row">
							<MessageHeader
								message={message}
								{...(prev ? { prev } : {})}
								owner={owner}
								{...(facts ? { facts } : {})}
								expanded={true}
								onToggle={() => actions.onToggle(message.id)}
								actions={{
									onReply: () => actions.onReply(message),
									onForward: () => actions.onForward(message),
									onQuote: () => actions.onQuote(message),
								}}
							/>
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent aria-label={`Actions for message from ${senderLabel}`}>
						<ContextMenuItem onSelect={() => actions.onToggle(message.id)}>
							<ChevronDown className="rotate-180" aria-hidden="true" />
							Collapse message
						</ContextMenuItem>
						<ContextMenuItem asChild>
							<a href={downloadHref} download>
								<Download aria-hidden="true" />
								Download raw email
							</a>
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			</ThreadColumn>

			<div data-slot="expanded-message-content" className="reader-message-content">
				<ThreadColumnInset>
					<ThreadColumn>
						<MessageNotices
							message={message}
							{...(prev ? { prev } : {})}
							owner={owner}
							{...(facts ? { facts } : {})}
							knownSenders={knownSenders}
							onMuteThread={actions.onMuteThread}
							onAddBack={(person: Person) => actions.onAddBack(message, person)}
						/>
						{invite?.kind === 'superseded' ? (
							<SupersededInviteNote
								message={message}
								onShowLatest={() => actions.onShowMessage(invite.latestId)}
							/>
						) : (
							<CalendarInvitationCard message={message} {...inviteExtras} />
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
							{...bodyExtras}
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
											{...(detail ? { detail } : {})}
										/>
									)
								})}
							</section>
						) : null}
						{own ? (
							<OutgoingStatus
								message={message}
								{...(bounce ? { bounce } : {})}
								onEditResend={() => actions.onEditResend(message)}
								onSendNow={() => actions.onSendNow(message)}
								onCancelSchedule={() => actions.onCancelSchedule(message)}
							/>
						) : null}
					</ThreadColumn>
				</ThreadColumnInset>
			</div>
		</article>
	)
})
