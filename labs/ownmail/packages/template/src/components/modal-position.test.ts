import { describe, expect, it } from 'vitest'
import {
	clampPointToViewport,
	createPanelPosition,
	ESTIMATED_PANEL_SIZE,
	panelBesideAnchor,
	type Rect,
} from './modal-position.js'

const viewport = { width: 1000, height: 800 }
const size = { width: 400, height: 300 }

describe('clampPointToViewport', () => {
	it('leaves an already-visible point untouched', () => {
		expect(clampPointToViewport({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 })
	})

	it('pulls a point back inside the right/bottom edges', () => {
		// x past the right edge -> clamped to width - size - margin (1000-400-8=592).
		expect(clampPointToViewport({ x: 5000, y: 5000 }, size, viewport)).toEqual({ x: 592, y: 492 })
	})

	it('pulls a point back inside the top/left edges to the margin', () => {
		expect(clampPointToViewport({ x: -50, y: -50 }, size, viewport)).toEqual({ x: 8, y: 8 })
	})

	it('falls back to the margin when the panel is larger than the viewport', () => {
		// viewport narrower/shorter than panel: max < min, so clamp returns the min (margin).
		expect(clampPointToViewport({ x: 100, y: 100 }, { width: 2000, height: 2000 }, viewport)).toEqual({
			x: 8,
			y: 8,
		})
	})
})

describe('panelBesideAnchor', () => {
	const anchor: Rect = { top: 120, left: 200, width: 80, height: 52 }

	it('sits to the right of the anchor when there is room', () => {
		// right edge of anchor (280) + gap (12) = 292.
		expect(panelBesideAnchor(anchor, size, viewport)).toEqual({ x: 292, y: 120 })
	})

	it('flips to the left of the anchor when the right side would overflow', () => {
		const nearRight: Rect = { top: 120, left: 900, width: 80, height: 52 }
		// right side (992 + 400 + 12) overflows 1000, so place left: 900 - 12 - 400 = 488.
		expect(panelBesideAnchor(nearRight, size, viewport)).toEqual({ x: 488, y: 120 })
	})
})

describe('createPanelPosition', () => {
	it('positions beside the anchor when one is given', () => {
		const anchor: Rect = { top: 100, left: 200, width: 80, height: 52 }
		expect(createPanelPosition(anchor, size, viewport)).toEqual(panelBesideAnchor(anchor, size, viewport))
	})

	it('centers the panel when there is no anchor', () => {
		expect(createPanelPosition(null, size, viewport)).toEqual({ x: 300, y: 250 })
		expect(createPanelPosition(undefined, size, viewport)).toEqual({ x: 300, y: 250 })
	})

	it('exposes a sane default panel footprint', () => {
		expect(ESTIMATED_PANEL_SIZE.width).toBeGreaterThan(0)
		expect(ESTIMATED_PANEL_SIZE.height).toBeGreaterThan(0)
	})
})
