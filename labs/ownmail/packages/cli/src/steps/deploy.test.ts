import * as p from '@clack/prompts'
import open from 'open'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('open', () => ({ default: vi.fn() }))

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

vi.mock('../state/pending-secrets.js', () => ({
	clearPendingSecrets: vi.fn((project: ProjectState) => {
		project.pendingSecrets = {}
	}),
	readPendingSecret: vi.fn((project: ProjectState, name: keyof ProjectState['pendingSecrets']) => {
		const secret = project.pendingSecrets[name]
		return typeof secret === 'string' ? secret : null
	}),
}))

vi.mock('@nylas-labs/cli-kit', () => ({
	DashboardAccountClient: class {},
	DpopKey: class {},
	GatewayClient: class {},
	NylasV3Client: class {},
}))

import { clearPendingSecrets } from '../state/pending-secrets.js'

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
	vi.mocked(open).mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof open>>)
	delete process.env.CLOUDFLARE_API_TOKEN
})

afterEach(() => {
	vi.unstubAllGlobals()
})

function stubHealthyApp() {
	const fetchMock = vi.fn().mockResolvedValue({ ok: true })
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

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
		const options = vi.mocked(p.select).mock.calls[0][0].options
		expect(options[0]).toMatchObject({
			value: 'oauth',
			label: expect.stringContaining('recommended'),
		})
		expect(options[1]).toMatchObject({ value: 'token', label: expect.stringContaining('advanced') })
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('Recommended: Wrangler OAuth'))
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
		await expect(ensureCloudflareAuth()).rejects.toThrow(/Replace `CLOUDFLARE_API_TOKEN`/)
	})

	it('explains how to retry OAuth when sign-in does not persist', async () => {
		vi.mocked(wranglerLoggedIn).mockResolvedValueOnce(false).mockResolvedValueOnce(false)
		vi.mocked(p.select).mockResolvedValueOnce('oauth')
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		await expect(ensureCloudflareAuth()).rejects.toThrow(/connect with Wrangler OAuth/)
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

	it('stops the storage spinner and leaves setup resumable when Cloudflare rejects storage creation', async () => {
		const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() }
		vi.mocked(p.spinner)
			.mockReset()
			.mockReturnValueOnce(spinner as unknown as ReturnType<typeof p.spinner>)
		vi.mocked(ensureKvNamespace).mockRejectedValueOnce(
			new Error('Cloudflare could not create session storage.'),
		)
		const ctx = makeCtx(makeProject())
		await expect(stepCfResources(ctx)).rejects.toThrow(/could not create session storage/)
		expect(spinner.stop).toHaveBeenCalledWith(
			'Cloudflare session storage needs attention; your project can be resumed.',
		)
		expect(markStep).not.toHaveBeenCalledWith(ctx.project, 'cf-resources')
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

	it('deploys without a custom domain or runtime base URL', async () => {
		vi.mocked(deploy).mockResolvedValueOnce('https://plain.workers.dev')
		const ctx = makeCtx(
			makeProject({
				applicationId: 'client-id',
				workerName: 'worker',
				kvNamespaceId: 'kv',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await stepDeploy(ctx)
		const materializeArg = vi.mocked(materialize).mock.calls[0][0]
		expect(materializeArg.appDomain).toBeUndefined()
		expect(materializeArg.vars.NYLAS_API_BASE_URL).toBeUndefined()
		expect(materializeArg.vars.INBOX_EMAIL).toBe('')
		expect(putSecret).toHaveBeenCalledTimes(2)
		expect(putSecret).toHaveBeenCalledWith('worker', 'NYLAS_API_KEY', 'secret-key')
		expect(putSecret).toHaveBeenCalledWith('worker', 'SESSION_SECRET', expect.any(String))
	})

	it('throws when the pending API key is missing at deploy time', async () => {
		vi.mocked(deploy).mockResolvedValueOnce('https://plain.workers.dev')
		const ctx = makeCtx(
			makeProject({ applicationId: 'client-id', workerName: 'worker', kvNamespaceId: 'kv' }),
		)
		await expect(stepDeploy(ctx)).rejects.toThrow(/Pending Nylas API key is missing/)
		expect(materialize).not.toHaveBeenCalled()
		expect(deploy).not.toHaveBeenCalled()
		expect(putSecret).not.toHaveBeenCalled()
	})

	it('throws when the Nylas client id is missing', async () => {
		const ctx = makeCtx(makeProject({ workerName: 'worker', kvNamespaceId: 'kv' }))
		await expect(stepDeploy(ctx)).rejects.toThrow(/client ID is missing/)
	})

	it('throws when the worker name is missing', async () => {
		const ctx = makeCtx(makeProject({ applicationId: 'client-id', kvNamespaceId: 'kv' }))
		await expect(stepDeploy(ctx)).rejects.toThrow(/Cloudflare worker name is missing/)
	})

	it('stops the deployment spinner and leaves setup resumable when deployment fails', async () => {
		const deploymentSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() }
		vi.mocked(p.spinner)
			.mockReset()
			.mockReturnValueOnce(deploymentSpinner as unknown as ReturnType<typeof p.spinner>)
		vi.mocked(deploy)
			.mockReset()
			.mockRejectedValueOnce(new Error('Cloudflare could not deploy the mailbox app.'))
		const ctx = makeCtx(
			makeProject({
				applicationId: 'client-id',
				workerName: 'worker',
				kvNamespaceId: 'kv',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await expect(stepDeploy(ctx)).rejects.toThrow(/could not deploy/)
		expect(deploymentSpinner.stop).toHaveBeenCalledWith(
			'Cloudflare deployment needs attention; your project can be resumed.',
		)
		expect(putSecret).not.toHaveBeenCalled()
		expect(markStep).not.toHaveBeenCalledWith(ctx.project, 'deploy')
	})

	it('stops secret setup and leaves setup resumable when a secret write fails', async () => {
		const deploymentSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() }
		vi.mocked(p.spinner)
			.mockReset()
			.mockReturnValueOnce(deploymentSpinner as unknown as ReturnType<typeof p.spinner>)
		vi.mocked(deploy).mockReset().mockResolvedValueOnce('https://plain.workers.dev')
		vi.mocked(putSecret)
			.mockReset()
			.mockRejectedValueOnce(new Error('Cloudflare could not store deployment secrets.'))
		const ctx = makeCtx(
			makeProject({
				applicationId: 'client-id',
				workerName: 'worker',
				kvNamespaceId: 'kv',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await expect(stepDeploy(ctx)).rejects.toThrow(/could not store deployment secrets/)
		expect(deploymentSpinner.stop).toHaveBeenCalledWith(
			'Cloudflare could not finish secret setup; your project can be resumed.',
		)
		expect(ctx.project.workersDevUrl).toBe('https://plain.workers.dev')
		expect(markStep).not.toHaveBeenCalledWith(ctx.project, 'deploy')
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
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await stepDeploy(ctx)
		const exportArg = vi.mocked(exportManualBundle).mock.calls[0][0]
		expect(exportArg.targetDir).toBe('/existing/dir')
		expect(exportArg.apiBaseUrl).toBeUndefined()
		expect(exportArg.apiKey).toBe('secret-key')
		expect(p.confirm).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'deploy')
	})

	it('throws when the pending API key is missing for manual export', async () => {
		const ctx = makeCtx(makeProject({ hostingProvider: 'manual', applicationId: 'client-id' }))
		await expect(stepDeploy(ctx)).rejects.toThrow(/Pending Nylas API key is missing/)
		expect(exportManualBundle).not.toHaveBeenCalled()
	})

	it('cancels the run when the URL is not yet available', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(false)
		const ctx = makeCtx(
			makeProject({
				hostingProvider: 'manual',
				applicationId: 'client-id',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await expect(stepDeploy(ctx)).rejects.toBeInstanceOf(CancelledError)
		expect(p.cancel).toHaveBeenCalled()
		expect(markStep).not.toHaveBeenCalled()
	})

	it('throws CancelledError when the has-URL confirm is cancelled', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		const ctx = makeCtx(
			makeProject({
				hostingProvider: 'manual',
				applicationId: 'client-id',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await expect(stepDeploy(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('throws CancelledError when the URL prompt is cancelled', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.text).mockResolvedValueOnce('https://x.example.com')
		vi.mocked(p.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true)
		const ctx = makeCtx(
			makeProject({
				hostingProvider: 'manual',
				applicationId: 'client-id',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
		await expect(stepDeploy(ctx)).rejects.toBeInstanceOf(CancelledError)
	})

	it('validates the public URL input', async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.text).mockResolvedValueOnce('https://mail.example.com')
		const ctx = makeCtx(
			makeProject({
				hostingProvider: 'manual',
				applicationId: 'client-id',
				pendingSecrets: { apiKey: 'secret-key' },
			}),
		)
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
		stubHealthyApp()
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

	it('normalizes the webhook callback URL before registering it', async () => {
		stubHealthyApp()
		const ensureWebhook = vi.fn().mockResolvedValue({})
		const ctx = makeCtx(
			makeProject({ workerName: 'worker', workersDevUrl: ' https://app.workers.dev/path/?debug=1#hash ' }),
			{ ensureWebhook },
		)

		await stepWebhook(ctx)

		expect(ensureWebhook).toHaveBeenCalledWith('https://app.workers.dev/path/api/webhooks/nylas', [
			'message.created',
			'message.updated',
			'thread.replied',
		])
	})

	it('registers the webhook without storing a secret when none is returned', async () => {
		stubHealthyApp()
		const ensureWebhook = vi.fn().mockResolvedValue({})
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		expect(putSecret).not.toHaveBeenCalled()
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('skips webhook setup until the deployed app is healthy', async () => {
		const ensureWebhook = vi.fn()
		const fetchMock = vi.fn().mockResolvedValue({ ok: false })
		vi.stubGlobal('fetch', fetchMock)
		vi.stubGlobal('setTimeout', ((fn: () => void) => {
			fn()
			return 0
		}) as unknown as typeof setTimeout)
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})

		await stepWebhook(ctx)

		expect(fetchMock).toHaveBeenCalledWith('https://app.workers.dev/healthz', expect.any(Object))
		expect(ensureWebhook).not.toHaveBeenCalled()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('not reachable yet'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('skips webhook setup locally when no app URL is recorded', async () => {
		const ensureWebhook = vi.fn()
		const ctx = makeCtx(makeProject({ workerName: 'worker' }), { ensureWebhook })

		await stepWebhook(ctx)

		expect(ensureWebhook).not.toHaveBeenCalled()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('public HTTPS app URL'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('skips webhook setup locally when the app URL is blank', async () => {
		const ensureWebhook = vi.fn()
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: '   ' }), { ensureWebhook })

		await stepWebhook(ctx)

		expect(ensureWebhook).not.toHaveBeenCalled()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('public HTTPS app URL'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('skips webhook setup locally when the app URL is not HTTPS', async () => {
		const ensureWebhook = vi.fn()
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: 'http://app.example.com' }), {
			ensureWebhook,
		})

		await stepWebhook(ctx)

		expect(ensureWebhook).not.toHaveBeenCalled()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('public HTTPS app URL'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('skips webhook setup locally when the app URL is malformed', async () => {
		const ensureWebhook = vi.fn()
		const ctx = makeCtx(makeProject({ workerName: 'worker', workersDevUrl: 'not a url' }), {
			ensureWebhook,
		})

		await stepWebhook(ctx)

		expect(ensureWebhook).not.toHaveBeenCalled()
		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('public HTTPS app URL'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('warns and continues when webhook setup fails with an Error', async () => {
		stubHealthyApp()
		const ensureWebhook = vi
			.fn()
			.mockRejectedValue(new Error('unable.verify.webhook_url : input webhook url is empty'))
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('Couldn’t set up instant updates.')
		expect(warning).toContain('npx ownmail doctor')
		expect(warning).not.toContain('unable.verify.webhook_url')
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('warns and continues when a returned webhook secret cannot be stored', async () => {
		stubHealthyApp()
		const ensureWebhook = vi.fn().mockResolvedValue({ webhook_secret: 'wh-secret' })
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})

		await stepWebhook(ctx)

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Couldn’t set up instant updates.'))
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'webhook')
	})

	it('warns and continues when webhook setup fails with a non-Error', async () => {
		stubHealthyApp()
		const ensureWebhook = vi.fn().mockRejectedValue('string failure')
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }), {
			ensureWebhook,
		})
		await stepWebhook(ctx)
		const [[warning]] = vi.mocked(p.log.warn).mock.calls
		expect(warning).toContain('Couldn’t set up instant updates.')
		expect(warning).not.toContain('string failure')
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
	it('reports the app is live, clears pending secrets, and opens the app when requested', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true })
		vi.stubGlobal('fetch', fetchMock)
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		const ctx = makeCtx(
			makeProject({
				workersDevUrl: 'https://app.workers.dev',
				inboxEmail: 'me@example.com',
				pendingSecrets: { apiKey: 'secret-key', appPassword: 'Sup3rSecret!!x' },
			}),
		)
		await stepVerify(ctx)
		expect(fetchMock).toHaveBeenCalledWith('https://app.workers.dev/healthz', expect.any(Object))
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(clearPendingSecrets).toHaveBeenCalledWith(ctx.project)
		expect(ctx.project.pendingSecrets).toEqual({})
		expect(markStep).toHaveBeenCalledWith(ctx.project, 'verify')
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Reset password:    npx ownmail inbox reset-password'),
			'🎉 Done',
		)
		expect(p.note).toHaveBeenCalledWith(expect.stringContaining('IMAP:'), '🎉 Done')
		expect(p.note).toHaveBeenCalledWith(expect.stringContaining('SMTP:'), '🎉 Done')
		expect(open).toHaveBeenCalledWith('https://app.workers.dev')
		vi.unstubAllGlobals()
	})

	it('warns when opening the live app fails', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true })
		vi.stubGlobal('fetch', fetchMock)
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(open).mockRejectedValueOnce(new Error('no browser'))
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }))

		await stepVerify(ctx)

		expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not open the browser'))
		vi.unstubAllGlobals()
	})

	it('skips opening the app when the browser prompt is cancelled', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true })
		vi.stubGlobal('fetch', fetchMock)
		vi.mocked(p.confirm).mockResolvedValueOnce(true)
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		const ctx = makeCtx(makeProject({ workersDevUrl: 'https://app.workers.dev' }))

		await stepVerify(ctx)

		expect(open).not.toHaveBeenCalled()
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
		expect(fetchMock).toHaveBeenCalledWith('https://manual.example.com/healthz', expect.any(Object))
		vi.unstubAllGlobals()
	})
})
