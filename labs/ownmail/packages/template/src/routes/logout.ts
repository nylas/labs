import { createFileRoute } from '@tanstack/react-router'
import { clearSessionCookie, destroySession } from '../server/session.js'

export const Route = createFileRoute('/logout')({
	server: {
		handlers: {
			GET: async ({ request }) => {
				await destroySession(request)
				return new Response(null, {
					status: 302,
					headers: { Location: '/login', 'Set-Cookie': clearSessionCookie() },
				})
			},
		},
	},
})
