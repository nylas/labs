/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Calendar, CalendarDays, Check, Loader2, MapPin } from 'lucide-react'
import { useId, useState } from 'react'
import { firstCalendarInvitationAttachment } from '#features/calendar/lib/calendar-invitation'
import type {
	CalendarInvitationDetails,
	InvitationWhen,
} from '#features/calendar/server/calendar-invitation-fns'
import { calendarKeys } from '#features/calendar/state/calendar-keys'
import { cn } from '#shared/lib/utils'
import { clockTime, viewerZone } from '../lib/edge-states.js'
import { shortDayLabel } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { EDGE_BUTTON_CLASS, EDGE_GHOST_CLASS, EDGE_LINK_CLASS } from './edge-actions.js'

const RESPONSE_OPTIONS = [
	{ status: 'yes', label: 'Accept' },
	{ status: 'maybe', label: 'Maybe' },
	{ status: 'no', label: 'Decline' },
] as const

const SYNC_RETRY_INTERVAL_MS = 2_000
const SYNC_LOOKUP_LIMIT = 5

/**
 * The time an invitation file itself proposes. The card's details describe the
 * event as it is now, so an earlier version's own time comes from its file.
 */
function useInvitationFileTime(message: MailMessage | undefined, enabled: boolean) {
	const attachment = message ? firstCalendarInvitationAttachment(message.attachments) : undefined
	const messageId = message?.id ?? ''
	const attachmentId = attachment?.id ?? ''
	return useQuery({
		queryKey: [...calendarKeys.invitation(messageId, attachmentId), 'file-time'],
		queryFn: async () => {
			const { getInvitationFileTime } = await import('../server/invitation-file-time.js')
			return getInvitationFileTime({ data: { messageId, attachmentId } })
		},
		enabled: enabled && attachmentId !== '',
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
}

/**
 * A meeting request in a message. When the event was updated in this thread
 * (design.md "Edge states"), only the newest invitation renders this card: it
 * says how many times the event changed, shows the earlier start struck
 * through beside the current one, and keeps the earlier versions one click
 * away. `previousStartTime` is read from the newest earlier version when the
 * caller does not know it.
 */
export function CalendarInvitationCard({
	message,
	updateCount,
	previousStartTime,
	earlierVersions,
}: {
	message: MailMessage
	updateCount?: number
	previousStartTime?: number
	earlierVersions?: MailMessage[]
}) {
	const attachment = firstCalendarInvitationAttachment(message.attachments)
	if (!attachment) return null
	return (
		<CalendarInvitationContent
			key={`${message.id}:${attachment.id}`}
			messageId={message.id}
			attachmentId={attachment.id}
			history={{
				...(updateCount !== undefined ? { updateCount } : {}),
				...(previousStartTime !== undefined ? { previousStartTime } : {}),
				earlierVersions: earlierVersions ?? [],
			}}
		/>
	)
}

type InvitationHistory = { updateCount?: number; previousStartTime?: number; earlierVersions: MailMessage[] }

function CalendarInvitationContent({
	messageId,
	attachmentId,
	history,
}: {
	messageId: string
	attachmentId: string
	history: InvitationHistory
}) {
	const [versionsOpen, setVersionsOpen] = useState(false)
	const versionsId = useId()
	const previousVersion = history.earlierVersions.at(-1)
	const previous = useInvitationFileTime(previousVersion, history.previousStartTime === undefined)
	const previousStart = history.previousStartTime ?? previous.data?.start
	const queryClient = useQueryClient()
	const queryKey = calendarKeys.invitation(messageId, attachmentId)
	const invitation = useQuery({
		queryKey,
		queryFn: async () => {
			const { getCalendarInvitation } = await import('#features/calendar/server/calendar-invitation-fns')
			return getCalendarInvitation({ data: { messageId, attachmentId } })
		},
		staleTime: 30_000,
		retry: false,
		refetchInterval: (query) => {
			const details = query.state.data
			// The invitation email and its provider-created event arrive independently.
			// Recheck briefly while that race settles. Any failed automatic lookup
			// permanently hands control to the explicit retry instead of starting a loop.
			return (details?.state === 'syncing' || details?.state === 'cancelling') &&
				query.state.errorUpdateCount === 0 &&
				query.state.dataUpdateCount < SYNC_LOOKUP_LIMIT
				? SYNC_RETRY_INTERVAL_MS
				: false
		},
	})
	const response = useMutation({
		mutationFn: async (status: 'yes' | 'maybe' | 'no') => {
			const { respondCalendarInvitation } = await import('#features/calendar/server/calendar-invitation-fns')
			return respondCalendarInvitation({ data: { messageId, attachmentId, status } })
		},
		onSuccess: (receipt) => {
			queryClient.setQueryData<CalendarInvitationDetails>(queryKey, (current) => {
				/* v8 ignore next -- a successful mutation can only originate from the rendered ready state; cache removal during the request is a safe no-op */
				if (current?.state !== 'ready') return current
				return { ...current, status: receipt.status }
			})
			void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges(), refetchType: 'active' })
		},
	})
	const addInvitation = useMutation({
		mutationFn: async () => {
			const { addCalendarInvitation } = await import('#features/calendar/server/calendar-invitation-fns')
			return addCalendarInvitation({ data: { messageId, attachmentId } })
		},
		onSuccess: (details) => {
			queryClient.setQueryData<CalendarInvitationDetails>(queryKey, details)
			void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges(), refetchType: 'active' })
		},
	})

	if (invitation.isPending) {
		return (
			<section
				data-slot="calendar-invitation"
				role="status"
				aria-label="Loading calendar invitation"
				className="mb-5 flex min-h-24 items-center gap-3 rounded-xl border border-border bg-card px-4 py-4"
			>
				<Loader2 className="h-4 w-4 animate-spin text-primary" />
				<span className="text-sm text-muted-foreground">Checking your calendar…</span>
			</section>
		)
	}

	if (invitation.isError) {
		return (
			<InvitationNotice
				title="Calendar invitation unavailable"
				message="We couldn’t open this invitation. Check your connection, then try again."
				onRetry={() => void invitation.refetch()}
				retrying={invitation.isFetching}
			/>
		)
	}

	const details = invitation.data
	if (details.state === 'invalid') {
		return (
			<InvitationNotice
				title="Unsupported calendar file"
				message="This attachment isn’t a valid meeting request, so no response was sent."
			/>
		)
	}
	if (details.state === 'syncing') {
		const canAdd = details.canAdd !== false
		return (
			<InvitationNotice
				title={canAdd ? 'Adding invitation to your calendar' : 'Invitation not in your calendar yet'}
				message={
					canAdd
						? 'Nylas is still syncing this event. You can check again or add it to your calendar now.'
						: 'This event isn’t in your calendar yet, and OwnMail can’t add it from this message. Check again later, or add it from your calendar app.'
				}
				onRetry={() => void invitation.refetch()}
				retrying={invitation.isFetching}
				onAction={canAdd ? () => addInvitation.mutate() : undefined}
				actionPending={addInvitation.isPending}
				error={addInvitation.isError}
			/>
		)
	}
	if (details.state === 'cancelling') {
		return (
			<InvitationNotice
				title="Cancelling invitation"
				message="Another calendar update is finishing. We’ll check this cancellation again in a moment."
				onRetry={() => void invitation.refetch()}
				retrying={invitation.isFetching}
			/>
		)
	}
	if (details.state === 'ineligible') {
		return (
			<InvitationNotice
				title="Response unavailable"
				message="This mailbox isn’t eligible to respond to the calendar event."
			/>
		)
	}
	if (details.state === 'cancelled') {
		return (
			<InvitationNotice
				title="Invitation cancelled"
				message={
					details.manualReview
						? 'OwnMail couldn’t safely verify an older imported copy. Check your calendar and remove it if it is still there.'
						: details.removed
							? 'The organizer cancelled this event, and it has been removed from your calendar.'
							: 'The organizer cancelled this invitation. Check your calendar for the latest event status.'
				}
			/>
		)
	}
	const canRespond = details.canRespond !== false
	const anySelected = RESPONSE_OPTIONS.some((option) => option.status === details.status)
	const changed =
		previousStart !== undefined && details.when.kind === 'timed' && previousStart !== details.when.start
	return (
		<section
			data-slot="calendar-invitation"
			aria-labelledby={`invitation-title-${attachmentId}`}
			className="mb-5 flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-[13px] text-foreground"
		>
			<p className="sr-only">Calendar invitation</p>
			<div className="flex min-w-0 items-center gap-2">
				<Calendar aria-hidden="true" className="size-3.5 shrink-0" />
				<h2
					id={`invitation-title-${attachmentId}`}
					className="m-0 min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]"
				>
					{details.title}
				</h2>
				{history.updateCount ? (
					<span data-slot="invitation-updates" className="ml-auto shrink-0 text-xs text-muted-foreground">
						Updated {history.updateCount} {history.updateCount === 1 ? 'time' : 'times'}
					</span>
				) : null}
			</div>
			<p className="m-0 font-data tabular-nums">
				{formatInvitationWhen(details.when)}
				{changed ? (
					<>
						{' '}
						<s data-slot="invitation-previous-time" className="text-muted-foreground">
							<span className="sr-only">was </span>
							{previousTimeLabel(previousStart, (details.when as { start: number }).start)}
						</s>
					</>
				) : null}
			</p>
			<p className="m-0 flex min-w-0 flex-wrap gap-x-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
				<span>From {details.organizer}</span>
				{details.location ? (
					<>
						<span aria-hidden="true">·</span>
						<span className="inline-flex items-center gap-1">
							<MapPin aria-hidden="true" className="size-3 shrink-0" />
							{details.location}
						</span>
					</>
				) : null}
			</p>

			<ConflictNotice conflicts={details.conflicts} />

			<div className="flex flex-wrap items-center gap-2">
				{canRespond ? (
					<fieldset className="flex min-w-0 flex-wrap gap-2 border-0 p-0" disabled={response.isPending}>
						<legend className="sr-only">Respond to invitation</legend>
						{RESPONSE_OPTIONS.map((option, index) => {
							const selected = details.status === option.status
							// The chosen answer, or Accept as the first choice before any answer, is the bordered one.
							const bordered = selected || (!anySelected && index === 0)
							return (
								<button
									key={option.status}
									type="button"
									aria-pressed={selected}
									onClick={() => response.mutate(option.status)}
									className={bordered ? EDGE_BUTTON_CLASS : EDGE_GHOST_CLASS}
								>
									{selected ? <Check aria-hidden="true" className="size-3" /> : null}
									{option.label}
								</button>
							)
						})}
					</fieldset>
				) : (
					<span className="text-xs text-muted-foreground">Added to your calendar</span>
				)}
				{history.earlierVersions.length > 0 ? (
					<button
						type="button"
						aria-expanded={versionsOpen}
						aria-controls={versionsId}
						onClick={() => setVersionsOpen((open) => !open)}
						className={cn(EDGE_LINK_CLASS, 'ml-auto')}
					>
						Earlier versions
					</button>
				) : null}
			</div>
			{canRespond ? (
				<p className="sr-only" aria-live="polite">
					{responseLabel(details.status)}
				</p>
			) : null}
			{versionsOpen ? <EarlierVersions id={versionsId} versions={history.earlierVersions} /> : null}
			{canRespond && response.isError ? (
				<p role="alert" className="m-0 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
					Your response wasn’t saved. Check your connection, then try again.
				</p>
			) : null}
		</section>
	)
}

function ConflictNotice({
	conflicts,
}: {
	conflicts: Extract<CalendarInvitationDetails, { state: 'ready' }>['conflicts']
}) {
	// A clear calendar needs no words; the resting card stays as compact as the board draws it.
	if (conflicts.state === 'clear') return null
	if (conflicts.state === 'unknown') {
		return (
			<p className="m-0 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
				<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
				We couldn’t check your full schedule. Review your calendar before responding.
			</p>
		)
	}
	return (
		<p
			role="alert"
			className="m-0 flex items-start gap-2 rounded-md border border-notice-warning-line bg-notice-warning px-3 py-2 text-xs text-notice-warning-foreground"
		>
			<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
			This overlaps with {conflicts.count} {conflicts.count === 1 ? 'event' : 'events'} on your calendar.
		</p>
	)
}

function InvitationNotice({
	title,
	message,
	onRetry,
	retrying = false,
	onAction,
	actionPending = false,
	error = false,
}: {
	title: string
	message: string
	onRetry?: () => void
	retrying?: boolean
	onAction?: () => void
	actionPending?: boolean
	error?: boolean
}) {
	return (
		<section
			data-slot="calendar-invitation"
			className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4"
		>
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
				<CalendarDays className="h-4 w-4" />
			</div>
			<div className="min-w-0 flex-1">
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>
				<p className="mt-1 text-sm text-muted-foreground">{message}</p>
				{onRetry || onAction ? (
					<div className="mt-2 flex flex-wrap gap-2">
						{onAction ? (
							<button
								type="button"
								onClick={onAction}
								disabled={actionPending}
								className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
							>
								{actionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
								{actionPending ? 'Adding…' : 'Add to calendar'}
							</button>
						) : null}
						<button
							type="button"
							onClick={onRetry}
							disabled={retrying}
							className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
						>
							{retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
							{retrying ? 'Checking…' : 'Try again'}
						</button>
					</div>
				) : null}
				{error ? (
					<p role="alert" className="mt-2 text-sm text-destructive">
						We couldn’t add this invitation. Check your connection, then try again.
					</p>
				) : null}
			</div>
		</section>
	)
}

/** The earlier start, as short as it can be: the time alone on the same day, else the day too. */
function previousTimeLabel(previous: number, current: number): string {
	const day = (seconds: number) => new Date(seconds * 1_000).toDateString()
	const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(previous * 1_000)
	if (day(previous) === day(current)) return time
	return `${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(previous * 1_000)} · ${time}`
}

/** Each earlier invitation of the event, newest first: the time it proposed (struck) and when it was sent. */
function EarlierVersions({ id, versions }: { id: string; versions: MailMessage[] }) {
	return (
		<ol id={id} className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-muted-foreground">
			{[...versions].reverse().map((version) => (
				<EarlierVersion key={version.id} version={version} />
			))}
		</ol>
	)
}

function EarlierVersion({ version }: { version: MailMessage }) {
	const file = useInvitationFileTime(version, true)
	const proposed = file.data ? formatInvitationWhen({ kind: 'timed', ...file.data }) : null
	const now = Date.now()
	const tz = viewerZone()
	const sent = version.date
		? `Sent ${shortDayLabel(version.date, now, tz)} ${clockTime(version.date, tz)}`
		: 'Sent earlier'
	return (
		<li className="font-data">
			{proposed ? <s>{proposed}</s> : null}
			{proposed ? ' · ' : null}
			{sent}
		</li>
	)
}

function responseLabel(status: 'yes' | 'no' | 'maybe' | 'noreply'): string {
	if (status === 'yes') return 'You accepted'
	if (status === 'maybe') return 'You replied maybe'
	if (status === 'no') return 'You declined'
	return 'Awaiting your response'
}

const PERIOD = /\s?([AP]M)$/i

/** "Thu, Oct 22 · 2:00–2:45 PM", "All day · Sat, Dec 25", "Sat, Dec 25–Mon, Dec 27". */
function formatInvitationWhen(when: InvitationWhen): string {
	const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
	if (when.kind === 'timed') {
		const start = new Date(when.start * 1_000)
		const end = new Date(when.end * 1_000)
		const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
		const from = time.format(start)
		const to = time.format(end)
		if (start.toDateString() !== end.toDateString()) {
			return `${day.format(start)} · ${from} – ${day.format(end)} · ${to}`
		}
		// One period for both ends when they share it: "2:00–2:45 PM".
		const shared = PERIOD.exec(from)?.[1] === PERIOD.exec(to)?.[1]
		return `${day.format(start)} · ${shared ? from.replace(PERIOD, '') : from}–${to}`
	}
	const start = localCalendarDate(when.startDate)
	const end = localCalendarDate(when.endDate)
	if (end.getTime() - start.getTime() <= 86_400_000) return `All day · ${day.format(start)}`
	const inclusiveEnd = new Date(end.getTime() - 86_400_000)
	return `All day · ${day.format(start)}–${day.format(inclusiveEnd)}`
}

function localCalendarDate(value: string): Date {
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
	return new Date(year, month - 1, day)
}
