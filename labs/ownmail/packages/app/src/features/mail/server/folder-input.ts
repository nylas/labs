import { requireNylasProviderId } from '#server/ids'

const MAX_FOLDER_NAME_LENGTH = 255

export type FolderNameInput = { name: string }
export type UpdateFolderInput = FolderNameInput & { folderId: string }
export type FolderIdInput = { folderId: string }

export function normalizeFolderNameInput(input: FolderNameInput): FolderNameInput {
	if (!input || typeof input.name !== 'string' || input.name.length > MAX_FOLDER_NAME_LENGTH) {
		throw new Error('Invalid folder name')
	}
	const name = input.name.trim()
	if (!name || hasControlCharacters(name)) throw new Error('Invalid folder name')
	return { name }
}

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0)
		return code <= 0x1f || code === 0x7f
	})
}

export function normalizeUpdateFolderInput(input: UpdateFolderInput): UpdateFolderInput {
	return {
		folderId: requireNylasProviderId(input.folderId, 'folder'),
		...normalizeFolderNameInput(input),
	}
}

export function normalizeFolderIdInput(input: FolderIdInput): FolderIdInput {
	return { folderId: requireNylasProviderId(input.folderId, 'folder') }
}
