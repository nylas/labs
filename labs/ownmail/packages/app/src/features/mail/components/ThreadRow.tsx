import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query'
import {
	AlertTriangle,
	BellOff,
	Calendar,
	Check,
	Clock,
	CornerDownRight,
	Paperclip,
	Reply,
	Star,
} from 'lucide-react'
import { type ReactNode, useContext, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CalendarInvitationDetails } from '#features/calendar/server/calendar-invitation-fns'
import { calendarKeys } from '#features/calendar/state/calendar-keys'
import { getThreadMessages } from '#server/fns'
import { cn } from '#shared/lib/utils'
import {
	messageBodyParagraphs,
	STAR_FILLED_CLASS,
	STAR_HOVER_CLASS,
	threadSender,
	threadTimestamp,
} from '../lib/mail-ui-model.js'
import {
	inviteWhenLabel,
	pendingSendAt,
	type RowWho,
	sendAtLabel,
	type ThreadRowFacts,
	threadRowFacts,
	threadRowLabel,
	wantsUnreadSummary,
} from '../lib/thread-list-model.js'
import { bounceFor } from '../lib/thread-reading-model.js'
import { getThreadUnreadSummary } from '../server/thread-list-functions.js'
import {
	type MailThread,
	type MailThreadDetail,
	mailKeys,
	threadDetailQueryOptions,
	toMailThreadDetail,
} from '../state/mail-queries.js'
import { useCompose } from './ComposeProvider.js'
import { useSeen, useThreadListEnv } from './ThreadListGroups.js'
import { ThreadRowTime } from './ThreadRowTime.js'

/**
 * Shared class for a thread-list row. Its 16px inline padding is the left edge
 * the list title shares. The row grid, its density variants, and
 * active/unread/hover states all come from `.thread-row` in `styles.css`, so
 * every list that uses this class and `ThreadRowLayout` follows the list
 * density preference.
 */
export const THREAD_ROW_CLASS =
	'thread-row group isolate w-full cursor-pointer border-b border-list-line px-4 py-3 text-left outline-none focus-visible:bg-accent'

/** A route-specific link can stretch across the row while remaining a sibling of row actions. */
export const THREAD_ROW_LINK_CLASS =
	'thread-row-link absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-[-2px] forced-colors:focus-visible:outline-solid'

/** A control that sits inside a row, above its stretched link. */
const ROW_CONTROL_CLASS = 'pointer-events-auto relative z-20'

/** The small outlined buttons inside a row: Accept, Decline, Edit and resend. */
const MINI_BUTTON_CLASS = cn(
	ROW_CONTROL_CLASS,
	'thread-row-mini inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-cta-line bg-card text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
)

export function threadRowLinkLabel(thread: MailThread, folderId: string) {
	return `Open ${thread.subject || '(no subject)'} from ${threadSender(thread, folderId)}`
}

/**
 * The cells every thread-list row shares: sender, time, subject and snippet,
 * with an optional leading control (a selection checkbox), a star beside the
 * time, a line that stands in for the snippet (an invitation, a send that
 * failed), and signal pills. `.thread-row` arranges them as three lines
 * (Default), two lines (Compact), or one line (Condensed); the narrower
 * densities keep only the first signal. Labels stay in the reader.
 */
export function ThreadRowLayout({
	leading,
	sender,
	tone,
	unread = false,
	hasAttachments = false,
	epochSeconds,
	when,
	star,
	subject,
	subjectIsStandIn = false,
	subjectClassName,
	snippetFrom,
	snippet,
	detail,
	signals = [],
	collapsedSignal,
}: {
	leading?: ReactNode
	sender: ReactNode
	/** How the row reads at a glance: a send that failed, a muted conversation, or one asking you. */
	tone?: 'failed' | 'muted' | 'asks'
	unread?: boolean
	/** A paperclip beside the time, for a row whose file is not named in a pill. */
	hasAttachments?: boolean
	epochSeconds?: number
	/** Replaces the time, as "Sends Mon 9:00 AM" does. */
	when?: ReactNode
	star?: ReactNode
	subject: string | undefined
	/** The subject is the first line standing in for a missing one, and looks it. */
	subjectIsStandIn?: boolean
	subjectClassName?: string
	/** "you" (with the reply glyph) or a first name: who the snippet is from. */
	snippetFrom?: string
	snippet: string | undefined
	/** Stands in for the snippet in the Default density. */
	detail?: ReactNode
	signals?: ReactNode[]
	/** What the Compact and Condensed rows show in place of `detail`. */
	collapsedSignal?: ReactNode
}) {
	const { now, tz, grouped } = useThreadListEnv()
	const single = signals.length === 1 ? signals[0] : null
	const firstOfMany = signals.length > 1 ? signals[0] : null
	const collapsed = collapsedSignal ?? firstOfMany
	return (
		<>
			{leading ? <span className="thread-row-lead pointer-events-none relative z-10">{leading}</span> : null}
			<span
				data-tone={tone}
				className={cn(
					'thread-row-sender pointer-events-none relative z-10 min-w-0 truncate text-sm',
					unread ? 'font-semibold text-foreground' : 'font-normal text-foreground',
					tone === 'muted' && 'text-muted-foreground',
				)}
			>
				{sender}
			</span>
			<span className="thread-row-when pointer-events-none relative z-10">
				{star}
				{when ?? (
					<>
						{hasAttachments ? (
							<Paperclip
								role="img"
								aria-label="Has attachments"
								className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
							/>
						) : null}
						<ThreadRowTime
							epochSeconds={epochSeconds}
							now={now}
							tz={tz}
							grouped={grouped}
							className={cn('text-xs', unread ? 'font-semibold text-cta-icon' : 'text-muted-foreground')}
						/>
					</>
				)}
			</span>
			<div className="thread-row-text pointer-events-none relative z-10">
				<span className="thread-row-summary">
					<span
						data-stand-in={subjectIsStandIn || undefined}
						className={cn(
							'thread-row-subject text-sm',
							unread ? 'font-semibold text-foreground' : 'text-foreground',
							subjectClassName,
						)}
					>
						{subject || '(no subject)'}
					</span>
					<span
						className="thread-row-snippet text-[13px] text-muted-foreground"
						data-replaced={detail ? '' : undefined}
					>
						{snippetFrom === 'you' ? (
							<>
								<Reply aria-hidden="true" className="thread-row-snippet-icon h-3.5 w-3.5" />
								You:{' '}
							</>
						) : snippetFrom ? (
							`${snippetFrom}: `
						) : null}
						{snippet}
					</span>
				</span>
				{detail ? <div className="thread-row-detail">{detail}</div> : null}
				{single || collapsed ? (
					<span className="thread-row-labels">
						{single}
						{collapsed ? <span className="thread-row-signal-collapsed">{collapsed}</span> : null}
					</span>
				) : null}
				{signals.length > 1 ? <span className="thread-row-signals">{signals}</span> : null}
			</div>
		</>
	)
}

/** A signal pill: what changes what you do next, as a glyph and a word. */
export function ThreadSignal({
	tone,
	children,
}: {
	tone: 'new' | 'ask' | 'file' | 'invite' | 'failed'
	children: ReactNode
}) {
	return (
		<span
			data-signal={tone}
			className={cn(
				'thread-signal',
				tone === 'new' && 'bg-primary font-data text-primary-foreground tabular-nums',
				tone === 'ask' && 'bg-signal-ask text-signal-ask-foreground',
				(tone === 'file' || tone === 'invite') && 'thread-signal-quiet bg-muted',
				tone === 'failed' && 'bg-danger-soft text-danger-soft-foreground',
			)}
		>
			{children}
		</span>
	)
}

/**
 * A failed action on this row, shown inside the row it concerns. The owning
 * row component holds the message, so it can never appear on another row.
 */
export function ThreadRowError({ message }: { message: string | null }) {
	return message ? (
		<p
			role="alert"
			className="pointer-events-none relative z-10 col-span-full text-xs font-medium text-destructive"
		>
			{message}
		</p>
	) : null
}

/** Rows outside a query client (isolated screens) read nothing from the network. */
const OFFLINE_CLIENT = new QueryClient()

const fetchThreadDetail = (threadId: string) => getThreadMessages({ data: { threadId } })

const NO_IDS: ReadonlySet<string> = new Set()

const noSubscription = () => () => {}
const inBrowser = () => true
const onServer = () => false

/** The unread messages of the conversation as the reader loaded it, if it has and any were. */
function unreadInReader(client: QueryClient, threadId: string): number | undefined {
	const detail = client.getQueryData<MailThreadDetail>(mailKeys.threadDetail(threadId))
	const count = detail?.messages.filter((message) => message.unread).length
	return count ? count : undefined
}

/**
 * A row's unread count and newest file, from one light lookup per thread.
 * Keyed by the newest message, so new mail asks again; otherwise it is asked
 * once (a read row hides its count, and focus never refetches it).
 */
export function threadUnreadSummaryQueryOptions(thread: MailThread) {
	return {
		queryKey: [
			...mailKeys.all,
			'thread-unread-summary',
			thread.id,
			thread.latest_draft_or_message?.id ?? '',
		] as const,
		queryFn: () => getThreadUnreadSummary({ data: { threadId: thread.id } }),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
	}
}

/** "Mary, Grace, Alan, you +1", "Draft · to Bright Smile Dental", "To Grace Hopper", "eng-all@ · 31 people". */
function RowSender({ who, fallback, muted = false }: { who: RowWho; fallback: string; muted?: boolean }) {
	if (who.kind === 'draft') {
		return (
			<>
				<span className="font-semibold text-danger-soft-foreground">Draft</span> · to {who.to}
			</>
		)
	}
	if (who.kind === 'to') return <>To {who.name}</>
	const people = (
		<>
			{who.kind === 'list' ? `${who.list} · ${who.people} people` : who.names || fallback}
			{who.kind === 'people' && who.more > 0 ? (
				<span className="font-normal text-muted-foreground"> +{who.more}</span>
			) : null}
		</>
	)
	// A muted conversation, a list's or anyone's, leads with the bell that says so.
	if (who.kind === 'list' || muted) {
		return (
			<span className="thread-row-list-who inline-flex min-w-0 items-center align-bottom">
				<BellOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
				<span className="sr-only">Muted: </span>
				<span className="truncate">{people}</span>
			</span>
		)
	}
	return people
}

/**
 * The visible content and secondary star action for a thread-list row. Callers place a
 * stretched route link before this content so the link and button remain semantic siblings,
 * and name it by `labelId`: the row renders that name, with every state the row shows.
 */
export function ThreadRowContent({
	thread,
	folderId,
	onToggleStar,
	starPending = false,
	selection,
	heldUnread = false,
	labelId,
}: {
	thread: MailThread
	folderId: string
	onToggleStar: () => void
	starPending?: boolean
	selection?: { checked: boolean; disabled: boolean; onToggle: () => void }
	/**
	 * The conversation is open and was unread when it opened: its row keeps
	 * reading as unread, with what was new, until another one opens.
	 */
	heldUnread?: boolean
	/** The id of the name the row's link reads out (`aria-labelledby`). */
	labelId?: string
}) {
	const env = useThreadListEnv()
	const contextClient = useContext(QueryClientContext)
	const client = contextClient ?? OFFLINE_CLIENT
	const probe = useRef<HTMLSpanElement>(null)
	const shownThread = useMemo(
		() => (heldUnread && !thread.unread ? { ...thread, unread: true } : thread),
		[heldUnread, thread],
	)
	const mutedHere = env.mutedIds.has(thread.id)
	// A muted row shows no signals, so it looks nothing up.
	const wantsSummary = Boolean(contextClient) && !mutedHere && wantsUnreadSummary(shownThread)
	const seen = useSeen(probe, wantsSummary)
	const summary = useQuery(
		{ ...threadUnreadSummaryQueryOptions(thread), enabled: wantsSummary && seen },
		client,
	).data
	// Facts are worked out again only when the thread, the owner, its muting, or
	// whether its scheduled send is still ahead changes, never on the list's
	// minute tick: a scheduled send is the only fact that reads the clock.
	const { owner, ownerFirstName } = env
	const scheduled = pendingSendAt(thread.latest_draft_or_message, env.now) !== undefined
	const computed = useMemo(
		() =>
			threadRowFacts(
				shownThread,
				{
					owner,
					ownerFirstName,
					mutedIds: mutedHere ? new Set([shownThread.id]) : NO_IDS,
					now: scheduled ? 0 : Number.POSITIVE_INFINITY,
				},
				summary,
			),
		[shownThread, owner, ownerFirstName, mutedHere, scheduled, summary],
	)
	// What was new when the conversation opened stays on its row while it is open,
	// even once the provider reports those messages read. A conversation opened
	// before its row looked (a link) counts the messages the reader loaded unread,
	// once in the browser: the server's cache can hold them before the browser's does.
	const mounted = useSyncExternalStore(noSubscription, inBrowser, onServer)
	const lastNewCount = useRef<number | undefined>(undefined)
	if (computed.newCount !== undefined) lastNewCount.current = computed.newCount
	else if (!heldUnread && !thread.unread) lastNewCount.current = undefined
	else if (mounted && heldUnread && lastNewCount.current === undefined && wantsUnreadSummary(shownThread)) {
		lastNewCount.current = unreadInReader(client, thread.id)
	}
	const facts: ThreadRowFacts =
		heldUnread && computed.newCount === undefined && lastNewCount.current !== undefined
			? { ...computed, newCount: lastNewCount.current }
			: computed
	const muted = facts.state === 'muted'
	const signals = muted ? [] : rowSignals(facts)
	const sendAtText = facts.sendAt !== undefined ? sendAtLabel(facts.sendAt, env.now, env.tz) : undefined
	return (
		<>
			<span ref={probe} aria-hidden="true" className="thread-row-probe" />
			{labelId ? (
				<span id={labelId} className="thread-row-name" hidden>
					{threadRowLabel(facts, sendAtText)}
				</span>
			) : null}
			<ThreadRowLayout
				leading={
					selection ? (
						<label
							className={cn(
								ROW_CONTROL_CLASS,
								'-m-3 inline-flex h-11 w-11 cursor-pointer items-center justify-center',
							)}
						>
							<input
								type="checkbox"
								checked={selection.checked}
								disabled={selection.disabled}
								onChange={selection.onToggle}
								aria-label={`Select ${facts.subject || '(no subject)'}`}
								className="h-4 w-4 accent-primary"
							/>
						</label>
					) : undefined
				}
				star={
					selection ? undefined : (
						<button
							type="button"
							disabled={starPending}
							data-starred={thread.starred ? 'true' : undefined}
							onClick={(event) => {
								event.preventDefault()
								event.stopPropagation()
								onToggleStar()
							}}
							aria-label={thread.starred ? 'Unstar' : 'Star'}
							aria-busy={starPending || undefined}
							className={cn(
								'thread-row-star touch-target-square -m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted press focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:cursor-wait disabled:opacity-50 lg:-m-2 lg:h-8 lg:w-8',
								ROW_CONTROL_CLASS,
								STAR_HOVER_CLASS,
							)}
						>
							<Star aria-hidden="true" className={cn('h-3.5 w-3.5', thread.starred && STAR_FILLED_CLASS)} />
						</button>
					)
				}
				sender={<RowSender who={facts.who} fallback={threadSender(thread, folderId)} muted={muted} />}
				tone={facts.state === 'failed' ? 'failed' : muted ? 'muted' : facts.asksYou ? 'asks' : undefined}
				unread={facts.unread}
				hasAttachments={Boolean(thread.has_attachments) && !facts.file && !facts.invite && !muted}
				epochSeconds={threadTimestamp(thread)}
				when={
					sendAtText !== undefined ? (
						<span className="inline-flex items-center gap-1 whitespace-nowrap font-data text-xs text-muted-foreground tabular-nums">
							<Clock aria-hidden="true" className="h-3 w-3" />
							{sendAtText}
						</span>
					) : undefined
				}
				subject={facts.subject}
				subjectIsStandIn={facts.subjectIsStandIn === true}
				subjectClassName={muted ? 'thread-row-subject-quiet' : undefined}
				snippetFrom={facts.snippetFrom}
				snippet={facts.snippet}
				detail={
					facts.state === 'failed' ? (
						<FailedSendLine threadId={thread.id} client={contextClient} />
					) : facts.invite && !muted ? (
						<InviteLine invite={facts.invite} tz={env.tz} client={contextClient} />
					) : undefined
				}
				collapsedSignal={
					// One or two lines keep what the detail line says as a pill, never as colour alone.
					facts.state === 'failed' ? (
						<ThreadSignal tone="failed">
							<AlertTriangle aria-hidden="true" className="h-3 w-3" />
							Not sent
						</ThreadSignal>
					) : facts.invite && !muted && facts.state === 'normal' ? (
						<ThreadSignal tone="invite">
							<Calendar aria-hidden="true" className="h-3 w-3" />
							Invite
						</ThreadSignal>
					) : undefined
				}
				signals={facts.invite ? [] : signals}
			/>
		</>
	)
}

/** "3 new", "Asks you", then the newest file: the order the board reads them. */
function rowSignals(facts: ThreadRowFacts): ReactNode[] {
	const signals: ReactNode[] = []
	if (facts.newCount) {
		signals.push(
			<ThreadSignal key="new" tone="new">
				{facts.newCount} new
			</ThreadSignal>,
		)
	}
	if (facts.asksYou) {
		signals.push(
			<ThreadSignal key="ask" tone="ask">
				<CornerDownRight aria-hidden="true" className="h-3 w-3" />
				Asks you
			</ThreadSignal>,
		)
	}
	if (facts.file) {
		signals.push(
			<ThreadSignal key="file" tone="file">
				<Paperclip aria-hidden="true" className="h-3 w-3" />
				<span className="truncate">{facts.file}</span>
			</ThreadSignal>,
		)
	}
	return signals
}

async function loadThread(client: QueryClient | undefined, threadId: string): Promise<MailThreadDetail> {
	if (client) return client.ensureQueryData(threadDetailQueryOptions(threadId, fetchThreadDetail))
	return toMailThreadDetail(await fetchThreadDetail(threadId))
}

/**
 * "Not sent. The address bounced." with Edit and resend, which opens the
 * composer on the message that bounced: its recipient, subject and text.
 */
function FailedSendLine({ threadId, client }: { threadId: string; client: QueryClient | undefined }) {
	const { openCompose } = useCompose()
	const [pending, setPending] = useState(false)
	const [failed, setFailed] = useState(false)
	async function editAndResend() {
		setPending(true)
		setFailed(false)
		try {
			const detail = await loadThread(client, threadId)
			const bounce = bounceFor(detail.messages, detail.mailboxEmail).at(-1)
			const original = detail.messages.find((message) => message.id === bounce?.originalId)
			if (!bounce || !original) throw new Error('No message to resend.')
			await openCompose({
				kind: 'new',
				to: bounce.address,
				subject: original.subject ?? '',
				body: messageBodyParagraphs(original).join('\n\n'),
			})
		} catch {
			setFailed(true)
		} finally {
			setPending(false)
		}
	}
	return (
		<span className="thread-row-failed flex items-center gap-cluster text-[13px]">
			<AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
			<span className="min-w-0 flex-1 truncate">
				{failed ? 'Couldn’t open the message. Try again.' : 'Not sent. The address bounced.'}
			</span>
			<button
				type="button"
				className={MINI_BUTTON_CLASS}
				disabled={pending}
				aria-busy={pending || undefined}
				onClick={(event) => {
					event.preventDefault()
					event.stopPropagation()
					void editAndResend()
				}}
			>
				Edit and resend
			</button>
		</span>
	)
}

/** The invitation card's own recheck while a provider event syncs. */
const INVITE_SYNC_RETRY_MS = 2_000
const INVITE_SYNC_LOOKUPS = 5

/**
 * An invitation's time with Accept and Decline, answered through the same
 * calendar functions and cache entry as the invitation card in the reader.
 * The invitation is looked up once the row has been on screen.
 */
function InviteLine({
	invite,
	tz,
	client,
}: {
	invite: { messageId: string; attachmentId: string }
	tz: string
	client: QueryClient | undefined
}) {
	const { messageId, attachmentId } = invite
	const queryClient = client ?? OFFLINE_CLIENT
	const ref = useRef<HTMLSpanElement>(null)
	const seen = useSeen(ref, Boolean(client))
	const queryKey = calendarKeys.invitation(messageId, attachmentId)
	const invitation = useQuery(
		{
			queryKey,
			queryFn: async () => {
				const { getCalendarInvitation } = await import('#features/calendar/server/calendar-invitation-fns')
				return getCalendarInvitation({ data: { messageId, attachmentId } })
			},
			staleTime: 30_000,
			retry: false,
			enabled: Boolean(client) && seen,
			// As the invitation card does: recheck briefly while the provider's event
			// catches up with the email, and never after a failed lookup.
			refetchInterval: (query) =>
				(query.state.data?.state === 'syncing' || query.state.data?.state === 'cancelling') &&
				query.state.errorUpdateCount === 0 &&
				query.state.dataUpdateCount < INVITE_SYNC_LOOKUPS
					? INVITE_SYNC_RETRY_MS
					: false,
		},
		queryClient,
	)
	const response = useMutation(
		{
			mutationFn: async (status: 'yes' | 'no') => {
				const { respondCalendarInvitation } = await import(
					'#features/calendar/server/calendar-invitation-fns'
				)
				return respondCalendarInvitation({ data: { messageId, attachmentId, status } })
			},
			onSuccess: (receipt) => {
				queryClient.setQueryData<CalendarInvitationDetails>(queryKey, (current) =>
					current?.state === 'ready' ? { ...current, status: receipt.status } : current,
				)
				void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges(), refetchType: 'active' })
			},
		},
		queryClient,
	)
	const details = invitation.data
	const ready = details?.state === 'ready' ? details : undefined
	const label = ready
		? inviteWhenLabel(ready.when, tz)
		: details?.state === 'cancelled'
			? 'Invitation cancelled'
			: 'Calendar invitation'
	// The answers wait, disabled, while the invitation loads. A failed lookup, or
	// one the calendar cannot answer, offers none: the reader's card explains why.
	const answerable = (!details && !invitation.isError) || (ready !== undefined && ready.canRespond !== false)
	return (
		<span ref={ref} className="thread-row-invite flex items-center gap-cluster">
			<span className="thread-row-invite-when flex min-w-0 flex-1 items-center text-[13px]">
				<Calendar aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
				<span className="truncate font-data tabular-nums">{label}</span>
			</span>
			{response.isError ? (
				<span role="alert" className="shrink-0 text-xs text-destructive">
					Not saved
				</span>
			) : null}
			{answerable ? (
				<fieldset className="flex shrink-0 gap-cluster border-0 p-0" disabled={!ready || response.isPending}>
					<legend className="sr-only">Respond to {ready?.title ?? 'invitation'}</legend>
					{(['yes', 'no'] as const).map((status) => {
						const selected = ready?.status === status
						return (
							<button
								key={status}
								type="button"
								aria-pressed={selected}
								onClick={(event) => {
									event.preventDefault()
									event.stopPropagation()
									response.mutate(status)
								}}
								className={cn(
									MINI_BUTTON_CLASS,
									status === 'no' && !selected && 'font-medium text-muted-foreground',
									selected && 'bg-muted',
								)}
							>
								{selected ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
								{status === 'yes' ? 'Accept' : 'Decline'}
							</button>
						)
					})}
				</fieldset>
			) : null}
		</span>
	)
}
