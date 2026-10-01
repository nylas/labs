import { ThreadColumn } from './ThreadColumn.js'

/**
 * The messages of a thread while what to show is not known yet: the saved
 * thread view during server render and hydration, or the Conversation view's
 * header lookup. It is the same block the thread skeleton shows, so nothing
 * moves when the reader or the transcript takes its place.
 */
export function ThreadMessagesPlaceholder() {
	return (
		<div data-slot="thread-messages-pending" className="py-5" aria-hidden="true">
			<ThreadColumn>
				<div className="flex flex-col gap-3">
					<div className="h-4 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
					<div className="h-4 w-5/6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
					<div className="h-4 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
				</div>
			</ThreadColumn>
		</div>
	)
}
