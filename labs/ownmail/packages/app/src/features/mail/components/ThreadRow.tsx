import { Paperclip, Star } from 'lucide-react'
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

/** Shared class for a thread-list row; active/unread/hover come from `.thread-row` CSS. */
export const THREAD_ROW_CLASS =
	'thread-row group isolate flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 pl-5 text-left outline-none focus-visible:bg-accent'

/** A route-specific link can stretch across the row while remaining a sibling of row actions. */
export const THREAD_ROW_LINK_CLASS =
	'thread-row-link absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-[-2px] forced-colors:focus-visible:outline-solid'

export function threadRowLinkLabel(thread: MailThread, folderId: string) {
	return `Open ${thread.subject || '(no subject)'} from ${threadSender(thread, folderId)}`
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
	const labels = threadLabels(thread)
	return (
		<>
			<div className="pointer-events-none relative z-10 flex items-center gap-2">
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
						'pointer-events-auto relative z-20 -m-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors active:bg-accent/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:cursor-wait disabled:opacity-50 lg:-m-2 lg:h-8 lg:w-8',
						STAR_HOVER_CLASS,
					)}
				>
					<Star aria-hidden="true" className={cn('h-4 w-4', thread.starred && STAR_FILLED_CLASS)} />
				</button>
				<span
					className={cn(
						'min-w-0 flex-1 truncate text-sm',
						thread.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
					)}
				>
					{threadSender(thread, folderId)}
					{(thread.message_ids?.length ?? 0) > 1 ? (
						<span className="ml-1 font-normal text-muted-foreground">({thread.message_ids?.length})</span>
					) : null}
				</span>
				{thread.has_attachments ? <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
				<ClientListDate
					epochSeconds={threadTimestamp(thread)}
					className="shrink-0 text-xs tabular-nums text-muted-foreground"
				/>
			</div>
			<p
				className={cn(
					'pointer-events-none relative z-10 truncate text-sm',
					thread.unread ? 'font-semibold text-foreground' : 'text-foreground/80',
				)}
			>
				{thread.subject || '(no subject)'}
			</p>
			<div className="pointer-events-none relative z-10 flex items-center gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
					{readableSnippet(thread.snippet)}
				</p>
				{labels.map((label) => (
					<span key={label.id} className={cn('shrink-0', labelBadgeClass(label.tone))}>
						{label.name}
					</span>
				))}
			</div>
		</>
	)
}
