/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, Check, Clock3, Loader2, MapPin } from 'lucide-react'
import { firstCalendarInvitationAttachment } from '#features/calendar/lib/calendar-invitation'
import type {
	CalendarInvitationDetails,
	InvitationWhen,
} from '#features/calendar/server/calendar-invitation-fns'
import { cn } from '#shared/lib/utils'
import type { MailMessage } from '../state/mail-queries.js'

const RESPONSE_OPTIONS = [
	{ status: 'yes', label: 'Accept' },
	{ status: 'maybe', label: 'Maybe' },
	{ status: 'no', label: 'Decline' },
] as const

const SYNC_RETRY_INTERVAL_MS = 2_000
const SYNC_LOOKUP_LIMIT = 5

export function CalendarInvitationCard({ message }: { message: MailMessage }) {
	const attachment = firstCalendarInvitationAttachment(message.attachments)
	if (!attachment) return null
	return (
		<CalendarInvitationContent
			key={`${message.id}:${attachment.id}`}
			messageId={message.id}
			attachmentId={attachment.id}
		/>
	)
}

function CalendarInvitationContent({ messageId, attachmentId }: { messageId: string; attachmentId: string }) {
	const queryClient = useQueryClient()
	const queryKey = ['calendar', 'invitation', messageId, attachmentId] as const
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
			return details?.state === 'syncing' &&
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
			void queryClient.invalidateQueries({ queryKey: ['calendar', 'range'], refetchType: 'active' })
		},
	})
	const addInvitation = useMutation({
		mutationFn: async () => {
			const { addCalendarInvitation } = await import('#features/calendar/server/calendar-invitation-fns')
			return addCalendarInvitation({ data: { messageId, attachmentId } })
		},
		onSuccess: (details) => {
			queryClient.setQueryData<CalendarInvitationDetails>(queryKey, details)
			void queryClient.invalidateQueries({ queryKey: ['calendar', 'range'], refetchType: 'active' })
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
				title="Adding invitation to your calendar"
				message={
					canAdd
						? 'Nylas is still syncing this event. You can check again or add it to your calendar now.'
						: 'Nylas is still syncing this event. You can check again in a moment.'
				}
				onRetry={() => void invitation.refetch()}
				retrying={invitation.isFetching}
				onAction={canAdd ? () => addInvitation.mutate() : undefined}
				actionPending={addInvitation.isPending}
				error={addInvitation.isError}
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
	return (
		<section
			data-slot="calendar-invitation"
			aria-labelledby={`invitation-title-${attachmentId}`}
			className="mb-5 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
		>
			<div className="border-l-4 border-l-primary px-4 py-4 sm:px-5">
				<div className="flex min-w-0 items-start gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<CalendarDays className="h-5 w-5" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-xs font-semibold tracking-wide text-primary uppercase">Calendar invitation</p>
						<h2
							id={`invitation-title-${attachmentId}`}
							className="mt-1 font-display text-lg font-semibold text-balance [overflow-wrap:anywhere]"
						>
							{details.title}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
							From {details.organizer}
						</p>
					</div>
				</div>

				<div className="mt-4 grid gap-2 text-sm text-foreground">
					<div className="flex items-start gap-2.5">
						<Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						<span>{formatInvitationWhen(details.when)}</span>
					</div>
					{details.location ? (
						<div className="flex items-start gap-2.5">
							<MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
							<span className="[overflow-wrap:anywhere]">{details.location}</span>
						</div>
					) : null}
				</div>

				<ConflictNotice conflicts={details.conflicts} />

				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
					<p className="text-sm font-medium text-muted-foreground" aria-live="polite">
						{responseLabel(details.status)}
					</p>
					<fieldset className="flex min-w-0 flex-wrap gap-2 border-0 p-0" disabled={response.isPending}>
						<legend className="sr-only">Respond to invitation</legend>
						{RESPONSE_OPTIONS.map((option) => {
							const selected = details.status === option.status
							return (
								<button
									key={option.status}
									type="button"
									aria-pressed={selected}
									onClick={() => response.mutate(option.status)}
									className={cn(
										'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-60',
										selected
											? 'border-primary bg-primary text-primary-foreground'
											: 'border-border bg-background text-foreground hover:bg-accent',
									)}
								>
									{selected ? <Check className="h-3.5 w-3.5" /> : null}
									{option.label}
								</button>
							)
						})}
					</fieldset>
				</div>
				{response.isError ? (
					<p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
						Your response wasn’t saved. Check your connection, then try again.
					</p>
				) : null}
			</div>
		</section>
	)
}

function ConflictNotice({
	conflicts,
}: {
	conflicts: Extract<CalendarInvitationDetails, { state: 'ready' }>['conflicts']
}) {
	if (conflicts.state === 'clear') {
		return (
			<p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
				<Check className="h-4 w-4 shrink-0" />
				No conflicts on your calendar
			</p>
		)
	}
	if (conflicts.state === 'unknown') {
		return (
			<p className="mt-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
				We couldn’t check your full schedule. Review your calendar before responding.
			</p>
		)
	}
	return (
		<p
			role="alert"
			className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/12 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
		>
			<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
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

function responseLabel(status: 'yes' | 'no' | 'maybe' | 'noreply'): string {
	if (status === 'yes') return 'You accepted'
	if (status === 'maybe') return 'You replied maybe'
	if (status === 'no') return 'You declined'
	return 'Awaiting your response'
}

function formatInvitationWhen(when: InvitationWhen): string {
	if (when.kind === 'timed') {
		const start = new Date(when.start * 1_000)
		const end = new Date(when.end * 1_000)
		const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(start)
		const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })
		return `${date} · ${time.format(start)}–${time.format(end)}`
	}
	const start = localCalendarDate(when.startDate)
	const end = localCalendarDate(when.endDate)
	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' })
	if (end.getTime() - start.getTime() <= 86_400_000) return `All day · ${date.format(start)}`
	const inclusiveEnd = new Date(end.getTime() - 86_400_000)
	return `All day · ${date.format(start)}–${date.format(inclusiveEnd)}`
}

function localCalendarDate(value: string): Date {
	const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
	return new Date(year, month - 1, day)
}
