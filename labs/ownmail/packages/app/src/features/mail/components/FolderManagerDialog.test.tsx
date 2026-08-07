// @vitest-environment jsdom
import type { Folder } from '@nylas-labs/cli-kit/v3'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mailKeys } from '../state/mail-queries.js'

const h = vi.hoisted(() => ({
	managerProps: undefined as any,
	createFolder: vi.fn(),
	updateFolder: vi.fn(),
	deleteFolder: vi.fn(),
}))

vi.mock('#shared/components/ResourceManagerDialog', () => ({
	ResourceManagerDialog: (props: any) => {
		h.managerProps = props
		return <div data-testid="folder-manager" />
	},
}))

vi.mock('../server/mail-functions.js', () => ({
	createFolder: (input: unknown) => h.createFolder(input),
	updateFolder: (input: unknown) => h.updateFolder(input),
	deleteFolder: (input: unknown) => h.deleteFolder(input),
}))

import { FolderManagerDialog } from './FolderManagerDialog.js'

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

const folders = [
	{ id: 'inbox', name: 'Inbox', system_folder: true },
	{ id: 'sent', name: 'Sent', system_folder: false },
	{ id: 'work', name: 'Work', system_folder: false, attributes: ['\\HasChildren'] },
	{ id: 'empty', name: '', system_folder: false },
] as Folder[]

function setup(onDeleted?: (folderId: string) => void, seedCache = true) {
	const queryClient = new QueryClient()
	if (seedCache) queryClient.setQueryData(mailKeys.folders(), folders)
	render(
		<QueryClientProvider client={queryClient}>
			<FolderManagerDialog folders={folders} onClose={vi.fn()} onDeleted={onDeleted} />
		</QueryClientProvider>,
	)
	return queryClient
}

describe('FolderManagerDialog', () => {
	it('exposes only custom folders and reconciles create and canonical update receipts', async () => {
		const queryClient = setup()
		expect(h.managerProps.items).toEqual([
			{ id: 'work', name: 'Work', canEdit: true, canDelete: true },
			{ id: 'empty', name: 'empty', canEdit: true, canDelete: true },
		])

		h.createFolder.mockResolvedValue({ folder: { id: 'new', name: 'New' } })
		await h.managerProps.onCreate('New')
		expect(h.createFolder).toHaveBeenCalledWith({ data: { name: 'New' } })
		expect(queryClient.getQueryData<Folder[]>(mailKeys.folders())).toContainEqual({ id: 'new', name: 'New' })

		h.updateFolder.mockResolvedValue({ folder: { id: 'work', name: 'Roadmap' } })
		await h.managerProps.onUpdate('work', 'Roadmap')
		expect(h.updateFolder).toHaveBeenCalledWith({ data: { folderId: 'work', name: 'Roadmap' } })
		expect(
			queryClient.getQueryData<Folder[]>(mailKeys.folders())?.find((folder) => folder.id === 'work')?.name,
		).toBe('Roadmap')

		h.createFolder.mockResolvedValue({
			folders: [{ id: 'canonical', name: 'Canonical' }],
			folder: { id: 'ignored', name: 'Ignored' },
		})
		await h.managerProps.onCreate('Canonical')
		expect(queryClient.getQueryData(mailKeys.folders())).toEqual([{ id: 'canonical', name: 'Canonical' }])
	})

	it('removes a deleted folder and reports its id to route recovery', async () => {
		const onDeleted = vi.fn()
		const queryClient = setup(onDeleted)
		h.deleteFolder.mockResolvedValue({ removedFolderId: 'work' })

		await h.managerProps.onDelete('work')

		expect(h.deleteFolder).toHaveBeenCalledWith({ data: { folderId: 'work' } })
		expect(
			queryClient.getQueryData<Folder[]>(mailKeys.folders())?.some((folder) => folder.id === 'work'),
		).toBe(false)
		expect(onDeleted).toHaveBeenCalledWith('work')
	})

	it('falls back to loader folders when the query cache is initially empty', async () => {
		const queryClient = setup(undefined, false)
		h.createFolder.mockResolvedValue({ folder: { id: 'new', name: 'New' } })

		await h.managerProps.onCreate('New')

		expect(queryClient.getQueryData<Folder[]>(mailKeys.folders())).toContainEqual({ id: 'new', name: 'New' })
	})
})
