// @vitest-environment jsdom
import type { Folder } from '@nylas-labs/cli-kit/v3'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MailSidebar } from './MailSidebar.js'

// Compose is app state: assert what the composer is asked to open, not a route.
const composeApi = vi.hoisted(() => ({
	openCompose: vi.fn(async () => {}),
	composing: null as { kind: string; threadId?: string } | null,
	registerInlineSlot: vi.fn(),
}))
vi.mock('./ComposeProvider.js', () => ({ useCompose: () => composeApi }))

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
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
	FolderManagerDialog: ({ onClose, onDeleted, initialAction }: any) => (
		<div
			role="dialog"
			aria-label="Folder manager"
			data-initial-action={JSON.stringify(initialAction ?? null)}
		>
			<button type="button" onClick={onClose}>
				close manager
			</button>
			<button type="button" onClick={() => onDeleted?.('work')}>
				delete work
			</button>
		</div>
	),
}))

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

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
				folderMask={{ to: '/' }}
				currentFolderId="inbox"
				onNavigate={onNavigate}
			/>,
		)
		const inbox = screen.getByRole('link', { name: /Inbox/ })
		expect(inbox).toHaveClass('nav-item-active')
		// The current folder is a fill plus weight, so it is also exposed to assistive technology.
		expect(inbox).toHaveAttribute('aria-current', 'page')
		expect(screen.getByRole('link', { name: 'Sent' })).not.toHaveAttribute('aria-current')
		// unread_count 3 is rendered; zero-count folders show no badge.
		expect(within(inbox).getByText('3')).toBeInTheDocument()
		const sent = screen.getByRole('link', { name: 'Sent' })
		expect(within(sent).queryByText(/^\d+$/)).toBeNull()

		fireEvent.click(inbox)
		expect(onNavigate).toHaveBeenCalled()
	})

	it('renders custom labels, highlights the active label, and falls back to id when unnamed', () => {
		render(<MailSidebar folders={folders} currentFolderId="work" baseFolderId="inbox" />)
		expect(screen.getByText('Labels')).toBeInTheDocument()
		const work = screen.getByRole('link', { name: 'Work' })
		expect(work).toHaveClass('nav-item-active')
		expect(work).toHaveAttribute('aria-current', 'page')
		// Empty-named custom folder renders its id.
		expect(screen.getByRole('link', { name: 'zeta' })).toBeInTheDocument()
	})

	it('keeps folder management discoverable when there are no custom folders', () => {
		const systemOnly = [{ id: 'inbox', system_folder: true }] as unknown as Folder[]
		render(<MailSidebar folders={systemOnly} />)
		expect(screen.getByText('Labels')).toBeInTheDocument()
		expect(screen.getByText('No labels yet.')).toBeInTheDocument()
	})

	it('uses larger touch targets only in the mobile navigation sheet', () => {
		const view = render(<MailSidebar folders={folders} currentFolderId="inbox" mobile />)
		expect(screen.getByRole('button', { name: 'Compose' })).toHaveClass('min-h-12')
		expect(screen.getByRole('link', { name: /Inbox/ })).toHaveClass('min-h-12', 'nav-item-active')
		expect(screen.getByRole('link', { name: 'Work' })).toHaveClass('min-h-12')
		expect(screen.getByRole('button', { name: 'Manage folders' })).toHaveClass('size-11')

		view.rerender(<MailSidebar folders={folders} currentFolderId="work" mobile />)
		expect(screen.getByRole('link', { name: 'Work' })).toHaveClass('nav-item-active')

		view.rerender(<MailSidebar folders={folders} currentFolderId="inbox" />)
		const compose = screen.getByRole('button', { name: 'Compose' })
		expect(compose).toHaveClass('touch-target', 'h-9', 'border-cta-line')
		expect(compose).not.toHaveClass('min-h-12')
		// design.md "Spacing" clause 7: the create action is inset 12px on every side, with no
		// separator boxing it in; the folder rows share that inset and are rounded like it.
		expect(compose.parentElement).toHaveClass('p-hairline')
		expect(compose.parentElement).not.toHaveClass('border-b')
		expect(screen.getByRole('navigation', { name: 'Mail folders' })).toHaveClass('px-hairline')
		expect(screen.getByRole('link', { name: /Inbox/ })).toHaveClass('rounded-md', 'px-cluster')
		// The labels section clears its separator by 12px.
		expect(screen.getByText('Labels').closest('.border-t')).toHaveClass('pt-hairline')
		expect(screen.getByRole('link', { name: /Inbox/ })).toHaveClass('touch-target', 'h-9')
		expect(screen.getByRole('button', { name: 'Manage folders' })).toHaveClass(
			'touch-target-square',
			'size-9',
			'max-md:size-11',
		)

		view.rerender(
			<MailSidebar folders={[{ id: 'inbox', system_folder: true }] as unknown as Folder[]} mobile />,
		)
		// The empty note sits on the rows' text edge in the sheet as on desktop.
		expect(screen.getByText('No labels yet.')).toHaveClass('px-cluster')
	})

	it('opens and closes folder management and reports deletion to the route', () => {
		const onFolderDeleted = vi.fn()
		render(<MailSidebar folders={folders} onFolderDeleted={onFolderDeleted} />)
		fireEvent.click(screen.getByRole('button', { name: 'Manage folders' }))
		expect(screen.getByRole('dialog', { name: 'Folder manager' })).toHaveAttribute(
			'data-initial-action',
			'null',
		)
		fireEvent.click(screen.getByRole('button', { name: 'delete work' }))
		expect(onFolderDeleted).toHaveBeenCalledWith('work')
		fireEvent.click(screen.getByRole('button', { name: 'close manager' }))
		expect(screen.queryByRole('dialog', { name: 'Folder manager' })).toBeNull()
	})

	describe('label context menu', () => {
		async function openLabelMenu(name: string) {
			fireEvent.contextMenu(screen.getByRole('link', { name }), { clientX: 10, clientY: 10 })
			return screen.findByRole('menu', { name: `Actions for ${name}` })
		}

		it('opens the folder manager on that label, where rename and delete are confirmed', async () => {
			const onNavigate = vi.fn()
			render(<MailSidebar folders={folders} currentFolderId="inbox" onNavigate={onNavigate} />)

			await openLabelMenu('Work')
			const remove = screen.getByRole('menuitem', { name: 'Delete…' })
			expect(remove).toHaveAttribute('data-variant', 'destructive')
			expect(remove.querySelector('svg')).not.toBeNull()
			fireEvent.click(remove)
			expect(await screen.findByRole('dialog', { name: 'Folder manager' })).toHaveAttribute(
				'data-initial-action',
				JSON.stringify({ kind: 'delete', id: 'work' }),
			)
			fireEvent.click(screen.getByRole('button', { name: 'close manager' }))

			await openLabelMenu('zeta')
			fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
			expect(await screen.findByRole('dialog', { name: 'Folder manager' })).toHaveAttribute(
				'data-initial-action',
				JSON.stringify({ kind: 'edit', id: 'zeta' }),
			)
			// Opening a manager form is not a navigation.
			expect(navigate).not.toHaveBeenCalled()
			expect(onNavigate).not.toHaveBeenCalled()
		})

		it('opens the label like its link does, and has nothing to open when it is already open', async () => {
			const onNavigate = vi.fn()
			const { unmount } = render(
				<MailSidebar folders={folders} currentFolderId="inbox" onNavigate={onNavigate} />,
			)
			await openLabelMenu('Work')
			fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
			expect(navigate).toHaveBeenCalledWith({
				to: '/mail/f/$folderId',
				params: { folderId: 'work' },
				search: { baseFolderId: 'inbox' },
			})
			expect(onNavigate).toHaveBeenCalledTimes(1)
			unmount()

			navigate.mockClear()
			render(<MailSidebar folders={folders} currentFolderId="work" />)
			await openLabelMenu('Work')
			expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute('aria-disabled', 'true')

			cleanup()
			render(<MailSidebar folders={folders} currentFolderId="starred" />)
			await openLabelMenu('Work')
			fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
			expect(navigate).toHaveBeenCalledTimes(1)
		})

		it('gives standard folders no menu: the folder manager cannot change them', () => {
			render(<MailSidebar folders={folders} currentFolderId="inbox" />)
			expect(fireEvent.contextMenu(screen.getByRole('link', { name: /Inbox/ }))).toBe(true)
			expect(screen.queryByRole('menu')).not.toBeInTheDocument()
		})
	})

	describe('Resume draft', () => {
		it('offers the latest draft under Compose, so an unfinished message is one click away', () => {
			const onNavigate = vi.fn()
			render(
				<MailSidebar
					folders={folders}
					latestDraft={{ id: 'draft-1', subject: 'Re: Q3 roadmap' }}
					onNavigate={onNavigate}
				/>,
			)
			const resume = screen.getByRole('button', { name: 'Resume Re: Q3 roadmap' })
			fireEvent.click(resume)
			// It reopens that saved draft over the current page, and closes the mobile sheet.
			expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'draft', draftId: 'draft-1' })
			expect(onNavigate).toHaveBeenCalledTimes(1)
		})

		it('names a draft without a subject instead of showing an empty row', () => {
			render(<MailSidebar folders={folders} latestDraft={{ id: 'draft-2', subject: '' }} mobile />)
			expect(screen.getByRole('button', { name: 'Resume (no subject)' })).toHaveClass('min-h-12')
		})

		it('shows nothing extra when there is no draft', () => {
			render(<MailSidebar folders={folders} />)
			expect(screen.queryByRole('button', { name: /^Resume/ })).not.toBeInTheDocument()
		})
	})

	describe('folder counts', () => {
		it('animates a count only when it changes on screen, never on first paint', () => {
			const view = render(<MailSidebar folders={folders} currentFolderId="inbox" />)
			expect(screen.getByText('3')).not.toHaveClass('count-tick')
			const updated = folders.map((folder) =>
				folder.id === 'inbox' ? { ...folder, unread_count: 4 } : folder,
			)
			view.rerender(<MailSidebar folders={updated} currentFolderId="inbox" />)
			expect(screen.getByText('4')).toHaveClass('count-tick')
			view.rerender(<MailSidebar folders={updated} currentFolderId="sent" />)
			expect(screen.getByText('4')).not.toHaveClass('count-tick')
		})
	})

	it('opens a new message over the current page instead of navigating to a compose page', () => {
		const onNavigate = vi.fn()
		render(<MailSidebar folders={folders} onNavigate={onNavigate} />)
		fireEvent.click(screen.getByRole('button', { name: 'Compose' }))
		expect(composeApi.openCompose).toHaveBeenCalledWith({ kind: 'new' })
		expect(onNavigate).toHaveBeenCalledTimes(1)
		expect(navigate).not.toHaveBeenCalled()
	})
})
