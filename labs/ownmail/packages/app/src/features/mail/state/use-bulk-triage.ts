import { useRef } from 'react'
import { accountScope } from '#app/lib/account-scope'
import { systemFolderBeforeMove } from '#features/mail/state/mail-cache'
import type { MailThread } from '#features/mail/state/mail-queries'
import { useToast } from '#shared/components/Toaster'
import { useIdentityState } from '#shared/hooks/use-identity-state'

export type BulkAction = 'archive' | 'trash' | 'read' | 'unread'
export type BulkUpdate = { threadId: string; unread?: boolean; folder?: string }
type SelectionState = {
	selecting: boolean
	ids: string[]
	pending: boolean
	error: string | null
	focusRevision: number
}
const initialSelection = (): SelectionState => ({
	selecting: false,
	ids: [],
	pending: false,
	error: null,
	focusRevision: 0,
})
const actionLabels: Record<BulkAction, string> = {
	archive: 'archived',
	trash: 'moved to Trash',
	read: 'marked as read',
	unread: 'marked as unread',
}

/** Only loaded selected IDs enter a batch. Each existing mutation owns its rollback. */
export function useBulkTriage({
	identity,
	threads,
	update,
}: {
	identity: string
	threads: MailThread[]
	update: (input: BulkUpdate) => Promise<unknown>
}) {
	const account = accountScope()
	const scope = `${account}:${identity}`
	const currentScope = useRef(scope)
	currentScope.current = scope
	const pendingScope = useRef<string | null>(null)
	const [state, setState] = useIdentityState([scope], initialSelection)
	const { showToast } = useToast()
	const selected = threads.filter((thread) => state.ids.includes(thread.id))
	const loadedIds = threads.map((thread) => thread.id)

	function start() {
		setState({ ...initialSelection(), selecting: true })
	}
	function clear() {
		if (pendingScope.current === scope) return
		setState(initialSelection())
	}
	function toggle(id: string) {
		if (pendingScope.current === scope || !loadedIds.includes(id)) return
		setState((previous) => ({
			...previous,
			ids: previous.ids.includes(id) ? previous.ids.filter((item) => item !== id) : [...previous.ids, id],
		}))
	}
	function toggleAll() {
		if (pendingScope.current === scope) return
		setState((previous) => ({
			...previous,
			ids: loadedIds.every((id) => previous.ids.includes(id)) ? [] : loadedIds,
		}))
	}

	async function run(action: BulkAction) {
		if (pendingScope.current === scope || selected.length === 0) return
		pendingScope.current = scope
		setState((previous) => ({ ...previous, pending: true, error: null }))
		const failed: string[] = []
		const inverses: BulkUpdate[] = []
		for (const thread of selected) {
			if (currentScope.current !== scope || accountScope() !== account) break
			const moving = action === 'archive' || action === 'trash'
			const from = systemFolderBeforeMove(thread.folders)
			// Do not move a thread if its original location cannot be restored accurately.
			if (moving && !from) {
				failed.push(thread.id)
				continue
			}
			try {
				await update(
					moving
						? { threadId: thread.id, folder: action }
						: { threadId: thread.id, unread: action === 'unread' },
				)
				inverses.push(
					moving
						? { threadId: thread.id, folder: from }
						: { threadId: thread.id, unread: Boolean(thread.unread) },
				)
			} catch {
				failed.push(thread.id)
			}
		}
		if (pendingScope.current === scope) pendingScope.current = null
		if (currentScope.current !== scope || accountScope() !== account) return
		setState((previous) => ({
			...previous,
			focusRevision: previous.focusRevision + 1,
			ids: failed,
			pending: false,
			error: failed.length
				? `${failed.length} conversation${failed.length === 1 ? '' : 's'} could not be updated. They remain selected; retry or open them individually.`
				: null,
		}))
		if (inverses.length) {
			let undoPending = false
			const undo = async () => {
				if (undoPending || accountScope() !== account) return
				undoPending = true
				const remaining: BulkUpdate[] = []
				for (const inverse of inverses) {
					if (accountScope() !== account) break
					try {
						await update(inverse)
					} catch {
						remaining.push(inverse)
					}
				}
				if (accountScope() !== account) return
				inverses.splice(0, inverses.length, ...remaining)
				undoPending = false
				if (currentScope.current === scope)
					setState((previous) => ({ ...previous, focusRevision: previous.focusRevision + 1 }))
				showToast(
					remaining.length
						? {
								message: `${remaining.length} conversation${remaining.length === 1 ? '' : 's'} could not be restored.`,
								action: { label: 'Retry Undo', onAction: () => void undo() },
							}
						: { message: 'Changes undone' },
				)
			}
			showToast({
				message: `${inverses.length} conversation${inverses.length === 1 ? '' : 's'} ${actionLabels[action]}`,
				action: { label: 'Undo', onAction: () => void undo() },
			})
		}
	}

	return {
		...state,
		selectedIds: state.ids,
		selectedCount: state.pending ? state.ids.length : selected.length,
		loadedCount: threads.length,
		allSelected: threads.length > 0 && selected.length === threads.length,
		start,
		clear,
		toggle,
		toggleAll,
		run,
	}
}

export type BulkTriage = ReturnType<typeof useBulkTriage>
