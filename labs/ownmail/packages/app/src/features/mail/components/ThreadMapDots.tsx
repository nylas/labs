import { Fragment } from 'react'
import { cn } from '#shared/lib/utils'
import { type MapEntry, personHue, personName } from '../lib/thread-reading-model.js'

/**
 * The thread's shape beside the reader: a dot per message, tinted for its
 * sender. Read messages are small, the first a little larger, new ones larger
 * and stronger, with a short green rule where the reader stopped and a ring on
 * the message in focus. A dot scrolls to its message and opens it; the column
 * itself (or `g m`) opens the thread map panel.
 */
export function ThreadMapDots({
	entries,
	stoppedBeforeIndex,
	currentId,
	dateLabel,
	onSelect,
	onOpenPanel,
}: {
	entries: MapEntry[]
	stoppedBeforeIndex: number | null
	currentId?: string
	dateLabel: (seconds: number) => string
	onSelect: (messageId: string) => void
	onOpenPanel: () => void
}) {
	return (
		<aside aria-label="Thread map" data-slot="thread-map-dots" className="reader-map">
			<div className="reader-map-track">
				{entries.map((entry, index) => {
					const size = entry.unread ? 'new' : index === 0 ? 'first' : 'read'
					const name = personName(entry.from, 'full')
					const date = entry.date ? dateLabel(entry.date) : ''
					return (
						<Fragment key={entry.messageId}>
							{index === stoppedBeforeIndex ? (
								<span aria-hidden="true" data-slot="thread-map-stopped" className="reader-map-stopped" />
							) : null}
							<button
								type="button"
								data-slot="thread-map-dot"
								aria-label={`${entry.from.isOwner ? 'You' : name}${date ? `, ${date}` : ''}${entry.unread ? ', new' : ''}`}
								aria-current={entry.messageId === currentId ? 'true' : undefined}
								title={`${entry.from.isOwner ? 'You' : name}${date ? `, ${date}` : ''}`}
								className={cn('reader-map-dot', `reader-map-dot-${size}`)}
								data-hue={personHue(entry.from.email)}
								onClick={() => onSelect(entry.messageId)}
							>
								<span aria-hidden="true" />
							</button>
						</Fragment>
					)
				})}
			</div>
			<button type="button" data-slot="thread-map-open" className="reader-map-open" onClick={onOpenPanel}>
				Open thread map
				<span className="sr-only"> (g m)</span>
			</button>
		</aside>
	)
}
