import { describe, expect, it } from 'vitest'
import { edgeCursor, listNavAction, moveCursor } from './list-nav.js'

describe('listNavAction', () => {
	it('maps j and ArrowDown to a downward move', () => {
		expect(listNavAction('j')).toBe('down')
		expect(listNavAction('ArrowDown')).toBe('down')
	})

	it('maps k and ArrowUp to an upward move', () => {
		expect(listNavAction('k')).toBe('up')
		expect(listNavAction('ArrowUp')).toBe('up')
	})

	it('maps Enter and o to open', () => {
		expect(listNavAction('Enter')).toBe('open')
		expect(listNavAction('o')).toBe('open')
	})

	it('maps Home and End to the list edges', () => {
		expect(listNavAction('Home')).toBe('first')
		expect(listNavAction('End')).toBe('last')
	})

	it('ignores unrelated keys so the caller leaves the event alone', () => {
		expect(listNavAction('x')).toBeNull()
		expect(listNavAction('/')).toBeNull()
	})
})

describe('edgeCursor', () => {
	it('selects the requested edge and keeps an empty list unselected', () => {
		expect(edgeCursor('first', 3)).toBe(0)
		expect(edgeCursor('last', 3)).toBe(2)
		expect(edgeCursor('first', 0)).toBe(-1)
	})
})

describe('moveCursor', () => {
	it('has no cursor for an empty list regardless of direction', () => {
		expect(moveCursor(-1, 1, 0)).toBe(-1)
		expect(moveCursor(0, -1, 0)).toBe(-1)
	})

	it('selects the first row when moving down from the unselected state', () => {
		expect(moveCursor(-1, 1, 5)).toBe(0)
	})

	it('selects the last row when moving up from the unselected state', () => {
		expect(moveCursor(-1, -1, 5)).toBe(4)
	})

	it('steps by the delta in the middle of the list', () => {
		expect(moveCursor(2, 1, 5)).toBe(3)
		expect(moveCursor(2, -1, 5)).toBe(1)
	})

	it('clamps at the top edge instead of wrapping', () => {
		expect(moveCursor(0, -1, 5)).toBe(0)
	})

	it('clamps at the bottom edge instead of wrapping', () => {
		expect(moveCursor(4, 1, 5)).toBe(4)
	})
})
