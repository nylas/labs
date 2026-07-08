import { describe, expect, it } from 'vitest'
import { threadFoldersAfterMove } from './mail-folders.js'

describe('mail folder moves', () => {
	it('preserves custom labels when moving between system folders', () => {
		expect(threadFoldersAfterMove(['inbox', 'work', 'travel'], 'archive')).toEqual([
			'archive',
			'work',
			'travel',
		])
		expect(threadFoldersAfterMove(['archive', 'work'], 'trash')).toEqual(['trash', 'work'])
	})
})
