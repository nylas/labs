import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/calendar/')({
	beforeLoad: () => {
		throw redirect({ to: '/calendar/$view', params: { view: 'week' } })
	},
})
