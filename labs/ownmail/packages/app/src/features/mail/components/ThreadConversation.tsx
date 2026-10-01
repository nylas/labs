/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Quiet */
import { ChevronDown, ChevronsDown, ChevronsUp, Download, Paperclip } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useUserPreferences } from '#app/preferences/user-preferences'
import { ClientMessageTime } from '#shared/components/ClientTime'
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
import { CalendarInvitationCard } from './CalendarInvitationCard.js'
import type { EmailDisplayStatus } from './EmailHtml.js'
import { MessageBody } from './MessageBody.js'
import { ThreadColumn } from './ThreadColumn.js'
import { ThreadDisplayMenu } from './ThreadDisplayMenu.js'

/**
 * The canonical thread reader: subject header, thread-level attachments, and the
 * expandable message list. Shared by the folder thread route, the compose backdrop,
 * and search results so there is a single reading-pane implementation.
 */
export function ThreadConversation({ thread, messages }: { thread: MailThread; messages: MailMessage[] }) {
	return <ThreadConversationController key={thread.id} thread={thread} messages={messages} />
}

function ThreadConversationController({ thread, messages }: { thread: MailThread; messages: MailMessage[] }) {
	const [preferences, savePreferences] = useUserPreferences()
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
		void originalColorSenders().then((senders) => {
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
		if (await setSenderOriginalColors(address, enabled)) return
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
		const trusted = await trustSenderImages(address)
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
			displayStatuses={displayStatuses}
			layoutMode={preferences.emailLayoutMode}
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
		/>
	)
}

function ThreadConversationContent({
	thread,
	messages,
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
}: {
	thread: MailThread
	messages: MailMessage[]
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
	onLayoutModeChange: (mode: EmailLayoutMode) => void
	onColorModeChange: (mode: EmailColorMode) => void
	onShowThreadImages: () => void
	onAlwaysShowImages: () => void
	onTrustSender: (address: string) => void
	onRetryImages: () => void
}) {
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

	return (
		<div data-slot="thread-conversation" className="min-h-full bg-background">
			<header
				data-slot="thread-summary"
				className="border-b border-border bg-background py-3 xl:sticky xl:top-0 xl:z-10 xl:py-5"
			>
				<ThreadColumn>
					<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 xl:flex xl:flex-wrap xl:justify-between xl:gap-x-4 xl:gap-y-3">
						<div className="flex min-w-0 flex-col items-start gap-2 xl:flex-row xl:flex-wrap xl:gap-x-3 xl:gap-y-2">
							<h1 className="min-w-0 font-display text-lg leading-6 font-semibold text-balance [overflow-wrap:anywhere] xl:text-xl xl:leading-normal 2xl:text-2xl">
								{thread.subject || '(no subject)'}
							</h1>
							{labels.length > 0 ? (
								<div className="flex min-w-0 flex-wrap gap-1.5">
									{labels.map((label) => (
										<span key={label.id} className={cn('text-xs', labelBadgeClass(label.tone))}>
											{label.name}
										</span>
									))}
								</div>
							) : null}
						</div>

						<div className="flex min-w-0 shrink-0 items-center gap-0.5 xl:gap-1">
							{hasHtmlMessages ? (
								<ThreadDisplayMenu
									messages={messages}
									statuses={displayStatuses}
									layoutMode={layoutMode}
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
							{messages.length > 1 ? (
								<fieldset className="flex min-w-0 shrink-0 items-center gap-0.5 border-0 p-0 xl:gap-1">
									<legend className="sr-only">Message display controls</legend>
									<button
										type="button"
										onClick={() => setOpenMessageIds(new Set(messages.map((message) => message.id)))}
										disabled={allMessagesOpen}
										aria-label={`Expand all ${messages.length} messages`}
										title="Expand all messages"
										className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-40"
									>
										<ChevronsDown className="h-4 w-4" aria-hidden="true" />
									</button>
									<button
										type="button"
										onClick={() => setOpenMessageIds(new Set())}
										disabled={allMessagesClosed}
										aria-label={`Collapse all ${messages.length} messages`}
										title="Collapse all messages"
										className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-40"
									>
										<ChevronsUp className="h-4 w-4" aria-hidden="true" />
									</button>
								</fieldset>
							) : null}
						</div>
					</div>

					{messages.length > 1 && threadAttachments.length > 0 ? (
						<div
							data-slot="thread-attachment-summary"
							className="mt-2 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md text-sm font-medium text-muted-foreground xl:mt-4"
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
			</div>
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

	return (
		<article data-slot="thread-message" aria-labelledby={senderHeadingId}>
			<ThreadColumn>
				<div
					data-slot="message-header"
					className={cn(
						'flex min-w-0 flex-wrap items-start gap-x-3 pt-4',
						!first && 'border-t border-border',
					)}
				>
					<div
						data-slot="sender-avatar"
						className={cn(
							'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-foreground',
							open ? 'h-10 w-10 text-xs' : 'h-8 w-8 text-[11px]',
						)}
					>
						{initials(fromLabel)}
					</div>
					<div className="min-w-0 flex-1 pt-1">
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
									className="order-3 ml-auto hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline-block"
								/>
							) : null}
						</div>
						{!open ? (
							<p className="mt-1 truncate text-sm text-muted-foreground">
								{collapsedMessagePreview(message)}
							</p>
						) : null}
					</div>
					<div className="flex shrink-0 items-center gap-1">
						{message.ownmailDraft !== true ? (
							<a
								data-slot="raw-email-download"
								href={`/messages/${encodeURIComponent(message.id)}/download`}
								download
								aria-label={`Download raw email from ${fromLabel}`}
								title="Download raw email"
								className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<Download className="h-4 w-4" />
							</a>
						) : null}
						<button
							data-slot="message-toggle"
							type="button"
							onClick={onToggle}
							className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-expanded={open}
							aria-controls={contentId}
							aria-label={`${open ? 'Collapse' : 'Expand'} message from ${fromLabel}`}
							title={`${open ? 'Collapse' : 'Expand'} message`}
						>
							<ChevronDown className={cn('h-4 w-4', open && 'rotate-180')} />
						</button>
					</div>
					{message.date ? (
						<ClientMessageTime
							epochSeconds={message.date}
							className="mt-1 basis-full whitespace-nowrap pl-12 text-right text-xs leading-5 text-muted-foreground sm:hidden"
						/>
					) : null}
				</div>
			</ThreadColumn>

			{open ? (
				<div id={contentId} data-slot="expanded-message-content" className="mt-3 w-full min-w-0 pb-4">
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
			className="relative order-3 min-w-0 basis-full text-xs text-muted-foreground sm:order-2 sm:max-w-80 sm:shrink-0 sm:basis-auto"
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

type Attachment = NonNullable<MailMessage['attachments']>[number]

function AttachmentLink({
	attachment,
	messageId,
	attribution,
}: {
	attachment: Attachment
	messageId: string
	attribution: string
}) {
	const filename = attachment.filename ?? 'attachment'
	const sizeLabel = attachment.size ? formatSize(attachment.size) : undefined
	return (
		<a
			data-slot="thread-attachment"
			href={`/attachments/${encodeURIComponent(attachment.id)}?message_id=${encodeURIComponent(messageId)}`}
			aria-label={`${filename}${sizeLabel ? `, ${sizeLabel}` : ''}, attached to message from ${attribution}`}
			className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid dark:bg-muted/40 dark:hover:bg-muted"
			download={attachment.filename}
		>
			<Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span className="min-w-0 truncate font-medium">{filename}</span>
			{sizeLabel ? <span className="shrink-0 text-muted-foreground">· {sizeLabel}</span> : null}
		</a>
	)
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
