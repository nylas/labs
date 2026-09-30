import { describe, expect, it } from 'vitest'
import { readingPaneLayout } from './reading-pane.js'

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
		expect(classes(layout.list)).toEqual(expect.arrayContaining(['xl:flex', 'xl:w-[22rem]']))
		expect(layout.container).not.toContain('xl:flex-col')
		expect(layout.wideBackControl).toBe(false)
	})

	it('stacks the list above the reader for a horizontal split', () => {
		const layout = readingPaneLayout('horizontal', true)
		expect(classes(layout.container)).toContain('xl:flex-col')
		expect(classes(layout.list)).toEqual(expect.arrayContaining(['xl:flex', 'xl:h-[40%]', 'xl:w-full']))
		expect(layout.wideBackControl).toBe(false)
	})
})
