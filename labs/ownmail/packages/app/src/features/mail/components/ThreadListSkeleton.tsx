import { THREAD_ROW_CLASS, ThreadRowLayout } from './ThreadRow.js'

const ROW_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-36', 'w-24']
/** A zero-width character: it keeps a text line's height and survives the
 * whitespace trimming applied to snippets, so each blank line stays a line. */
const BLANK_LINE = '\u200b'
const BAR_CLASS = 'inline-block h-3 animate-pulse rounded bg-muted align-middle motion-reduce:animate-none'

/** Placeholder rows for a thread list whose folder or search is still loading.
 * They are real list rows with blank cells, so they take the height of the
 * list density set on the section around them and share the list's gutter:
 * nothing moves when the rows arrive. */
export function ThreadListSkeleton() {
	return (
		<div data-testid="thread-list-skeleton" aria-hidden="true" className="min-h-0 flex-1 overflow-hidden">
			{ROW_WIDTHS.map((width, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
				<div key={index} className={THREAD_ROW_CLASS}>
					<ThreadRowLayout
						leading={<span className={`${BAR_CLASS} w-4`} />}
						sender={<span className={`${BAR_CLASS} ${width}`} />}
						subject={BLANK_LINE}
						snippet={BLANK_LINE}
					/>
				</div>
			))}
		</div>
	)
}
