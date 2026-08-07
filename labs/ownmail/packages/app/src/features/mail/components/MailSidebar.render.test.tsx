// @vitest-environment jsdom
import type { Folder } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MailSidebar } from './MailSidebar.js'

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children, to, params, ...rest }: any) => {
		const href =
			typeof to === 'string' && params?.folderId ? to.replace('$folderId', params.folderId) : (to ?? '#')
		// Strip non-DOM props so React doesn't warn.
		const { search, mask, ...domProps } = rest
		return (
			<a href={href} {...domProps}>
				{children}
			</a>
		)
	},
}))

vi.mock('./FolderManagerDialog.js', () => ({
	FolderManagerDialog: ({ onClose, onDeleted }: any) => (
		<div role="dialog" aria-label="Folder manager">
			<button type="button" onClick={onClose}>
				close manager
			</button>
			<button type="button" onClick={() => onDeleted?.('work')}>
				delete work
			</button>
		</div>
	),
}))

afterEach(cleanup)

const folders = [
	// System folder: excluded from the custom-label list.
	{ id: 'inbox', system_folder: true, unread_count: 3 },
	// Non-system but a standard mail-folder id: excluded via the id check.
	{ id: 'sent', system_folder: false },
	// Custom label present in the shared LABELS table.
	{ id: 'work', name: 'Work', system_folder: false },
	// Custom label with no name -> falls back to its id.
	{ id: 'zeta', name: '', system_folder: false },
] as unknown as Folder[]

describe('MailSidebar', () => {
	it('renders standard folders, marks the current one active, and shows only positive counts', () => {
		const onNavigate = vi.fn()
		render(
			<MailSidebar
				folders={folders}
				composeSearch={{ folderId: 'inbox' }}
				composeMask={{ to: '/' }}
				folderMask={{ to: '/' }}
				currentFolderId="inbox"
				onNavigate={onNavigate}
			/>,
		)
		const inbox = screen.getByRole('link', { name: /Inbox/ })
		expect(inbox).toHaveClass('nav-item-active')
		// unread_count 3 is rendered; zero-count folders show no badge.
		expect(within(inbox).getByText('3')).toBeInTheDocument()
		const sent = screen.getByRole('link', { name: 'Sent' })
		expect(within(sent).queryByText(/^\d+$/)).toBeNull()

		fireEvent.click(inbox)
		expect(onNavigate).toHaveBeenCalled()
	})

	it('renders custom labels, highlights the active label, and falls back to id when unnamed', () => {
		render(<MailSidebar folders={folders} composeSearch={{}} currentFolderId="work" baseFolderId="inbox" />)
		expect(screen.getByText('Labels')).toBeInTheDocument()
		const work = screen.getByRole('link', { name: 'Work' })
		expect(work).toHaveClass('nav-item-active')
		// Empty-named custom folder renders its id.
		expect(screen.getByRole('link', { name: 'zeta' })).toBeInTheDocument()
	})

	it('keeps folder management discoverable when there are no custom folders', () => {
		const systemOnly = [{ id: 'inbox', system_folder: true }] as unknown as Folder[]
		render(<MailSidebar folders={systemOnly} composeSearch={{}} />)
		expect(screen.getByText('Labels')).toBeInTheDocument()
		expect(screen.getByText('No labels yet.')).toBeInTheDocument()
	})

	it('opens and closes folder management and reports deletion to the route', () => {
		const onFolderDeleted = vi.fn()
		render(<MailSidebar folders={folders} composeSearch={{}} onFolderDeleted={onFolderDeleted} />)
		fireEvent.click(screen.getByRole('button', { name: 'Manage folders' }))
		expect(screen.getByRole('dialog', { name: 'Folder manager' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'delete work' }))
		expect(onFolderDeleted).toHaveBeenCalledWith('work')
		fireEvent.click(screen.getByRole('button', { name: 'close manager' }))
		expect(screen.queryByRole('dialog', { name: 'Folder manager' })).toBeNull()
	})
})
