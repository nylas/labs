import type { Thread } from '@nylas-labs/cli-kit/v3'
import { Paperclip, Star } from 'lucide-react'
import { ClientListDate } from './ClientTime.js'
import {
	cn,
	labelBadgeClass,
	STAR_FILLED_CLASS,
	STAR_HOVER_CLASS,
	threadLabels,
	threadSender,
	threadTimestamp,
} from './ui-model.js'

/** Shared class for a thread-list row link; active/unread/hover come from `.thread-row` CSS. */
export const THREAD_ROW_CLASS =
	'thread-row group flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 pl-5 text-left outline-none focus-visible:bg-accent'

/**
 * The inner content of a thread-list row (star, sender, date, subject, snippet, labels).
 * Callers own the surrounding `<Link>` (routing differs per surface); this keeps a single
 * row rendering shared by the folder list, the compose backdrop, and search results.
 */
export function ThreadRowContent({
	thread,
	folderId,
	onToggleStar,
	starPending = false,
}: {
	thread: Thread
	folderId: string
	onToggleStar: () => void
	starPending?: boolean
}) {
	const labels = threadLabels(thread)
	return (
		<>
			<div className="flex items-center gap-2">
				<button
					type="button"
					disabled={starPending}
					onClick={(event) => {
						event.preventDefault()
						event.stopPropagation()
						onToggleStar()
					}}
					aria-label={thread.starred ? 'Unstar' : 'Star'}
					className={cn(
						'shrink-0 text-muted-foreground transition-colors disabled:cursor-wait disabled:opacity-50',
						STAR_HOVER_CLASS,
					)}
				>
					<Star className={cn('h-4 w-4', thread.starred && STAR_FILLED_CLASS)} />
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
					'truncate text-sm',
					thread.unread ? 'font-semibold text-foreground' : 'text-foreground/80',
				)}
			>
				{thread.subject || '(no subject)'}
			</p>
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{thread.snippet}</p>
				{labels.map((label) => (
					<span key={label.id} className={cn('shrink-0', labelBadgeClass(label.tone))}>
						{label.name}
					</span>
				))}
			</div>
		</>
	)
}
