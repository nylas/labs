import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

export const Route = createFileRoute('/contacts/')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	component: ContactsIndex,
})

function ContactsIndex() {
	const { q } = Route.useSearch()
	return (
		<div className="hidden h-full flex-col items-center justify-center gap-3 p-8 text-center md:flex">
			<p className="text-sm text-muted-foreground">Select a contact to see their details.</p>
			<Link
				to="/contacts/new"
				search={q ? { q } : {}}
				className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:brightness-105 active:scale-[0.98]"
			>
				<Plus className="h-4 w-4" /> New contact
			</Link>
		</div>
	)
}
