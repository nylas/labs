import { describe, expect, it } from 'vitest'
import {
	READING_PANE_COLLAPSE_PX,
	readingPaneDragExtent,
	readingPaneLayout,
	readingPaneMinExtent,
	readingPaneSizeStyle,
	settleReadingPaneResize,
} from './reading-pane.js'

const classes = (value: string) => value.split(' ')

describe('readingPaneLayout', () => {
	it('keeps narrow screens single-pane in every layout: the conversation replaces the list', () => {
		for (const pane of ['none', 'vertical', 'horizontal'] as const) {
			const open = readingPaneLayout(pane, true)
			const closed = readingPaneLayout(pane, false)
			// Below `xl` the list is hidden while reading and the reader while browsing.
			expect(classes(open.list)).toContain('hidden')
			expect(classes(closed.reader)).toContain('hidden')
			expect(classes(closed.list)).toContain('flex')
			expect(classes(open.reader)).toContain('flex')
		}
	})

	it('never shows the list beside a conversation with no split, even on wide screens', () => {
		const layout = readingPaneLayout('none', true)
		expect(layout.list).not.toMatch(/xl:flex\b/)
		expect(layout.reader).not.toMatch(/xl:/)
		expect(layout.wideBackControl).toBe(true)
		// Without an open conversation there is no empty reader beside the list.
		expect(readingPaneLayout('none', false).reader).not.toMatch(/xl:flex\b/)
	})

	it('places the list beside the reader for a vertical split', () => {
		const layout = readingPaneLayout('vertical', true)
		expect(classes(layout.list)).toEqual(
			expect.arrayContaining(['xl:flex', 'xl:w-[min(var(--mail-list-width,22.5rem),calc(100%_-_360px))]']),
		)
		expect(layout.container).not.toContain('xl:flex-col')
		expect(layout.wideBackControl).toBe(false)
	})

	it('marks only the vertical-split list for the Condensed width, leaving the width itself to CSS', () => {
		// The 26rem Condensed width must follow the same pointer query as the rows, which script
		// cannot evaluate, so the layout stays at 22.5rem and only carries the hook CSS widens.
		const vertical = classes(readingPaneLayout('vertical', true).list)
		expect(vertical).toEqual(
			expect.arrayContaining([
				'mail-list-vertical',
				'xl:w-[min(var(--mail-list-width,22.5rem),calc(100%_-_360px))]',
				'xl:max-w-[min(var(--mail-list-width,22.5rem),calc(100%_-_360px))]',
			]),
		)
		expect(readingPaneLayout('vertical', true).list).not.toContain('26rem')
		// No split and the horizontal split already give the list the full width.
		for (const pane of ['none', 'horizontal'] as const) {
			expect(classes(readingPaneLayout(pane, true).list)).not.toContain('mail-list-vertical')
		}
	})

	it('stacks the list above the reader for a horizontal split', () => {
		const layout = readingPaneLayout('horizontal', true)
		expect(classes(layout.container)).toContain('xl:flex-col')
		expect(classes(layout.list)).toEqual(
			expect.arrayContaining([
				'xl:flex',
				'xl:h-[min(var(--mail-list-height,40%),calc(100%_-_160px))]',
				'xl:w-full',
			]),
		)
		expect(layout.wideBackControl).toBe(false)
	})
})

describe('readingPaneSizeStyle', () => {
	it('carries only the sizes the person dragged to', () => {
		expect(readingPaneSizeStyle({ readingPaneListWidth: null, readingPaneListHeight: null })).toEqual({})
		expect(readingPaneSizeStyle({ readingPaneListWidth: 420, readingPaneListHeight: 55 })).toEqual({
			'--mail-list-width': '420px',
			'--mail-list-height': '55%',
		})
	})
})

describe('reading pane resizing', () => {
	it('lets a drag shrink the list to nothing but always leaves the reader room', () => {
		expect(readingPaneDragExtent('vertical', -40, 1200)).toBe(0)
		expect(readingPaneDragExtent('vertical', 500.4, 1200)).toBe(500)
		expect(readingPaneDragExtent('vertical', 1100, 1200)).toBe(840)
		expect(readingPaneDragExtent('horizontal', 790, 800)).toBe(640)
		// Panes too small for the reader's room never yield a negative size.
		expect(readingPaneDragExtent('vertical', 100, 200)).toBe(0)
	})

	it('switches to no split when the list is dragged to near zero', () => {
		for (const pane of ['vertical', 'horizontal'] as const) {
			expect(settleReadingPaneResize(pane, 0, 1200)).toEqual({ kind: 'collapse' })
			expect(settleReadingPaneResize(pane, READING_PANE_COLLAPSE_PX - 1, 1200)).toEqual({ kind: 'collapse' })
		}
	})

	it('keeps a vertical list between its minimum and what leaves the reader room', () => {
		expect(settleReadingPaneResize('vertical', READING_PANE_COLLAPSE_PX, 1200)).toEqual({
			kind: 'width',
			value: 240,
		})
		expect(settleReadingPaneResize('vertical', 480.6, 1200)).toEqual({ kind: 'width', value: 481 })
		expect(settleReadingPaneResize('vertical', 1100, 1200)).toEqual({ kind: 'width', value: 840 })
		expect(settleReadingPaneResize('vertical', 3000, 4000)).toEqual({ kind: 'width', value: 1600 })
		// A window too narrow for both still keeps the smallest usable list.
		expect(settleReadingPaneResize('vertical', 300, 400)).toEqual({ kind: 'width', value: 240 })
	})

	it('stores a horizontal list as a bounded percentage of the panes', () => {
		expect(settleReadingPaneResize('horizontal', 400, 1000)).toEqual({ kind: 'height', value: 40 })
		expect(settleReadingPaneResize('horizontal', 97, 1000)).toEqual({ kind: 'height', value: 10 })
		expect(settleReadingPaneResize('horizontal', 950, 1000)).toEqual({ kind: 'height', value: 85 })
		expect(settleReadingPaneResize('horizontal', 200, 0)).toEqual({ kind: 'height', value: 85 })
	})

	it('reports the smallest list each split settles to', () => {
		expect(readingPaneMinExtent('vertical', 1200)).toBe(240)
		expect(readingPaneMinExtent('horizontal', 800)).toBe(80)
	})
})
