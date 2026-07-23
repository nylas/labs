import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runAppDomain } from './app-domain.js'

const hoisted = vi.hoisted(() => ({
	ensureRedirectUris: vi.fn(),
	createApiKey: vi.fn(),
	revokeApiKey: vi.fn(),
	setupRealtimeWebhook: vi.fn(),
	checkAppHealth: vi.fn(),
	releaseProjectLock: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	text: vi.fn(),
	select: vi.fn(),
	isCancel: vi.fn(() => false),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
	log: { step: vi.fn(), warn: vi.fn() },
}))
vi.mock('@nylas-labs/cli-kit', () => ({
	NylasV3Client: vi.fn().mockImplementation(function NylasV3ClientMock() {
		return {
			ensureRedirectUris: hoisted.ensureRedirectUris,
			reconcileWebhook: vi.fn(),
			deleteWebhook: vi.fn(),
		}
	}),
}))
vi.mock('../deploy/app-health.js', () => ({ checkAppHealth: hoisted.checkAppHealth }))
vi.mock('../deploy/materialize.js', () => ({
	loadManifest: vi.fn(() => ({ templateVersion: '3.0.0' })),
	materialize: vi.fn(() => ({ configPath: '/tmp/wrangler.json' })),
}))
vi.mock('../deploy/provider-cli.js', () => ({
	attachVercelDomain: vi.fn(),
	configureNetlifyDomain: vi.fn(),
}))
vi.mock('../deploy/webhook.js', () => ({ setupRealtimeWebhook: hoisted.setupRealtimeWebhook }))
vi.mock('../deploy/wrangler.js', () => ({ deploy: vi.fn() }))
vi.mock('../nylas-env.js', () => ({
	apiBaseUrl: vi.fn(() => 'https://api.example.com'),
	deployedApiBaseUrl: vi.fn(() => undefined),
}))
vi.mock('../state/project-lock.js', () => ({
	acquireProjectLock: vi.fn(() => hoisted.releaseProjectLock),
}))
vi.mock('../state/store.js', () => ({ saveProject: vi.fn() }))
vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(),
	requireGateway: vi.fn(() => ({
		createApiKey: hoisted.createApiKey,
		revokeApiKey: hoisted.revokeApiKey,
	})),
	tokens: vi.fn(() => ({ userToken: 't' })),
}))
vi.mock('../steps/deploy.js', () => ({ ensureCloudflareAuth: vi.fn() }))
vi.mock('../steps/provision.js', () => ({
	CancelledError: class CancelledError extends Error {
		constructor() {
			super('Cancelled')
			this.name = 'CancelledError'
		}
	},
}))
vi.mock('./shared.js', () => ({
	pickExistingProject: vi.fn(),
	supportReference: vi.fn((err: { requestId?: string }) =>
		err.requestId ? `Request ID: ${err.requestId}. Include this ID if you contact Nylas Support.` : undefined,
	),
}))

import * as p from '@clack/prompts'
import { checkAppHealth } from '../deploy/app-health.js'
import { materialize } from '../deploy/materialize.js'
import { attachVercelDomain, configureNetlifyDomain } from '../deploy/provider-cli.js'
import { setupRealtimeWebhook } from '../deploy/webhook.js'
import { deploy } from '../deploy/wrangler.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
import { saveProject } from '../state/store.js'
import { createContext } from '../steps/context.js'
import { ensureCloudflareAuth } from '../steps/deploy.js'
import { pickExistingProject } from './shared.js'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: ['deploy'],
		pendingSecrets: {},
		hostingProvider: 'cloudflare',
		workerName: 'w1',
		kvNamespaceId: 'kv1',
		workersDevUrl: 'https://acme.workers.dev',
		applicationId: 'app-1',
		appDomains: [],
		...overrides,
	} as ProjectState
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(p.isCancel).mockReturnValue(false)
	vi.mocked(createContext).mockResolvedValue({ auth: { userToken: 't' } } as never)
	hoisted.createApiKey.mockResolvedValue({ id: 'key-1', apiKey: 'secret-key' })
	hoisted.revokeApiKey.mockResolvedValue(undefined)
	hoisted.checkAppHealth.mockResolvedValue(true)
	hoisted.setupRealtimeWebhook.mockResolvedValue({
		status: 'registered',
		callbackUrl: 'https://mail.acme.com/api/webhooks/nylas',
		secretStored: true,
	})
	hoisted.releaseProjectLock.mockReset()
})

afterEach(() => {
	Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
})

describe('runAppDomain', () => {
	it.each([
		[{ ejected: true }, /Ejected projects/],
		[{ hostingProvider: 'local' }, /Local hosting/],
		[{ hostingProvider: 'manual' }, /manual hosting/i],
	] as const)('rejects unsupported project state without mutation', async (overrides, error) => {
		vi.mocked(pickExistingProject).mockResolvedValue(project(overrides))
		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(error)
		expect(hoisted.createApiKey).not.toHaveBeenCalled()
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('validates and canonicalizes hostnames before changing providers', async () => {
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		await expect(runAppDomain({ domain: 'https://mail.acme.com/path' })).rejects.toThrow(
			/no https.*path.*port.*wildcard/i,
		)
		expect(hoisted.createApiKey).not.toHaveBeenCalled()

		await runAppDomain({ domain: ' MAIL.Acme.COM. ' })
		expect(materialize).toHaveBeenCalledWith(expect.objectContaining({ appDomains: ['mail.acme.com'] }))
		expect(proj.appDomain).toBe('mail.acme.com')
	})

	it.each([
		[{ applicationId: undefined }, /Nylas application details/],
		[{ workerName: undefined }, /Cloudflare deployment details/],
		[{ kvNamespaceId: undefined }, /Cloudflare deployment details/],
		[
			{
				hostingProvider: 'vercel',
				workerName: undefined,
				kvNamespaceId: undefined,
				vercelProjectId: undefined,
				vercelOrgId: 'team_1',
			},
			/Vercel project details/,
		],
		[
			{
				hostingProvider: 'netlify',
				workerName: undefined,
				kvNamespaceId: undefined,
				netlifySiteId: undefined,
			},
			/Netlify site details/,
		],
	] as const)('fails closed when required project metadata is missing', async (overrides, error) => {
		vi.mocked(pickExistingProject).mockResolvedValue(project(overrides))
		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(error)
		expect(hoisted.createApiKey).not.toHaveBeenCalled()
	})

	it.each([
		[{ completedSteps: [] }, /has not finished deploying/],
		[{ workersDevUrl: undefined }, /Cloudflare app URL is missing/],
		[
			{
				hostingProvider: 'vercel',
				workerName: undefined,
				kvNamespaceId: undefined,
				workersDevUrl: undefined,
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
				providerAppUrl: undefined,
			},
			/hosted app URL is missing/,
		],
	] as const)('requires a completed, addressable deployment', async (overrides, error) => {
		vi.mocked(pickExistingProject).mockResolvedValue(project(overrides))

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(error)

		expect(hoisted.createApiKey).not.toHaveBeenCalled()
		expect(hoisted.releaseProjectLock).toHaveBeenCalled()
	})

	it('stages every Cloudflare route, registers Nylas, promotes the primary, and revokes the key', async () => {
		const proj = project({
			appDomain: 'old.acme.com',
			appDomains: ['old.acme.com'],
			inboxEmail: 'hi@acme.com',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(deployedApiBaseUrl).mockReturnValueOnce('https://api-runtime.example.com')

		await runAppDomain({ domain: 'mail.acme.com', primary: true })

		expect(ensureCloudflareAuth).toHaveBeenCalled()
		expect(materialize).toHaveBeenCalledWith(
			expect.objectContaining({
				appDomains: ['old.acme.com', 'mail.acme.com'],
				vars: expect.objectContaining({
					INBOX_EMAIL: 'hi@acme.com',
					NYLAS_API_BASE_URL: 'https://api-runtime.example.com',
				}),
			}),
		)
		expect(deploy).toHaveBeenCalledWith('/tmp/wrangler.json')
		expect(checkAppHealth).toHaveBeenCalledWith('https://mail.acme.com')
		expect(hoisted.ensureRedirectUris).toHaveBeenCalledWith(['https://mail.acme.com/auth/callback'])
		expect(setupRealtimeWebhook).toHaveBeenCalledWith(proj, expect.anything(), {
			baseUrl: 'https://mail.acme.com',
			checkHealth: false,
		})
		expect(proj.appDomain).toBe('mail.acme.com')
		expect(proj.pendingAppDomain).toBeUndefined()
		expect(hoisted.revokeApiKey).toHaveBeenCalledWith(expect.anything(), 'us', 'app-1', 'key-1')
	})

	it('keeps an additional domain out of the primary webhook', async () => {
		const proj = project({ appDomain: 'mail.acme.com', appDomains: ['mail.acme.com'] })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await runAppDomain({ domain: 'inbox.acme.com', secondary: true })

		expect(proj.appDomain).toBe('mail.acme.com')
		expect(proj.appDomains).toEqual(['mail.acme.com', 'inbox.acme.com'])
		expect(setupRealtimeWebhook).not.toHaveBeenCalled()
		expect(hoisted.ensureRedirectUris).toHaveBeenCalledWith(['https://inbox.acme.com/auth/callback'])
	})

	it('honors --secondary for the first custom app domain', async () => {
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await runAppDomain({ domain: 'inbox.acme.com', secondary: true })

		expect(proj.appDomain).toBeUndefined()
		expect(proj.appDomains).toEqual(['inbox.acme.com'])
		expect(setupRealtimeWebhook).not.toHaveBeenCalled()
	})

	it('attaches a Vercel domain to the recorded project', async () => {
		const proj = project({
			hostingProvider: 'vercel',
			workerName: undefined,
			kvNamespaceId: undefined,
			providerAppUrl: 'https://acme.vercel.app',
			vercelProjectId: 'prj_1',
			vercelOrgId: 'team_1',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await runAppDomain({ domain: 'mail.acme.com' })

		expect(attachVercelDomain).toHaveBeenCalledWith('mail.acme.com', 'prj_1', 'team_1')
		expect(ensureCloudflareAuth).not.toHaveBeenCalled()
	})

	it('stages and then promotes a primary Netlify domain', async () => {
		const proj = project({
			hostingProvider: 'netlify',
			workerName: undefined,
			kvNamespaceId: undefined,
			providerAppUrl: 'https://acme.netlify.app',
			netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await runAppDomain({ domain: 'mail.acme.com' })

		expect(configureNetlifyDomain).toHaveBeenNthCalledWith(
			1,
			'mail.acme.com',
			'123e4567-e89b-42d3-a456-426614174000',
			false,
		)
		expect(configureNetlifyDomain).toHaveBeenNthCalledWith(
			2,
			'mail.acme.com',
			'123e4567-e89b-42d3-a456-426614174000',
			true,
		)
	})

	it('keeps the previous primary and pending intent while TLS provisions', async () => {
		const proj = project({ appDomain: 'old.acme.com', appDomains: ['old.acme.com'] })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		hoisted.checkAppHealth.mockResolvedValue(false)

		const error = await runAppDomain({ domain: 'mail.acme.com', primary: true }).catch(
			(caught: unknown) => caught,
		)

		expect((error as Error).message).toMatch(/setup is pending/i)
		expect((error as Error).message).toContain(
			'Cloudflare Dashboard → Workers & Pages → w1 → Settings → Domains & Routes',
		)
		expect(proj.appDomain).toBe('old.acme.com')
		expect(proj.pendingAppDomain).toEqual({ domain: 'mail.acme.com', primary: true })
		expect(setupRealtimeWebhook).not.toHaveBeenCalled()
		expect(hoisted.revokeApiKey).toHaveBeenCalled()
	})

	it.each([
		[
			{
				hostingProvider: 'vercel' as const,
				workerName: undefined,
				kvNamespaceId: undefined,
				workersDevUrl: undefined,
				providerAppUrl: 'https://acme.vercel.app',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
			},
			'Vercel Dashboard → project prj_1 → Settings → Domains',
		],
		[
			{
				hostingProvider: 'netlify' as const,
				workerName: undefined,
				kvNamespaceId: undefined,
				workersDevUrl: undefined,
				providerAppUrl: 'https://acme.netlify.app',
				netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
			},
			'Netlify Dashboard → site 123e4567-e89b-42d3-a456-426614174000 → Domain management',
		],
	])('points pending hosted domains to the exact provider project', async (overrides, guidance) => {
		vi.mocked(pickExistingProject).mockResolvedValue(project(overrides))
		hoisted.checkAppHealth.mockResolvedValue(false)

		const error = await runAppDomain({ domain: 'mail.acme.com', primary: true }).catch(
			(caught: unknown) => caught,
		)

		expect((error as Error).message).toContain(guidance)
	})

	it('keeps pending state and revokes the key when Cloudflare deployment fails', async () => {
		const proj = project()
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		vi.mocked(deploy).mockRejectedValueOnce(new Error('Cloudflare could not deploy'))

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(/could not deploy/)

		expect(proj.pendingAppDomain).toEqual({ domain: 'mail.acme.com', primary: true })
		expect(proj.appDomains).toEqual([])
		expect(hoisted.revokeApiKey).toHaveBeenCalled()
	})

	it('keeps a failed Nylas promotion resumable and never prints success', async () => {
		const proj = project({ appDomain: 'old.acme.com', appDomains: ['old.acme.com'] })
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		hoisted.setupRealtimeWebhook.mockResolvedValue({
			status: 'failed',
			callbackUrl: 'https://mail.acme.com/api/webhooks/nylas',
			requestId: 'req-safe-1',
		})

		await expect(runAppDomain({ domain: 'mail.acme.com', primary: true })).rejects.toThrow(
			/instant updates are not ready.*Request ID: req-safe-1/s,
		)

		expect(proj.appDomain).toBe('old.acme.com')
		expect(proj.pendingAppDomain).toEqual({ domain: 'mail.acme.com', primary: true })
		expect(p.outro).not.toHaveBeenCalled()
		expect(hoisted.revokeApiKey).toHaveBeenCalled()
	})

	it('reports a webhook failure without inventing a support reference', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		hoisted.setupRealtimeWebhook.mockResolvedValue({
			status: 'skipped',
			reason: 'unhealthy-app',
		})

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(
			/instant updates are not ready\.\nRetry:/,
		)
	})

	it('requires Nylas sign-in before provider or state mutation', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		vi.mocked(createContext).mockResolvedValue({ auth: null } as never)

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(/No provider changes/)

		expect(saveProject).not.toHaveBeenCalled()
		expect(ensureCloudflareAuth).not.toHaveBeenCalled()
	})

	it('does not attempt cleanup when temporary API-key creation fails', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		hoisted.createApiKey.mockRejectedValueOnce(new Error('gateway unavailable'))

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(/gateway unavailable/)

		expect(hoisted.revokeApiKey).not.toHaveBeenCalled()
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('warns with a safe reference when temporary-key revocation fails', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		hoisted.revokeApiKey.mockRejectedValue(
			Object.assign(new Error('secret provider details'), { requestId: 'req-revoke-1' }),
		)

		await runAppDomain({ domain: 'mail.acme.com' })

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Request ID: req-revoke-1'))
		expect(p.log.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret provider details'))
	})

	it('warns without a fabricated reference when key revocation has no request id', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		hoisted.revokeApiKey.mockRejectedValue(new Error('secret provider details'))

		await runAppDomain({ domain: 'mail.acme.com' })

		const warning = vi.mocked(p.log.warn).mock.calls.at(-1)?.[0]
		expect(warning).toContain('Could not revoke')
		expect(warning).not.toContain('Request ID:')
	})

	it('resumes the recorded role for a pending domain and rejects role changes', async () => {
		const proj = project({
			appDomain: 'mail.acme.com',
			appDomains: ['mail.acme.com', 'inbox.acme.com'],
			pendingAppDomain: { domain: 'inbox.acme.com', primary: false },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await expect(runAppDomain({ domain: 'inbox.acme.com', primary: true })).rejects.toThrow(
			/started as --secondary/,
		)
		await runAppDomain({ domain: 'inbox.acme.com', secondary: true })

		expect(setupRealtimeWebhook).not.toHaveBeenCalled()
		expect(proj.appDomain).toBe('mail.acme.com')
	})

	it('requires the recorded pending domain to finish before another begins', async () => {
		const proj = project({
			appDomains: ['first.acme.com'],
			pendingAppDomain: { domain: 'first.acme.com', primary: true },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await expect(runAppDomain({ domain: 'second.acme.com', primary: true })).rejects.toThrow(
			/app-domain first\.acme\.com.*--primary/s,
		)

		expect(hoisted.createApiKey).not.toHaveBeenCalled()
	})

	it('preserves a pending secondary role in the resume command', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			project({
				appDomain: 'mail.acme.com',
				appDomains: ['mail.acme.com', 'first.acme.com'],
				pendingAppDomain: { domain: 'first.acme.com', primary: false },
			}),
		)

		await expect(runAppDomain({ domain: 'second.acme.com', secondary: true })).rejects.toThrow(
			/app-domain first\.acme\.com.*--secondary/s,
		)
	})

	it('rejects changing a pending primary to secondary', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			project({
				appDomains: ['mail.acme.com'],
				pendingAppDomain: { domain: 'mail.acme.com', primary: true },
			}),
		)

		await expect(runAppDomain({ domain: 'mail.acme.com', secondary: true })).rejects.toThrow(
			/started as --primary/,
		)
	})

	it('resumes a pending domain without requiring the role flag again', async () => {
		const proj = project({
			appDomain: 'mail.acme.com',
			appDomains: ['mail.acme.com', 'inbox.acme.com'],
			pendingAppDomain: { domain: 'inbox.acme.com', primary: false },
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await runAppDomain({ domain: 'inbox.acme.com' })

		expect(proj.appDomain).toBe('mail.acme.com')
		expect(proj.pendingAppDomain).toBeUndefined()
	})

	it('enforces domain capacity before creating a key or changing a provider', async () => {
		const proj = project({
			appDomains: Array.from({ length: 50 }, (_, index) => `d${index}.acme.com`),
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)

		await expect(runAppDomain({ domain: 'overflow.acme.com', secondary: true })).rejects.toThrow(/at most 50/)

		expect(hoisted.createApiKey).not.toHaveBeenCalled()
		expect(ensureCloudflareAuth).not.toHaveBeenCalled()
	})

	it('requires explicit input in noninteractive mode', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		await expect(runAppDomain({})).rejects.toThrow(/Usage: ownmail app-domain/)

		vi.mocked(pickExistingProject).mockResolvedValue(
			project({ appDomain: 'old.acme.com', appDomains: ['old.acme.com'] }),
		)
		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(/Choose --primary or --secondary/)
	})

	it('supports and cancels interactive hostname and role prompts', async () => {
		Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		vi.mocked(p.text).mockResolvedValue('mail.acme.com')
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		await expect(runAppDomain({})).rejects.toThrow(/Cancelled/)
		const validator = vi.mocked(p.text).mock.calls[0][0].validate as (
			value: string | undefined,
		) => string | undefined
		expect(validator(' MAIL.Acme.COM. ')).toBeUndefined()
		expect(validator(undefined)).toMatch(/Enter a hostname/)

		vi.mocked(pickExistingProject).mockResolvedValue(
			project({ appDomain: 'old.acme.com', appDomains: ['old.acme.com'] }),
		)
		vi.mocked(p.select).mockResolvedValue('secondary')
		vi.mocked(p.isCancel).mockReturnValue(false)
		await runAppDomain({ domain: 'mail.acme.com' })
		expect(p.select).toHaveBeenCalled()

		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		await expect(runAppDomain({ domain: 'another.acme.com' })).rejects.toThrow(/Cancelled/)
	})

	it('accepts an interactive hostname prompt when it is not cancelled', async () => {
		Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
		vi.mocked(pickExistingProject).mockResolvedValue(project())
		vi.mocked(p.text).mockResolvedValue('mail.acme.com')

		await runAppDomain({})

		expect(p.text).toHaveBeenCalled()
		expect(hoisted.ensureRedirectUris).toHaveBeenCalled()
	})

	it('fails safely if Netlify site state disappears before final promotion', async () => {
		const proj = project({
			hostingProvider: 'netlify',
			workerName: undefined,
			kvNamespaceId: undefined,
			providerAppUrl: 'https://acme.netlify.app',
			netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(proj)
		hoisted.setupRealtimeWebhook.mockImplementationOnce(async () => {
			proj.netlifySiteId = undefined
			return {
				status: 'registered',
				callbackUrl: 'https://mail.acme.com/api/webhooks/nylas',
				secretStored: true,
			}
		})

		await expect(runAppDomain({ domain: 'mail.acme.com' })).rejects.toThrow(
			/Netlify site details are missing/,
		)
	})

	it('rejects conflicting role flags', async () => {
		await expect(runAppDomain({ domain: 'mail.acme.com', primary: true, secondary: true })).rejects.toThrow(
			/either --primary or --secondary/,
		)
		expect(pickExistingProject).not.toHaveBeenCalled()
	})
})
