/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Quiet */
import { ChevronDown, ChevronsDown, ChevronsUp, Download, MoreHorizontal, Paperclip } from 'lucide-react'
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { createPortal } from 'react-dom'
import { accountScope } from '#app/lib/account-scope'
import {
	type EmailLayoutPreference,
	type ThreadView,
	useUserPreferences,
	useUserPreferencesReady,
} from '#app/preferences/user-preferences'
import { ClientMessageTime } from '#shared/components/ClientTime'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { IconButton } from '#shared/components/ui/icon-button'
import { useIdentityState } from '#shared/hooks/use-identity-state'
import { labelBadgeClass } from '#shared/lib/color-tone'
import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'
import type { EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import {
	originalColorSenders,
	setSenderOriginalColors,
	trustSenderImages,
} from '../lib/image-sender-trust.js'
import { collapsedMessagePreview, messageHasHtml, threadLabels } from '../lib/mail-ui-model.js'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import { AttachmentLink, formatSize } from './AttachmentLink.js'
import { CalendarInvitationCard } from './CalendarInvitationCard.js'
import { type ConversationReply, ConversationTranscript } from './ConversationTranscript.js'
import type { EmailDisplayStatus } from './EmailHtml.js'
import { MessageBody } from './MessageBody.js'
import { ThreadColumn } from './ThreadColumn.js'
import { CONVERSATION_LAYOUT_OPTIONS, ThreadDisplayMenu } from './ThreadDisplayMenu.js'
import { ThreadMessagesPlaceholder } from './ThreadMessagesPlaceholder.js'
import { ThreadViewSwitch } from './ThreadViewSwitch.js'

/** A pane toolbar renders an element with this id to host the thread's display actions. */
export const THREAD_TOOLBAR_ACTIONS_ID = 'thread-toolbar-actions'

/** The toolbar takes the thread actions from Tailwind's `md` breakpoint, where it is the 44px desktop row. */
const TOOLBAR_ACTIONS_QUERY = '(min-width: 48rem)'

/**
 * Where the thread actions render: the pane toolbar's slot on desktop, or `null`
 * for the subject row (narrow screens, whose toolbar is already full, and panes
 * without a toolbar). `undefined` until mounted, so server markup never paints
 * the actions in one place and then moves them.
 */
function useThreadToolbarSlot(): HTMLElement | null | undefined {
	const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined)
	useLayoutEffect(() => {
		const desktop = window.matchMedia?.(TOOLBAR_ACTIONS_QUERY)
		const update = () =>
			setSlot(desktop?.matches === false ? null : document.getElementById(THREAD_TOOLBAR_ACTIONS_ID))
		update()
		desktop?.addEventListener('change', update)
		return () => desktop?.removeEventListener('change', update)
	}, [])
	return slot
}

/**
 * The canonical thread reader: subject, thread-level attachments, and the
 * expandable message list. Shared by the folder thread route, the compose backdrop,
 * and search results so there is a single reading-pane implementation. `children`
 * render after the last message, inside the same scroll flow.
 *
 * The optional Conversation view shows the same thread as a chat transcript.
 * `mailboxEmail` is the signed-in address (its messages sit on the right) and
 * `reply` supplies the existing reply entry points for the pinned input, which
 * replaces `children` in that view.
 */
export function ThreadConversation({
	thread,
	messages,
	mailboxEmail,
	reply,
	children,
}: {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail?: string
	reply?: ConversationReply
	children?: ReactNode
}) {
	return (
		<ThreadConversationController
			key={thread.id}
			thread={thread}
			messages={messages}
			mailboxEmail={mailboxEmail}
			reply={reply}
		>
			{children}
		</ThreadConversationController>
	)
}

function ThreadConversationController({
	thread,
	messages,
	mailboxEmail,
	reply,
	children,
}: {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail: string | undefined
	reply: ConversationReply | undefined
	children?: ReactNode
}) {
	const [preferences, savePreferences] = useUserPreferences()
	// The saved view is not known while rendering on the server and hydrating.
	// Until it is, the messages are a neutral placeholder, so a person whose
	// default is Conversation never sees the standard reader first.
	const preferencesReady = useUserPreferencesReady()
	// The toolbar switch flips this thread only, in memory. The flip lives under
	// the thread's identity and is remembered against the default it overrode:
	// once a new default is chosen (from the command palette) it is dropped, not
	// kept for later.
	const [viewOverride, setViewOverride] = useIdentityState<{ view: ThreadView; over: ThreadView } | null>(
		[thread.id],
		() => null,
	)
	const overrideStands = viewOverride?.over === preferences.threadView
	if (viewOverride && !overrideStands) setViewOverride(null)
	const threadView = viewOverride && overrideStands ? viewOverride.view : preferences.threadView
	const [displayStatuses, setDisplayStatuses] = useState<Map<string, EmailDisplayStatus>>(() => new Map())
	const [loadRemoteImagesForThread, setLoadRemoteImagesForThread] = useState(false)
	const [trustedDuringThisView, setTrustedDuringThisView] = useState<Set<string>>(() => new Set())
	const [retryRevision, setRetryRevision] = useState(0)
	const [senderTrustStatus, setSenderTrustStatus] = useState<{
		address?: string
		state: 'idle' | 'loading' | 'error'
	}>({ state: 'idle' })
	const [originalSenders, setOriginalSenders] = useState<ReadonlySet<string>>(() => new Set())
	const [originalColorStatus, setOriginalColorStatus] = useState<'idle' | 'error'>('idle')
	const latestMessageId = messages.at(-1)?.id

	useEffect(() => {
		let active = true
		void originalColorSenders(accountScope()).then((senders) => {
			if (active) setOriginalSenders(new Set(senders))
		})
		return () => {
			active = false
		}
	}, [])

	const onSenderOriginalColorsChange = useCallback(async (address: string, enabled: boolean) => {
		const update = (include: boolean) =>
			setOriginalSenders((current) => {
				const next = new Set(current)
				if (include) next.add(address)
				else next.delete(address)
				return next
			})
		update(enabled)
		setOriginalColorStatus('idle')
		if (await setSenderOriginalColors(address, enabled, accountScope())) return
		update(!enabled)
		setOriginalColorStatus('error')
	}, [])

	const onDisplayStatus = useCallback((messageId: string, status: EmailDisplayStatus | null) => {
		setDisplayStatuses((current) => {
			const next = new Map(current)
			if (status) next.set(messageId, status)
			else next.delete(messageId)
			return next
		})
	}, [])

	const onTrustSender = useCallback(async (address: string) => {
		setSenderTrustStatus({ address, state: 'loading' })
		const trusted = await trustSenderImages(address, accountScope())
		if (!trusted) {
			setSenderTrustStatus({ address, state: 'error' })
			return
		}
		setTrustedDuringThisView((current) => new Set(current).add(address.trim().toLowerCase()))
		setSenderTrustStatus({ address, state: 'idle' })
	}, [])

	// Reset expansion state as part of the conversation identity so a thread swap
	// cannot paint once with the previous thread's open message IDs. Including the
	// latest message also preserves the existing behaviour when a new reply arrives.
	return (
		<ThreadConversationContent
			key={latestMessageId}
			thread={thread}
			messages={messages}
			mailboxEmail={mailboxEmail}
			reply={reply}
			threadView={threadView}
			onThreadViewChange={(view) => setViewOverride({ view, over: preferences.threadView })}
			preferencesReady={preferencesReady}
			displayStatuses={displayStatuses}
			// `clean` belongs to the Conversation view; the standard reader lays it out as readable.
			layoutMode={preferences.emailLayoutMode === 'original' ? 'original' : 'readable'}
			colorMode={preferences.emailColorMode}
			darkenEmail={preferences.emailDarkMode}
			loadRemoteImagesForThread={loadRemoteImagesForThread}
			trustedDuringThisView={trustedDuringThisView}
			originalColorSenders={originalSenders}
			originalColorStatus={originalColorStatus}
			onSenderOriginalColorsChange={(address, enabled) => void onSenderOriginalColorsChange(address, enabled)}
			retryRevision={retryRevision}
			senderTrustStatus={senderTrustStatus}
			onDisplayStatus={onDisplayStatus}
			onLayoutModeChange={(emailLayoutMode) => savePreferences({ ...preferences, emailLayoutMode })}
			onColorModeChange={(emailColorMode) => savePreferences({ ...preferences, emailColorMode })}
			onShowThreadImages={() => setLoadRemoteImagesForThread(true)}
			onAlwaysShowImages={() => savePreferences({ ...preferences, remoteImagePolicy: 'always' })}
			onTrustSender={(address) => void onTrustSender(address)}
			onRetryImages={() => setRetryRevision((current) => current + 1)}
		>
			{children}
		</ThreadConversationContent>
	)
}

function ThreadConversationContent({
	thread,
	messages,
	mailboxEmail,
	reply,
	threadView,
	onThreadViewChange,
	preferencesReady,
	displayStatuses,
	layoutMode,
	colorMode,
	darkenEmail,
	loadRemoteImagesForThread,
	trustedDuringThisView,
	originalColorSenders,
	originalColorStatus,
	onSenderOriginalColorsChange,
	retryRevision,
	senderTrustStatus,
	onDisplayStatus,
	onLayoutModeChange,
	onColorModeChange,
	onShowThreadImages,
	onAlwaysShowImages,
	onTrustSender,
	onRetryImages,
	children,
}: {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail: string | undefined
	reply: ConversationReply | undefined
	threadView: ThreadView
	onThreadViewChange: (view: ThreadView) => void
	preferencesReady: boolean
	displayStatuses: ReadonlyMap<string, EmailDisplayStatus>
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	darkenEmail: boolean
	loadRemoteImagesForThread: boolean
	trustedDuringThisView: ReadonlySet<string>
	originalColorSenders: ReadonlySet<string>
	originalColorStatus: 'idle' | 'error'
	onSenderOriginalColorsChange: (address: string, enabled: boolean) => void
	retryRevision: number
	senderTrustStatus: { address?: string; state: 'idle' | 'loading' | 'error' }
	onDisplayStatus: (messageId: string, status: EmailDisplayStatus | null) => void
	onLayoutModeChange: (mode: EmailLayoutPreference) => void
	onColorModeChange: (mode: EmailColorMode) => void
	onShowThreadImages: () => void
	onAlwaysShowImages: () => void
	onTrustSender: (address: string) => void
	onRetryImages: () => void
	children?: ReactNode
}) {
	const toolbarSlot = useThreadToolbarSlot()
	const latestMessageId = messages.at(-1)?.id
	const [openMessageIds, setOpenMessageIds] = useState<Set<string>>(
		() => new Set(latestMessageId ? [latestMessageId] : []),
	)
	const labels = threadLabels(thread)
	const threadAttachments = useMemo(
		() =>
			messages.flatMap((message) =>
				(message.attachments ?? [])
					.filter((attachment) => !attachment.is_inline)
					.map((attachment) => ({
						attachment,
						messageId: message.id,
						fromLabel: message.from?.[0]?.name || message.from?.[0]?.email || '(unknown sender)',
					})),
			),
		[messages],
	)
	const allMessagesOpen = messages.length > 0 && messages.every((message) => openMessageIds.has(message.id))
	const allMessagesClosed = messages.every((message) => !openMessageIds.has(message.id))
	const hasHtmlMessages = messages.some(messageHasHtml)

	function toggleMessage(messageId: string) {
		setOpenMessageIds((current) => {
			const next = new Set(current)
			if (next.has(messageId)) next.delete(messageId)
			else next.add(messageId)
			return next
		})
	}

	const conversation = threadView === 'conversation'
	const viewSwitch = <ThreadViewSwitch value={threadView} onChange={onThreadViewChange} />

	// Display menu and expand/collapse-all. They live in the pane toolbar on
	// desktop, so the subject row there is one line of text and nothing else.
	const threadActions =
		hasHtmlMessages || messages.length > 1 ? (
			<div data-slot="thread-actions" className="flex min-w-0 shrink-0 items-center gap-1">
				{viewSwitch}
				{hasHtmlMessages ? (
					<ThreadDisplayMenu
						messages={messages}
						statuses={displayStatuses}
						{...(conversation
							? {
									layoutMode: layoutMode === 'original' ? 'original' : 'clean',
									layoutOptions: CONVERSATION_LAYOUT_OPTIONS,
								}
							: { layoutMode })}
						colorMode={colorMode}
						showColorControl={darkenEmail}
						senderTrustStatus={senderTrustStatus}
						originalColorSenders={originalColorSenders}
						originalColorStatus={originalColorStatus}
						onSenderOriginalColorsChange={onSenderOriginalColorsChange}
						onLayoutModeChange={onLayoutModeChange}
						onColorModeChange={onColorModeChange}
						onShowThreadImages={onShowThreadImages}
						onAlwaysShowImages={onAlwaysShowImages}
						onTrustSender={onTrustSender}
						onRetryImages={onRetryImages}
					/>
				) : null}
				{messages.length > 1 && !conversation ? (
					<fieldset className="flex min-w-0 shrink-0 items-center gap-1 border-0 p-0">
						<legend className="sr-only">Message display controls</legend>
						<IconButton
							label={`Expand all ${messages.length} messages`}
							title="Expand all messages"
							onClick={() => setOpenMessageIds(new Set(messages.map((message) => message.id)))}
							disabled={allMessagesOpen}
						>
							<ChevronsDown aria-hidden="true" />
						</IconButton>
						<IconButton
							label={`Collapse all ${messages.length} messages`}
							title="Collapse all messages"
							onClick={() => setOpenMessageIds(new Set())}
							disabled={allMessagesClosed}
						>
							<ChevronsUp aria-hidden="true" />
						</IconButton>
					</fieldset>
				) : null}
			</div>
		) : (
			viewSwitch
		)

	return (
		<div
			data-slot="thread-conversation"
			className={conversation ? 'flex min-h-full flex-col bg-background' : 'min-h-full bg-background'}
		>
			{/* The subject is the first line of the conversation: body size, in the
			    scroll flow, with no separator before the first message. */}
			<header data-slot="thread-summary" className="bg-background pt-3">
				<ThreadColumn>
					<div className="flex min-w-0 items-start justify-between gap-x-2">
						<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
							<h1 className="min-w-0 font-sans text-base leading-6 font-semibold tracking-normal [overflow-wrap:anywhere]">
								{thread.subject || '(no subject)'}
							</h1>
							{labels.map((label) => (
								<span key={label.id} className={cn('text-xs', labelBadgeClass(label.tone))}>
									{label.name}
								</span>
							))}
						</div>
						{toolbarSlot === null ? threadActions : null}
					</div>
					{toolbarSlot ? createPortal(threadActions, toolbarSlot) : null}

					{messages.length > 1 && threadAttachments.length > 0 ? (
						<div
							data-slot="thread-attachment-summary"
							className="mt-2 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md text-sm font-medium text-muted-foreground"
						>
							<Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
							<span>
								{threadAttachments.length} thread{' '}
								{threadAttachments.length === 1 ? 'attachment' : 'attachments'}
							</span>
						</div>
					) : null}
				</ThreadColumn>
			</header>

			{!preferencesReady ? (
				<ThreadMessagesPlaceholder />
			) : conversation ? (
				<ConversationTranscript
					threadId={thread.id}
					messages={messages}
					mailboxEmail={mailboxEmail}
					loadRemoteImagesForThread={loadRemoteImagesForThread}
					trustedDuringThisView={trustedDuringThisView}
					cleanDesigned={layoutMode !== 'original'}
					onDisplayStatus={onDisplayStatus}
					reply={reply}
					renderOriginal={(message) => (
						<MessageBody
							message={message}
							darkenEmail={darkenEmail}
							layoutMode={layoutMode}
							colorMode={
								colorMode === 'original' ||
								originalColorSenders.has(message.from?.[0]?.email?.trim().toLowerCase() ?? '')
									? 'original'
									: 'automatic'
							}
							loadRemoteImagesForThread={loadRemoteImagesForThread}
							loadRemoteImagesForSender={trustedDuringThisView.has(
								message.from?.[0]?.email?.trim().toLowerCase() ?? '',
							)}
							retryRevision={retryRevision}
							onDisplayStatus={onDisplayStatus}
						/>
					)}
				>
					{children}
				</ConversationTranscript>
			) : (
				<div data-slot="thread-messages" className="pb-10">
					{messages.map((message, index) => (
						<MessageBlock
							key={message.id}
							first={index === 0}
							message={message}
							open={openMessageIds.has(message.id)}
							onToggle={() => toggleMessage(message.id)}
							darkenEmail={darkenEmail}
							layoutMode={layoutMode}
							colorMode={
								colorMode === 'original' ||
								originalColorSenders.has(message.from?.[0]?.email?.trim().toLowerCase() ?? '')
									? 'original'
									: 'automatic'
							}
							loadRemoteImagesForThread={loadRemoteImagesForThread}
							loadRemoteImagesForSender={trustedDuringThisView.has(
								message.from?.[0]?.email?.trim().toLowerCase() ?? '',
							)}
							retryRevision={retryRevision}
							onDisplayStatus={onDisplayStatus}
						/>
					))}
					{children}
				</div>
			)}
		</div>
	)
}

function MessageBlock({
	first,
	message,
	open,
	onToggle,
	darkenEmail,
	layoutMode,
	colorMode,
	loadRemoteImagesForThread,
	loadRemoteImagesForSender,
	retryRevision,
	onDisplayStatus,
}: {
	first: boolean
	message: MailMessage
	open: boolean
	onToggle: () => void
	darkenEmail: boolean
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	loadRemoteImagesForThread: boolean
	loadRemoteImagesForSender: boolean
	retryRevision: number
	onDisplayStatus: (messageId: string, status: EmailDisplayStatus | null) => void
}) {
	const contentId = useId()
	const senderHeadingId = useId()
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	const recipients = message.to?.map((person) => person.name || person.email).join(', ') || 'me'
	const downloadHref =
		message.ownmailDraft !== true ? `/messages/${encodeURIComponent(message.id)}/download` : undefined

	return (
		<article
			data-slot="thread-message"
			data-state={open ? 'open' : 'collapsed'}
			aria-labelledby={senderHeadingId}
		>
			<ThreadColumn>
				{/* The separator and its clearance sit outside the row, so the row's
				    height is the same for the first message and every later one. */}
				<div data-slot="message-header" className={cn(!first && 'border-t border-border pt-4')}>
					{/* The header's right-click menu mirrors its overflow menu. The
					    message body below keeps the browser's own menu. */}
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								data-slot="message-header-row"
								className="message-header-row flex min-w-0 flex-wrap items-center gap-x-3"
							>
								<div
									data-slot="sender-avatar"
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground"
								>
									{initials(fromLabel)}
								</div>
								<div className="relative min-w-0 flex-1">
									<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
										<h2
											id={senderHeadingId}
											className="order-1 min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]"
										>
											{fromLabel}
										</h2>
										{open ? <MessageDetails message={message} recipientLabel={recipients} /> : null}
										{message.date ? (
											<ClientMessageTime
												epochSeconds={message.date}
												className="order-3 ml-auto hidden shrink-0 text-[13px] text-muted-foreground tabular-nums sm:inline-block"
											/>
										) : null}
									</div>
									{!open ? (
										// A collapsed message opens from its own summary; the stretched
										// hit area covers the sender and preview lines.
										<button
											data-slot="message-expand"
											type="button"
											onClick={onToggle}
											aria-label={`Expand message from ${fromLabel}`}
											className="mt-1 block w-full truncate rounded-sm text-left text-sm text-muted-foreground before:absolute before:inset-0 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											{collapsedMessagePreview(message)}
										</button>
									) : null}
								</div>
								<MessageActionsMenu
									fromLabel={fromLabel}
									messageOpen={open}
									contentId={contentId}
									downloadHref={downloadHref}
									onToggle={onToggle}
								/>
								{message.date ? (
									<ClientMessageTime
										epochSeconds={message.date}
										className="basis-full whitespace-nowrap pl-10 text-right text-[13px] leading-5 text-muted-foreground sm:hidden"
									/>
								) : null}
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent aria-label={`Actions for message from ${fromLabel}`}>
							<ContextMenuItem onSelect={() => onToggle()}>
								<ChevronDown className={cn(open && 'rotate-180')} aria-hidden="true" />
								{open ? 'Collapse message' : 'Expand message'}
							</ContextMenuItem>
							{downloadHref ? (
								<ContextMenuItem asChild>
									<a href={downloadHref} download>
										<Download aria-hidden="true" />
										Download raw email
									</a>
								</ContextMenuItem>
							) : null}
						</ContextMenuContent>
					</ContextMenu>
				</div>
			</ThreadColumn>

			{open ? (
				<div id={contentId} data-slot="expanded-message-content" className="w-full min-w-0 pb-4">
					<ThreadColumn>
						<CalendarInvitationCard message={message} />
					</ThreadColumn>
					<MessageBody
						message={message}
						darkenEmail={darkenEmail}
						layoutMode={layoutMode}
						colorMode={colorMode}
						loadRemoteImagesForThread={loadRemoteImagesForThread}
						loadRemoteImagesForSender={loadRemoteImagesForSender}
						retryRevision={retryRevision}
						onDisplayStatus={onDisplayStatus}
					/>
					<ThreadColumn>
						<MessageAttachments message={message} />
					</ThreadColumn>
				</div>
			) : (
				<div data-slot="collapsed-message-end" className="pb-4" />
			)}
		</article>
	)
}

const messageActionClass =
	'flex min-h-11 w-full items-center gap-3 whitespace-nowrap rounded-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring'

/** The one control in a message header: collapse or expand, and the raw download. */
function MessageActionsMenu({
	fromLabel,
	messageOpen,
	contentId,
	downloadHref,
	onToggle,
}: {
	fromLabel: string
	messageOpen: boolean
	contentId: string
	downloadHref: string | undefined
	onToggle: () => void
}) {
	const [open, setOpen] = useState(false)
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const menuId = useId()

	useEffect(() => {
		if (!open) return
		menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
		function closeOnOutsidePointer(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener('pointerdown', closeOnOutsidePointer)
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
	}, [open])

	function close() {
		setOpen(false)
		triggerRef.current?.focus()
	}

	function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault()
			event.stopPropagation()
			close()
			return
		}
		const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
		if (step === 0) return
		event.preventDefault()
		const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
		const index = items.indexOf(document.activeElement as HTMLElement)
		items[(index + step + items.length) % items.length]?.focus()
	}

	return (
		<div ref={rootRef} data-slot="message-actions" className="relative shrink-0">
			<IconButton
				ref={triggerRef}
				label={`Actions for message from ${fromLabel}`}
				title="Message actions"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onClick={() => setOpen((isOpen) => !isOpen)}
			>
				<MoreHorizontal aria-hidden="true" />
			</IconButton>
			{open ? (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label={`Actions for message from ${fromLabel}`}
					onKeyDown={onMenuKeyDown}
					className="absolute right-0 top-[calc(100%+0.25rem)] z-50 w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
				>
					<button
						data-slot="message-toggle"
						type="button"
						role="menuitem"
						aria-expanded={messageOpen}
						aria-controls={contentId}
						onClick={() => {
							close()
							onToggle()
						}}
						className={messageActionClass}
					>
						<ChevronDown
							className={cn('h-4 w-4 shrink-0 text-muted-foreground', messageOpen && 'rotate-180')}
							aria-hidden="true"
						/>
						{messageOpen ? 'Collapse message' : 'Expand message'}
					</button>
					{downloadHref ? (
						<a
							data-slot="raw-email-download"
							role="menuitem"
							href={downloadHref}
							download
							onClick={close}
							className={messageActionClass}
						>
							<Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							Download raw email
						</a>
					) : null}
				</div>
			) : null}
		</div>
	)
}

const MESSAGE_ADDRESS_FIELDS = [
	['from', 'From'],
	['to', 'To'],
	['cc', 'Cc'],
	['bcc', 'Bcc'],
	['reply_to', 'Reply-To'],
] as const

function MessageDetails({ message, recipientLabel }: { message: MailMessage; recipientLabel: string }) {
	const [open, setOpen] = useState(false)
	const panelId = useId()
	const labelId = useId()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const pointerStartedInsideRef = useRef(false)
	const clearPointerGuardTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const addressRows = MESSAGE_ADDRESS_FIELDS.flatMap(([field, label]) => {
		const participants = message[field]
		return participants?.length ? [{ label, value: participants.map(formatParticipant).join(', ') }] : []
	})

	useEffect(() => {
		if (!open) return

		function onPointerDown(event: PointerEvent) {
			clearTimeout(clearPointerGuardTimerRef.current)
			pointerStartedInsideRef.current = event.composedPath().includes(rootRef.current as EventTarget)
			if (!pointerStartedInsideRef.current) setOpen(false)
		}

		function onPointerUp() {
			clearPointerGuardTimerRef.current = setTimeout(() => {
				pointerStartedInsideRef.current = false
				clearPointerGuardTimerRef.current = undefined
			}, 0)
		}

		function onPointerCancel() {
			clearTimeout(clearPointerGuardTimerRef.current)
			clearPointerGuardTimerRef.current = undefined
			pointerStartedInsideRef.current = false
		}

		function onFocusIn(event: FocusEvent) {
			if (pointerStartedInsideRef.current) return
			if (!event.composedPath().includes(rootRef.current as EventTarget)) setOpen(false)
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			setOpen(false)
			triggerRef.current?.focus()
		}

		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('pointerup', onPointerUp)
		document.addEventListener('pointercancel', onPointerCancel)
		document.addEventListener('focusin', onFocusIn)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('pointerup', onPointerUp)
			document.removeEventListener('pointercancel', onPointerCancel)
			document.removeEventListener('focusin', onFocusIn)
			document.removeEventListener('keydown', onKeyDown)
			clearTimeout(clearPointerGuardTimerRef.current)
			clearPointerGuardTimerRef.current = undefined
			pointerStartedInsideRef.current = false
		}
	}, [open])

	if (addressRows.length === 0 && !message.date) return null

	return (
		<div
			ref={rootRef}
			data-slot="message-details"
			className="relative order-3 min-w-0 basis-full text-[13px] text-muted-foreground sm:order-2 sm:max-w-80 sm:shrink-0 sm:basis-auto"
		>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-controls={panelId}
				className="relative -mx-1 inline-flex min-h-7 max-w-full items-center gap-0.5 rounded-md px-1 text-left before:absolute before:-inset-x-1 before:-inset-y-2 hover:text-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="truncate sm:overflow-visible sm:text-clip sm:whitespace-nowrap">
					to {recipientLabel}
				</span>
				<ChevronDown className={cn('h-3 w-3 shrink-0', open && 'rotate-180')} />
				<span className="sr-only">{open ? 'Hide' : 'Show'} message details</span>
			</button>
			{open ? (
				<section
					id={panelId}
					aria-labelledby={labelId}
					className="z-20 mt-2 w-[calc(100vw-5.5rem)] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-sm sm:absolute sm:left-0 sm:top-full sm:w-96 sm:max-w-[calc(100vw-6rem)]"
				>
					<h2 id={labelId} className="mb-3 font-display text-sm font-semibold text-foreground">
						Message details
					</h2>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
						{addressRows.map((row) => (
							<div key={row.label} className="contents">
								<dt className="font-medium text-foreground">{row.label}</dt>
								<dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{row.value}</dd>
							</div>
						))}
						{message.date ? (
							<div className="contents">
								<dt className="font-medium text-foreground">Date</dt>
								<dd className="text-muted-foreground tabular-nums">
									<ClientMessageTime epochSeconds={message.date} />
								</dd>
							</div>
						) : null}
					</dl>
				</section>
			) : null}
		</div>
	)
}

function formatParticipant(participant: { email: string; name?: string }): string {
	return participant.name ? `${participant.name} <${participant.email}>` : participant.email
}

function MessageAttachments({ message }: { message: MailMessage }) {
	const attachments = (message.attachments ?? []).filter((attachment) => !attachment.is_inline)
	if (attachments.length === 0) return null
	const from = message.from?.[0]
	const fromLabel = from?.name || from?.email || '(unknown sender)'
	return (
		<section className="mt-4" aria-label={`Attachments from ${fromLabel}`}>
			<div className="flex min-w-0 flex-wrap gap-2">
				{attachments.map((attachment) => (
					<AttachmentLink
						key={attachment.id}
						attachment={attachment}
						messageId={message.id}
						attribution={fromLabel}
					/>
				))}
			</div>
		</section>
	)
}

export { formatSize }
