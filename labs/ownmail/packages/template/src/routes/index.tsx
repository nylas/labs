import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getSession } from '../server/session.js'

const hasSession = createServerFn({ method: 'GET' }).handler(async () => {
	const session = await getSession(getRequest())
	return { loggedIn: session !== null }
})

export const Route = createFileRoute('/')({
	beforeLoad: async () => {
		const { loggedIn } = await hasSession()
		throw redirect({ to: loggedIn ? '/mail' : '/login' })
	},
})
