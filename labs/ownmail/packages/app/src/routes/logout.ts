import { createFileRoute } from '@tanstack/react-router'
import { LOGIN_PATH } from '../components/route-paths.js'
import { clearSessionCookie, destroySession } from '../server/session.js'

export const Route = createFileRoute('/logout')({
	server: {
		handlers: {
			GET: async ({ request }) => {
				await destroySession(request)
				return new Response(null, {
					status: 302,
					headers: { Location: LOGIN_PATH, 'Set-Cookie': clearSessionCookie() },
				})
			},
		},
	},
})
