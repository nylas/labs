import { Archive, ListChecks, Mail, MailOpen, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { BulkAction, BulkTriage } from '#features/mail/state/use-bulk-triage'
import { Button } from '#shared/components/ui/button'
import { useSetMailSelectionActions } from './MailSelectionActions.js'

const ACTIONS = [
	{ action: 'archive', label: 'Archive selected', icon: Archive },
	{ action: 'read', label: 'Mark selected as read', icon: MailOpen },
	{ action: 'unread', label: 'Mark selected as unread', icon: Mail },
	{ action: 'trash', label: 'Move selected to Trash', icon: Trash2 },
] as const

function BulkActionButtons({ selection, mobile = false }: { selection: BulkTriage; mobile?: boolean }) {
	return ACTIONS.map(({ action, label, icon: Icon }) => (
		<Button
			key={action}
			variant="ghost"
			size="icon"
			className={mobile ? 'flex-1' : undefined}
			aria-label={label}
			title={label}
			disabled={selection.pending || selection.selectedCount === 0}
			onClick={() => void selection.run(action as BulkAction)}
		>
			<Icon className="h-4 w-4" aria-hidden="true" />
		</Button>
	))
}

/** Count and loaded-only selection stay visible; mobile actions reuse the app's bottom bar. */
export function BulkMailToolbar({ selection }: { selection: BulkTriage }) {
	const publishMobileActions = useSetMailSelectionActions()
	const allRef = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (allRef.current) allRef.current.indeterminate = selection.selectedCount > 0 && !selection.allSelected
	}, [selection.allSelected, selection.selectedCount])
	useEffect(() => {
		if (selection.selecting && selection.focusRevision >= 0) allRef.current?.focus()
	}, [selection.focusRevision, selection.selecting])
	useEffect(() => {
		publishMobileActions(selection.selecting ? <BulkActionButtons selection={selection} mobile /> : null)
		return () => publishMobileActions(null)
	}, [publishMobileActions, selection])

	if (!selection.selecting)
		return (
			<Button
				variant="ghost"
				size="icon"
				onClick={selection.start}
				disabled={selection.loadedCount === 0}
				id="mail-select-messages"
				aria-label="Select messages"
				title="Select messages"
			>
				<ListChecks className="h-4 w-4" aria-hidden="true" />
			</Button>
		)
	return (
		<fieldset
			className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
			aria-label="Bulk mail selection"
			aria-busy={selection.pending}
		>
			<label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
				<input
					ref={allRef}
					type="checkbox"
					checked={selection.allSelected}
					disabled={selection.pending}
					onChange={selection.toggleAll}
					aria-label="Select all loaded conversations"
					className="h-4 w-4 accent-primary"
				/>
				<span>Select all loaded</span>
			</label>
			<span className="text-sm tabular-nums" role="status">
				{selection.selectedCount} selected{selection.pending ? ' · Updating…' : ''}
			</span>
			<div className="hidden items-center gap-1 md:flex">
				<BulkActionButtons selection={selection} />
			</div>
			<Button
				variant="ghost"
				disabled={selection.pending}
				onClick={() => {
					selection.clear()
					requestAnimationFrame(() => document.getElementById('mail-select-messages')?.focus())
				}}
			>
				Done selecting
			</Button>
			{selection.error ? (
				<p role="alert" className="w-full text-xs text-destructive">
					{selection.error}
				</p>
			) : null}
		</fieldset>
	)
}
