// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ManagedResource, ResourceManagerDialog } from './ResourceManagerDialog.js'

afterEach(cleanup)

const items: ManagedResource[] = [
	{ id: 'work', name: 'Work', detail: 'Primary calendar', canEdit: true, canDelete: true },
	{ id: 'shared', name: 'Shared', detail: 'Read only', canEdit: false, canDelete: false },
	{ id: 'plain', name: 'Plain', canEdit: false, canDelete: false },
]

function setup(overrides: Partial<Parameters<typeof ResourceManagerDialog>[0]> = {}) {
	const props = {
		title: 'Manage folders',
		noun: 'folder',
		items,
		onClose: vi.fn(),
		onCreate: vi.fn(async () => undefined),
		onUpdate: vi.fn(async () => undefined),
		onDelete: vi.fn(async () => undefined),
		...overrides,
	}
	render(<ResourceManagerDialog {...props} />)
	return props
}

describe('ResourceManagerDialog', () => {
	it('creates a resource after client validation and blocks dismissal while saving', async () => {
		let finish: (() => void) | undefined
		const onCreate = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
		const props = setup({ onCreate })
		const user = userEvent.setup()

		expect(screen.getByText('Primary calendar')).toBeInTheDocument()
		expect(screen.getByText('Read only')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Edit Shared' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Delete Shared' })).toBeNull()

		await user.click(screen.getByRole('button', { name: 'Add folder' }))
		fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as HTMLFormElement)
		expect(screen.getByRole('alert')).toHaveTextContent('Enter a folder name up to 200 characters.')
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(201) } })
		fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form') as HTMLFormElement)
		expect(screen.getByRole('alert')).toBeInTheDocument()

		await user.clear(screen.getByLabelText('Name'))
		await user.type(screen.getByLabelText('Name'), '  Projects  ')
		await user.click(screen.getByRole('button', { name: 'Save' }))
		expect(onCreate).toHaveBeenCalledWith('Projects')
		expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()

		fireEvent.keyDown(document, { key: 'Escape' })
		expect(props.onClose).not.toHaveBeenCalled()
		finish?.()
		await screen.findByRole('button', { name: 'Add folder' })
	})

	it('edits with generic retry feedback, clears stale errors, and supports cancel', async () => {
		const onUpdate = vi
			.fn<Parameters<Parameters<typeof ResourceManagerDialog>[0]['onUpdate']>, Promise<void>>()
			.mockRejectedValueOnce(new Error('private provider detail'))
			.mockResolvedValue(undefined)
		setup({ onUpdate })
		const user = userEvent.setup()

		await user.click(screen.getByRole('button', { name: 'Edit Work' }))
		const input = screen.getByLabelText('Name')
		expect(input).toHaveValue('Work')
		await user.clear(input)
		await user.type(input, 'Roadmap')
		await user.click(screen.getByRole('button', { name: 'Save' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not save this folder. Check your connection, then try again.',
		)
		expect(screen.queryByText('private provider detail')).toBeNull()

		await user.type(input, ' 2')
		expect(screen.queryByRole('alert')).toBeNull()
		await user.click(screen.getByRole('button', { name: 'Save' }))
		await screen.findByRole('button', { name: 'Add folder' })
		expect(onUpdate).toHaveBeenLastCalledWith('work', 'Roadmap 2')

		await user.click(screen.getByRole('button', { name: 'Edit Work' }))
		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(screen.getByRole('button', { name: 'Add folder' })).toBeInTheDocument()
	})

	it('confirms deletion, permits retry after a generic failure, and permits cancel', async () => {
		const onDelete = vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValue(undefined)
		setup({ onDelete })
		const user = userEvent.setup()

		await user.click(screen.getByRole('button', { name: 'Delete Work' }))
		expect(screen.getByRole('group', { name: 'Delete Work?' })).toHaveTextContent(
			'This action cannot be undone.',
		)
		await user.click(screen.getByRole('button', { name: 'Delete folder' }))
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not delete this folder. Check your connection, then try again.',
		)
		await user.click(screen.getByRole('button', { name: 'Delete folder' }))
		await screen.findByRole('button', { name: 'Add folder' })
		expect(onDelete).toHaveBeenCalledTimes(2)

		await user.click(screen.getByRole('button', { name: 'Delete Work' }))
		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(screen.queryByRole('group', { name: 'Delete Work?' })).toBeNull()
	})

	it('renders an empty state and supports close button, backdrop, and Escape dismissal', async () => {
		const props = setup({ items: [] })
		const user = userEvent.setup()
		const dialog = screen.getByRole('dialog', { name: 'Manage folders' })
		expect(dialog).toHaveAttribute('data-presentation', 'bottom-sheet')
		expect(dialog).toHaveClass('sm:right-auto', 'sm:bottom-auto', 'sm:left-1/2')
		expect(screen.getByText('No folders yet.')).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Close' }))
		expect(props.onClose).toHaveBeenCalledTimes(1)
		await user.click(document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement)
		expect(props.onClose).toHaveBeenCalledTimes(2)
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(props.onClose).toHaveBeenCalledTimes(3)
	})
})
