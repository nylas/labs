import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/calendar')({
	component: Outlet,
})
