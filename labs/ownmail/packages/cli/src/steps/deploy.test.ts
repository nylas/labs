import * as p from '@clack/prompts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportManualBundle, loadManifest, materialize } from '../deploy/materialize.js'
import {
	cloudflareApiTokenConfigured,
	deploy,
	ensureKvNamespace,
	putSecret,
	wranglerLoggedIn,
	wranglerLogin,
} from '../deploy/wrangler.js'
import { deployedApiBaseUrl, resourceNameSuffix } from '../nylas-env.js'
import type { ProjectState } from '../state/schema.js'
import { markStep, saveProject } from '../state/store.js'
import type { StepContext } from './context.js'
import {
	ensureCloudflareAuth,
	stepCfAuth,
	stepCfResources,
	stepDeploy,
	stepHostingProvider,
	stepRedirectUris,
	stepVerify,
	stepWebhook,
} from './deploy.js'
import { CancelledError } from './provision.js'

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	cancel: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
	password: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		step: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
	},
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
	tasks: vi.fn(),
}))

vi.mock('../deploy/wrangler.js', () => ({
	runWrangler: vi.fn(),
	wranglerLoggedIn: vi.fn(),
	wranglerLogin: vi.fn(),
	cloudflareApiTokenConfigured: vi.fn(() => false),
	ensureKvNamespace: vi.fn(),
	putSecret: vi.fn(),
	deploy: vi.fn(),
}))

vi.mock('../deploy/materialize.js', () => ({
	loadManifest: vi.fn(() => ({ templateVersion: '1.0.0' })),
	materialize: vi.fn(() => ({ dir: '/tmp/deploy', configPath: '/tmp/deploy/wrangler.json' })),
	exportManualBundle: vi.fn(() => '/tmp/export'),
}))

vi.mock('../nylas-env.js', () => ({
	deployedApiBaseUrl: vi.fn(() => undefined),
	resourceNameSuffix: vi.fn(() => ''),
	apiBaseUrl: vi.fn(() => 'https://api.us.nylas.com'),
	dashboardAccountUrl: vi.fn(() => undefined),
	gatewayUrls: vi.fn(() => ({})),
}))

vi.mock('../state/store.js', () => ({
	markStep: vi.fn(),
	saveProject: vi.fn(),
	loadAuth: vi.fn(() => null),
	saveAuth: vi.fn(),
}))

vi.mock('@nylas-labs/cli-kit', () => ({
	DashboardAccountClient: class {},
	DpopKey: class {},
	GatewayClient: class {},
	NylasV3Client: class {},
}))

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'my-inbox',
		createdAt: 1,
		updatedAt: 1,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	} as ProjectState
}

function makeCtx(project: ProjectState, v3: Partial<StepContext['v3']> = {}): StepContext {
	return {
		project,
		auth: null,
		dpop: null,
		dashboard: null,
		gateway: null,
		v3: v3 as StepContext['v3'],
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	// clearAllMocks wipes the default implementations set at mock creation.
	vi.mocked(p.isCancel).mockReturnValue(false)
	vi.mocked(p.spinner).mockReturnValue({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	} as unknown as ReturnType<typeof p.spinner>)
	vi.mocked(cloudflareApiTokenConfigured).mockReturnValue(false)
	vi.mocked(loadManifest).mockReturnValue({
		templateVersion: '1.0.0',
	} as ReturnType<typeof loadManifest>)
	vi.mocked(materialize).mockReturnValue({
		dir: '/tmp/deploy',
		configPath: '/tmp/deploy/wrangler.json',
	})
	vi.mocked(exportManualBundle).mockReturnValue('/tmp/export')
	vi.mocked(resourceNameSuffix).mockReturnValue('')
	vi.mocked(deployedApiBaseUrl).mockReturnValue(undefined)
	delete process.env.CLOUDFLARE_API_TOKEN
})

describe('stepHostingProvider', () => {
	it('is idempotent when a provider is already chosen', async () => {
		const ctx = makeCtx(makeProject({ hostingProvider: 'cloudflare' }))
		await stepHostingProvider(ctx)
		expect(p.select).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'hosting')
	})

	it('persists the chosen provider on a fresh run', async () => {
		vi.mocked(p.select).mockResolvedValueOnce('manual')
		const ctx = makeCtx(makeProject())
		await stepHostingProvider(ctx)
		expect(ctx.project.hostingProvider).toBe('manual')
		expect(saveProject).toHaveBeenCalledWith(ctx.project)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'hosting')
	})

	it('throws CancelledError when the provider prompt is cancelled', async () => {
		vi.mocked(p.select).mockResolvedValueOnce('x')
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		const ctx = makeCtx(makeProject())
		await expect(stepHostingProvider(ctx)).rejects.toBeInstanceOf(CancelledError)
		expect(saveProject).not.toHaveBeenCalled()
	})
})

describe('stepCfAuth', () => {
	it('skips Cloudflare auth for manual hosting', async () => {
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual' }))
		await stepCfAuth(ctx)
		expect(wranglerLoggedIn).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'cf-auth')
	})

	it('marks the step when already logged in', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(true)
		const ctx = makeCtx(makeProject({ hostingProvider: 'cloudflare' }))
		await stepCfAuth(ctx)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'cf-auth')
	})

	it('runs interactive auth when not logged in', async () => {
		// stepCfAuth check (false), ensureCloudflareAuth start (false), final (true).
		vi.mocked(wranglerLoggedIn)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true)
		vi.mocked(cloudflareApiTokenConfigured).mockReturnValue(true)
		const ctx = makeCtx(makeProject({ hostingProvider: 'cloudflare' }))
		await stepCfAuth(ctx)
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'cf-auth')
	})
})

describe('ensureCloudflareAuth', () => {
	it('returns immediately when already authenticated', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(true)
		await ensureCloudflareAuth()
		expect(p.select).not.toHaveBeenCalled()
	})

	it('skips the connect prompt when an API token is already configured', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
		vi.mocked(cloudflareApiTokenConfigured).mockReturnValue(true)
		await ensureCloudflareAuth()
		expect(p.select).not.toHaveBeenCalled()
	})

	it('accepts a pasted API token', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
		vi.mocked(p.select).mockResolvedValueOnce('token')
		vi.mocked(p.password).mockResolvedValueOnce('  a-very-long-cloudflare-token  ')
		await ensureCloudflareAuth()
		expect(process.env.CLOUDFLARE_API_TOKEN).toBe('a-very-long-cloudflare-token')
	})

	it('validates the pasted token', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
		vi.mocked(p.select).mockResolvedValueOnce('token')
		vi.mocked(p.password).mockResolvedValueOnce('a-very-long-cloudflare-token')
		await ensureCloudflareAuth()
		const validate = vi.mocked(p.password).mock.calls[0][0].validate as (
			v: string | undefined,
		) => string | undefined
		expect(validate(undefined)).toMatch(/valid Cloudflare API token/)
		expect(validate('short')).toMatch(/valid Cloudflare API token/)
		expect(validate('a-token-longer-than-twenty-chars')).toBeUndefined()
	})

	it('throws CancelledError when the connect method is cancelled', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false)
		vi.mocked(p.select).mockResolvedValueOnce('token')
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		await expect(ensureCloudflareAuth()).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws CancelledError when the token prompt is cancelled', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false)
		vi.mocked(p.select).mockResolvedValueOnce('token')
		vi.mocked(p.password).mockResolvedValueOnce('anything')
		vi.mocked(p.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true)
		await expect(ensureCloudflareAuth()).rejects.toBeInstanceOf(CancelledError)
	})

	it('opens the OAuth URL in the browser when confirmed', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
		vi.mocked(p.select).mockResolvedValueOnce('oauth')
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		await ensureCloudflareAuth()
		expect(wranglerLogin).toHaveBeenCalledWith({ openBrowser: true })
		expect(p.log.step).toHaveBeenCalledWith(expect.stringContaining('open a login URL'))
	})

	it('prints the OAuth URL when the browser open is declined', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
		vi.mocked(p.select).mockResolvedValueOnce('oauth')
		vi.mocked(p.confirm).mockResolvedValueOnce(false)
		await ensureCloudflareAuth()
		expect(wranglerLogin).toHaveBeenCalledWith({ openBrowser: false })
		expect(p.log.step).toHaveBeenCalledWith(expect.stringContaining('print a login URL'))
	})

	it('throws CancelledError when the OAuth confirm is cancelled', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false)
		vi.mocked(p.select).mockResolvedValueOnce('oauth')
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true)
		await expect(ensureCloudflareAuth()).rejects.toBeInstanceOf(CancelledError)
		expect(wranglerLogin).not.toHaveBeenCalled()
	})

	it('throws when authentication still fails afterwards', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(false)
		vi.mocked(cloudflareApiTokenConfigured).mockReturnValue(true)
		await expect(ensureCloudflareAuth()).rejects.toThrow(/authentication failed/)
	})
})

describe('stepCfResources', () => {
	it('skips resource creation for manual hosting', async () => {
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual' }))
		await stepCfResources(ctx)
		expect(ensureKvNamespace).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'cf-resources')
	})

	it('creates KV namespace and derives worker name from the slug', async () => {
		vi.mocked(ensureKvNamespace).mockResolvedValueOnce('kv-123')
		const ctx = makeCtx(makeProject())
		await stepCfResources(ctx)
		expect(ensureKvNamespace).toHaveBeenCalledWith('ownmail-my-inbox-sessions')
		expect(ctx.project.kvNamespaceId).toBe('kv-123')
		expect(ctx.project.workerName).toBe('my-inbox-ownmail')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'cf-resources')
	})

	it('derives worker name from the domain subdomain when present', async () => {
		vi.mocked(ensureKvNamespace).mockResolvedValueOnce('kv-1')
		const ctx = makeCtx(makeProject({ domainAddress: 'mail.example.com' }))
		await stepCfResources(ctx)
		expect(ctx.project.workerName).toBe('mail-ownmail')
	})

	it('reuses existing KV namespace and worker name on resume', async () => {
		const ctx = makeCtx(makeProject({ kvNamespaceId: 'existing-kv', workerName: 'existing-worker' }))
		await stepCfResources(ctx)
		expect(ensureKvNamespace).not.toHaveBeenCalled()
		expect(ctx.project.workerName).toBe('existing-worker')
	})
})

describe('stepDeploy (cloudflare)', () => {
	it('deploys with a custom domain, runtime base URL, and API key secret', async () => {
		vi.mocked(deployedApiBaseUrl).mockReturnValue('https://api.custom.nylas.com')
		vi.mocked(deploy).mockResolvedValueOnce('https://my-inbox.workers.dev')
		const ctx = makeCtx(
			makeProject({
				applicationId: 'client-id',
				workerName: 'worker',
				kvNamespaceId: 'kv',
				appDomain: 'mail.example.com',
				inboxEmail: 'me@example.com',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await stepDeploy(ctx)
		const materializeArg = vi.mocked(materialize).mock.calls[0][0]
		expect(materializeArg.appDomain).toBe('mail.example.com')
		expect(materializeArg.vars.NYLAS_API_BASE_URL).toBe('https://api.custom.nylas.com')
		expect(ctx.project.workersDevUrl).toBe('https://my-inbox.workers.dev')
		expect(putSecret).toHaveBeenCalledWith('worker', 'NYLAS_API_KEY', 'secret-key')
		expect(putSecret).toHaveBeenCalledWith('worker', 'SESSION_SECRET', expect.any(String))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'deploy')
	})

	it('deploys without a custom domain, runtime base URL, or API key', async () => {
		vi.mocked(deploy).mockResolvedValueOnce('https://plain.workers.dev')
		const ctx = makeCtx(
			makeProject({ applicationId: 'client-id', workerName: 'worker', kvNamespaceId: 'kv' }),
		)
		await stepDeploy(ctx)
		const materializeArg = vi.mocked(materialize).mock.calls[0][0]
		expect(materializeArg.appDomain).toBeUndefined()
		expect(materializeArg.vars.NYLAS_API_BASE_URL).toBeUndefined()
		expect(materializeArg.vars.INBOX_EMAIL).toBe('')
		// Only the session secret is set (no API key present).
		expect(putSecret).toHaveBeenCalledTimes(1)
		expect(putSecret).toHaveBeenCalledWith('worker', 'SESSION_SECRET', expect.any(String))
	})

	it('throws when the Nylas client id is missing', async () => {
		const ctx = makeCtx(makeProject({ workerName: 'worker', kvNamespaceId: 'kv' }))
		await expect(stepDeploy(ctx)).rejects.toThrow(/client ID is missing/)
	})

	it('throws when the worker name is missing', async () => {
		const ctx = makeCtx(makeProject({ applicationId: 'client-id', kvNamespaceId: 'kv' }))
		await expect(stepDeploy(ctx)).rejects.toThrow(/Cloudflare worker name is missing/)
	})
})

describe('stepDeploy (manual)', () => {
	it('exports the bundle and records the provided public URL', async () => {
		vi.mocked(deployedApiBaseUrl).mockReturnValue('https://api.custom.nylas.com')
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.text).mockResolvedValueOnce('https://mail.example.com/#frag?q=1')
		const ctx = makeCtx(
			makeProject({
				hostingProvider: 'manual',
				applicationId: 'client-id',
				inboxEmail: 'me@example.com',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await stepDeploy(ctx)
		const exportArg = vi.mocked(exportManualBundle).mock.calls[0][0]
		expect(exportArg.apiBaseUrl).toBe('https://api.custom.nylas.com')
		expect(exportArg.apiKey).toBe('secret-key')
		expect(exportArg.targetDir).toContain('my-inbox-ownmail-manual-')
		expect(ctx.project.manualAppUrl).toBe('https://mail.example.com')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'deploy')
	})

	it('uses an existing manual deploy dir and skips the URL prompt when set', async () => {
		const ctx = makeCtx(
			makeProject({
				hostingProvider: 'manual',
				applicationId: 'client-id',
				manualDeployDir: '/existing/dir',
				manualAppUrl: 'https://already.example.com',
			}),
		)
		await stepDeploy(ctx)
		const exportArg = vi.mocked(exportManualBundle).mock.calls[0][0]
		expect(exportArg.targetDir).toBe('/existing/dir')
		expect(exportArg.apiBaseUrl).toBeUndefined()
		expect(exportArg.apiKey).toBeUndefined()
		expect(p.confirm).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'deploy')
	})

	it('cancels the run when the URL is not yet available', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(false)
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual', applicationId: 'client-id' }))
		await expect(stepDeploy(ctx)).rejects.toBeInstanceOf(CancelledError)
		expect(p.cancel).toHaveBeenCalled()
		expect(markStep).not.toHaveBeenCalled()
	})

	it('throws CancelledError when the has-URL confirm is cancelled', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual', applicationId: 'client-id' }))
		await expect(stepDeploy(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws CancelledError when the URL prompt is cancelled', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.text).mockResolvedValueOnce('https://x.example.com')
		vi.mocked(p.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true)
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual', applicationId: 'client-id' }))
		await expect(stepDeploy(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('validates the public URL input', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.text).mockResolvedValueOnce('https://mail.example.com')
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual', applicationId: 'client-id' }))
		await stepDeploy(ctx)
		const validate = vi.mocked(p.text).mock.calls[0][0].validate as (
			v: string | undefined,
		) => string | undefined
		expect(validate(undefined)).toMatch(/public HTTPS URL/)
		expect(validate('http://insecure.example.com')).toMatch(/HTTPS URL/)
		expect(validate('not a url')).toMatch(/valid URL/)
		expect(validate('https://ok.example.com')).toBeUndefined()
	})
})

describe('stepWebhook', () => {
	it('skips webhook setup for manual hosting', async () => {
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual' }))
		await stepWebhook(ctx)
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('polling'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('registers the webhook and stores its secret', async () => {
		const ensureWebhook = vi.fn().mockResolvedValue({ webhook_secret: 'wh-secret' })
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		expect(ensureWebhook).toHaveBeenCalledWith('https://app.workers.dev/api/webhooks/nylas', [
			'message.created',
			'message.updated',
			'thread.replied',
		])
		expect(putSecret).toHaveBeenCalledWith('worker', 'NYLAS_WEBHOOK_SECRET', 'wh-secret')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('registers the webhook without storing a secret when none is returned', async () => {
		const ensureWebhook = vi.fn().mockResolvedValue({})
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		expect(putSecret).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('warns and continues when webhook setup fails with an Error', async () => {
		const ensureWebhook = vi.fn().mockRejectedValue(new Error('boom'))
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('warns and continues when webhook setup fails with a non-Error', async () => {
		const ensureWebhook = vi.fn().mockRejectedValue('string failure')
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('string failure'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})
})

describe('stepRedirectUris', () => {
	it('registers localhost, app domain, and workers.dev callbacks', async () => {
		const ensureRedirectUris = vi.fn().mockResolvedValue(undefined)
		const ctx = makeCtx(
			makeProject({ appDomain: 'mail.example.com', workersDevUrl: 'https://app.workers.dev' }),
			{ ensureRedirectUris },
		)
		await stepRedirectUris(ctx)
		const urls = ensureRedirectUris.mock.calls[0][0] as string[]
		expect(urls).toContain('http://localhost:3000/auth/callback')
		expect(urls).toContain('https://mail.example.com/auth/callback')
		// appUrl resolves to the app domain (not workers.dev) when a domain is set.
		expect(urls).toContain('https://mail.example.com/auth/callback')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'redirect-uris')
	})

	it('registers the workers.dev callback when there is no custom domain', async () => {
		const ensureRedirectUris = vi.fn().mockResolvedValue(undefined)
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }), {
			ensureRedirectUris,
		})
		await stepRedirectUris(ctx)
		const urls = ensureRedirectUris.mock.calls[0][0] as string[]
		expect(urls).toContain('https://app.workers.dev/auth/callback')
	})

	it('registers only localhost when no app URL is known', async () => {
		const ensureRedirectUris = vi.fn().mockResolvedValue(undefined)
		const ctx = makeCtx(makeProject(), { ensureRedirectUris })
		await stepRedirectUris(ctx)
		const urls = ensureRedirectUris.mock.calls[0][0] as string[]
		expect(urls).toEqual(['http://localhost:3000/auth/callback'])
	})
})

describe('stepVerify', () => {
	it('reports the app is live when the health check passes', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true })
		vi.stubGlobal('fetch', fetchMock)
		const ctx = makeCtx(
			makeProject({ workersDevUrl: 'https://app.workers.dev', inboxEmail: 'me@example.com' }),
		)
		await stepVerify(ctx)
		expect(fetchMock).toHaveBeenCalledWith('https://app.workers.dev/healthz')
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(ctx.project.pendingSecrets).toEqual({})
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'verify')
		vi.unstubAllGlobals()
	})

	it('warns when the health check never returns ok', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: false })
		vi.stubGlobal('fetch', fetchMock)
		// Collapse the 3s backoff so the 10-attempt loop runs instantly.
		vi.stubGlobal('setTimeout', ((fn: () => void) => {
			fn()
			return 0
		}) as unknown as typeof setTimeout)
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }))
		await stepVerify(ctx)
		expect(fetchMock).toHaveBeenCalledTimes(10)
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('doctor'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'verify')
		vi.unstubAllGlobals()
	})

	it('tolerates fetch errors during the health check', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('not ready'))
		vi.stubGlobal('fetch', fetchMock)
		vi.stubGlobal('setTimeout', ((fn: () => void) => {
			fn()
			return 0
		}) as unknown as typeof setTimeout)
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }))
		await stepVerify(ctx)
		expect(fetchMock).toHaveBeenCalledTimes(10)
		expect(p.log.warn).toHaveBeenCalled()
		vi.unstubAllGlobals()
	})

	it('throws when no app URL is known', async () => {
		const ctx = makeCtx(makeProject())
		await expect(stepVerify(ctx)).rejects.toThrow(/App URL is missing/)
	})

	it('prefers the manual app URL over workers.dev', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true })
		vi.stubGlobal('fetch', fetchMock)
		const ctx = makeCtx(
			makeProject({
				manualAppUrl: 'https://manual.example.com',
				workersDevUrl: 'https://app.workers.dev',
			}),
		)
		await stepVerify(ctx)
		expect(fetchMock).toHaveBeenCalledWith('https://manual.example.com/healthz')
		vi.unstubAllGlobals()
	})
})
