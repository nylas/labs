import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ContactModal } from '../components/ContactModal.js'

export const Route = createFileRoute('/contacts/new')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	component: NewContactRoute,
})

function NewContactRoute() {
	const { q } = Route.useSearch()
	const navigate = useNavigate()
	const router = useRouter()
	const search = q ? { q } : {}

	function close(changed: boolean, contactId?: string) {
		if (changed) void router.invalidate()
		if (changed && contactId) {
			navigate({ to: '/contacts/$contactId', params: { contactId }, search })
		} else {
			navigate({ to: '/contacts', search })
		}
	}

	return <ContactModal contact={null} onClose={close} />
}
