import { describe, expect, it } from 'vitest'
import {
	normalizeFolderIdInput,
	normalizeFolderNameInput,
	normalizeUpdateFolderInput,
} from './folder-input.js'

describe('folder management input', () => {
	it('trims valid create and update names and validates provider ids', () => {
		expect(normalizeFolderNameInput({ name: '  Projects  ' })).toEqual({ name: 'Projects' })
		expect(normalizeUpdateFolderInput({ folderId: 'folder-1', name: ' Roadmap ' })).toEqual({
			folderId: 'folder-1',
			name: 'Roadmap',
		})
		expect(normalizeFolderIdInput({ folderId: 'folder-1' })).toEqual({ folderId: 'folder-1' })
	})

	it.each([
		[null, 'missing input'],
		[{ name: 3 }, 'non-string'],
		[{ name: '   ' }, 'blank'],
		[{ name: 'bad\nname' }, 'control character'],
		[{ name: 'x'.repeat(256) }, 'too long'],
	])('rejects invalid folder names: %s', (input) => {
		expect(() => normalizeFolderNameInput(input as never)).toThrow('Invalid folder name')
	})

	it('rejects invalid ids for update and delete', () => {
		expect(() => normalizeUpdateFolderInput({ folderId: '', name: 'Projects' })).toThrow('Invalid folder')
		expect(() => normalizeFolderIdInput({ folderId: 'bad\nid' })).toThrow('Invalid folder')
	})
})
