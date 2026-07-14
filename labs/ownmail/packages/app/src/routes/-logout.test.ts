import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const destroySession = vi.fn()
const clearSessionCookie = vi.fn()
vi.mock('../server/session.js', () => ({
	destroySession: (r: any) => destroySession(r),
	clearSessionCookie: () => clearSessionCookie(),
}))

import { Route } from './logout.js'

const POST = Route.options.server.handlers.POST

beforeEach(() => {
	vi.clearAllMocks()
})

describe('/logout', () => {
	it('destroys the server session and clears the cookie before bouncing to login', async () => {
		clearSessionCookie.mockReturnValue('ownmail_session=; Max-Age=0')
		const request = new Request('http://ownmail.local/logout', {
			method: 'POST',
			headers: { origin: 'http://ownmail.local' },
		})

		const response = await POST({ request })

		expect(destroySession).toHaveBeenCalledWith(request)
		expect(response.status).toBe(302)
		expect(response.headers.get('Location')).toBe('/login')
		expect(response.headers.get('Set-Cookie')).toBe('ownmail_session=; Max-Age=0')
	})

	it('refuses a cross-site logout attempt', async () => {
		const request = new Request('http://ownmail.local/logout', {
			method: 'POST',
			headers: { origin: 'https://attacker.example' },
		})

		const response = await POST({ request })

		expect(response.status).toBe(403)
		expect(destroySession).not.toHaveBeenCalled()
	})
})
