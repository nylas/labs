import { ChevronDown, ChevronUp, Download, Forward, Quote, Reply } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useMounted } from '#shared/components/ClientTime'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '#shared/components/ui/context-menu'
import { GLASS_PANEL_FROM_SM_CLASS } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'
import { headerSenderName, headerTimeLabel, longDateLabel } from '../lib/message-anatomy.js'
import { firstName, recipientSummary, senderPerson } from '../lib/thread-reading-model.js'
import type { MailMessage, MessageHeaderFacts } from '../state/mail-queries.js'
import { Avatar } from './Avatar.js'
import { MessageDetailsPanel } from './MessageDetailsPanel.js'
import { SenderContactCard } from './SenderContactCard.js'

export type MessageHeaderActions = { onReply(): void; onForward(): void; onQuote(): void }

/** The reader's IANA time zone, or UTC where the runtime has none. */
function viewerTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Popovers inside the header row whose clicks are their own, not the row's. */
const HEADER_POPOVERS = '[data-slot="message-details-popover"], [data-slot="sender-contact-card"]'

/** Out of sight until it has keyboard focus; the board's header shows no collapse control. */
const collapseButtonClass =
	'sr-only shrink-0 rounded-md text-foreground/75 outline-none hover:bg-muted hover:text-foreground focus-visible:not-sr-only focus-visible:inline-flex focus-visible:size-7 focus-visible:items-center focus-visible:justify-center focus-visible:ring-2 focus-visible:ring-ring'

const actionButtonClass =
	'touch-target inline-flex size-7 items-center justify-center rounded-md text-foreground/75 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

function HeaderAction({
	label,
	onClick,
	children,
}: {
	label: string
	onClick: () => void
	children: ReactNode
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			// Keeps the reader's text selection, which "Quote selection in reply" needs.
			onMouseDown={(event) => event.preventDefault()}
			className={actionButtonClass}
		>
			{children}
		</button>
	)
}

/**
 * One open message's header (boards 01 and 05): a 32px avatar, the sender's
 * name (hover or focus it for their card), a short recipient summary that
 * opens the full details, and the time. Reply, Forward and Quote appear as a
 * small group when the header is hovered or holds focus; on touch screens they
 * stay visible. The summary is set in the normal text colour only when the
 * recipients changed from the message before (`prev`, passed only when that
 * message sits open directly above).
 *
 * Clicking the header's empty space collapses an open message, and a
 * "Collapse message" button, shown when it has keyboard focus, does the same
 * from the keyboard; a collapsed header is one button that opens it. Its
 * right-click menu mirrors these actions and adds the raw download. The
 * details panel follows the summary in the document, so Tab moves into it.
 */
export function MessageHeader({
	message,
	prev,
	owner,
	facts,
	expanded,
	onToggle,
	actions,
	headingId,
	contentId,
	senderFlagged = false,
	listSizes,
}: {
	message: MailMessage
	prev?: MailMessage
	owner: string
	facts?: MessageHeaderFacts
	expanded: boolean
	onToggle(): void
	actions: MessageHeaderActions
	/** Id for the sender heading, so the message can be labelled by it. */
	headingId?: string
	/** Id of the message body this header opens and collapses. */
	contentId?: string
	/** The sender only looks like someone known (see `isLookalikeSender`); failed checks come from `facts`. */
	senderFlagged?: boolean
	/** Member counts of mailing lists, keyed by lower-case address: "pm-leads@ · 12". */
	listSizes?: Readonly<Record<string, number>>
}) {
	const mounted = useMounted()
	const ownHeadingId = useId()
	const detailsId = useId()
	const [detailsOpen, setDetailsOpen] = useState(false)
	const detailsButtonRef = useRef<HTMLButtonElement>(null)
	const detailsRef = useRef<HTMLDivElement>(null)
	const sender = senderPerson(message, owner)
	const name = headerSenderName(message, owner)
	const summary = recipientSummary(message, prev, owner)
	const showDetails = expanded && detailsOpen
	const tz = mounted ? viewerTimeZone() : 'UTC'
	const time = message.date && mounted ? headerTimeLabel(message.date, Date.now(), tz) : ''
	const downloadHref =
		message.ownmailDraft !== true ? `/messages/${encodeURIComponent(message.id)}/download` : undefined

	useDismiss(showDetails, [detailsButtonRef, detailsRef], () => setDetailsOpen(false), detailsButtonRef)

	function onRowClick(event: MouseEvent<HTMLDivElement>) {
		if (!expanded) return
		const target = event.target as HTMLElement
		if (target.closest(`button, a, input, [role="dialog"], ${HEADER_POPOVERS}`)) return
		if (window.getSelection()?.toString()) return
		onToggle()
	}

	const timeElement = message.date ? (
		<time
			dateTime={new Date(message.date * 1000).toISOString()}
			title={mounted ? longDateLabel(message.date, tz) : undefined}
			className="font-data text-xs whitespace-nowrap tabular-nums text-muted-foreground"
			suppressHydrationWarning
		>
			{time || ' '}
		</time>
	) : null

	const headingClass = 'text-[15px] leading-snug font-semibold text-foreground'
	// The card sits beside the heading, not in it, so the heading names only the sender.
	const nameElement =
		sender.isOwner || !expanded ? (
			<h2 id={headingId ?? ownHeadingId} className={cn('flex min-w-0', headingClass)}>
				<span className="truncate">{name}</span>
			</h2>
		) : (
			<SenderContactCard
				message={message}
				heading={{ id: headingId ?? ownHeadingId, className: headingClass }}
				suspicious={senderFlagged || facts?.authFailed === true}
			>
				{name}
			</SenderContactCard>
		)

	return (
		<div
			data-slot="message-header"
			data-state={expanded ? 'open' : 'collapsed'}
			className="group/header relative"
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					{/* Clicking the header's own space is a pointer shortcut for collapsing; the collapse button and the menu are the keyboard paths. */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: see above */}
					<div
						data-slot="message-header-row"
						className={cn(
							'message-header-row relative flex min-w-0 items-center gap-3',
							// On a phone the panel opens in the flow under the summary; the avatar stays at the top.
							showDetails && 'max-sm:items-start',
						)}
						onClick={onRowClick}
					>
						<Avatar person={sender} size={32} />
						<div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-baseline md:gap-2">
							{nameElement}
							<div className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground md:text-[13px]">
								{expanded ? (
									<button
										ref={detailsButtonRef}
										type="button"
										data-slot="recipient-summary"
										data-changed={summary.changed || undefined}
										aria-expanded={showDetails}
										aria-controls={showDetails ? detailsId : undefined}
										onClick={() => setDetailsOpen((open) => !open)}
										className={cn(
											'inline-flex min-w-0 items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
											summary.changed && 'text-foreground',
										)}
									>
										<span className="truncate">{summary.text}</span>
										<ChevronDown
											aria-hidden="true"
											className={cn(
												'size-3 shrink-0',
												showDetails
													? 'rotate-180'
													: 'hidden md:inline md:opacity-0 md:group-focus-within/header:opacity-100 md:group-hover/header:opacity-100',
											)}
										/>
										<span className="sr-only">{showDetails ? 'Hide' : 'Show'} message details</span>
									</button>
								) : (
									<span className="truncate">{summary.text}</span>
								)}
								{timeElement ? (
									<span className="shrink-0 md:hidden">
										<span aria-hidden="true">· </span>
										{timeElement}
									</span>
								) : null}
							</div>
							{showDetails ? (
								// biome-ignore lint/a11y/noStaticElementInteractions: only keeps the header's right-click menu out of the panel, so its text can be copied
								<div
									ref={detailsRef}
									data-slot="message-details-popover"
									onContextMenu={(event) => event.stopPropagation()}
									// In the flow on a phone, so flat there; it floats, as glass, from `sm` up, under the summary.
									className={cn(
										'z-20 mt-2 sm:absolute sm:top-full sm:left-11 sm:max-h-[min(36rem,70vh)] sm:w-[428px] sm:max-w-[calc(100vw-6rem)] sm:overflow-y-auto',
										GLASS_PANEL_FROM_SM_CLASS,
									)}
								>
									<MessageDetailsPanel
										id={detailsId}
										message={message}
										owner={owner}
										facts={facts}
										viewerTz={tz}
										listSizes={listSizes}
									/>
								</div>
							) : null}
						</div>
						{expanded ? (
							// biome-ignore lint/a11y/useSemanticElements: a toolbar-like cluster of three buttons, not a form fieldset
							<span
								role="group"
								aria-label="Message actions"
								data-slot="message-hover-actions"
								className="hidden shrink-0 items-center gap-px rounded-lg border border-border bg-card p-px md:inline-flex md:opacity-0 md:group-focus-within/header:opacity-100 md:group-hover/header:opacity-100 [@media(hover:none)]:md:opacity-100"
							>
								<HeaderAction label={`Reply to ${firstName(sender)}`} onClick={actions.onReply}>
									<Reply className="size-3.5" aria-hidden="true" />
								</HeaderAction>
								<HeaderAction label="Forward this message" onClick={actions.onForward}>
									<Forward className="size-3.5" aria-hidden="true" />
								</HeaderAction>
								<HeaderAction label="Quote selection in reply" onClick={actions.onQuote}>
									<Quote className="size-3.5" aria-hidden="true" />
								</HeaderAction>
							</span>
						) : null}
						{expanded ? (
							<button
								type="button"
								data-slot="message-collapse"
								aria-label="Collapse message"
								aria-expanded={true}
								aria-controls={contentId}
								onClick={onToggle}
								className={collapseButtonClass}
							>
								<ChevronUp className="size-3.5" aria-hidden="true" />
							</button>
						) : (
							// A collapsed header opens from anywhere on it.
							<button
								type="button"
								data-slot="message-expand"
								aria-expanded={false}
								aria-label={`Expand message from ${name}`}
								onClick={onToggle}
								className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
						)}
						{timeElement ? <span className="hidden shrink-0 md:inline">{timeElement}</span> : null}
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent aria-label={`Actions for message from ${name}`}>
					<ContextMenuItem onSelect={onToggle}>
						<ChevronDown className={cn(expanded && 'rotate-180')} aria-hidden="true" />
						{expanded ? 'Collapse message' : 'Expand message'}
					</ContextMenuItem>
					<ContextMenuItem onSelect={actions.onReply}>
						<Reply aria-hidden="true" />
						Reply
					</ContextMenuItem>
					<ContextMenuItem onSelect={actions.onForward}>
						<Forward aria-hidden="true" />
						Forward
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
	)
}

const DIALOG_PARTS = '[data-slot="dialog-content"], [data-slot="dialog-overlay"]'

/**
 * Closes a popover on a pointer press or focus outside its parts, and on
 * Escape (returning focus to its trigger). A press that starts inside and
 * ends outside, as a text selection does, keeps it open.
 */
function useDismiss(
	open: boolean,
	parts: Array<{ current: HTMLElement | null }>,
	close: () => void,
	trigger: { current: HTMLElement | null },
) {
	const closeRef = useRef(close)
	closeRef.current = close
	const partsRef = useRef(parts)
	partsRef.current = parts

	useEffect(() => {
		if (!open) return
		let pressStartedInside = false
		const inside = (event: Event) => {
			const path = event.composedPath()
			return (
				partsRef.current.some((part) => part.current !== null && path.includes(part.current)) ||
				// The raw-headers dialog opened from the panel is portalled, but is part of it.
				path.some((node) => node instanceof Element && node.matches(DIALOG_PARTS))
			)
		}
		function onPointerDown(event: PointerEvent) {
			pressStartedInside = inside(event)
			if (!pressStartedInside) closeRef.current()
		}
		function onPointerUp() {
			setTimeout(() => {
				pressStartedInside = false
			}, 0)
		}
		function onFocusIn(event: FocusEvent) {
			if (!pressStartedInside && !inside(event)) closeRef.current()
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== 'Escape') return
			// A dialog opened from the panel handles its own Escape.
			if (document.querySelector('[data-slot="dialog-content"]')) return
			event.preventDefault()
			event.stopPropagation()
			closeRef.current()
			trigger.current?.focus()
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('pointerup', onPointerUp)
		document.addEventListener('focusin', onFocusIn)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('pointerup', onPointerUp)
			document.removeEventListener('focusin', onFocusIn)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [open, trigger])
}
