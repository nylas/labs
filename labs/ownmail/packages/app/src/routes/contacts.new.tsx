import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ContactModal } from '../components/ContactModal.js'

export const Route = createFileRoute('/contacts/new')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	component: NewContactRoute,
})

function NewContactRoute() {
	const { q } = Route.useSearch()
	const navigate = useNavigate()
	const search = q ? { q } : {}

	function close(changed: boolean, contactId?: string) {
		if (changed && contactId) {
			navigate({ to: '/contacts/$contactId', params: { contactId }, search })
		} else {
			navigate({ to: '/contacts', search })
		}
	}

	return <ContactModal contact={null} onClose={close} />
}
