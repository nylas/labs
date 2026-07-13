import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (opts: any) => ({ options: opts }),
}))

const platform = vi.fn()
vi.mock('../server/platform.js', () => ({ platform: () => platform() }))

import { Route } from './healthz.js'

const GET = Route.options.server.handlers.GET

beforeEach(() => {
	vi.clearAllMocks()
})

describe('/healthz', () => {
	it('reports app identity and KV-backed session mode so ops can confirm the deployment', async () => {
		platform.mockResolvedValue({
			env: { APP_NAME: 'ownmail', TEMPLATE_VERSION: '1.2.3' },
			kv: { get: vi.fn() },
		})

		const response = await GET()

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			ok: true,
			app: 'ownmail',
			templateVersion: '1.2.3',
			sessions: 'kv',
		})
	})

	it('surfaces stateless session mode when no KV binding is present', async () => {
		platform.mockResolvedValue({
			env: { APP_NAME: 'ownmail', TEMPLATE_VERSION: '1.2.3' },
			kv: null,
		})

		const response = await GET()

		expect(await response.json()).toMatchObject({ sessions: 'stateless' })
	})
})
