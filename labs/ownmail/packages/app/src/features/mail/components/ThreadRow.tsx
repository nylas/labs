import { Paperclip, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { ClientListDate } from '#shared/components/ClientTime'
import { labelBadgeClass } from '#shared/lib/color-tone'
import { cn } from '#shared/lib/utils'
import {
	readableSnippet,
	STAR_FILLED_CLASS,
	STAR_HOVER_CLASS,
	threadLabels,
	threadSender,
	threadTimestamp,
} from '../lib/mail-ui-model.js'
import type { MailThread } from '../state/mail-queries.js'

/**
 * Shared class for a thread-list row. Its 16px inline padding is the left edge
 * the list title shares. The row grid, its density variants, and
 * active/unread/hover states all come from `.thread-row` in `styles.css`, so
 * every list that uses this class and `ThreadRowLayout` follows the list
 * density preference.
 */
export const THREAD_ROW_CLASS =
	'thread-row group isolate w-full cursor-pointer border-b border-border px-4 py-3 text-left outline-none focus-visible:bg-accent'

/** A route-specific link can stretch across the row while remaining a sibling of row actions. */
export const THREAD_ROW_LINK_CLASS =
	'thread-row-link absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-[-2px] forced-colors:focus-visible:outline-solid'

export function threadRowLinkLabel(thread: MailThread, folderId: string) {
	return `Open ${thread.subject || '(no subject)'} from ${threadSender(thread, folderId)}`
}

/**
 * The cells every thread-list row shares: unread dot, leading action, sender,
 * date, then subject and snippet. `.thread-row` arranges them as three lines
 * (Default), two lines (Compact), or one line (Condensed).
 */
export function ThreadRowLayout({
	leading,
	sender,
	unread = false,
	hasAttachments = false,
	epochSeconds,
	subject,
	snippet,
	labels = [],
}: {
	leading: ReactNode
	sender: ReactNode
	unread?: boolean
	hasAttachments?: boolean
	epochSeconds?: number
	subject: string | undefined
	snippet: string | undefined
	labels?: ReturnType<typeof threadLabels>
}) {
	return (
		<>
			<span aria-hidden="true" className="thread-row-dot pointer-events-none relative z-10" />
			<span className="thread-row-lead pointer-events-none relative z-10">{leading}</span>
			<span
				className={cn(
					'thread-row-sender pointer-events-none relative z-10 min-w-0 truncate text-sm',
					unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
				)}
			>
				{sender}
			</span>
			<span className="thread-row-when pointer-events-none relative z-10">
				{hasAttachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
				{epochSeconds ? (
					<ClientListDate
						epochSeconds={epochSeconds}
						className="shrink-0 text-xs tabular-nums text-muted-foreground"
					/>
				) : null}
			</span>
			<div className="thread-row-text pointer-events-none relative z-10">
				<span className="thread-row-summary">
					<span
						className={cn(
							'thread-row-subject text-sm',
							unread ? 'font-semibold text-foreground' : 'text-foreground/80',
						)}
					>
						{subject || '(no subject)'}
					</span>
					<span className="thread-row-snippet text-xs text-muted-foreground">{readableSnippet(snippet)}</span>
				</span>
				{labels.length > 0 ? (
					<span className="thread-row-labels">
						{labels.map((label) => (
							<span key={label.id} className={cn('shrink-0', labelBadgeClass(label.tone))}>
								{label.name}
							</span>
						))}
					</span>
				) : null}
			</div>
		</>
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

/**
 * The visible content and secondary star action for a thread-list row. Callers place a
 * stretched route link before this content so the link and button remain semantic siblings.
 */
export function ThreadRowContent({
	thread,
	folderId,
	onToggleStar,
	starPending = false,
}: {
	thread: MailThread
	folderId: string
	onToggleStar: () => void
	starPending?: boolean
}) {
	return (
		<ThreadRowLayout
			leading={
				<button
					type="button"
					disabled={starPending}
					onClick={(event) => {
						event.preventDefault()
						event.stopPropagation()
						onToggleStar()
					}}
					aria-label={thread.starred ? 'Unstar' : 'Star'}
					aria-busy={starPending || undefined}
					className={cn(
						'thread-row-star touch-target-square pointer-events-auto relative z-20 -m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted active:translate-y-px focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:cursor-wait disabled:opacity-50 lg:-m-2 lg:h-8 lg:w-8',
						STAR_HOVER_CLASS,
					)}
				>
					<Star aria-hidden="true" className={cn('h-4 w-4', thread.starred && STAR_FILLED_CLASS)} />
				</button>
			}
			sender={
				<>
					{threadSender(thread, folderId)}
					{(thread.message_ids?.length ?? 0) > 1 ? (
						<span className="ml-1 font-normal text-muted-foreground">({thread.message_ids?.length})</span>
					) : null}
				</>
			}
			unread={thread.unread}
			hasAttachments={thread.has_attachments}
			epochSeconds={threadTimestamp(thread)}
			subject={thread.subject}
			snippet={thread.snippet}
			labels={threadLabels(thread)}
		/>
	)
}
