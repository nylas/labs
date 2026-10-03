import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useMemo } from 'react'
import { ensureMailboxInfo } from '#app/query/mailbox-info'
import { contactIdFromPath } from '#features/contacts/lib/contacts-model'
import {
	contactsInitialData,
	flattenContactPages,
	useContactsPages,
} from '#features/contacts/state/contacts-state'
import { getContacts } from '#server/fns'
import { seededData } from '#shared/lib/seeded-data'
import { ContactsShell } from './-contacts-screen'

export const Route = createFileRoute('/contacts')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	loader: async ({ context }) => {
		const [info, page] = await Promise.all([
			ensureMailboxInfo(context.queryClient),
			getContacts({ data: {} }),
		])
		return { info, contacts: page.contacts, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
	},
	staleTime: 30_000,
	component: ContactsLayout,
})

function ContactsLayout() {
	const { info, contacts, nextCursor } = Route.useLoaderData()
	const initialPage = useMemo(
		() => ({ contacts, ...(nextCursor ? { nextCursor } : {}) }),
		[contacts, nextCursor],
	)
	const contactsQuery = useContactsPages(initialPage)
	const contactPages = seededData(contactsQuery.data, contactsInitialData(initialPage))
	// One array per cache update: the shell keys its keyboard cursor and paging
	// state on this list's identity, so a fresh array each render would reset them.
	const flatContacts = useMemo(() => flattenContactPages(contactPages), [contactPages])
	const { q } = Route.useSearch()
	const navigate = useNavigate()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	async function loadMoreContacts() {
		await contactsQuery.fetchNextPage({ cancelRefetch: false })
	}
	return (
		<ContactsShell
			info={info}
			contacts={flatContacts}
			nextCursor={contactsQuery.hasNextPage ? contactPages.pages.at(-1)?.nextCursor : undefined}
			loadingMore={contactsQuery.isFetchingNextPage}
			loadMoreError={contactsQuery.isFetchNextPageError}
			onLoadMore={loadMoreContacts}
			onRefresh={() => contactsQuery.refetch({ throwOnError: true })}
			query={q ?? ''}
			selectedId={contactIdFromPath(pathname)}
			onQueryChange={(next) => navigate({ to: '/contacts', search: next ? { q: next } : {}, replace: true })}
		/>
	)
}
