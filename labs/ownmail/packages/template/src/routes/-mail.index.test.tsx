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
	getRequest: vi.fn(() => new Request('http://ownmail.local/mail')),
}))

const usingDevMocks = vi.fn()
vi.mock('../server/platform.js', () => ({ usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
vi.mock('../server/session.js', () => ({ getSession: (r: any) => getSession(r) }))

import { Route } from './mail.index.js'

afterEach(() => {
	vi.clearAllMocks()
})
beforeEach(() => {
	vi.clearAllMocks()
})

describe('/mail index redirect', () => {
	it('forwards a signed-in user to the default inbox folder so /mail is never a dead end', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ email: 'a@b.com' })

		await expect(Route.options.beforeLoad()).rejects.toMatchObject({
			to: '/mail/f/$folderId',
			options: { params: { folderId: 'inbox' } },
		})
	})

	it('forwards to the inbox under dev mocks without checking a session', async () => {
		usingDevMocks.mockResolvedValue(true)

		await expect(Route.options.beforeLoad()).rejects.toMatchObject({ to: '/mail/f/$folderId' })
		expect(getSession).not.toHaveBeenCalled()
	})

	it('sends an anonymous visitor to login before any folder redirect', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		await expect(Route.options.beforeLoad()).rejects.toMatchObject({ to: '/login' })
	})
})
