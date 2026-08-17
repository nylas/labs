import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Button } from '#shared/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { Input } from '#shared/components/ui/input'

const MAX_RESOURCE_NAME_LENGTH = 200

export type ManagedResource = {
	id: string
	name: string
	detail?: string
	canEdit: boolean
	canDelete: boolean
}

type Action =
	| { kind: 'create' }
	| { kind: 'edit'; resource: ManagedResource }
	| { kind: 'delete'; resource: ManagedResource }

export function ResourceManagerDialog({
	title,
	noun,
	items,
	onClose,
	onCreate,
	onUpdate,
	onDelete,
}: {
	title: string
	noun: string
	items: ManagedResource[]
	onClose: () => void
	onCreate: (name: string) => Promise<void>
	onUpdate: (id: string, name: string) => Promise<void>
	onDelete: (id: string) => Promise<void>
}) {
	const [action, setAction] = useState<Action | null>(null)
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [validation, setValidation] = useState<string | null>(null)
	const busyRef = useRef(false)

	function begin(next: Action) {
		setAction(next)
		setName(next.kind === 'edit' ? next.resource.name : '')
		setError(null)
		setValidation(null)
	}

	function cancelAction() {
		/* v8 ignore next -- action controls are disabled while busy; the ref only closes the same-batch gap -- @preserve */
		if (busyRef.current) return
		setAction(null)
		setError(null)
		setValidation(null)
	}

	async function save(event: FormEvent) {
		event.preventDefault()
		/* v8 ignore next -- the form exists only for create/edit and is disabled while busy -- @preserve */
		if (busyRef.current || !action || action.kind === 'delete') return
		const normalized = name.trim()
		if (!normalized || normalized.length > MAX_RESOURCE_NAME_LENGTH) {
			setValidation(`Enter a ${noun} name up to ${MAX_RESOURCE_NAME_LENGTH} characters.`)
			return
		}
		setValidation(null)
		setError(null)
		busyRef.current = true
		setBusy(true)
		try {
			if (action.kind === 'create') await onCreate(normalized)
			else await onUpdate(action.resource.id, normalized)
			setAction(null)
			setName('')
		} catch {
			setError(`Could not save this ${noun}. Check your connection, then try again.`)
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}

	async function confirmDelete() {
		/* v8 ignore next -- the confirmation control exists only for delete and is disabled while busy -- @preserve */
		if (busyRef.current || action?.kind !== 'delete') return
		setError(null)
		busyRef.current = true
		setBusy(true)
		try {
			await onDelete(action.resource.id)
			setAction(null)
		} catch {
			setError(`Could not delete this ${noun}. Check your connection, then try again.`)
		} finally {
			busyRef.current = false
			setBusy(false)
		}
	}

	function requestClose() {
		if (!busyRef.current) onClose()
	}

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				/* v8 ignore next -- this controlled, always-open dialog only emits false dismissal requests -- @preserve */
				if (!open) requestClose()
			}}
		>
			<DialogContent
				presentation="bottom-sheet"
				className="flex flex-col sm:max-h-[85vh] sm:max-w-md"
				aria-busy={busy || undefined}
				onPointerDownOutside={(event) => event.preventDefault()}
				onBackdropClick={requestClose}
			>
				<div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
					<DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
					<button
						type="button"
						onClick={requestClose}
						disabled={busy}
						aria-label="Close"
						className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-[calc(1rem+var(--safe-area-bottom))]">
					{action?.kind === 'delete' ? (
						<fieldset className="space-y-4 border-0 p-0">
							<legend className="font-semibold">Delete {action.resource.name}?</legend>
							<p className="text-sm text-muted-foreground">This action cannot be undone.</p>
							{error ? (
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
							) : null}
							<div className="flex justify-end gap-2">
								<Button type="button" variant="outline" onClick={cancelAction} disabled={busy}>
									Cancel
								</Button>
								<Button type="button" variant="destructive" onClick={confirmDelete} disabled={busy}>
									{busy ? 'Deleting…' : `Delete ${noun}`}
								</Button>
							</div>
						</fieldset>
					) : action ? (
						<form onSubmit={save} className="space-y-4">
							<label className="block text-sm font-medium" htmlFor="managed-resource-name">
								Name
							</label>
							<Input
								id="managed-resource-name"
								autoFocus
								value={name}
								disabled={busy}
								maxLength={MAX_RESOURCE_NAME_LENGTH + 1}
								aria-invalid={Boolean(validation) || undefined}
								aria-describedby={validation ? 'resource-name-validation' : undefined}
								onChange={(event) => {
									setName(event.target.value)
									setValidation(null)
									setError(null)
								}}
							/>
							{validation ? (
								<p id="resource-name-validation" role="alert" className="text-sm text-destructive">
									{validation}
								</p>
							) : null}
							{error ? (
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
							) : null}
							<div className="flex justify-end gap-2">
								<Button type="button" variant="outline" onClick={cancelAction} disabled={busy}>
									Cancel
								</Button>
								<Button type="submit" disabled={busy}>
									{busy ? 'Saving…' : 'Save'}
								</Button>
							</div>
						</form>
					) : (
						<div className="space-y-3">
							<Button type="button" className="w-full" onClick={() => begin({ kind: 'create' })}>
								<Plus /> Add {noun}
							</Button>
							{items.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">No {noun}s yet.</p>
							) : (
								<ul className="divide-y divide-border rounded-lg border border-border">
									{items.map((item) => (
										<li key={item.id} className="flex min-h-14 items-center gap-2 px-3 py-2">
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium">{item.name}</p>
												{item.detail ? <p className="text-xs text-muted-foreground">{item.detail}</p> : null}
											</div>
											{item.canEdit ? (
												<Button
													type="button"
													size="icon"
													variant="ghost"
													aria-label={`Edit ${item.name}`}
													onClick={() => begin({ kind: 'edit', resource: item })}
												>
													<Pencil />
												</Button>
											) : null}
											{item.canDelete ? (
												<Button
													type="button"
													size="icon"
													variant="ghost"
													aria-label={`Delete ${item.name}`}
													onClick={() => begin({ kind: 'delete', resource: item })}
												>
													<Trash2 />
												</Button>
											) : null}
										</li>
									))}
								</ul>
							)}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
