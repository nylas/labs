// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileTabBar } from '#app/components/MobileTabBar'
import type { MailThread } from '#features/mail/state/mail-queries'
import { useBulkTriage } from '#features/mail/state/use-bulk-triage'
import { ToastProvider } from '#shared/components/Toaster'
import { BulkMailToolbar } from './BulkMailToolbar.js'
import { MailSelectionActionsProvider } from './MailSelectionActions.js'

vi.mock('@tanstack/react-router', () => ({ Link: ({ to, ...rest }: any) => <a href={to} {...rest} /> }))
afterEach(cleanup)
const threads = [
	{ id: 'one', folders: ['inbox'] },
	{ id: 'two', folders: ['inbox'] },
] as MailThread[]
function Harness({
	update,
	empty = false,
}: {
	update: (input: unknown) => Promise<unknown>
	empty?: boolean
}) {
	const selection = useBulkTriage({ identity: 'inbox', threads: empty ? [] : threads, update })
	return (
		<>
			<BulkMailToolbar selection={selection} />
			<button type="button" onClick={() => selection.toggle('one')}>
				Toggle first
			</button>
		</>
	)
}
function renderToolbar(update = vi.fn().mockResolvedValue(undefined), empty = false) {
	return render(
		<MailSelectionActionsProvider>
			<Harness update={update} empty={empty} />
			<MobileTabBar active="mail" />
		</MailSelectionActionsProvider>,
	)
}
describe('BulkMailToolbar', () => {
	it('replaces mobile tabs with the same four accessible actions and restores tabs after clearing', async () => {
		renderToolbar()
		expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		const mobile = screen.getByRole('toolbar', { name: 'Selected mail actions' })
		expect(document.querySelectorAll('[data-slot="mobile-bottom-bar"]')).toHaveLength(1)
		expect(mobile).toHaveClass('mobile-primary-tabs')
		expect(screen.queryByRole('navigation', { name: 'Primary mobile' })).not.toBeInTheDocument()
		expect(within(mobile).getAllByRole('button')).toHaveLength(4)
		for (const button of within(mobile).getAllByRole('button')) expect(button).toBeDisabled()
		fireEvent.click(screen.getByRole('checkbox', { name: 'Select all loaded conversations' }))
		expect(screen.getByText('2 selected')).toBeInTheDocument()
		for (const button of within(mobile).getAllByRole('button')) expect(button).toBeEnabled()
		fireEvent.click(screen.getByRole('button', { name: 'Done selecting' }))
		expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeInTheDocument()
		expect(screen.queryByRole('toolbar', { name: 'Selected mail actions' })).not.toBeInTheDocument()
		await waitFor(() => expect(screen.getByRole('button', { name: 'Select messages' })).toHaveFocus())
	})

	it('represents partial selection and allows keyboard selection of all loaded rows', async () => {
		renderToolbar()
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		fireEvent.click(screen.getByRole('button', { name: 'Toggle first' }))
		const checkbox = screen.getByRole('checkbox', { name: 'Select all loaded conversations' })
		expect(checkbox).toBePartiallyChecked()
		checkbox.focus()
		await userEvent.keyboard(' ')
		expect(checkbox).toBeChecked()
		expect(screen.getByText('2 selected')).toBeInTheDocument()
	})

	it('announces partial failures and restores focus to the selection checkbox', async () => {
		const update = vi.fn().mockRejectedValueOnce(new Error('provider detail')).mockResolvedValue(undefined)
		renderToolbar(update)
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		const all = screen.getByRole('checkbox', { name: 'Select all loaded conversations' })
		fireEvent.click(all)
		const mobile = screen.getByRole('toolbar', { name: 'Selected mail actions' })
		fireEvent.click(within(mobile).getByRole('button', { name: 'Archive selected' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('1 conversation could not be updated.')
		await waitFor(() => expect(all).toHaveFocus())
		expect(all).toBePartiallyChecked()
		expect(screen.getByText('1 selected')).toBeInTheDocument()
		expect(update).toHaveBeenCalledTimes(2)
	})

	it('offers no selectable mode for an empty loaded list', () => {
		renderToolbar(vi.fn(), true)
		expect(screen.getByRole('button', { name: 'Select messages' })).toBeDisabled()
	})
})

describe('bulk undo focus', () => {
	it('returns focus to loaded selection after Undo and after retrying a failed Undo', async () => {
		const update = vi.fn().mockResolvedValue(undefined)
		render(
			<ToastProvider>
				<MailSelectionActionsProvider>
					<Harness update={update} />
					<MobileTabBar active="mail" />
				</MailSelectionActionsProvider>
			</ToastProvider>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Select messages' }))
		const all = screen.getByRole('checkbox', { name: 'Select all loaded conversations' })
		await waitFor(() => expect(all).toHaveFocus())
		fireEvent.click(all)
		fireEvent.click(
			within(screen.getByRole('toolbar', { name: 'Selected mail actions' })).getByRole('button', {
				name: 'Archive selected',
			}),
		)
		const undo = await screen.findByRole('button', { name: 'Undo' })
		update.mockRejectedValueOnce(new Error('offline'))
		undo.focus()
		fireEvent.click(undo)
		await screen.findByRole('button', { name: 'Retry Undo' })
		await waitFor(() => expect(all).toHaveFocus())
		const retry = screen.getByRole('button', { name: 'Retry Undo' })
		retry.focus()
		fireEvent.click(retry)
		await screen.findByText('Changes undone')
		await waitFor(() => expect(all).toHaveFocus())
	})
})
