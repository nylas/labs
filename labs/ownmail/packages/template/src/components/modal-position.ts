/**
 * Geometry for the floating, draggable event composer. Pure so the placement
 * and drag-clamping rules can be unit-tested without a DOM; the React shell
 * just feeds in the pointer position and the current viewport.
 */

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rect = { top: number; left: number; width: number; height: number }

/**
 * Estimated footprint of the composer panel. Using a constant instead of
 * measuring the DOM keeps placement deterministic (and testable) and is close
 * enough to keep the panel on screen — the exact pixel size doesn't matter for
 * a soft clamp.
 */
export const ESTIMATED_PANEL_SIZE: Size = { width: 448, height: 460 }

function clamp(value: number, min: number, max: number): number {
	if (max < min) return min
	if (value < min) return min
	if (value > max) return max
	return value
}

/** Clamp a panel's top-left so a panel of `size` stays within `viewport` minus `margin`. */
export function clampPointToViewport(point: Point, size: Size, viewport: Size, margin = 8): Point {
	return {
		x: clamp(point.x, margin, viewport.width - size.width - margin),
		y: clamp(point.y, margin, viewport.height - size.height - margin),
	}
}

/**
 * Place a panel just to the right of an anchor rect, flipping to its left when
 * the right side would overflow, then clamp to keep it fully on screen.
 */
export function panelBesideAnchor(anchor: Rect, size: Size, viewport: Size, gap = 12): Point {
	const rightX = anchor.left + anchor.width + gap
	const fitsRight = rightX + size.width + gap <= viewport.width
	const x = fitsRight ? rightX : anchor.left - gap - size.width
	return clampPointToViewport({ x, y: anchor.top }, size, viewport, gap)
}

/**
 * Initial position for the composer: beside the clicked slot when one was
 * given, otherwise centered in the viewport.
 */
export function createPanelPosition(anchor: Rect | null | undefined, size: Size, viewport: Size): Point {
	if (anchor) return panelBesideAnchor(anchor, size, viewport)
	const centered = { x: (viewport.width - size.width) / 2, y: (viewport.height - size.height) / 2 }
	return clampPointToViewport(centered, size, viewport)
}
