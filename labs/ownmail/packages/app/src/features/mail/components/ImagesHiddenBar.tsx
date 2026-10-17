import { alwaysForLabel, hiddenImagesText } from '../lib/edge-states.js'
import { EDGE_BUTTON_CLASS, EDGE_GHOST_CLASS } from './edge-actions.js'

/**
 * Says how many of a message's images are held back and from where, with the
 * two ways to let them in: this message now, or this sender from now on. The
 * images keep their declared space meanwhile, so allowing them moves nothing.
 */
export function ImagesHiddenBar({
	count,
	domain,
	senderName,
	onShow,
	onAlways,
}: {
	count: number
	domain: string
	senderName?: string
	onShow(): void
	onAlways?: () => void
}) {
	return (
		<div data-slot="images-hidden-bar" className="mt-3 flex flex-wrap items-center gap-2">
			<span className="min-w-0 flex-1 text-xs text-muted-foreground">{hiddenImagesText(count, domain)}</span>
			<button type="button" onClick={onShow} className={EDGE_BUTTON_CLASS}>
				Show
			</button>
			{onAlways ? (
				<button type="button" onClick={onAlways} className={EDGE_GHOST_CLASS}>
					{alwaysForLabel(senderName, domain)}
				</button>
			) : null}
		</div>
	)
}
