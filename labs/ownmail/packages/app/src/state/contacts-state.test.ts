import type { Contact } from '@nylas-labs/cli-kit/v3'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
	applyContactEffect,
	type ContactsPages,
	contactsKeys,
	contactsStateTestApi,
	flattenContactPages,
} from './contacts-state.js'

const ada = { id: 'contact-1', given_name: 'Ada' } as Contact
const grace = { id: 'contact-2', given_name: 'Grace' } as Contact

function pages(): ContactsPages {
	return {
		pages: [{ contacts: [ada], nextCursor: 'next' }, { contacts: [ada, grace] }],
		pageParams: [undefined, 'next'],
	}
}

describe('contact cache effects', () => {
	it('deduplicates contacts across loaded pages', () => {
		expect(flattenContactPages(pages()).map((contact) => contact.id)).toEqual(['contact-1', 'contact-2'])
	})

	it('updates list copies and detail data together', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(contactsKeys.list(), pages())
		queryClient.setQueryData(contactsKeys.detail(ada.id), ada)
		const updated = { ...ada, given_name: 'Augusta Ada' }

		applyContactEffect(queryClient, { type: 'updated', contact: updated })

		expect(queryClient.getQueryData(contactsKeys.detail(ada.id))).toEqual(updated)
		expect(
			flattenContactPages(queryClient.getQueryData(contactsKeys.list()) as ContactsPages),
		).toContainEqual(updated)
	})

	it('inserts a created contact only on the first cached page', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(contactsKeys.list(), pages())
		const created = { id: 'contact-3', given_name: 'Katherine' } as Contact
		applyContactEffect(queryClient, { type: 'created', contact: created })
		const cached = queryClient.getQueryData<ContactsPages>(contactsKeys.list())
		expect(cached?.pages[0]?.contacts[0]).toEqual(created)
		expect(cached?.pages[1]?.contacts).not.toContainEqual(created)
	})

	it('removes a deleted contact from every page and its detail cache', () => {
		const queryClient = new QueryClient()
		queryClient.setQueryData(contactsKeys.list(), pages())
		queryClient.setQueryData(contactsKeys.detail(ada.id), ada)

		applyContactEffect(queryClient, { type: 'deleted', contactId: ada.id })

		expect(flattenContactPages(queryClient.getQueryData(contactsKeys.list()) as ContactsPages)).toEqual([
			grace,
		])
		expect(queryClient.getQueryData(contactsKeys.detail(ada.id))).toBeUndefined()
	})

	it('does not resurrect a confirmed deletion when a provider read is stale', () => {
		const queryClient = new QueryClient()
		contactsStateTestApi.rememberConfirmedContactEffect(queryClient, {
			type: 'deleted',
			contactId: ada.id,
		})

		const reconciled = contactsStateTestApi.reconcileContactPage(
			queryClient,
			{ contacts: [ada, grace] },
			true,
		)

		expect(reconciled.contacts).toEqual([grace])
	})

	it('overlays confirmed creates and updates onto stale provider pages', () => {
		const queryClient = new QueryClient()
		const created = { id: 'contact-3', given_name: 'Katherine' } as Contact
		const updated = { ...ada, given_name: 'Augusta' }
		contactsStateTestApi.rememberConfirmedContactEffect(queryClient, { type: 'created', contact: created })
		contactsStateTestApi.rememberConfirmedContactEffect(queryClient, { type: 'updated', contact: updated })

		expect(
			contactsStateTestApi.reconcileContactPage(queryClient, { contacts: [ada] }, true).contacts,
		).toEqual([created, updated])
		expect(
			contactsStateTestApi.reconcileContactPage(queryClient, { contacts: [grace] }, false).contacts,
		).toEqual([grace])
	})
})
