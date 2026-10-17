/**
 * Plain stand-ins for the components the standard reader mounts but other
 * modules own (avatars, the message header and notices, the long-thread tools,
 * the body's edge states and the phone bars). Reader tests mock those modules
 * with this one, so they assert what the reader does (what it mounts, with
 * which data, and what their callbacks do) rather than how each part looks.
 * Each stand-in renders its props as text and its callbacks as buttons.
 */
import type { ReactNode } from 'react'
import {
	type CatchUpFacts,
	emptyBodyNote,
	type MapEntry,
	type Person,
	personName,
	recipientSummary,
	senderPerson,
	type ThreadFile,
} from '#features/mail/lib/thread-reading-model'
import type { MailMessage, MessageHeaderFacts } from '#features/mail/state/mail-queries'

type Attachment = NonNullable<MailMessage['attachments']>[number]

const initialsOf = (person: Person): string =>
	(person.name || person.email)
		.split(/[\s@.]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0]?.toUpperCase())
		.join('')

export function Avatar({
	person,
	size,
}: {
	person: Person
	size: number
	ring?: boolean
	className?: string
}) {
	return (
		<span data-slot="avatar" data-size={size} aria-hidden="true">
			{initialsOf(person)}
		</span>
	)
}

export function AvatarStack({ people, size, max = 3 }: { people: Person[]; size: number; max?: number }) {
	return (
		<span data-slot="avatar-stack" data-size={size}>
			{people.slice(0, max).map((person) => (
				<Avatar key={person.email} person={person} size={size} />
			))}
		</span>
	)
}

export function MessageHeader({
	message,
	prev,
	owner,
	facts,
	onToggle,
	actions,
}: {
	message: MailMessage
	prev?: MailMessage
	owner: string
	facts?: MessageHeaderFacts
	expanded: boolean
	onToggle(): void
	actions: { onReply(): void; onForward(): void; onQuote(): void }
}) {
	const name = personName(senderPerson(message, owner), 'full')
	const recipients = recipientSummary(message, prev, owner)
	return (
		<div data-slot="message-header" data-verified={facts?.verified ? 'true' : undefined}>
			<h2>{name}</h2>
			<span data-slot="recipient-summary">{recipients.text}</span>
			<button type="button" onClick={onToggle}>
				Collapse message from {name}
			</button>
			<button type="button" onClick={actions.onReply}>
				Reply to {name}
			</button>
			<button type="button" onClick={actions.onForward}>
				Forward message from {name}
			</button>
			<button type="button" onClick={actions.onQuote}>
				Quote message from {name}
			</button>
		</div>
	)
}

export function MessageNotices({
	message,
	onMuteThread,
	onAddBack,
	knownSenders,
}: {
	message: MailMessage
	prev?: MailMessage
	owner: string
	facts?: MessageHeaderFacts
	knownSenders: Person[]
	onMuteThread(): void
	onAddBack(person: Person): void
}) {
	const first = knownSenders[0]
	return (
		<div
			data-slot="message-notices-stub"
			data-message={message.id}
			data-known={knownSenders.map((person) => person.email).join(',')}
		>
			<button type="button" onClick={onMuteThread}>
				Mute from notice {message.id}
			</button>
			{first ? (
				<button type="button" onClick={() => onAddBack(first)}>
					Add back from notice {message.id}
				</button>
			) : null}
		</div>
	)
}

export const linksDisabled = (facts?: MessageHeaderFacts, lookalike?: boolean): boolean =>
	Boolean(facts?.authFailed || lookalike)

export function AttachmentChip({
	attachment,
	detail,
}: {
	attachment: Attachment
	messageId: string
	detail?: string
}) {
	return (
		<span data-slot="attachment-chip">
			{attachment.filename ?? 'attachment'}
			{detail ? ` · ${detail}` : ''}
		</span>
	)
}

export function EmptyBody({ message, owner }: { message: MailMessage; owner: string }) {
	const note = emptyBodyNote(message, owner)
	return note ? <p data-slot="empty-body-stub">{note}</p> : null
}

export const draftAnchorId = (id: string): string => `draft-${id}`

export function DraftInThread({
	draft,
	replyToFirstName,
	onResume,
	onDiscard,
}: {
	draft: MailMessage
	replyToFirstName?: string
	onResume(): void
	onDiscard(): void
}) {
	return (
		<div id={draftAnchorId(draft.id)} data-slot="draft-stub">
			Draft reply to {replyToFirstName ?? 'nobody'}
			<button type="button" onClick={onResume}>
				Resume
			</button>
			<button type="button" onClick={onDiscard}>
				Discard
			</button>
		</div>
	)
}

export function OutgoingStatus({
	bounce,
	onEditResend,
	onSendNow,
	onCancelSchedule,
}: {
	message: MailMessage
	bounce?: { address: string }
	onEditResend(): void
	onSendNow?(): void
	onCancelSchedule?(): void
}) {
	// Like the real one, it offers Send now and Cancel only with a handler for each.
	return (
		<div data-slot="outgoing-stub">
			{bounce ? `Not sent. ${bounce.address} bounced.` : null}
			<button type="button" onClick={onEditResend}>
				Edit and resend
			</button>
			{onSendNow ? (
				<button type="button" onClick={onSendNow}>
					Send now
				</button>
			) : null}
			{onCancelSchedule ? (
				<button type="button" onClick={onCancelSchedule}>
					Cancel scheduled send
				</button>
			) : null}
		</div>
	)
}

export function ThreadStreamNotices({
	trashed,
	showTrashed,
	onToggleTrashed,
}: {
	trashed: MailMessage[]
	showTrashed: boolean
	onToggleTrashed(): void
	thread: unknown
	messages: MailMessage[]
	owner: string
}) {
	if (trashed.length === 0) return null
	return (
		<p data-slot="stream-notices-stub">
			{trashed.length} in Trash
			<button type="button" onClick={onToggleTrashed}>
				{showTrashed ? 'Hide trashed' : 'Show trashed'}
			</button>
		</p>
	)
}

export function PartialLoadNotice({
	failedCount,
	shownCount,
	onRetry,
}: {
	failedCount: number
	shownCount: number
	onRetry(): void
}) {
	return (
		<p data-slot="partial-load-stub">
			{failedCount} failed, {shownCount} shown
			<button type="button" onClick={onRetry}>
				Try again
			</button>
		</p>
	)
}

export function ThreadLoadError({ reset }: { error: unknown; reset(): void }) {
	return (
		<p data-slot="thread-load-error-stub">
			Load failed
			<button type="button" onClick={reset}>
				Try again
			</button>
		</p>
	)
}

export function LongMessageFrame({ messageId, children }: { messageId: string; children: ReactNode }) {
	return (
		<div data-slot="long-message-stub" data-message={messageId}>
			{children}
		</div>
	)
}

export function SupersededInviteNote({
	message,
	onShowLatest,
}: {
	message: MailMessage
	onShowLatest(): void
}) {
	return (
		<p data-slot="superseded-stub" data-message={message.id}>
			<button type="button" onClick={onShowLatest}>
				Show the latest invitation
			</button>
		</p>
	)
}

export function ReplyAllGuard({
	count,
	replyOnlyFirstName,
	onReplyOnly,
}: {
	count: number
	replyOnlyFirstName: string
	onReplyOnly(): void
}) {
	if (count <= 25) return null
	return (
		<p role="note">
			Reply all will reach {count} people.
			<button type="button" onClick={onReplyOnly}>
				Reply to {replyOnlyFirstName} only
			</button>
		</p>
	)
}

export function CatchUpCard({
	facts,
	sinceLabel,
	summaryMessages,
	onJumpToFirstNew,
	onAnswer,
	onShowSources,
}: {
	facts: CatchUpFacts
	sinceLabel: string
	summaryMessages: MailMessage[]
	onJumpToFirstNew(): void
	onAnswer(messageId: string): void
	onShowSources(ids: string[]): void
}) {
	const question = facts.questionsToYou[0]
	return (
		<section aria-label="Catch up" data-slot="catch-up-stub">
			Since you last read, {sinceLabel}: {facts.newCount} new
			<button type="button" onClick={onJumpToFirstNew}>
				Jump to first new
			</button>
			{question ? (
				<button type="button" onClick={() => onAnswer(question.messageId)}>
					Answer {personName(question.from, 'first')}
				</button>
			) : null}
			<button type="button" onClick={() => onShowSources(summaryMessages.map((message) => message.id))}>
				Show sources
			</button>
			<button type="button" onClick={() => onShowSources([])}>
				Hide sources
			</button>
		</section>
	)
}

export type ThreadMapFilter = 'all' | 'files' | 'you' | { from: string }

export const threadMapNamesYou = (): string[] => []

export function ThreadMapPanel({
	open,
	entries,
	selectedId,
	onSelect,
	onClose,
}: {
	entries: MapEntry[]
	stoppedBeforeIndex: number | null
	filter: ThreadMapFilter
	onFilter(filter: ThreadMapFilter): void
	selectedId?: string
	onSelect(messageId: string): void
	onClose(): void
	open: boolean
	namesYouIds?: readonly string[]
}) {
	if (!open) return null
	return (
		<aside aria-label="Thread map panel" data-selected={selectedId}>
			{entries.map((entry) => (
				<button key={entry.messageId} type="button" onClick={() => onSelect(entry.messageId)}>
					Map row {entry.messageId}
				</button>
			))}
			<button type="button" onClick={onClose}>
				Close thread map
			</button>
		</aside>
	)
}

export function ThreadFilesShelf({
	files,
	onDownloadAll,
	onOpenFile,
}: {
	files: ThreadFile[]
	onDownloadAll(): void
	onOpenFile(file: ThreadFile): void
}) {
	return (
		<section aria-label="Files in this thread">
			<button type="button" onClick={onDownloadAll}>
				Download all
			</button>
			{files.map((file) => (
				<button key={file.attachmentId} type="button" onClick={() => onOpenFile(file)}>
					Open {file.filename}
				</button>
			))}
		</section>
	)
}

export function MobileThreadTopBar({
	subject,
	messageCount,
	peopleCount,
	onBack,
	onArchive,
	moreMenu,
}: {
	subject: string
	messageCount: number
	peopleCount: number
	onBack(): void
	onArchive(): void
	moreMenu: ReactNode
}) {
	return (
		<div data-slot="mobile-top-bar-stub">
			{subject} · {messageCount} messages · {peopleCount} people
			<button type="button" onClick={onBack}>
				Back to Inbox
			</button>
			<button type="button" onClick={onArchive}>
				Archive from the phone bar
			</button>
			{moreMenu}
		</div>
	)
}

export function JumpToNewPill({ count, onJump }: { count: number; onJump(): void }) {
	if (count === 0) return null
	return (
		<button type="button" onClick={onJump}>
			{count} more new
		</button>
	)
}

export function MobileReplyBar({
	onReplyAll,
	onReply,
	onForward,
}: {
	onReplyAll(): void
	onReply(): void
	onForward(): void
}) {
	return (
		<div data-slot="mobile-reply-bar-stub">
			<button type="button" onClick={onReply}>
				Reply to thread
			</button>
			<button type="button" onClick={onReplyAll}>
				Reply all to thread
			</button>
			<button type="button" onClick={onForward}>
				Forward thread
			</button>
		</div>
	)
}
