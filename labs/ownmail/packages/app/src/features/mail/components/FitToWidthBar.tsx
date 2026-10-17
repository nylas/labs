import { fitPercent } from '../lib/edge-states.js'
import { EDGE_GHOST_CLASS } from './edge-actions.js'

/**
 * A designed message wider than the pane is scaled down to fit rather than
 * scrolled sideways, and this bar says so: "Fitted to width (82%)". Actual
 * size shows it at 100% and pans; Open in window shows it at its own width.
 */
export function FitToWidthBar({
	scale,
	actualSize,
	onToggleActualSize,
	onOpenWindow,
}: {
	scale: number
	actualSize: boolean
	onToggleActualSize(): void
	onOpenWindow(): void
}) {
	return (
		<div data-slot="fit-to-width-bar" className="mt-3 flex flex-wrap items-center gap-2">
			<span className="min-w-0 flex-1 text-xs text-muted-foreground">
				{actualSize ? (
					'Actual size'
				) : (
					<>
						Fitted to width <span className="font-data tabular-nums">({fitPercent(scale)}%)</span>
					</>
				)}
			</span>
			<button type="button" onClick={onToggleActualSize} className={EDGE_GHOST_CLASS}>
				{actualSize ? 'Fit to width' : 'Actual size'}
			</button>
			<button type="button" onClick={onOpenWindow} className={EDGE_GHOST_CLASS}>
				Open in window
			</button>
		</div>
	)
}
