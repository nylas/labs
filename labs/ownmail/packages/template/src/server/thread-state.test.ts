import { describe, expect, it } from 'vitest'
import { normalizeThreadStateInput } from './thread-state.js'

describe('thread state validation', () => {
	it('normalizes valid thread actions', () => {
		expect(
			normalizeThreadStateInput({
				threadId: 'thread#abc',
				unread: false,
				starred: true,
				folder: 'archive',
			}),
		).toEqual({
			threadId: 'thread#abc',
			unread: false,
			starred: true,
			folder: 'archive',
		})
	})

	it('rejects malformed booleans before calling Nylas', () => {
		expect(() =>
			normalizeThreadStateInput({ threadId: 'thread#abc', unread: 'false' as unknown as boolean }),
		).toThrow('Invalid unread state')
		expect(() =>
			normalizeThreadStateInput({ threadId: 'thread#abc', starred: 'true' as unknown as boolean }),
		).toThrow('Invalid starred state')
	})

	it('rejects invalid provider ids', () => {
		expect(() => normalizeThreadStateInput({ threadId: '', folder: 'archive' })).toThrow('Invalid thread')
		expect(() => normalizeThreadStateInput({ threadId: 'thread#abc', folder: 'bad\nfolder' })).toThrow(
			'Invalid folder',
		)
	})
})
