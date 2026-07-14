import type { Contact } from '@nylas-labs/cli-kit/v3'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { createContact, updateContact } from '../server/fns.js'
import {
	type ContactForm,
	contactToForm,
	emptyContactForm,
	formToFields,
	removeAt,
	replaceAt,
} from './contacts-model.js'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.js'
import { Input } from './ui/input.js'
import { Textarea } from './ui/textarea.js'
import { cn } from './ui-model.js'

const FIELD_TYPES = ['', 'work', 'home', 'other'] as const

export const CONTACT_DIALOG_PANEL_CLASS =
	'flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl'

/** Create (contact = null) or edit a contact. Resolves with whether it changed. */
export function ContactModal({
	contact,
	onClose,
}: {
	contact: Contact | null
	onClose: (changed: boolean, contactId?: string) => void
}) {
	const [form, setForm] = useState<ContactForm>(() => (contact ? contactToForm(contact) : emptyContactForm()))
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	function patch(next: Partial<ContactForm>) {
		setForm((current) => ({ ...current, ...next }))
	}

	async function save() {
		setBusy(true)
		setError(null)
		try {
			const fields = formToFields(form)
			if (contact) {
				await updateContact({ data: { contactId: contact.id, ...fields } })
				onClose(true, contact.id)
			} else {
				const created = await createContact({ data: fields })
				onClose(true, created.contactId)
			}
		} catch {
			setError('Failed to save contact')
			setBusy(false)
		}
	}

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				/* v8 ignore next -- while saving, the dialog cannot be dismissed */
				if (!next && !busy) onClose(false)
			}}
		>
			<DialogContent className={CONTACT_DIALOG_PANEL_CLASS}>
				<div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
					<DialogTitle className="text-lg font-semibold">
						{contact ? 'Edit contact' : 'New contact'}
					</DialogTitle>
					<button
						type="button"
						onClick={() => onClose(false)}
						disabled={busy}
						aria-label="Close"
						className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					<div className="grid grid-cols-2 gap-3">
						<Field id="contact-given-name" label="First name">
							<Input
								id="contact-given-name"
								value={form.givenName}
								onChange={(e) => patch({ givenName: e.target.value })}
							/>
						</Field>
						<Field id="contact-surname" label="Last name">
							<Input
								id="contact-surname"
								value={form.surname}
								onChange={(e) => patch({ surname: e.target.value })}
							/>
						</Field>
						<Field id="contact-company" label="Company">
							<Input
								id="contact-company"
								value={form.companyName}
								onChange={(e) => patch({ companyName: e.target.value })}
							/>
						</Field>
						<Field id="contact-job-title" label="Job title">
							<Input
								id="contact-job-title"
								value={form.jobTitle}
								onChange={(e) => patch({ jobTitle: e.target.value })}
							/>
						</Field>
					</div>

					<RowGroup
						legend="Email"
						addLabel="Add email"
						onAdd={() => patch({ emails: [...form.emails, { email: '', type: '' }] })}
					>
						{form.emails.map((row, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
							<div key={index} className="flex items-center gap-2">
								<Input
									type="email"
									aria-label={`Email ${index + 1}`}
									placeholder="name@example.com"
									value={row.email}
									onChange={(e) =>
										patch({ emails: replaceAt(form.emails, index, { ...row, email: e.target.value }) })
									}
									className="flex-1"
								/>
								<TypeSelect
									label={`Email ${index + 1} type`}
									value={row.type}
									onChange={(type) => patch({ emails: replaceAt(form.emails, index, { ...row, type }) })}
								/>
								<RemoveRowButton
									label={`Remove email ${index + 1}`}
									onClick={() => patch({ emails: removeAt(form.emails, index) })}
								/>
							</div>
						))}
					</RowGroup>

					<RowGroup
						legend="Phone"
						addLabel="Add phone"
						onAdd={() => patch({ phoneNumbers: [...form.phoneNumbers, { number: '', type: '' }] })}
					>
						{form.phoneNumbers.map((row, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
							<div key={index} className="flex items-center gap-2">
								<Input
									type="tel"
									aria-label={`Phone ${index + 1}`}
									placeholder="+1 555 0100"
									value={row.number}
									onChange={(e) =>
										patch({
											phoneNumbers: replaceAt(form.phoneNumbers, index, {
												...row,
												number: e.target.value,
											}),
										})
									}
									className="flex-1"
								/>
								<TypeSelect
									label={`Phone ${index + 1} type`}
									value={row.type}
									onChange={(type) =>
										patch({ phoneNumbers: replaceAt(form.phoneNumbers, index, { ...row, type }) })
									}
								/>
								<RemoveRowButton
									label={`Remove phone ${index + 1}`}
									onClick={() => patch({ phoneNumbers: removeAt(form.phoneNumbers, index) })}
								/>
							</div>
						))}
					</RowGroup>

					<Field id="contact-notes" label="Notes">
						<Textarea
							id="contact-notes"
							value={form.notes}
							onChange={(e) => patch({ notes: e.target.value })}
							className="min-h-20"
						/>
					</Field>

					{error ? (
						<p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
					) : null}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
					<button
						type="button"
						onClick={() => onClose(false)}
						disabled={busy}
						className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={save}
						className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
					>
						{busy ? 'Saving...' : contact ? 'Save changes' : 'Add contact'}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1.5">
			<label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
				{label}
			</label>
			{children}
		</div>
	)
}

function RowGroup({
	legend,
	addLabel,
	onAdd,
	children,
}: {
	legend: string
	addLabel: string
	onAdd: () => void
	children: React.ReactNode
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">{legend}</span>
				<button
					type="button"
					onClick={onAdd}
					className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
				>
					<Plus className="h-3.5 w-3.5" /> {addLabel}
				</button>
			</div>
			{children}
		</div>
	)
}

function TypeSelect({
	label,
	value,
	onChange,
}: {
	label: string
	value: string
	onChange: (value: string) => void
}) {
	return (
		<select
			aria-label={label}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className={cn(
				'h-9 rounded-md border border-border bg-card px-2 text-sm text-muted-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
			)}
		>
			{FIELD_TYPES.map((type) => (
				<option key={type} value={type}>
					{type === '' ? 'Type' : type.charAt(0).toUpperCase() + type.slice(1)}
				</option>
			))}
		</select>
	)
}

function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
		>
			<X className="h-4 w-4" />
		</button>
	)
}
