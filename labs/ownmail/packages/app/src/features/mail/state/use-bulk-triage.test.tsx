// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailThread } from './mail-queries.js'
import { type BulkAction, useBulkTriage } from './use-bulk-triage.js'

const scope = vi.hoisted(() => ({ account: 'a' }))
const showToast = vi.hoisted(() => vi.fn())
vi.mock('#app/lib/account-scope', () => ({ accountScope: () => scope.account }))
vi.mock('#shared/components/Toaster', () => ({ useToast: () => ({ showToast }) }))
const threads = [
	{ id: 'one', unread: true, folders: ['inbox'] },
	{ id: 'two', unread: false, folders: ['archive'] },
] as MailThread[]
function pending() {
	let resolve!: () => void
	const promise = new Promise<void>((res) => {
		resolve = res
	})
	return { promise, resolve }
}
function setup(update = vi.fn().mockResolvedValue(undefined)) {
	return {
		...renderHook(({ identity, list }) => useBulkTriage({ identity, threads: list, update }), {
			initialProps: { identity: 'inbox', list: threads },
		}),
		update,
	}
}
afterEach(cleanup)
beforeEach(() => {
	scope.account = 'a'
	showToast.mockClear()
})

describe('bulk triage boundaries and recovery', () => {
	it('selects only loaded rows, toggles individual/all, and clears explicitly', async () => {
		const { result, update } = setup()
		await act(async () => {
			await result.current.run('archive')
		})
		expect(update).not.toHaveBeenCalled()
		act(() => result.current.start())
		expect(result.current.selecting).toBe(true)
		act(() => result.current.toggle('unseen'))
		expect(result.current.selectedCount).toBe(0)
		act(() => result.current.toggle('one'))
		expect(result.current.selectedIds).toEqual(['one'])
		act(() => result.current.toggle('one'))
		expect(result.current.selectedCount).toBe(0)
		act(() => result.current.toggleAll())
		expect(result.current.allSelected).toBe(true)
		act(() => result.current.toggleAll())
		expect(result.current.selectedCount).toBe(0)
		act(() => result.current.clear())
		expect(result.current.selecting).toBe(false)
	})
	it.each(['archive', 'trash', 'read', 'unread'] as BulkAction[])(
		'applies %s and restores each original state through Undo',
		async (action) => {
			const { result, update } = setup()
			act(() => {
				result.current.start()
				result.current.toggleAll()
			})
			await act(async () => {
				await result.current.run(action)
			})
			const moving = action === 'archive' || action === 'trash'
			expect(update.mock.calls.map(([input]) => input)).toEqual(
				threads.map((thread) =>
					moving
						? { threadId: thread.id, folder: action }
						: { threadId: thread.id, unread: action === 'unread' },
				),
			)
			expect(result.current.selectedCount).toBe(0)
			await act(async () => {
				showToast.mock.calls[0][0].action.onAction()
				await Promise.resolve()
				await Promise.resolve()
			})
			expect(update.mock.calls.slice(2).map(([input]) => input)).toEqual(
				threads.map((thread) =>
					moving
						? { threadId: thread.id, folder: thread.folders?.[0] }
						: { threadId: thread.id, unread: Boolean(thread.unread) },
				),
			)
			expect(result.current.focusRevision).toBe(2)
		},
	)
	it('blocks duplicate input and keeps count while optimistic rows leave', async () => {
		const first = pending()
		const { result, rerender, update } = setup(
			vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined),
		)
		act(() => {
			result.current.start()
			result.current.toggleAll()
		})
		let running!: Promise<void>
		act(() => {
			running = result.current.run('archive')
		})
		act(() => {
			void result.current.run('trash')
			result.current.toggle('one')
			result.current.toggleAll()
			result.current.clear()
		})
		expect(update).toHaveBeenCalledTimes(1)
		rerender({ identity: 'inbox', list: [] })
		expect(result.current.selectedCount).toBe(2)
		await act(async () => {
			first.resolve()
			await running
		})
		expect(update).toHaveBeenCalledTimes(2)
	})
	it('keeps failed items selected for retry and only reports generic errors', async () => {
		const { result, update } = setup(
			vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue(undefined),
		)
		act(() => result.current.toggleAll())
		await act(async () => {
			await result.current.run('trash')
		})
		expect(result.current.selectedIds).toEqual(['one'])
		expect(result.current.error).toMatch(/^1 conversation could not/)
		expect(result.current.error).not.toContain('secret')
		expect(showToast.mock.calls[0][0].message).toBe('1 conversation moved to Trash')
		await act(async () => {
			await result.current.run('trash')
		})
		expect(update).toHaveBeenLastCalledWith({ threadId: 'one', folder: 'trash' })
		expect(result.current.error).toBeNull()
	})
	it('does not move items without a restorable original location', async () => {
		const { result, rerender, update } = setup()
		rerender({ identity: 'search', list: [{ id: 'x' }, { id: 'y', folders: ['label'] }] as MailThread[] })
		act(() => result.current.toggleAll())
		await act(async () => {
			await result.current.run('archive')
		})
		expect(update).not.toHaveBeenCalled()
		expect(result.current.error).toMatch(/^2 conversations could not/)
		expect(showToast).not.toHaveBeenCalled()
	})
	it('resets on folder change and does not clear a newer operation when the old one finishes', async () => {
		const first = pending()
		const second = pending()
		const { result, rerender, update } = setup(
			vi
				.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise)
				.mockResolvedValue(undefined),
		)
		act(() => result.current.toggleAll())
		let old!: Promise<void>
		let next!: Promise<void>
		act(() => {
			old = result.current.run('read')
		})
		rerender({ identity: 'archive', list: threads })
		expect(result.current.selecting).toBe(false)
		expect(result.current.selectedCount).toBe(0)
		act(() => result.current.toggle('two'))
		act(() => {
			next = result.current.run('unread')
		})
		await act(async () => {
			first.resolve()
			await old
		})
		act(() => {
			void result.current.run('read')
		})
		expect(update).toHaveBeenCalledTimes(2)
		expect(result.current.pending).toBe(true)
		await act(async () => {
			second.resolve()
			await next
		})
		expect(result.current.pending).toBe(false)
	})
	it('stops queued writes on account switch and refuses stale Undo', async () => {
		const first = pending()
		const { result, rerender, update } = setup(
			vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined),
		)
		act(() => result.current.toggleAll())
		let running!: Promise<void>
		act(() => {
			running = result.current.run('read')
		})
		scope.account = 'b'
		rerender({ identity: 'inbox', list: threads })
		expect(result.current.selectedCount).toBe(0)
		await act(async () => {
			first.resolve()
			await running
		})
		expect(update).toHaveBeenCalledTimes(1)
		act(() => result.current.toggle('two'))
		await act(async () => {
			await result.current.run('unread')
		})
		const undo = showToast.mock.calls[0][0].action.onAction
		scope.account = 'c'
		await act(async () => {
			undo()
			await Promise.resolve()
		})
		expect(update).toHaveBeenCalledTimes(2)
	})
	it('retries only failed Undo items and prevents duplicate pending Undo', async () => {
		const first = pending()
		const { result, update } = setup()
		act(() => result.current.toggleAll())
		await act(async () => {
			await result.current.run('read')
		})
		update.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('private'))
		const undo = showToast.mock.calls[0][0].action.onAction
		act(() => {
			undo()
			undo()
		})
		expect(update).toHaveBeenCalledTimes(3)
		await act(async () => {
			first.resolve()
			await Promise.resolve()
			await Promise.resolve()
		})
		const retry = showToast.mock.calls.at(-1)?.[0]
		expect(retry.message).toBe('1 conversation could not be restored.')
		await act(async () => {
			retry.action.onAction()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(update).toHaveBeenCalledTimes(5)
		expect(update).toHaveBeenLastCalledWith({ threadId: 'two', unread: false })
	})
	it('keeps every failed Undo available for retry', async () => {
		const { result, update } = setup()
		act(() => result.current.toggleAll())
		await act(async () => {
			await result.current.run('archive')
		})
		update.mockRejectedValue(new Error('offline'))
		await act(async () => {
			showToast.mock.calls[0][0].action.onAction()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(showToast.mock.calls.at(-1)?.[0].message).toBe('2 conversations could not be restored.')
	})
	it('stops multi-item Undo on account switch', async () => {
		const first = pending()
		const { result, update } = setup()
		act(() => result.current.toggleAll())
		await act(async () => {
			await result.current.run('read')
		})
		update.mockReturnValueOnce(first.promise)
		act(() => showToast.mock.calls[0][0].action.onAction())
		scope.account = 'b'
		await act(async () => {
			first.resolve()
			await Promise.resolve()
		})
		expect(update).toHaveBeenCalledTimes(3)
		expect(showToast).toHaveBeenCalledTimes(1)
	})
	it('does not move focus in a different folder after an older batch is undone', async () => {
		const { result, rerender } = setup()
		act(() => result.current.toggle('one'))
		await act(async () => {
			await result.current.run('archive')
		})
		const undo = showToast.mock.calls[0][0].action.onAction
		rerender({ identity: 'archive', list: threads })
		await act(async () => {
			undo()
			await Promise.resolve()
		})
		expect(result.current.focusRevision).toBe(0)
	})
})
