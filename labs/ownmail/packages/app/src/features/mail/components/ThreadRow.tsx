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

/** Shared class for a thread-list row container; active/unread/hover come from `.thread-row` CSS. */
export const THREAD_ROW_CLASS = 'thread-row group relative w-full border-b border-border text-left'

/** Shared class for the row's stretched navigation target. */
export const THREAD_ROW_LINK_CLASS =
	'flex w-full cursor-pointer flex-col gap-1 py-3 pr-4 pl-14 outline-none focus-visible:bg-accent'

/**
 * The non-interactive content of a thread-list row (sender, date, subject, snippet, labels).
 * Callers own the sibling navigation and star controls so a button is never nested in a link.
 */
export function ThreadRowContent({ thread, folderId }: { thread: MailThread; folderId: string }) {
	const labels = threadLabels(thread)
	return (
		<>
			<div className="flex items-center gap-2">
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

export function ThreadRowStarButton({
	starred,
	pending,
	onToggle,
}: {
	starred: boolean
	pending?: boolean
	onToggle: () => void
}) {
	return (
		<button
			type="button"
			disabled={pending}
			onClick={onToggle}
			aria-label={starred ? 'Unstar' : 'Star'}
			className={cn(
				'touch-target-square absolute top-1 left-1 z-10 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted active:translate-y-px disabled:cursor-wait disabled:opacity-50',
				STAR_HOVER_CLASS,
			)}
		>
			<Star className={cn('h-4 w-4', starred && STAR_FILLED_CLASS)} />
		</button>
	)
}
