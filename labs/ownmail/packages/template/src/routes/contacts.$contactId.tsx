import type { Contact } from '@nylas-labs/cli-kit/v3'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Building2, Mail, Pencil, Phone, StickyNote, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ContactModal } from '../components/ContactModal.js'
import { contactDisplayName, contactSubtitle } from '../components/contacts-model.js'
import { deleteContact, getContact } from '../server/fns.js'
import { ContactAvatar } from './contacts.js'

export const Route = createFileRoute('/contacts/$contactId')({
	validateSearch: (search): { q?: string; edit?: true } => ({
		...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
		...(search.edit ? { edit: true } : {}),
	}),
	loader: ({ params }) => getContact({ data: { contactId: params.contactId } }),
	component: ContactDetailRoute,
})

function ContactDetailRoute() {
	const contact = Route.useLoaderData()
	const { q, edit } = Route.useSearch()
	const navigate = useNavigate()
	const router = useRouter()
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const search = q ? { q } : {}

	function openEdit() {
		navigate({
			to: '/contacts/$contactId',
			params: { contactId: contact.id },
			search: { ...search, edit: true },
		})
	}

	function closeEdit(changed: boolean) {
		if (changed) void router.invalidate()
		navigate({ to: '/contacts/$contactId', params: { contactId: contact.id }, search })
	}

	async function remove() {
		setDeleteError(null)
		try {
			await deleteContact({ data: { contactId: contact.id } })
			void router.invalidate()
			navigate({ to: '/contacts', search })
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : 'Failed to delete contact')
		}
	}

	return (
		<>
			<ContactDetailScreen
				contact={contact}
				confirmingDelete={confirmingDelete}
				deleteError={deleteError}
				onBack={() => navigate({ to: '/contacts', search })}
				onEdit={openEdit}
				onRequestDelete={() => setConfirmingDelete(true)}
				onCancelDelete={() => setConfirmingDelete(false)}
				onConfirmDelete={remove}
			/>
			{edit ? <ContactModal contact={contact} onClose={closeEdit} /> : null}
		</>
	)
}

export function ContactDetailScreen({
	contact,
	confirmingDelete,
	deleteError,
	onBack,
	onEdit,
	onRequestDelete,
	onCancelDelete,
	onConfirmDelete,
}: {
	contact: Contact
	confirmingDelete: boolean
	deleteError: string | null
	onBack: () => void
	onEdit: () => void
	onRequestDelete: () => void
	onCancelDelete: () => void
	onConfirmDelete: () => void
}) {
	const name = contactDisplayName(contact)
	const subtitle = contactSubtitle(contact)
	return (
		<div className="mx-auto max-w-2xl px-5 py-6">
			<button
				type="button"
				onClick={onBack}
				className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:hidden"
			>
				<ArrowLeft className="h-4 w-4" /> All contacts
			</button>

			<div className="flex items-start gap-4">
				<ContactAvatar name={name} className="h-14 w-14 text-lg" />
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-semibold text-balance">{name}</h1>
					{subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
				</div>
			</div>

			<div className="mt-6 space-y-5">
				{contact.emails?.length ? (
					<DetailSection icon={<Mail className="h-4 w-4" />} title="Email">
						{contact.emails.map((entry) => (
							<DetailRow key={entry.email} label={entry.type}>
								<a href={`mailto:${entry.email}`} className="text-primary hover:underline">
									{entry.email}
								</a>
							</DetailRow>
						))}
					</DetailSection>
				) : null}

				{contact.phone_numbers?.length ? (
					<DetailSection icon={<Phone className="h-4 w-4" />} title="Phone">
						{contact.phone_numbers.map((entry) => (
							<DetailRow key={entry.number} label={entry.type}>
								{entry.number}
							</DetailRow>
						))}
					</DetailSection>
				) : null}

				{contact.company_name || contact.job_title ? (
					<DetailSection icon={<Building2 className="h-4 w-4" />} title="Work">
						<DetailRow>{[contact.job_title, contact.company_name].filter(Boolean).join(' · ')}</DetailRow>
					</DetailSection>
				) : null}

				{contact.notes ? (
					<DetailSection icon={<StickyNote className="h-4 w-4" />} title="Notes">
						<p className="text-sm whitespace-pre-wrap text-foreground/80">{contact.notes}</p>
					</DetailSection>
				) : null}
			</div>

			{deleteError ? (
				<p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{deleteError}</p>
			) : null}

			<div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
				<button
					type="button"
					onClick={onEdit}
					className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
				>
					<Pencil className="h-4 w-4" /> Edit
				</button>
				{confirmingDelete ? (
					<>
						<button
							type="button"
							onClick={onConfirmDelete}
							className="flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-destructive/90"
						>
							<Trash2 className="h-4 w-4" /> Confirm delete
						</button>
						<button
							type="button"
							onClick={onCancelDelete}
							className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
						>
							Cancel
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={onRequestDelete}
						className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
					>
						<Trash2 className="h-4 w-4" /> Delete
					</button>
				)}
			</div>
		</div>
	)
}

function DetailSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
	return (
		<section>
			<h2 className="mb-1.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{icon} {title}
			</h2>
			<div className="space-y-1 pl-6 text-sm">{children}</div>
		</section>
	)
}

function DetailRow({ label, children }: { label?: string; children: ReactNode }) {
	return (
		<div className="flex items-baseline gap-2">
			<span>{children}</span>
			{label ? <span className="text-xs text-muted-foreground capitalize">{label}</span> : null}
		</div>
	)
}
