import type { Contact } from '@nylas-labs/cli-kit/v3'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Building2, Mail, Pencil, Phone, StickyNote, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ContactContextMenu } from '#features/contacts/components/ContactContextMenu'
import { ContactModal } from '#features/contacts/components/ContactModal'
import { contactDisplayName, contactSubtitle } from '#features/contacts/lib/contacts-model'
import {
	findCachedContact,
	useContact,
	useDeleteContactMutation,
} from '#features/contacts/state/contacts-state'
import { getContact } from '#server/fns'
import { Section } from '#shared/components/ui/section'
import { seededData } from '#shared/lib/seeded-data'
import { ContactAvatar } from './contacts.js'

export const Route = createFileRoute('/contacts/$contactId')({
	validateSearch: (search): { q?: string; edit?: true; delete?: true } => ({
		...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
		...(search.edit ? { edit: true } : {}),
		// Set by the list's context menu: open on the delete confirmation.
		...(search.delete ? { delete: true } : {}),
	}),
	loader: ({ params }) => getContact({ data: { contactId: params.contactId } }),
	component: ContactDetailRoute,
	pendingComponent: ContactPending,
})

/** Shown while another contact loads. The name comes from the list beside it
 * when that row is cached; the previous contact's details are never kept. */
function ContactPending() {
	const { contactId } = Route.useParams()
	const listed = findCachedContact(useQueryClient(), contactId)
	const name = listed ? contactDisplayName(listed) : undefined
	return (
		<div data-testid="contact-pending" aria-busy="true" className="mx-auto max-w-2xl px-5 py-6">
			<div className="flex items-start gap-4">
				{name ? (
					<ContactAvatar name={name} className="h-14 w-14 text-lg" />
				) : (
					<div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
				)}
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-semibold text-balance">{name ?? 'Loading contact…'}</h1>
				</div>
			</div>
			<div className="mt-6 flex flex-col gap-3" aria-hidden="true">
				<div className="h-4 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
				<div className="h-4 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
				<div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
			</div>
		</div>
	)
}

function ContactDetailRoute() {
	const loadedContact = Route.useLoaderData()
	// The delete confirmation and its error belong to one contact, so they live
	// under a key equal to the contact id.
	return <ContactDetail key={loadedContact.id} loadedContact={loadedContact} />
}

function ContactDetail({ loadedContact }: { loadedContact: Contact }) {
	const contact = seededData(useContact(loadedContact.id, loadedContact).data, loadedContact)
	const { q, edit, delete: deleteRequested } = Route.useSearch()
	const navigate = useNavigate()
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const deleteMutation = useDeleteContactMutation(contact.id)
	const search = q ? { q } : {}

	function openEdit() {
		navigate({
			to: '/contacts/$contactId',
			params: { contactId: contact.id },
			search: { ...search, edit: true },
		})
	}

	function closeEdit(_changed: boolean) {
		navigate({ to: '/contacts/$contactId', params: { contactId: contact.id }, search })
	}

	async function remove() {
		/* v8 ignore next -- the confirmed-delete control is disabled as soon as the first request starts -- @preserve */
		if (deleting) return
		setDeleteError(null)
		setDeleting(true)
		try {
			await deleteMutation.mutateAsync()
			navigate({ to: '/contacts', search })
		} catch {
			setDeleteError('Failed to delete contact')
			setDeleting(false)
		}
	}

	return (
		<>
			<ContactDetailScreen
				contact={contact}
				confirmingDelete={confirmingDelete || Boolean(deleteRequested)}
				deleting={deleting}
				deleteError={deleteError}
				onBack={() => navigate({ to: '/contacts', search })}
				onEdit={openEdit}
				onNewEmail={(to) => navigate({ to: '/mail/compose', search: { to } })}
				onRequestDelete={() => setConfirmingDelete(true)}
				onCancelDelete={() => {
					setConfirmingDelete(false)
					// A confirmation the list asked for lives in the URL; cancelling clears it.
					if (deleteRequested)
						navigate({ to: '/contacts/$contactId', params: { contactId: contact.id }, search })
				}}
				onConfirmDelete={remove}
			/>
			{edit ? <ContactModal contact={contact} onClose={closeEdit} /> : null}
		</>
	)
}

export function ContactDetailScreen({
	contact,
	confirmingDelete,
	deleting = false,
	deleteError,
	onBack,
	onEdit,
	onNewEmail,
	onRequestDelete,
	onCancelDelete,
	onConfirmDelete,
}: {
	contact: Contact
	confirmingDelete: boolean
	deleting?: boolean
	deleteError: string | null
	onBack: () => void
	onEdit: () => void
	onNewEmail: (email: string) => void
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
				className="mb-4 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
			>
				<ArrowLeft className="h-4 w-4" /> All contacts
			</button>

			{/* The header's menu holds the actions of the buttons below. The
			    details keep the browser menu, for their links and text. */}
			<ContactContextMenu
				contact={contact}
				onEdit={onEdit}
				onNewEmail={onNewEmail}
				onRequestDelete={onRequestDelete}
			>
				<div className="flex items-start gap-4">
					<ContactAvatar name={name} className="h-14 w-14 text-lg" />
					<div className="min-w-0 flex-1">
						<h1 className="text-xl font-semibold text-balance">{name}</h1>
						{subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
					</div>
				</div>
			</ContactContextMenu>

			<div className="mt-6 space-y-5">
				{contact.emails?.length ? (
					<DetailSection icon={<Mail className="h-4 w-4" />} title="Email">
						{contact.emails.map((entry) => (
							<DetailRow key={entry.email} label={entry.type}>
								<a
									href={`mailto:${entry.email}`}
									className="flex min-h-11 items-center rounded-lg px-2 text-primary transition-colors hover:bg-muted hover:underline"
								>
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
								<a
									href={`tel:${entry.number}`}
									className="flex min-h-11 items-center rounded-lg px-2 text-primary transition-colors hover:bg-muted hover:underline"
								>
									{entry.number}
								</a>
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
				<p role="alert" className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{deleteError}
				</p>
			) : null}

			<Section className="flex flex-col items-stretch gap-2 min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:items-center">
				<button
					type="button"
					onClick={onEdit}
					disabled={deleting}
					className="flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 min-[400px]:justify-start"
				>
					<Pencil className="h-4 w-4" /> Edit
				</button>
				{confirmingDelete ? (
					<>
						<button
							type="button"
							onClick={onConfirmDelete}
							disabled={deleting}
							className="flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50 min-[400px]:justify-start"
						>
							<Trash2 className="h-4 w-4" /> {deleting ? 'Deleting…' : 'Confirm delete'}
						</button>
						<button
							type="button"
							onClick={onCancelDelete}
							disabled={deleting}
							className="min-h-11 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
						>
							Cancel
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={onRequestDelete}
						disabled={deleting}
						className="flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 min-[400px]:justify-start"
					>
						<Trash2 className="h-4 w-4" /> Delete
					</button>
				)}
			</Section>
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
		<div className="flex min-h-11 items-center gap-2">
			<span className="min-w-0">{children}</span>
			{label ? <span className="text-xs text-muted-foreground capitalize">{label}</span> : null}
		</div>
	)
}
