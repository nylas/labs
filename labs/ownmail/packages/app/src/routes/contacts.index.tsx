import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contacts/')({
	validateSearch: (search): { q?: string } =>
		typeof search.q === 'string' && search.q ? { q: search.q } : {},
	component: ContactsIndex,
})

function ContactsIndex() {
	// The create action lives at the top of the contact list beside this pane.
	return (
		<div className="hidden h-full flex-col items-center justify-center gap-3 p-8 text-center md:flex">
			<p className="text-sm text-muted-foreground">
				Select a contact to see their details, or add one with New contact.
			</p>
		</div>
	)
}
