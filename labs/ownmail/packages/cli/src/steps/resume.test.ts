import * as p from '@clack/prompts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import type { StepContext } from './context.js'
import { findDeployedApp, findDeployments } from './resume.js'

const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', () => ({
	select: vi.fn(),
	isCancel: vi.fn((value: unknown) => value === CANCEL),
}))

vi.mock('../deploy/provider-cli.js', () => ({ listVercelProjects: vi.fn(), listNetlifySites: vi.fn() }))
vi.mock('../deploy/wrangler.js', () => ({ listCloudflareWorkers: vi.fn() }))
vi.mock('./deploy.js', () => ({ ensureCloudflareAuth: vi.fn() }))
vi.mock('./provision.js', () => {
	class CancelledError extends Error {}
	return { CancelledError, listSandboxApplications: vi.fn() }
})

import { listNetlifySites, listVercelProjects } from '../deploy/provider-cli.js'
import { listCloudflareWorkers } from '../deploy/wrangler.js'
import { ensureCloudflareAuth } from './deploy.js'
import { CancelledError, listSandboxApplications } from './provision.js'

/** Stubs each deployed app's public `/healthz` by origin. */
function stubHealthz(byOrigin: Record<string, Response | Error>) {
	const fetchMock = vi.fn(async (input: string | URL) => {
		const url = new URL(String(input))
		const response = url.pathname === '/healthz' ? byOrigin[url.origin] : undefined
		if (!response || response instanceof Error) throw response ?? new Error(`unexpected ${url}`)
		return response
	})
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('findDeployments', () => {
	it('offers only Workers that answer as an OwnMail project, so an unrelated app is never adopted', async () => {
		vi.mocked(listCloudflareWorkers).mockResolvedValue([
			{ name: 'acme-ownmail', url: 'https://acme-ownmail.me.workers.dev' },
			{ name: 'blog-ownmail', url: 'https://blog-ownmail.me.workers.dev' },
			{ name: 'down-ownmail', url: 'https://down-ownmail.me.workers.dev' },
			{ name: 'odd-ownmail', url: 'https://odd-ownmail.me.workers.dev' },
		])
		stubHealthz({
			'https://acme-ownmail.me.workers.dev': Response.json({ ok: true, app: 'acme' }),
			'https://blog-ownmail.me.workers.dev': new Response('<html>'),
			'https://down-ownmail.me.workers.dev': new Error('offline'),
			// Reserved and malformed names are not user projects.
			'https://odd-ownmail.me.workers.dev': Response.json({ ok: true, app: '__login__' }),
		})

		await expect(findDeployments('cloudflare')).resolves.toEqual([
			{
				provider: 'cloudflare',
				workerName: 'acme-ownmail',
				slug: 'acme',
				url: 'https://acme-ownmail.me.workers.dev',
			},
		])
		expect(ensureCloudflareAuth).toHaveBeenCalled()
		expect(listCloudflareWorkers).toHaveBeenCalledWith('-ownmail')
	})

	it('carries the Vercel project identifiers the redeploy needs', async () => {
		vi.mocked(listVercelProjects).mockResolvedValue([
			{ projectId: 'prj_1', orgId: 'team_1', name: 'acme-ownmail', url: 'https://acme-ownmail.vercel.app' },
		])
		stubHealthz({ 'https://acme-ownmail.vercel.app': Response.json({ app: 'acme' }) })

		await expect(findDeployments('vercel')).resolves.toEqual([
			{
				provider: 'vercel',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
				slug: 'acme',
				url: 'https://acme-ownmail.vercel.app',
			},
		])
	})

	it('carries the Netlify site the redeploy needs', async () => {
		const siteId = '123e4567-e89b-42d3-a456-426614174000'
		vi.mocked(listNetlifySites).mockResolvedValue([
			{ siteId, name: 'acme-ownmail', url: 'https://acme-ownmail.netlify.app' },
			{ siteId, name: 'gated-ownmail', url: 'https://gated-ownmail.netlify.app' },
		])
		stubHealthz({
			'https://acme-ownmail.netlify.app': Response.json({ app: 'acme' }),
			'https://gated-ownmail.netlify.app': new Response('', { status: 401 }),
		})

		await expect(findDeployments('netlify')).resolves.toEqual([
			{ provider: 'netlify', netlifySiteId: siteId, slug: 'acme', url: 'https://acme-ownmail.netlify.app' },
		])
	})
})

describe('findDeployedApp', () => {
	const key = (name: string, status = 'active') => ({ id: `id-${name}`, name, status })

	function ctxWith(keysByApp: Record<string, ReturnType<typeof key>[]>, orgPublicId = 'org1') {
		vi.mocked(listSandboxApplications).mockResolvedValue(
			Object.keys(keysByApp).map((applicationId) => ({ applicationId, region: 'us' })) as never,
		)
		const gateway = {
			listApiKeys: vi.fn(async (_t: unknown, _r: unknown, appId: string) => keysByApp[appId]),
		}
		const ctx = {
			project: { slug: '__login__', region: 'us', orgPublicId } as ProjectState,
			auth: { userToken: 'u' },
			gateway,
		} as unknown as StepContext
		return { ctx, gateway }
	}

	it('identifies the app by its active deployment key, since sandbox apps carry no project tag', async () => {
		const { ctx, gateway } = ctxWith({
			'app-other': [key('ownmail other 2026-01-02T03-04-05-678Z')],
			'app-acme': [key('ownmail acme (rotated 2026-02-02)')],
			'app-old': [key('ownmail acme 2025-01-02T03-04-05-678Z', 'revoked')],
		})

		await expect(findDeployedApp(ctx, 'acme')).resolves.toMatchObject({ applicationId: 'app-acme' })
		expect(listSandboxApplications).toHaveBeenCalledWith(ctx, gateway, 'org1')
		expect(p.select).not.toHaveBeenCalled()
	})

	it('refuses to link a deployment to an app outside the signed-in organization', async () => {
		const { ctx } = ctxWith({ 'app-mine': [key('ownmail mine 2026-01-02T03-04-05-678Z')] })

		await expect(findDeployedApp(ctx, 'acme')).rejects.toThrow(
			/Log in to the Nylas organization that owns this app/,
		)
	})

	it('asks which app to use when several have keys for the project', async () => {
		const { ctx } = ctxWith({
			'app-1': [key('ownmail acme 2026-01-02T03-04-05-678Z')],
			'app-2': [key('ownmail acme (doctor repair 2026-03-03)')],
		})
		vi.mocked(p.select).mockResolvedValueOnce('app-2' as never)

		await expect(findDeployedApp(ctx, 'acme')).resolves.toMatchObject({ applicationId: 'app-2' })
		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({
				options: [expect.objectContaining({ value: 'app-1' }), expect.objectContaining({ value: 'app-2' })],
			}),
		)
	})

	it('pauses when choosing between apps is cancelled', async () => {
		const { ctx } = ctxWith({
			'app-1': [key('ownmail acme 2026-01-02T03-04-05-678Z')],
			'app-2': [key('ownmail acme 2026-01-03T03-04-05-678Z')],
		})
		vi.mocked(p.select).mockResolvedValueOnce(CANCEL as never)

		await expect(findDeployedApp(ctx, 'acme')).rejects.toBeInstanceOf(CancelledError)
	})

	it('requires the organization chosen at login', async () => {
		const { ctx } = ctxWith({}, '')

		await expect(findDeployedApp(ctx, 'acme')).rejects.toThrow(/Organization unavailable/)
	})
})
