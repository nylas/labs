import type { AnyRouter, ParsedLocation } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { rememberReaderHistory, returnToPreviousFolder } from './reader-history.js'

describe('reader history', () => {
	it.each([
		['direct reader load', undefined, 0, false],
		['different folder', '/mail/f/sent', 0, false],
		['replaced list entry', '/mail/f/inbox', 1, false],
		['previous inbox entry', '/mail/f/inbox', 0, true],
	] as const)('%s', (_, pathname, originIndex, expected) => {
		let onNavigate: (event: { fromLocation?: ParsedLocation }) => void = () => {}
		const back = vi.fn()
		const router = {
			subscribe: (_: string, callback: typeof onNavigate) => {
				onNavigate = callback
			},
			state: { location: { state: { __TSR_index: 1 } } },
			history: { back },
		} as unknown as AnyRouter
		rememberReaderHistory(router)
		onNavigate({
			fromLocation: pathname
				? ({ pathname, state: { __TSR_index: originIndex } } as ParsedLocation)
				: undefined,
		})
		expect(returnToPreviousFolder(router, 'inbox')).toBe(expected)
		expect(back).toHaveBeenCalledTimes(expected ? 1 : 0)
	})
})
