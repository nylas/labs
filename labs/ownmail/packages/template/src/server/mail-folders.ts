const SYSTEM_FOLDER_IDS = new Set(['inbox', 'sent', 'drafts', 'archive', 'trash', 'junk', 'spam', 'starred'])

export function threadFoldersAfterMove(
	currentFolders: readonly string[] | undefined,
	targetFolder: string,
): string[] {
	const current = currentFolders ?? []
	const replacingSystemFolder = SYSTEM_FOLDER_IDS.has(targetFolder)
	const kept = current.filter(
		(folder) => folder !== targetFolder && (!replacingSystemFolder || !SYSTEM_FOLDER_IDS.has(folder)),
	)
	return [targetFolder, ...kept]
}
