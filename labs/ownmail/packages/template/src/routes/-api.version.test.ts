import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const platform = vi.fn()
const usingDevMocks = vi.fn()
vi.mock('../server/platform.js', () => ({
	platform: () => platform(),
	usingDevMocks: () => usingDevMocks(),
}))

const getSession = vi.fn()
vi.mock('../server/session.js', () => ({ getSession: (r: any) => getSession(r) }))

import { Route, versionResponse } from './api.version.js'

const GET = Route.options.server.handlers.GET

function req() {
	return new Request('http://ownmail.local/api/version')
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('/api/version', () => {
	it('returns the inert realtime signal for local dev mocks without requiring a signed session', async () => {
		const response = await versionResponse(req(), { devMocks: true })

		expect(response.status).toBe(200)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(await response.json()).toEqual({ version: 0 })
		expect(getSession).not.toHaveBeenCalled()
	})

	it('serves the inert signal through the route handler when dev mocks are auto-detected', async () => {
		usingDevMocks.mockResolvedValue(true)

		const response = await GET({ request: req() })

		expect(await response.json()).toEqual({ version: 0 })
		expect(getSession).not.toHaveBeenCalled()
	})

	it('refuses to leak a version signal to an unauthenticated caller', async () => {
		usingDevMocks.mockResolvedValue(false)
		getSession.mockResolvedValue(null)

		const response = await GET({ request: req() })

		expect(response.status).toBe(401)
	})

	it('reports the KV-backed webhook counter for the caller grant', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		const kv = { get: vi.fn().mockResolvedValue('7') }
		platform.mockResolvedValue({ kv })

		const response = await versionResponse(req(), { devMocks: false })

		expect(kv.get).toHaveBeenCalledWith('version:grant-1')
		expect(await response.json()).toEqual({ version: 7 })
	})

	it('treats a grant with no recorded counter as version zero', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		platform.mockResolvedValue({ kv: { get: vi.fn().mockResolvedValue(null) } })

		const response = await versionResponse(req(), { devMocks: false })

		expect(await response.json()).toEqual({ version: 0 })
	})

	it('reports a constant version when no KV binding exists (slow polling only)', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		platform.mockResolvedValue({ kv: null })

		const response = await versionResponse(req(), { devMocks: false })

		expect(await response.json()).toEqual({ version: 0 })
	})
})
