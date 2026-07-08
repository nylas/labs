// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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

const getMailboxInfo = vi.fn()
vi.mock('../server/fns.js', () => ({ getMailboxInfo: () => getMailboxInfo() }))

const usingDevMocks = vi.fn()
vi.mock('../server/platform.js', () => ({ usingDevMocks: () => usingDevMocks() }))

const getSession = vi.fn()
vi.mock('../server/session.js', () => ({ getSession: (r: any) => getSession(r) }))

const loadMailFolderData = vi.fn()
vi.mock('./mail.f.$folderId.js', () => ({
	loadMailFolderData: (id: string) => loadMailFolderData(id),
	MailFolderRouteScreen: (props: any) => <div data-testid="folder-screen">{props.folderId}</div>,
}))

vi.mock('./mail.js', () => ({
	MailRouteScreen: (props: any) => (
		<div data-testid="mail-screen" data-default={props.defaultFolderId}>
			{props.children}
		</div>
	),
}))

import { Route } from './index.js'

afterEach(cleanup)
beforeEach(() => {
	vi.clearAllMocks()
})

describe('home route loader', () => {
	it('loads the default inbox for a signed-in user so the app opens straight to mail', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue({ email: 'a@b.com' })
		getMailboxInfo.mockResolvedValue({ address: 'a@b.com' })
		loadMailFolderData.mockResolvedValue({ folders: [{ id: 'inbox' }] })

		const data = await Route.options.loader()

		expect(data.authenticated).toBe(true)
		expect(data.info).toEqual({ address: 'a@b.com' })
		expect(loadMailFolderData).toHaveBeenCalledWith('inbox')
	})

	it('treats an active dev-mocks environment as authenticated without a real session', async () => {
		usingDevMocks.mockResolvedValue(true)
		getMailboxInfo.mockResolvedValue({ address: 'dev@local' })
		loadMailFolderData.mockResolvedValue({ folders: [] })

		const data = await Route.options.loader()

		expect(getSession).not.toHaveBeenCalled()
		expect(data.authenticated).toBe(true)
	})

	it('redirects an anonymous visitor to login instead of leaking mailbox data', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		await expect(Route.options.loader()).rejects.toMatchObject({ to: '/login' })
		expect(getMailboxInfo).not.toHaveBeenCalled()
	})
})

describe('home route component', () => {
	it('renders the mail shell seeded with the default folder data from the loader', () => {
		Route.useLoaderData = vi.fn(() => ({
			authenticated: true,
			info: { address: 'a@b.com' },
			folderData: { folders: [{ id: 'inbox' }], threads: [] },
		}))
		const Home = Route.options.component
		render(<Home />)
		expect(screen.getByTestId('mail-screen').dataset.default).toBe('inbox')
		expect(screen.getByTestId('folder-screen').textContent).toBe('inbox')
	})
})
