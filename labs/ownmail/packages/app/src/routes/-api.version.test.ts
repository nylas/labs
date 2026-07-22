import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const platform = vi.fn()
const usingDevMocks = vi.fn()
vi.mock('#server/platform', () => ({
	platform: () => platform(),
	usingDevMocks: () => usingDevMocks(),
}))

const getSession = vi.fn()
vi.mock('#server/session', () => ({ getSession: (r: any) => getSession(r) }))

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
		expect(await response.json()).toEqual({
			version: 0,
			domains: { mail: 0, contacts: 0, calendar: 0 },
		})
		expect(getSession).not.toHaveBeenCalled()
	})

	it('serves the inert signal through the route handler when dev mocks are auto-detected', async () => {
		usingDevMocks.mockResolvedValue(true)

		const response = await GET({ request: req() })

		expect(await response.json()).toEqual({
			version: 0,
			domains: { mail: 0, contacts: 0, calendar: 0 },
		})
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
		expect(await response.json()).toEqual({
			version: 7,
			domains: { mail: 7, contacts: 7, calendar: 7 },
		})
	})

	it('reports independent domain counters without exposing the session grant id', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-private' })
		const values: Record<string, string> = {
			'version:grant-private': '12',
			'version:grant-private:mail': '9',
			'version:grant-private:contacts': '4',
			'version:grant-private:calendar': '7',
		}
		platform.mockResolvedValue({ kv: { get: vi.fn(async (key: string) => values[key] ?? null) } })

		const response = await versionResponse(req(), { devMocks: false })
		const json = await response.json()

		expect(json).toEqual({ version: 12, domains: { mail: 9, contacts: 4, calendar: 7 } })
		expect(JSON.stringify(json)).not.toContain('grant-private')
	})

	it('does not bump absent domains after the first scoped counter is written', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		const values: Record<string, string> = {
			'version:grant-1': '3',
			'version:grant-1:mail': '3',
		}
		platform.mockResolvedValue({ kv: { get: vi.fn(async (key: string) => values[key] ?? null) } })

		const response = await versionResponse(req(), { devMocks: false })

		expect(await response.json()).toEqual({
			version: 3,
			domains: { mail: 3, contacts: 0, calendar: 0 },
		})
	})

	it('treats a grant with no recorded counter as version zero', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		platform.mockResolvedValue({ kv: { get: vi.fn().mockResolvedValue(null) } })

		const response = await versionResponse(req(), { devMocks: false })

		expect(await response.json()).toEqual({
			version: 0,
			domains: { mail: 0, contacts: 0, calendar: 0 },
		})
	})

	it('reports a constant version when no KV binding exists (slow polling only)', async () => {
		getSession.mockResolvedValue({ grantId: 'grant-1' })
		platform.mockResolvedValue({ kv: null })

		const response = await versionResponse(req(), { devMocks: false })

		expect(await response.json()).toEqual({
			version: 0,
			domains: { mail: 0, contacts: 0, calendar: 0 },
		})
	})
})
