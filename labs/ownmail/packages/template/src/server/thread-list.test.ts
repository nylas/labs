import { describe, expect, it } from 'vitest'
import { normalizeThreadListInput } from './thread-list.js'

describe('thread list validation', () => {
	it('normalizes valid thread list queries', () => {
		expect(
			normalizeThreadListInput({
				folderId: 'inbox',
				pageToken: 'cursor#next',
				q: 'roadmap',
				starred: false,
			}),
		).toEqual({
			folderId: 'inbox',
			pageToken: 'cursor#next',
			q: 'roadmap',
			starred: false,
		})
	})

	it('omits an absent page token from the normalized query', () => {
		expect(normalizeThreadListInput({ folderId: 'inbox' })).toEqual({ folderId: 'inbox' })
	})

	it('rejects invalid provider ids before calling Nylas', () => {
		expect(() => normalizeThreadListInput({ folderId: '' })).toThrow('Invalid folder')
		expect(() => normalizeThreadListInput({ folderId: 'bad\nfolder' })).toThrow('Invalid folder')
		expect(() => normalizeThreadListInput({ pageToken: 'bad\ntoken' })).toThrow('Invalid page token')
	})

	it('rejects malformed filters before calling Nylas', () => {
		expect(() => normalizeThreadListInput({ starred: 'true' as unknown as boolean })).toThrow(
			'Invalid starred filter',
		)
		expect(() => normalizeThreadListInput({ q: 'x'.repeat(501) })).toThrow('Search query too long')
		expect(() => normalizeThreadListInput({ q: 42 as unknown as string })).toThrow('Search query too long')
	})
})
