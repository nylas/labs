// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
	redirect: (o: any) => {
		throw Object.assign(new Error('REDIRECT'), { isRedirect: true, to: o?.to, options: o })
	},
}))

vi.mock('@tanstack/react-start', () => ({
	createServerFn: () => ({ handler: (fn: any) => fn }),
}))

vi.mock('@tanstack/react-start/server', () => ({
	getRequest: vi.fn(() => new Request('http://ownmail.local/')),
}))

const usingDevMocks = vi.fn()
vi.mock('#server/platform', () => ({ usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
vi.mock('#server/session', () => ({ getSession: (r: any) => getSession(r) }))

import { Route } from './index.js'

afterEach(() => {
	vi.clearAllMocks()
})
beforeEach(() => {
	vi.clearAllMocks()
})

describe('home route redirect', () => {
	it('redirects a signed-in user straight to the canonical inbox route (no duplicate root view)', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ email: 'a@b.com' })

		await expect(Route.options.beforeLoad()).rejects.toMatchObject({
			to: '/mail/f/$folderId',
			// Replaces the transient root entry so Back doesn't bounce off the redirect.
			options: { params: { folderId: 'inbox' }, replace: true },
		})
	})

	it('treats an active dev-mocks environment as authenticated without a real session', async () => {
		usingDevMocks.mockResolvedValue(true)

		await expect(Route.options.beforeLoad()).rejects.toMatchObject({ to: '/mail/f/$folderId' })
		expect(getSession).not.toHaveBeenCalled()
	})

	it('redirects an anonymous visitor to login instead of leaking mailbox data', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		await expect(Route.options.beforeLoad()).rejects.toMatchObject({ to: '/login' })
	})
})
