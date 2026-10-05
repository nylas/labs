import { useQuery } from '@tanstack/react-query'
import { Download, Mail } from 'lucide-react'
import {
	type ComponentProps,
	type ReactElement,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
} from 'react'
import { accountScope } from '#app/lib/account-scope'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { Button } from '#shared/components/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { useIdentityState } from '#shared/hooks/use-identity-state'
import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'
import { type MessageContent, messageContent } from '../lib/clean-view.js'
import {
	buildConversation,
	type ConversationBubble,
	type ConversationItem,
	senderLabel,
} from '../lib/conversation-model.js'
import { senderImagesTrusted } from '../lib/image-sender-trust.js'
import { replyAllDraftSearch, replyDraftSearch } from '../lib/mail-ui-model.js'
import { type MailMessage, threadListUnsubscribeQueryOptions } from '../state/mail-queries.js'
import { AttachmentLink } from './AttachmentLink.js'
import { CalendarInvitationCard } from './CalendarInvitationCard.js'
import { CleanBlocks, LinkPreviewRegion } from './CleanBlocks.js'
import type { EmailDisplayStatus } from './EmailHtml.js'
import { ThreadColumn } from './ThreadColumn.js'
import { ThreadMessagesPlaceholder } from './ThreadMessagesPlaceholder.js'

/** The existing reply entry points; the Conversation view never sends on its own. */
export interface ConversationReply {
	onReply: () => void
	onReplyAll: () => void
}

const senderKey = (message: MailMessage): string => message.from?.[0]?.email?.trim().toLowerCase() ?? ''

function timeLabel(epochSeconds: number): string {
	return new Date(epochSeconds * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(epochSeconds: number): string {
	return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
	})
}

function MessageTime({ epochSeconds }: { epochSeconds: number }) {
	return (
		<time dateTime={new Date(epochSeconds * 1000).toISOString()} className="font-data tabular-nums">
			{timeLabel(epochSeconds)}
		</time>
	)
}

/** Loaded on demand, so the standard reader never asks for message headers. */
async function fetchListUnsubscribeIds(threadId: string): Promise<string[]> {
	const { getThreadListUnsubscribe } = await import('../server/mail-functions.js')
	return (await getThreadListUnsubscribe({ data: { threadId } })).messageIds
}

const NO_MESSAGE_IDS: readonly string[] = []

/**
 * The Conversation view of one thread. Which messages are bulk mail is one of
 * its classification signals, looked up once per account and thread and cached.
 * Until that answer is in, the transcript is the thread skeleton's placeholder:
 * a message is never painted as a bubble and then re-drawn as an article. If
 * the lookup fails, messages are classified on their bodies alone.
 */
export function ConversationTranscript(props: Omit<ComponentProps<typeof Transcript>, 'listUnsubscribeIds'>) {
	const lookup = useQuery(threadListUnsubscribeQueryOptions(props.threadId, fetchListUnsubscribeIds))
	if (lookup.isPending) return <ThreadMessagesPlaceholder />
	return <Transcript {...props} listUnsubscribeIds={lookup.data ?? NO_MESSAGE_IDS} />
}

/**
 * A thread as a chat transcript. Each email is a bubble holding only what its
 * sender newly wrote; mail that does not fit a bubble, and any message switched
 * to "Show original", is rendered by the standard reader in the same stream.
 */
function Transcript({
	threadId,
	messages,
	mailboxEmail,
	loadRemoteImagesForThread,
	trustedDuringThisView,
	cleanDesigned,
	listUnsubscribeIds,
	onDisplayStatus,
	renderOriginal,
	reply,
	children,
}: {
	threadId: string
	messages: MailMessage[]
	mailboxEmail?: string | undefined
	loadRemoteImagesForThread: boolean
	trustedDuringThisView: ReadonlySet<string>
	/** Designed mail becomes a clean article; false keeps the standard reader for it. */
	cleanDesigned: boolean
	/** Messages that carry a List-Unsubscribe header. */
	listUnsubscribeIds: readonly string[]
	onDisplayStatus: (messageId: string, status: EmailDisplayStatus | null) => void
	/** The standard reader's body for one message, with the thread's display settings. */
	renderOriginal: (message: MailMessage) => ReactNode
	reply?: ConversationReply | undefined
	children?: ReactNode
}) {
	const [preferences] = useUserPreferences()
	// "Show original" is a per-message choice held only while the thread is open.
	// It lives under the thread's identity, like the trust this account stored.
	const [originalIds, setOriginalIds] = useIdentityState<ReadonlySet<string>>([threadId], () => new Set())
	const account = accountScope()
	const [storedTrust, setStoredTrust] = useIdentityState<ReadonlySet<string>>(
		[threadId, account],
		() => new Set(),
	)

	useEffect(() => {
		let active = true
		for (const sender of new Set(messages.map(senderKey))) {
			void senderImagesTrusted(sender, account).then((trusted) => {
				if (active && trusted) setStoredTrust((current) => new Set(current).add(sender))
			})
		}
		return () => {
			active = false
		}
	}, [account, messages, setStoredTrust])

	const allowAll = preferences.remoteImagePolicy === 'always' || loadRemoteImagesForThread
	const contents = useMemo(() => {
		const map = new Map<string, { content: MessageContent; allowed: boolean }>()
		for (const message of messages) {
			const sender = senderKey(message)
			const allowed = allowAll || trustedDuringThisView.has(sender) || storedTrust.has(sender)
			map.set(message.id, {
				content: messageContent(message, allowed, cleanDesigned, listUnsubscribeIds.includes(message.id)),
				allowed,
			})
		}
		return map
	}, [allowAll, cleanDesigned, listUnsubscribeIds, messages, storedTrust, trustedDuringThisView])

	const conversation = useMemo(
		() =>
			buildConversation(messages, {
				mailboxEmail,
				// Every message of `messages` has an entry in `contents`.
				contentFor: (message) => (contents.get(message.id) as { content: MessageContent }).content,
				originalIds,
			}),
		[contents, mailboxEmail, messages, originalIds],
	)

	// Bubbles report blocked remote images the way the email renderer does, so the
	// thread display menu's image controls keep working. A message shown by the
	// standard reader reports for itself.
	useLayoutEffect(() => {
		const reported: string[] = []
		for (const [messageId, { content, allowed }] of contents) {
			if (content.kind === 'original' || originalIds.has(messageId)) continue
			const article = content.kind === 'article'
			if (!article && !content.hasRemoteImages) continue
			reported.push(messageId)
			onDisplayStatus(messageId, {
				// An article can always be switched back to the original layout.
				layoutAvailable: article,
				remoteImages: content.hasRemoteImages ? { hasRemoteImages: true, loaded: allowed } : null,
			})
		}
		return () => {
			for (const messageId of reported) onDisplayStatus(messageId, null)
		}
	}, [contents, onDisplayStatus, originalIds])

	const setOriginal = (ids: string[], original: boolean) =>
		setOriginalIds((current) => {
			const next = new Set(current)
			for (const id of ids) {
				if (original) next.add(id)
				else next.delete(id)
			}
			return next
		})

	const lastMessage = messages.at(-1)
	// A thread of only designed mail opens as an article, not a chat.
	const chat = conversation.layout === 'chat'
	return (
		<div data-slot="conversation-view" className="flex min-h-0 flex-1 flex-col">
			<LinkPreviewRegion
				data-slot="conversation-transcript"
				data-navigation-content=""
				className="flex flex-1 flex-col gap-region pb-region"
			>
				{chat ? (
					<ThreadColumn>
						<p data-slot="conversation-participants" className="text-sm text-muted-foreground">
							{[conversation.participants, emailCount(messages.length)].filter(Boolean).join(' · ')}
						</p>
					</ThreadColumn>
				) : null}
				{conversation.items.map((item) => (
					<TranscriptItem
						key={item.key}
						item={item}
						group={conversation.group}
						chat={chat}
						renderOriginal={renderOriginal}
						onSetOriginal={setOriginal}
					/>
				))}
			</LinkPreviewRegion>
			{reply && lastMessage && chat ? (
				<ConversationReplyBar
					threadId={threadId}
					message={lastMessage}
					messages={messages}
					mailboxEmail={mailboxEmail ?? ''}
					group={conversation.group}
					reply={reply}
				/>
			) : (
				children
			)}
		</div>
	)
}

function TranscriptItem({
	item,
	group,
	chat,
	renderOriginal,
	onSetOriginal,
}: {
	item: ConversationItem
	group: boolean
	chat: boolean
	renderOriginal: (message: MailMessage) => ReactNode
	onSetOriginal: (ids: string[], original: boolean) => void
}) {
	if (item.kind === 'day') {
		return (
			<ThreadColumn>
				<p data-slot="conversation-day" className="text-center text-xs font-medium text-muted-foreground">
					<time dateTime={new Date(item.epochSeconds * 1000).toISOString()}>
						{dayLabel(item.epochSeconds)}
					</time>
				</p>
			</ThreadColumn>
		)
	}

	if (item.kind === 'event') {
		return (
			<ThreadColumn>
				<p data-slot="conversation-event" className="text-center text-xs font-medium text-muted-foreground">
					{item.text}
				</p>
			</ThreadColumn>
		)
	}

	if (item.kind === 'card' && chat) {
		// In a chat the standard reader is one more message from its sender: it
		// sits on their side, in a bubble its canvas fills, never across the pane.
		const { message, mine } = item
		return (
			<article
				data-slot="conversation-card"
				data-side={mine ? 'me' : 'them'}
				aria-label={`Message from ${item.label}`}
			>
				<ThreadColumn>
					<div className={cn('flex min-w-0 flex-col gap-cluster', mine ? 'items-end' : 'items-start')}>
						<div className="flex min-w-0 flex-wrap items-center gap-x-cluster">
							<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
								<span className="font-semibold text-foreground">{mine ? 'You' : item.label}</span>
								{message.date ? (
									<>
										{' · '}
										<MessageTime epochSeconds={message.date} />
									</>
								) : null}
							</p>
							{item.restorable ? (
								<Button variant="ghost" size="sm" onClick={() => onSetOriginal([message.id], false)}>
									Show in conversation
								</Button>
							) : null}
						</div>
						<div className="w-full min-w-0 empty:hidden">
							<CalendarInvitationCard message={message} />
						</div>
						{/* A painted sender canvas fills the bubble edge to edge; mail without one sits on the bubble's own fill. */}
						<div
							data-slot="conversation-card-body"
							className={cn(
								'w-full min-w-0 overflow-hidden rounded-2xl bg-muted py-cluster empty:hidden has-[[data-slot=email-canvas-band][style]]:py-0',
								BUBBLE_MAX_WIDTH_CLASS,
							)}
						>
							{renderOriginal(message)}
						</div>
						<BubbleAttachments message={message} />
					</div>
				</ThreadColumn>
			</article>
		)
	}

	if (item.kind === 'card') {
		const { message } = item
		return (
			<article data-slot="conversation-card" aria-label={`Message from ${item.label}`}>
				<ThreadColumn>
					<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-cluster">
						<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
							<span className="font-semibold text-foreground">{item.label}</span>
							{message.date ? (
								<>
									{' · '}
									<MessageTime epochSeconds={message.date} />
								</>
							) : null}
						</p>
						{item.restorable ? (
							<Button variant="ghost" size="sm" onClick={() => onSetOriginal([message.id], false)}>
								Show clean view
							</Button>
						) : null}
					</div>
					<CalendarInvitationCard message={message} />
				</ThreadColumn>
				{renderOriginal(message)}
				<ThreadColumn>
					<BubbleAttachments message={message} className="mt-cluster" />
				</ThreadColumn>
			</article>
		)
	}

	if (item.kind === 'article') {
		const { message } = item
		return (
			<article data-slot="conversation-article" aria-label={`Message from ${item.label}`}>
				<ThreadColumn>
					{/* In a chat the article is a card in the stream; on its own it is the page. */}
					<MessageMenu
						message={message}
						label={item.label}
						onShowOriginal={() => onSetOriginal([message.id], true)}
					>
						<div
							className={cn(
								'flex min-w-0 max-w-[72ch] flex-col gap-hairline',
								chat && 'rounded-lg border border-border bg-card p-region',
							)}
						>
							<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-cluster">
								<p className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
									<span className="font-semibold text-foreground">{item.label}</span>
									{message.date ? (
										<>
											{' · '}
											<MessageTime epochSeconds={message.date} />
										</>
									) : null}
								</p>
								<Button variant="ghost" size="sm" onClick={() => onSetOriginal([message.id], true)}>
									Show original
								</Button>
							</div>
							<CalendarInvitationCard message={message} />
							<CleanBlocks blocks={item.blocks} />
							<BubbleAttachments message={message} />
						</div>
					</MessageMenu>
				</ThreadColumn>
			</article>
		)
	}

	const name = item.mine ? 'You' : item.label
	const named = group && !item.mine
	const last = item.bubbles.at(-1) as ConversationBubble
	return (
		<ThreadColumn>
			<section
				data-slot="conversation-run"
				data-side={item.mine ? 'me' : 'them'}
				aria-label={`${name}, ${emailCount(item.bubbles.length)}`}
				className={cn('flex min-w-0 gap-cluster', item.mine && 'flex-row-reverse')}
			>
				{named ? (
					<div
						data-slot="sender-avatar"
						aria-hidden="true"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground"
					>
						{initials(item.label)}
					</div>
				) : null}
				<div
					className={cn('flex min-w-0 flex-1 flex-col gap-control', item.mine ? 'items-end' : 'items-start')}
				>
					<h2 className={named ? 'text-xs font-semibold text-muted-foreground' : 'sr-only'}>{name}</h2>
					{item.bubbles.map((bubble) => (
						<Bubble
							key={bubble.message.id}
							bubble={bubble}
							mine={item.mine}
							label={name}
							onShowOriginal={() => onSetOriginal([bubble.message.id], true)}
						/>
					))}
					<div className="flex min-w-0 flex-wrap items-center gap-x-cluster text-xs text-muted-foreground">
						<span>
							{last.message.date ? <MessageTime epochSeconds={last.message.date} /> : null}
							{last.message.date && item.bubbles.length > 1 ? ' · ' : null}
							{item.bubbles.length > 1 ? emailCount(item.bubbles.length) : null}
						</span>
						<Button
							variant="ghost"
							size="sm"
							className="text-xs"
							aria-label={`Show original ${item.bubbles.length > 1 ? 'messages' : 'message'} from ${name}`}
							onClick={() =>
								onSetOriginal(
									item.bubbles.map((bubble) => bubble.message.id),
									true,
								)
							}
						>
							Show original
						</Button>
					</div>
				</div>
			</section>
		</ThreadColumn>
	)
}

/**
 * The right-click menu of one message in the transcript: what that message
 * already offers here ("Show original") and in the reader's overflow menu
 * (the raw download). Selected text, links and images inside the message keep
 * the browser's menu, as rendered email does. Opening the menu changes nothing.
 */
function MessageMenu({
	message,
	label,
	onShowOriginal,
	children,
}: {
	message: MailMessage
	label: string
	onShowOriginal: () => void
	/** The bubble or article card; it becomes the trigger. */
	children: ReactElement
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild keepNativeMenuOn="a[href], img">
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent aria-label={`Actions for message from ${label}`}>
				<ContextMenuItem onSelect={() => onShowOriginal()}>
					<Mail aria-hidden="true" />
					Show original
				</ContextMenuItem>
				{/* An unsent draft is always shown by the standard reader, never here, so every message has a raw form. */}
				<ContextMenuItem asChild>
					<a href={`/messages/${encodeURIComponent(message.id)}/download`} download>
						<Download aria-hidden="true" />
						Download raw email
					</a>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

/**
 * A message never spans the whole column, so the side it sits on (the reader's
 * on the right, everyone else's on the left) shows however long the message is.
 */
const BUBBLE_MAX_WIDTH_CLASS = 'max-w-[min(72ch,85%)]'

function emailCount(count: number): string {
	return count === 1 ? '1 email' : `${count} emails`
}

function Bubble({
	bubble,
	mine,
	label,
	onShowOriginal,
}: {
	bubble: ConversationBubble
	mine: boolean
	label: string
	onShowOriginal: () => void
}) {
	const { message } = bubble
	const hasAttachments = (message.attachments ?? []).some((attachment) => !attachment.is_inline)
	return (
		<>
			<div className="w-full min-w-0 empty:hidden">
				<CalendarInvitationCard message={message} />
			</div>
			{/* A bubble is a fill: no border, no side rail. The side and the sender's
			    name carry who wrote it, so the tint is never the only signal. */}
			<MessageMenu message={message} label={label} onShowOriginal={onShowOriginal}>
				<div
					data-slot="conversation-bubble"
					data-unsure={bubble.unsure || undefined}
					className={cn(
						'flex min-w-0 flex-col gap-cluster rounded-2xl px-hairline py-cluster',
						BUBBLE_MAX_WIDTH_CLASS,
						// The reader's own bubbles are the quiet green tint; everyone else's are neutral.
						mine ? 'bg-bubble-own text-bubble-own-foreground' : 'bg-muted text-foreground',
					)}
				>
					{bubble.blocks.length > 0 ? (
						<CleanBlocks blocks={bubble.blocks} historyOpen={bubble.unsure} />
					) : hasAttachments ? null : (
						<p className="text-sm text-muted-foreground">No message text</p>
					)}
					<BubbleAttachments message={message} />
				</div>
			</MessageMenu>
		</>
	)
}

function BubbleAttachments({ message, className }: { message: MailMessage; className?: string }) {
	const attachments = (message.attachments ?? []).filter((attachment) => !attachment.is_inline)
	if (attachments.length === 0) return null
	const attribution = senderLabel(message)
	return (
		<div data-slot="conversation-attachments" className={cn('flex min-w-0 flex-wrap gap-cluster', className)}>
			{attachments.map((attachment) => (
				<AttachmentLink
					key={attachment.id}
					attachment={attachment}
					messageId={message.id}
					attribution={attribution}
				/>
			))}
		</div>
	)
}

/** Recipients named before the rest collapse into a count. */
const REPLY_RECIPIENTS_SHOWN = 3

/**
 * The pinned reply input. It names everyone who will receive the reply and
 * opens the existing composer, which is where the message is written and sent.
 * The recipients come from the same functions the composer is opened with
 * (`replyAllDraftSearch` and `replyDraftSearch`), so the bar can never name a
 * different set: the reply-all flow addresses everyone in To and sends no Cc,
 * and the bar says so. A long list shows its first names and a count that
 * expands to the full list. A group defaults to reply-all; replying to one
 * person is an explicit, visible choice.
 */
function ConversationReplyBar({
	threadId,
	message,
	messages,
	mailboxEmail,
	group,
	reply,
}: {
	threadId: string
	message: MailMessage
	messages: MailMessage[]
	mailboxEmail: string
	group: boolean
	reply: ConversationReply
}) {
	// Reply-all is the default: in a two-person thread it is simply the other
	// person. The choice belongs to this thread and its latest message.
	const [toAll, setToAll] = useIdentityState([threadId, message.id], () => true)
	const [expanded, setExpanded] = useIdentityState([threadId, message.id, toAll], () => false)
	const names = new Map<string, string>()
	for (const item of messages) {
		for (const person of [...(item.from ?? []), ...(item.to ?? []), ...(item.cc ?? [])]) {
			if (person.name) names.set(person.email.trim().toLowerCase(), person.name)
		}
	}
	const named = (to: string) =>
		to
			.split(', ')
			.filter(Boolean)
			.map((email) => names.get(email.toLowerCase()) ?? email)
	// A reply to one person goes to the Reply-To address when the sender set one.
	const one = named(replyDraftSearch(message).to)
	const recipients = toAll ? named(replyAllDraftSearch(message, mailboxEmail).to) : one
	const hidden = expanded ? 0 : Math.max(0, recipients.length - REPLY_RECIPIENTS_SHOWN)
	const shown = hidden > 0 ? recipients.slice(0, REPLY_RECIPIENTS_SHOWN) : recipients
	const sender = one[0] ?? senderLabel(message)
	return (
		<div
			data-slot="conversation-reply"
			className="sticky bottom-0 z-10 mt-auto hidden border-t border-border bg-background py-hairline md:block"
		>
			<ThreadColumn>
				<div className="flex min-w-0 flex-col gap-cluster">
					<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-cluster text-xs text-muted-foreground">
						<div className="flex min-w-0 flex-wrap items-center gap-x-cluster">
							<p data-slot="conversation-reply-recipients" className="min-w-0 [overflow-wrap:anywhere]">
								<span className="font-semibold text-foreground">To</span>{' '}
								{recipients.length > 0 ? shown.join(', ') : 'no recipients yet'}
							</p>
							{recipients.length > REPLY_RECIPIENTS_SHOWN ? (
								<Button
									variant="ghost"
									size="sm"
									className="text-xs"
									aria-expanded={expanded}
									onClick={() => setExpanded((current) => !current)}
								>
									{expanded ? 'Show fewer' : `and ${hidden} more`}
								</Button>
							) : null}
							<p>No Cc or Bcc · add them in the composer</p>
						</div>
						{group ? (
							<Button
								variant="ghost"
								size="sm"
								className="text-xs"
								aria-pressed={!toAll}
								onClick={() => setToAll((current) => !current)}
							>
								{toAll ? `Reply only to ${sender}` : 'Reply to all'}
							</Button>
						) : null}
					</div>
					<button
						data-slot="conversation-reply-input"
						type="button"
						onClick={toAll ? reply.onReplyAll : reply.onReply}
						className="flex min-h-11 w-full items-center justify-between gap-cluster rounded-full bg-muted px-region text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
					>
						<span className="min-w-0 truncate">
							{!toAll ? `Reply to ${sender}…` : group ? 'Reply to all…' : 'Reply…'}
						</span>
						<span className="shrink-0 font-medium text-foreground">Open composer</span>
					</button>
				</div>
			</ThreadColumn>
		</div>
	)
}
