import type { Contact } from '@nylas-labs/cli-kit/v3'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ContactAvatar } from '#features/contacts/components/ContactAvatar'
import { ContactModal } from '#features/contacts/components/ContactModal'
import { contactDisplayName } from '#features/contacts/lib/contacts-model'
import {
	findCachedContact,
	useContact,
	useDeleteContactMutation,
} from '#features/contacts/state/contacts-state'
import { useCompose } from '#features/mail/components/ComposeProvider'
import { getContact } from '#server/fns'
import { seededData } from '#shared/lib/seeded-data'
import { ContactDetailScreen } from './-contact-detail-screen'

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
	const { openCompose } = useCompose()
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
				onNewEmail={(to) => void openCompose({ kind: 'new', to })}
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
