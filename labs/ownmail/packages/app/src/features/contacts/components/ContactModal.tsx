import type { Contact } from '@nylas-labs/cli-kit/v3'
import { Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '#shared/components/ui/dialog'
import { Input } from '#shared/components/ui/input'
import { Textarea } from '#shared/components/ui/textarea'
import { cn } from '#shared/lib/utils'
import {
	type ContactForm,
	type ContactFormValidation,
	contactFormsEqual,
	contactToForm,
	emptyContactForm,
	formToFields,
	removeAt,
	replaceAt,
	validateContactForm,
} from '../lib/contacts-model.js'
import { useCreateContactMutation, useUpdateContactMutation } from '../state/contacts-state.js'

const FIELD_TYPES = ['', 'work', 'home', 'other'] as const

export const CONTACT_DIALOG_PANEL_CLASS = 'flex flex-col overflow-hidden bg-card sm:max-h-[85vh] sm:max-w-lg'

/** Create (contact = null) or edit a contact. Resolves with whether it changed. */
export function ContactModal({
	contact,
	onClose,
}: {
	contact: Contact | null
	onClose: (changed: boolean, contactId?: string) => void
}) {
	const [initialForm] = useState<ContactForm>(() => (contact ? contactToForm(contact) : emptyContactForm()))
	const [form, setForm] = useState<ContactForm>(initialForm)
	const [busy, setBusy] = useState(false)
	const [confirmingDiscard, setConfirmingDiscard] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [validation, setValidation] = useState<ContactFormValidation | null>(null)
	const busyRef = useRef(false)
	const closedRef = useRef(false)
	const restoreFocusTargetRef = useRef<HTMLElement | null>(null)
	const cancelButtonRef = useRef<HTMLButtonElement>(null)
	const continueEditingButtonRef = useRef<HTMLButtonElement>(null)
	const givenNameRef = useRef<HTMLInputElement>(null)
	const emailRefs = useRef<Array<HTMLInputElement | null>>([])
	const createMutation = useCreateContactMutation()
	const updateMutation = useUpdateContactMutation(contact)
	const dirty = !contactFormsEqual(form, initialForm)

	useEffect(() => {
		if (confirmingDiscard) {
			continueEditingButtonRef.current?.focus()
		} else if (restoreFocusTargetRef.current) {
			const target = restoreFocusTargetRef.current
			restoreFocusTargetRef.current = null
			target.focus()
		}
	}, [confirmingDiscard])

	function finishClose(changed: boolean, contactId?: string) {
		if (closedRef.current) return
		closedRef.current = true
		if (contactId === undefined) onClose(changed)
		else onClose(changed, contactId)
	}

	function requestClose(focusTarget?: HTMLElement) {
		if (busyRef.current || closedRef.current) return
		if (dirty) {
			const activeElement = document.activeElement as HTMLElement
			restoreFocusTargetRef.current = focusTarget ?? activeElement
			setConfirmingDiscard(true)
			return
		}
		finishClose(false)
	}

	function continueEditing() {
		setConfirmingDiscard(false)
	}

	function patch(next: Partial<ContactForm>) {
		setError(null)
		setForm((current) => ({ ...current, ...next }))
	}

	function clearIdentityValidation() {
		setValidation((current) => (current?.field === 'identity' ? null : current))
	}

	function clearEmailValidation(index: number) {
		setValidation((current) =>
			current?.field === 'identity' || (current?.field === 'email' && current.index === index)
				? null
				: current,
		)
	}

	async function save() {
		/* v8 ignore next -- native disabled state prevents repeated UI submission; the ref closes same-batch gaps -- @preserve */
		if (busyRef.current || closedRef.current) return
		setError(null)
		const nextValidation = validateContactForm(form)
		if (nextValidation) {
			setValidation(nextValidation)
			if (nextValidation.field === 'identity') givenNameRef.current?.focus()
			else emailRefs.current[nextValidation.index]?.focus()
			return
		}
		setValidation(null)
		busyRef.current = true
		setBusy(true)
		try {
			const fields = formToFields(form)
			if (contact) {
				await updateMutation.mutateAsync(fields)
				finishClose(true, contact.id)
			} else {
				const created = await createMutation.mutateAsync(fields)
				finishClose(true, created.contactId)
			}
		} catch {
			setError('Could not save contact. Check your connection, then try again.')
			busyRef.current = false
			setBusy(false)
		}
	}

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				/* v8 ignore next -- this controlled, always-open dialog only emits false dismissal requests -- @preserve */
				if (next) return
				if (confirmingDiscard) {
					continueEditing()
					return
				}
				requestClose()
			}}
		>
			<DialogContent
				presentation="bottom-sheet"
				className={CONTACT_DIALOG_PANEL_CLASS}
				aria-busy={busy || undefined}
				{...(confirmingDiscard
					? {
							role: 'alertdialog' as const,
							'aria-labelledby': 'contact-discard-title',
							'aria-describedby': 'contact-discard-description',
						}
					: {})}
				/* v8 ignore next -- Radix owns the native pointer-outside event; explicit overlay tests cover dismissal -- @preserve */
				onPointerDownOutside={(event) => event.preventDefault()}
				onBackdropClick={confirmingDiscard ? continueEditing : () => requestClose()}
			>
				{confirmingDiscard ? (
					<DiscardConfirmation
						continueButtonRef={continueEditingButtonRef}
						onContinue={continueEditing}
						onDiscard={() => finishClose(false)}
					/>
				) : null}

				<div
					hidden={confirmingDiscard}
					className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"
				>
					<DialogTitle className="text-lg font-semibold">
						{contact ? 'Edit contact' : 'New contact'}
					</DialogTitle>
					<button
						type="button"
						onClick={(event) => requestClose(event.currentTarget)}
						disabled={busy}
						aria-label="Close"
						className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:opacity-50"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div hidden={confirmingDiscard} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<Field id="contact-given-name" label="First name">
							<Input
								ref={givenNameRef}
								id="contact-given-name"
								autoComplete="given-name"
								disabled={busy}
								value={form.givenName}
								aria-invalid={validation?.field === 'identity' || undefined}
								aria-describedby={validation?.field === 'identity' ? 'contact-form-validation' : undefined}
								className="h-11"
								onChange={(e) => {
									patch({ givenName: e.target.value })
									clearIdentityValidation()
								}}
							/>
						</Field>
						<Field id="contact-surname" label="Last name">
							<Input
								id="contact-surname"
								autoComplete="family-name"
								disabled={busy}
								value={form.surname}
								className="h-11"
								onChange={(e) => {
									patch({ surname: e.target.value })
									clearIdentityValidation()
								}}
							/>
						</Field>
						<Field id="contact-company" label="Company">
							<Input
								id="contact-company"
								autoComplete="organization"
								disabled={busy}
								value={form.companyName}
								className="h-11"
								onChange={(e) => {
									patch({ companyName: e.target.value })
									clearIdentityValidation()
								}}
							/>
						</Field>
						<Field id="contact-job-title" label="Job title">
							<Input
								id="contact-job-title"
								autoComplete="organization-title"
								disabled={busy}
								value={form.jobTitle}
								className="h-11"
								onChange={(e) => patch({ jobTitle: e.target.value })}
							/>
						</Field>
					</div>

					<RowGroup
						legend="Email"
						addLabel="Add email"
						disabled={busy}
						onAdd={() => patch({ emails: [...form.emails, { email: '', type: '' }] })}
					>
						{form.emails.map((row, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
							<div key={index} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
								<Input
									ref={(node) => {
										emailRefs.current[index] = node
									}}
									id={`contact-email-${index}`}
									name={`contact-email-${index}`}
									type="email"
									autoComplete={index === 0 ? 'email' : `section-contact-email-${index + 1} email`}
									disabled={busy}
									aria-label={`Email ${index + 1}`}
									aria-invalid={
										validation?.field === 'email' && validation.index === index ? true : undefined
									}
									aria-describedby={
										validation?.field === 'email' && validation.index === index
											? 'contact-form-validation'
											: undefined
									}
									placeholder="name@example.com"
									value={row.email}
									onChange={(e) => {
										patch({ emails: replaceAt(form.emails, index, { ...row, email: e.target.value }) })
										clearEmailValidation(index)
									}}
									className="h-11 flex-1"
								/>
								<TypeSelect
									label={`Email ${index + 1} type`}
									disabled={busy}
									value={row.type}
									onChange={(type) => patch({ emails: replaceAt(form.emails, index, { ...row, type }) })}
								/>
								<RemoveRowButton
									label={`Remove email ${index + 1}`}
									disabled={busy}
									onClick={() => {
										patch({ emails: removeAt(form.emails, index) })
										setValidation(null)
									}}
								/>
							</div>
						))}
					</RowGroup>

					<RowGroup
						legend="Phone"
						addLabel="Add phone"
						disabled={busy}
						onAdd={() => patch({ phoneNumbers: [...form.phoneNumbers, { number: '', type: '' }] })}
					>
						{form.phoneNumbers.map((row, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
							<div key={index} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
								<Input
									id={`contact-phone-${index}`}
									name={`contact-phone-${index}`}
									type="tel"
									autoComplete={index === 0 ? 'tel' : `section-contact-phone-${index + 1} tel`}
									disabled={busy}
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
									className="h-11 flex-1"
								/>
								<TypeSelect
									label={`Phone ${index + 1} type`}
									disabled={busy}
									value={row.type}
									onChange={(type) =>
										patch({ phoneNumbers: replaceAt(form.phoneNumbers, index, { ...row, type }) })
									}
								/>
								<RemoveRowButton
									label={`Remove phone ${index + 1}`}
									disabled={busy}
									onClick={() => patch({ phoneNumbers: removeAt(form.phoneNumbers, index) })}
								/>
							</div>
						))}
					</RowGroup>

					<Field id="contact-notes" label="Notes">
						<Textarea
							id="contact-notes"
							disabled={busy}
							value={form.notes}
							onChange={(e) => patch({ notes: e.target.value })}
							className="min-h-20"
						/>
					</Field>

					{validation ? (
						<p
							id="contact-form-validation"
							role="alert"
							className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
						>
							{validation.message}
						</p>
					) : null}
					{error ? (
						<p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
							{error}
						</p>
					) : null}
				</div>

				<div
					hidden={confirmingDiscard}
					className="flex items-center justify-end gap-2 border-t border-border px-5 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom))]"
				>
					<button
						ref={cancelButtonRef}
						type="button"
						onClick={(event) => requestClose(event.currentTarget)}
						disabled={busy}
						className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={save}
						className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid active:scale-[0.98] disabled:opacity-50"
					>
						{busy ? 'Saving...' : contact ? 'Save changes' : 'Add contact'}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

function DiscardConfirmation({
	continueButtonRef,
	onContinue,
	onDiscard,
}: {
	continueButtonRef: React.RefObject<HTMLButtonElement | null>
	onContinue: () => void
	onDiscard: () => void
}) {
	return (
		<div className="p-5">
			<h2 id="contact-discard-title" className="text-lg font-semibold">
				Discard unsaved changes?
			</h2>
			<p id="contact-discard-description" className="mt-2 text-sm leading-6 text-muted-foreground">
				Your contact changes have not been saved. You can keep editing or discard them.
			</p>
			<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					ref={continueButtonRef}
					type="button"
					onClick={onContinue}
					className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
				>
					Continue editing
				</button>
				<button
					type="button"
					onClick={onDiscard}
					className="min-h-11 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid"
				>
					Discard changes
				</button>
			</div>
		</div>
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
	disabled,
	onAdd,
	children,
}: {
	legend: string
	addLabel: string
	disabled: boolean
	onAdd: () => void
	children: React.ReactNode
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">{legend}</span>
				<button
					type="button"
					disabled={disabled}
					onClick={onAdd}
					className="flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:opacity-50"
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
	disabled,
	onChange,
}: {
	label: string
	value: string
	disabled: boolean
	onChange: (value: string) => void
}) {
	return (
		<select
			aria-label={label}
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			className={cn(
				'h-11 rounded-md border border-border bg-card px-2 text-sm text-muted-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid',
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

function RemoveRowButton({
	label,
	disabled,
	onClick,
}: {
	label: string
	disabled: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="flex h-11 w-11 shrink-0 self-end items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-solid disabled:opacity-50 sm:self-auto"
		>
			<X className="h-4 w-4" />
		</button>
	)
}
