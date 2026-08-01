import type { Contact } from '@nylas-labs/cli-kit/v3'
import {
	type InfiniteData,
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { ContactFieldsInput } from '#features/contacts/server/contact-input'
import { createContact, deleteContact, getContact, getContacts, updateContact } from '#server/fns'

export type ContactsPage = Awaited<ReturnType<typeof getContacts>>
export type ContactsPages = InfiniteData<ContactsPage, string | undefined>

export const contactsKeys = {
	all: ['contacts'] as const,
	list: () => ['contacts', 'list'] as const,
	detail: (contactId: string) => ['contacts', 'detail', contactId] as const,
}

const CONFIRMED_EFFECT_TTL_MS = 30_000
const confirmedEffects = new WeakMap<
	QueryClient,
	Array<{
		expiresAt: number
		effect:
			| { type: 'created'; contact: Contact }
			| { type: 'updated'; contact: Contact }
			| { type: 'deleted'; contactId: string }
	}>
>()

function rememberConfirmedContactEffect(
	queryClient: QueryClient,
	effect:
		| { type: 'created'; contact: Contact }
		| { type: 'updated'; contact: Contact }
		| { type: 'deleted'; contactId: string },
) {
	const current = confirmedEffects.get(queryClient) ?? []
	confirmedEffects.set(queryClient, [
		...current.filter((entry) => entry.expiresAt > Date.now()),
		{ effect, expiresAt: Date.now() + CONFIRMED_EFFECT_TTL_MS },
	])
}

function reconcileContactPage(
	queryClient: QueryClient,
	page: ContactsPage,
	firstPage: boolean,
): ContactsPage {
	let contacts = page.contacts
	const active = (confirmedEffects.get(queryClient) ?? []).filter((entry) => entry.expiresAt > Date.now())
	confirmedEffects.set(queryClient, active)
	for (const { effect } of active) {
		if (effect.type === 'deleted') {
			contacts = contacts.filter((contact) => contact.id !== effect.contactId)
			continue
		}
		const found = contacts.some((contact) => contact.id === effect.contact.id)
		contacts = found
			? contacts.map((contact) => (contact.id === effect.contact.id ? effect.contact : contact))
			: effect.type === 'created' && firstPage
				? [effect.contact, ...contacts]
				: contacts
	}
	return { ...page, contacts: dedupeContacts(contacts) }
}

function contactsInitialData(page: ContactsPage): ContactsPages {
	return { pages: [page], pageParams: [undefined] }
}

/** The route loader supplies the first page; subsequent pages live in one deduplicated cache. */
export function useContactsPages(initialPage: ContactsPage) {
	const queryClient = useQueryClient()
	const loaderPageRef = useRef(initialPage)
	const query = useInfiniteQuery({
		queryKey: contactsKeys.list(),
		queryFn: async ({ pageParam }) =>
			reconcileContactPage(
				queryClient,
				await getContacts({ data: pageParam ? { pageToken: pageParam } : {} }),
				pageParam === undefined,
			),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor,
		initialData: contactsInitialData(initialPage),
		select: (data) => ({
			...data,
			pages: data.pages.map((page, index) => reconcileContactPage(queryClient, page, index === 0)),
		}),
	})
	useEffect(() => {
		if (loaderPageRef.current !== initialPage) {
			loaderPageRef.current = initialPage
			queryClient.setQueryData(
				contactsKeys.list(),
				contactsInitialData(reconcileContactPage(queryClient, initialPage, true)),
			)
		}
		return () => {
			void queryClient
				.cancelQueries({ queryKey: contactsKeys.list(), exact: true }, { revert: true, silent: true })
				.catch(
					/* v8 ignore next -- @preserve cancellation is best-effort lifecycle cleanup with no user-facing failure */
					() => {},
				)
		}
	}, [initialPage, queryClient])
	return query
}

export function useContact(contactId: string, initialData: Contact) {
	const queryClient = useQueryClient()
	return useQuery({
		queryKey: contactsKeys.detail(contactId),
		queryFn: async () => {
			const contact = await getContact({ data: { contactId } })
			return reconcileContactPage(queryClient, { contacts: [contact] }, true).contacts[0] ?? contact
		},
		initialData,
		select: (contact) =>
			reconcileContactPage(queryClient, { contacts: [contact] }, true).contacts[0] ?? contact,
	})
}

function dedupeContacts(contacts: Contact[]): Contact[] {
	const byId = new Map<string, Contact>()
	for (const contact of contacts) byId.set(contact.id, contact)
	return [...byId.values()]
}

export function flattenContactPages(data: ContactsPages): Contact[] {
	return dedupeContacts(data.pages.flatMap((page) => page.contacts))
}

function updateContactPages(
	data: ContactsPages | undefined,
	updater: (contacts: Contact[], pageIndex: number) => Contact[],
): ContactsPages | undefined {
	if (!data) return data
	return {
		...data,
		pages: data.pages.map((page, pageIndex) => ({
			...page,
			contacts: dedupeContacts(updater(page.contacts, pageIndex)),
		})),
	}
}

/** Pure, exhaustive cache effect for contact create/update/delete operations. */
export function applyContactEffect(
	queryClient: QueryClient,
	effect:
		| { type: 'created'; contact: Contact }
		| { type: 'updated'; contact: Contact }
		| { type: 'deleted'; contactId: string },
) {
	if (effect.type === 'deleted') {
		queryClient.removeQueries({ queryKey: contactsKeys.detail(effect.contactId), exact: true })
		queryClient.setQueryData<ContactsPages>(contactsKeys.list(), (data) =>
			updateContactPages(data, (contacts) => contacts.filter((contact) => contact.id !== effect.contactId)),
		)
		return
	}

	queryClient.setQueryData(contactsKeys.detail(effect.contact.id), effect.contact)
	queryClient.setQueryData<ContactsPages>(contactsKeys.list(), (data) =>
		updateContactPages(data, (contacts, pageIndex) => {
			const found = contacts.some((contact) => contact.id === effect.contact.id)
			if (found)
				return contacts.map((contact) => (contact.id === effect.contact.id ? effect.contact : contact))
			return effect.type === 'created' && pageIndex === 0 ? [effect.contact, ...contacts] : contacts
		}),
	)
}

function contactFromFields(contactId: string, fields: ContactFieldsInput, previous?: Contact): Contact {
	const clean = (value: string | undefined) => value?.trim() || undefined
	const emails = (fields.emails ?? [])
		.map((entry) => ({
			email: entry.email.trim(),
			...(clean(entry.type) ? { type: clean(entry.type) } : {}),
		}))
		.filter((entry) => entry.email)
	const phoneNumbers = (fields.phoneNumbers ?? [])
		.map((entry) => ({
			number: entry.number.trim(),
			...(clean(entry.type) ? { type: clean(entry.type) } : {}),
		}))
		.filter((entry) => entry.number)
	return {
		...previous,
		id: contactId,
		given_name: clean(fields.givenName),
		surname: clean(fields.surname),
		company_name: clean(fields.companyName),
		job_title: clean(fields.jobTitle),
		notes: clean(fields.notes),
		emails,
		phone_numbers: phoneNumbers,
	} as Contact
}

type ContactSnapshot = ReturnType<QueryClient['getQueriesData']>

function snapshotContacts(queryClient: QueryClient): ContactSnapshot {
	return queryClient.getQueriesData({ queryKey: contactsKeys.all })
}

function restoreContacts(queryClient: QueryClient, snapshot: ContactSnapshot | undefined) {
	for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data)
}

function refreshContacts(queryClient: QueryClient) {
	// A refresh is reconciliation, not part of the mutation transaction. If it fails,
	// the confirmed optimistic value remains visible and focus/poll sync retries later.
	void queryClient.invalidateQueries({ queryKey: contactsKeys.all, refetchType: 'active' }).catch(
		/* v8 ignore next -- @preserve background reconciliation failures are intentionally detached and have no observable mutation result */
		() => {},
	)
}

export function useCreateContactMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (fields: ContactFieldsInput) => createContact({ data: fields }),
		onMutate: async (fields) => {
			await queryClient.cancelQueries({ queryKey: contactsKeys.all })
			const snapshot = snapshotContacts(queryClient)
			const optimisticId = `optimistic-contact-${crypto.randomUUID()}`
			applyContactEffect(queryClient, {
				type: 'created',
				contact: contactFromFields(optimisticId, fields),
			})
			return { snapshot, optimisticId, fields }
		},
		onError: (_error, _fields, context) => restoreContacts(queryClient, context?.snapshot),
		onSuccess: (receipt, fields, context) => {
			/* v8 ignore else -- @preserve successful library callbacks always receive the context returned by onMutate */
			if (context) applyContactEffect(queryClient, { type: 'deleted', contactId: context.optimisticId })
			const canonical = 'contact' in receipt && receipt.contact ? receipt.contact : undefined
			const effect = {
				type: 'created',
				contact: canonical ?? contactFromFields(receipt.contactId, fields),
			} as const
			applyContactEffect(queryClient, effect)
			rememberConfirmedContactEffect(queryClient, effect)
			refreshContacts(queryClient)
		},
	})
}

export function useUpdateContactMutation(contact: Contact | null) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (fields: ContactFieldsInput) => {
			if (!contact) throw new Error('Contact is required')
			return updateContact({ data: { contactId: contact.id, ...fields } })
		},
		onMutate: async (fields) => {
			if (!contact) return undefined
			await queryClient.cancelQueries({ queryKey: contactsKeys.all })
			const snapshot = snapshotContacts(queryClient)
			applyContactEffect(queryClient, {
				type: 'updated',
				contact: contactFromFields(contact.id, fields, contact),
			})
			return { snapshot, fields }
		},
		onError: (_error, _fields, context) => restoreContacts(queryClient, context?.snapshot),
		onSuccess: (receipt, fields) => {
			/* v8 ignore next -- mutationFn rejects before success whenever the closed-over contact is absent -- @preserve */
			if (!contact) return
			const canonical = 'contact' in receipt && receipt.contact ? receipt.contact : undefined
			const effect = {
				type: 'updated',
				contact: canonical ?? contactFromFields(contact.id, fields, contact),
			} as const
			applyContactEffect(queryClient, effect)
			rememberConfirmedContactEffect(queryClient, effect)
			refreshContacts(queryClient)
		},
	})
}

export function useDeleteContactMutation(contactId: string) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: () => deleteContact({ data: { contactId } }),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: contactsKeys.all })
			const snapshot = snapshotContacts(queryClient)
			applyContactEffect(queryClient, { type: 'deleted', contactId })
			return { snapshot }
		},
		onError: (_error, _variables, context) => restoreContacts(queryClient, context?.snapshot),
		onSuccess: () => {
			const effect = { type: 'deleted', contactId } as const
			applyContactEffect(queryClient, effect)
			rememberConfirmedContactEffect(queryClient, effect)
			refreshContacts(queryClient)
		},
	})
}

export const contactsStateTestApi = { rememberConfirmedContactEffect, reconcileContactPage }
