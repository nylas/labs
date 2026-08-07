import type { Folder } from '@nylas-labs/cli-kit/v3'
import { useQueryClient } from '@tanstack/react-query'
import { ResourceManagerDialog } from '#shared/components/ResourceManagerDialog'
import { createFolder, deleteFolder, updateFolder } from '../server/mail-functions.js'
import { type MailFolder, mailKeys, toMailFolder } from '../state/mail-queries.js'

function isCustomFolder(folder: Folder): boolean {
	return !folder.system_folder && !['inbox', 'sent', 'drafts', 'archive', 'trash', 'junk'].includes(folder.id)
}

export function FolderManagerDialog({
	folders,
	onClose,
	onDeleted,
}: {
	folders: Folder[]
	onClose: () => void
	onDeleted?: (folderId: string) => void
}) {
	const queryClient = useQueryClient()

	function reconcile(
		receipt: { folder: Folder; folders?: Folder[] } | { removedFolderId: string; folders?: Folder[] },
	) {
		queryClient.setQueryData<MailFolder[]>(mailKeys.folders(), (current) => {
			if (receipt.folders) return receipt.folders.map(toMailFolder)
			const existing = current ?? folders.map(toMailFolder)
			if ('removedFolderId' in receipt) {
				return existing.filter((folder) => folder.id !== receipt.removedFolderId)
			}
			const next = toMailFolder(receipt.folder)
			return existing.some((folder) => folder.id === next.id)
				? existing.map((folder) => (folder.id === next.id ? next : folder))
				: [...existing, next]
		})
		void queryClient.invalidateQueries({ queryKey: mailKeys.all, refetchType: 'active' }).catch(
			/* v8 ignore next -- background reconciliation cannot change a confirmed mutation result -- @preserve */
			() => {},
		)
	}

	return (
		<ResourceManagerDialog
			title="Manage folders"
			noun="folder"
			items={folders.filter(isCustomFolder).map((folder) => ({
				id: folder.id,
				name: folder.name || folder.id,
				canEdit: true,
				canDelete: true,
			}))}
			onClose={onClose}
			onCreate={async (name) => reconcile(await createFolder({ data: { name } }))}
			onUpdate={async (folderId, name) => reconcile(await updateFolder({ data: { folderId, name } }))}
			onDelete={async (folderId) => {
				reconcile(await deleteFolder({ data: { folderId } }))
				onDeleted?.(folderId)
			}}
		/>
	)
}
