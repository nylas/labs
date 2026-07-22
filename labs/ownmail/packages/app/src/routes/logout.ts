import { createFileRoute } from '@tanstack/react-router'
import { LOGIN_PATH } from '../app/config/route-paths.js'
import { clearSessionCookie, destroySession } from '../server/session.js'

export const Route = createFileRoute('/logout')({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// SameSite=Lax does not protect a top-level cross-site GET. Require a
				// same-origin POST so another site cannot force a user to sign out.
				if (request.headers.get('origin') !== new URL(request.url).origin) {
					return new Response('Forbidden', { status: 403 })
				}
				await destroySession(request)
				return new Response(null, {
					status: 302,
					headers: { Location: LOGIN_PATH, 'Set-Cookie': clearSessionCookie() },
				})
			},
		},
	},
})
