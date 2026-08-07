import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => {
		let validator: ((input: unknown) => unknown) | undefined
		const api = {
			validator(fn: (input: unknown) => unknown) {
				validator = fn
				return api
			},
			handler(fn: (ctx: { data: unknown }) => unknown) {
				return (opts?: { data?: unknown }) => fn({ data: validator ? validator(opts?.data) : opts?.data })
			},
		}
		return api
	},
}))

vi.mock('@tanstack/react-start/server', () => ({
	getRequest: () => new Request('http://ownmail.local/'),
	setResponseHeader: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
	redirect: (opts: { to: string }) => Object.assign(new Error('REDIRECT'), { to: opts.to }),
}))

const { mailboxFromRequest } = vi.hoisted(() => ({ mailboxFromRequest: vi.fn() }))
vi.mock('#server/nylas', () => ({ mailboxFromRequest: (request: Request) => mailboxFromRequest(request) }))

const { platform } = vi.hoisted(() => ({ platform: vi.fn() }))
vi.mock('#server/platform', () => ({ platform: () => platform() }))

const { createFolder, deleteFolder, updateFolder } = await import('./mail-functions.js')

const custom = { id: 'work', name: 'Work', system_folder: false, attributes: ['\\HasChildren'] }
const system = { id: 'inbox', name: 'Inbox', system_folder: true }
const attributedSystem = { id: 'trash-provider', name: 'Deleted', attributes: ['\\Trash'] }

function resolveMailbox(overrides: Record<string, unknown> = {}) {
	const mailbox = {
		listFolders: vi.fn(async () => ({ data: [system, custom, attributedSystem] })),
		createFolder: vi.fn(async (body: { name: string }) => ({ data: { id: 'created', ...body } })),
		updateFolder: vi.fn(async (folderId: string, body: { name: string }) => ({
			data: { id: folderId, ...body },
		})),
		deleteFolder: vi.fn(async () => undefined),
		...overrides,
	}
	mailboxFromRequest.mockResolvedValue({ mailbox, email: 'ada@ownmail.com', grantId: 'grant-123' })
	return mailbox
}

describe('folder management server functions', () => {
	beforeEach(() => {
		mailboxFromRequest.mockReset()
		platform.mockReset().mockResolvedValue({ kv: null })
	})

	it('creates, renames, and deletes custom folders with reconciled receipts', async () => {
		const mailbox = resolveMailbox()

		const created = await createFolder({ data: { name: ' Projects ' } })
		const updated = await updateFolder({ data: { folderId: 'work', name: ' Roadmap ' } })
		const deleted = await deleteFolder({ data: { folderId: 'work' } })

		expect(created.folder).toEqual({ id: 'created', name: 'Projects' })
		expect(created.folders).toEqual([system, custom, attributedSystem])
		expect(updated.folder).toEqual({ id: 'work', name: 'Roadmap' })
		expect(deleted.removedFolderId).toBe('work')
		expect(mailbox.createFolder).toHaveBeenCalledWith({ name: 'Projects' })
		expect(mailbox.updateFolder).toHaveBeenCalledWith('work', { name: 'Roadmap' })
		expect(mailbox.deleteFolder).toHaveBeenCalledWith('work')
	})

	it('fails closed for missing and protected folder targets', async () => {
		const mailbox = resolveMailbox()

		await expect(updateFolder({ data: { folderId: 'inbox', name: 'Nope' } })).rejects.toThrow(
			'This folder cannot be changed.',
		)
		await expect(updateFolder({ data: { folderId: 'trash-provider', name: 'Nope' } })).rejects.toThrow(
			'This folder cannot be changed.',
		)
		await expect(deleteFolder({ data: { folderId: 'missing' } })).rejects.toThrow(
			'This folder cannot be changed.',
		)
		expect(mailbox.updateFolder).not.toHaveBeenCalled()
		expect(mailbox.deleteFolder).not.toHaveBeenCalled()
	})

	it('maps each provider failure to a generic mailbox error', async () => {
		resolveMailbox({ createFolder: vi.fn().mockRejectedValue(new Error('provider detail')) })
		await expect(createFolder({ data: { name: 'Projects' } })).rejects.toThrow(
			'Something went wrong talking to your mailbox.',
		)

		resolveMailbox({ updateFolder: vi.fn().mockRejectedValue(new Error('provider detail')) })
		await expect(updateFolder({ data: { folderId: 'work', name: 'Projects' } })).rejects.toThrow(
			'Something went wrong talking to your mailbox.',
		)

		resolveMailbox({ deleteFolder: vi.fn().mockRejectedValue(new Error('provider detail')) })
		await expect(deleteFolder({ data: { folderId: 'work' } })).rejects.toThrow(
			'Something went wrong talking to your mailbox.',
		)
	})

	it('validates folder input before resolving the mailbox', () => {
		expect(() => createFolder({ data: { name: '   ' } })).toThrow('Invalid folder name')
		expect(() => updateFolder({ data: { folderId: '', name: 'Projects' } })).toThrow('Invalid folder')
		expect(() => deleteFolder({ data: { folderId: '' } })).toThrow('Invalid folder')
		expect(mailboxFromRequest).not.toHaveBeenCalled()
	})
})
