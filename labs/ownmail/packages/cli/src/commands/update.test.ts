import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runUpdate } from './update.js'

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	log: { info: vi.fn(), step: vi.fn() },
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}))

vi.mock('node:fs', () => ({ rmSync: vi.fn() }))

vi.mock('../deploy/app-health.js', () => ({ checkAppHealth: vi.fn() }))

vi.mock('../deploy/local-server.js', () => ({ findLocalPort: vi.fn(), startLocalServer: vi.fn() }))

vi.mock('../deploy/materialize.js', () => ({
	loadManifest: vi.fn(),
	materialize: vi.fn(),
	materializeVercel: vi.fn(),
	materializeNetlify: vi.fn(),
	materializeLocal: vi.fn(),
}))

vi.mock('../deploy/provider-cli.js', () => ({
	deployVercel: vi.fn(),
	deployNetlify: vi.fn(),
	ensureVercelProject: vi.fn(),
	ensureVercelRealtimeStore: vi.fn(),
	setNetlifyEnvironment: vi.fn(),
	setVercelEnvironment: vi.fn(),
}))

vi.mock('../deploy/wrangler.js', () => ({
	deploy: vi.fn(),
}))

vi.mock('../nylas-env.js', () => ({
	deployedApiBaseUrl: vi.fn(() => undefined),
}))

vi.mock('../state/store.js', () => ({
	saveProject: vi.fn(),
	configDir: vi.fn(() => '/config'),
}))

vi.mock('../state/pending-secrets.js', () => ({ readPendingSecret: vi.fn() }))

vi.mock('../steps/deploy.js', () => ({
	ensureCloudflareAuth: vi.fn(),
}))

vi.mock('./shared.js', () => ({
	pickExistingProject: vi.fn(),
}))

import * as p from '@clack/prompts'
import { checkAppHealth } from '../deploy/app-health.js'
import { findLocalPort, startLocalServer } from '../deploy/local-server.js'
import {
	loadManifest,
	materialize,
	materializeLocal,
	materializeNetlify,
	materializeVercel,
} from '../deploy/materialize.js'
import {
	deployNetlify,
	deployVercel,
	ensureVercelProject,
	ensureVercelRealtimeStore,
	setNetlifyEnvironment,
	setVercelEnvironment,
} from '../deploy/provider-cli.js'
import { deploy } from '../deploy/wrangler.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
import { readPendingSecret } from '../state/pending-secrets.js'
import { saveProject } from '../state/store.js'
import { ensureCloudflareAuth } from '../steps/deploy.js'
import { pickExistingProject } from './shared.js'

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
	return {
		slug: 'acme',
		createdAt: 0,
		updatedAt: 0,
		region: 'us',
		ejected: false,
		completedSteps: [],
		pendingSecrets: {},
		...overrides,
	} as ProjectState
}

function fullDeployProject(overrides: Partial<ProjectState> = {}): ProjectState {
	return makeProject({
		hostingProvider: 'cloudflare',
		applicationId: 'app_1',
		workerName: 'acme-ownmail',
		workersDevUrl: 'https://acme.workers.dev',
		kvNamespaceId: 'kv_1',
		templateVersion: '1.0.0',
		...overrides,
	})
}

let savedExitCode: typeof process.exitCode

beforeEach(() => {
	vi.clearAllMocks()
	savedExitCode = process.exitCode
	process.exitCode = undefined
	vi.mocked(loadManifest).mockReturnValue({
		templateVersion: '1.2.0',
		minCliVersion: '0.1.0',
		requiredSecrets: [],
		requiredVars: [],
		kvBindings: [],
		migrations: [],
	})
	vi.mocked(deployedApiBaseUrl).mockReturnValue(undefined)
	vi.mocked(materialize).mockReturnValue({ dir: '/tmp/x', configPath: '/tmp/x/wrangler.json' })
	vi.mocked(materializeVercel).mockReturnValue({ dir: '/tmp/vercel' })
	vi.mocked(materializeNetlify).mockReturnValue({ dir: '/tmp/netlify' })
	vi.mocked(materializeLocal).mockReturnValue({ dir: '/config/runtimes/acme' })
	vi.mocked(deployVercel).mockResolvedValue('https://acme.vercel.app')
	vi.mocked(deployNetlify).mockResolvedValue('https://acme.netlify.app')
	vi.mocked(findLocalPort).mockResolvedValue(3000)
	vi.mocked(startLocalServer).mockResolvedValue('http://localhost:3000')
	vi.mocked(checkAppHealth).mockReset().mockResolvedValue(false)
	vi.mocked(readPendingSecret).mockImplementation((_project, name) =>
		name === 'apiKey' ? 'nyk_secret' : 'session_secret',
	)
	vi.mocked(deploy).mockResolvedValue('https://acme.workers.dev')
})

afterEach(() => {
	process.exitCode = savedExitCode
})

describe('runUpdate — guard clauses', () => {
	it('refuses to update an ejected project', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ ejected: true }))

		await expect(runUpdate({})).rejects.toThrow(/is ejected/)
	})

	it('explains manual-hosted updates and exits without deploying', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'manual', manualDeployDir: '/exports/acme' }),
		)

		await runUpdate({})

		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('/exports/acme'))
		expect(p.outro).toHaveBeenCalledWith('No Cloudflare deployment was changed.')
		expect(deploy).not.toHaveBeenCalled()
	})

	it('errors when a manual project has never exported a bundle', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ hostingProvider: 'manual' }))

		await expect(runUpdate({})).rejects.toThrow(/has not exported a manual deploy bundle/)
	})

	it('infers manual hosting when neither provider nor worker name is set', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: undefined, workerName: undefined }),
		)

		await expect(runUpdate({})).rejects.toThrow(/has not exported a manual deploy bundle/)
	})

	it('treats a project without a hostingProvider but with a workerName as cloudflare', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			fullDeployProject({ hostingProvider: undefined, templateVersion: '1.2.0' }),
		)

		await runUpdate({})

		expect(deploy).toHaveBeenCalled()
	})

	it('errors when the first deploy is incomplete', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(fullDeployProject({ workersDevUrl: undefined }))

		await expect(runUpdate({})).rejects.toThrow(/hasn’t finished its first deploy/)
	})

	it('errors when the application client ID is missing', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(fullDeployProject({ applicationId: '   ' }))

		await expect(runUpdate({})).rejects.toThrow(/client ID is missing/)
	})
})

describe('runUpdate — redeploy', () => {
	it('stops the spinner and preserves the project when Cloudflare rejects an update', async () => {
		const spinner = { start: vi.fn(), stop: vi.fn() }
		vi.mocked(p.spinner).mockReturnValueOnce(spinner as unknown as ReturnType<typeof p.spinner>)
		const project = fullDeployProject()
		vi.mocked(pickExistingProject).mockResolvedValue(project)
		vi.mocked(deploy).mockRejectedValueOnce(new Error('Cloudflare could not deploy the mailbox app.'))

		await expect(runUpdate({})).rejects.toThrow(/could not deploy/)

		expect(spinner.stop).toHaveBeenCalledWith(
			'Cloudflare update needs attention; retry `npx ownmail app update` when ready.',
		)
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('redeploys and refreshes config when already on the latest template', async () => {
		const project = fullDeployProject({ templateVersion: '1.2.0' })
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runUpdate({})

		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('redeploying anyway'))
		expect(ensureCloudflareAuth).toHaveBeenCalled()
		expect(deploy).toHaveBeenCalledWith('/tmp/x/wrangler.json')
		expect(project.templateVersion).toBe('1.2.0')
		expect(saveProject).toHaveBeenCalledWith(project)
		expect(p.outro).toHaveBeenCalledWith('Secrets and sessions were untouched.')
	})

	it('shows migration notes when upgrading across versions', async () => {
		vi.mocked(loadManifest).mockReturnValue({
			templateVersion: '1.2.0',
			minCliVersion: '0.1.0',
			requiredSecrets: [],
			requiredVars: [],
			kvBindings: [],
			migrations: [
				{ version: '0.9.0', notes: 'old — skipped' },
				{ version: '1.1.0', notes: 'added calendar' },
			],
		})
		const project = fullDeployProject({ templateVersion: '1.0.0' })
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runUpdate({})

		expect(p.note).toHaveBeenCalledWith('1.1.0: added calendar', expect.stringContaining('1.0.0'))
		expect(p.log.step).toHaveBeenCalledWith(expect.stringContaining('1.0.0 → 1.2.0'))
		expect(project.templateVersion).toBe('1.2.0')
	})

	it('upgrades without a migration note when nothing is relevant', async () => {
		const project = fullDeployProject({ templateVersion: '1.1.0' })
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runUpdate({})

		expect(p.note).not.toHaveBeenCalled()
		expect(p.log.step).toHaveBeenCalled()
	})

	it('handles a project that has never recorded a template version', async () => {
		vi.mocked(loadManifest).mockReturnValue({
			templateVersion: '1.2.0',
			minCliVersion: '0.1.0',
			requiredSecrets: [],
			requiredVars: [],
			kvBindings: [],
			migrations: [{ version: '1.0.0', notes: 'first' }],
		})
		const project = fullDeployProject({ templateVersion: undefined })
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runUpdate({})

		expect(p.note).toHaveBeenCalledWith('1.0.0: first', expect.stringContaining('undefined'))
	})

	it('injects an optional appDomain and runtime API base URL into the materialized vars', async () => {
		vi.mocked(deployedApiBaseUrl).mockReturnValue('https://api-staging.us.nylas.com')
		const project = fullDeployProject({ appDomain: 'mail.acme.com', inboxEmail: 'hi@acme.com' })
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runUpdate({})

		expect(materialize).toHaveBeenCalledWith(
			expect.objectContaining({
				appDomain: 'mail.acme.com',
				vars: expect.objectContaining({
					NYLAS_API_BASE_URL: 'https://api-staging.us.nylas.com',
					INBOX_EMAIL: 'hi@acme.com',
				}),
			}),
		)
	})

	it('omits appDomain and defaults inbox email when neither is set', async () => {
		const project = fullDeployProject({ appDomain: undefined, inboxEmail: undefined })
		vi.mocked(pickExistingProject).mockResolvedValue(project)

		await runUpdate({})

		const arg = vi.mocked(materialize).mock.calls[0]?.[0]
		expect(arg).not.toHaveProperty('appDomain')
		expect(arg?.vars.INBOX_EMAIL).toBe('')
		expect(arg?.vars).not.toHaveProperty('NYLAS_API_BASE_URL')
	})
})

describe('runUpdate — Node providers', () => {
	it('redeploys a linked Vercel project without rotating settings', async () => {
		const project = makeProject({
			hostingProvider: 'vercel',
			applicationId: 'app_1',
			inboxEmail: 'hi@acme.com',
			vercelProjectId: 'prj_1',
			vercelOrgId: 'team_1',
			providerAppUrl: 'https://old.vercel.app',
			siteName: 'Acme Inbox',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)
		vi.mocked(checkAppHealth).mockResolvedValueOnce(true)
		await runUpdate({})
		expect(ensureVercelProject).toHaveBeenCalledWith('/tmp/vercel', 'acme-ownmail', 'team_1', {
			projectId: 'prj_1',
			orgId: 'team_1',
		})
		expect(ensureVercelRealtimeStore).toHaveBeenCalledWith('/tmp/vercel', 'acme-realtime', 'us')
		expect(setVercelEnvironment).toHaveBeenCalledWith(
			'/tmp/vercel',
			expect.objectContaining({ OWNMAIL_SITE_NAME: 'Acme Inbox', INBOX_EMAIL: 'hi@acme.com' }),
			new Set(),
		)
		expect(project.providerAppUrl).toBe('https://acme.vercel.app')
	})

	it('reports Vercel runtime logs when the redeployed app is unhealthy', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				hostingProvider: 'vercel',
				applicationId: 'app_1',
				inboxEmail: 'hi@acme.com',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
			}),
		)

		await expect(runUpdate({})).rejects.toThrow(
			'npx vercel logs --deployment https://acme.vercel.app --level error --expand',
		)
	})

	it('requires recorded identifiers before provider redeploys', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ hostingProvider: 'vercel' }))
		await expect(runUpdate({})).rejects.toThrow(/missing its recorded Vercel project/)

		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ hostingProvider: 'netlify' }))
		await expect(runUpdate({})).rejects.toThrow(/missing its recorded Netlify site/)
	})

	it('redeploys a recorded Netlify site', async () => {
		vi.mocked(deployedApiBaseUrl).mockReturnValueOnce('https://api-staging.example.com')
		const project = makeProject({
			hostingProvider: 'netlify',
			applicationId: 'app_1',
			inboxEmail: 'hi@acme.com',
			netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)
		await runUpdate({})
		expect(deployNetlify).toHaveBeenCalledWith('/tmp/netlify', project.netlifySiteId)
		expect(setNetlifyEnvironment).toHaveBeenCalledWith(
			'/tmp/netlify',
			project.netlifySiteId,
			expect.objectContaining({
				NYLAS_API_BASE_URL: 'https://api-staging.example.com',
				OWNMAIL_SITE_NAME: 'ownmail',
			}),
		)
		expect(project.providerAppUrl).toBe('https://acme.netlify.app')
	})

	it('fails closed before changing provider settings when required runtime identity is missing', async () => {
		vi.mocked(pickExistingProject).mockResolvedValueOnce(
			makeProject({
				hostingProvider: 'vercel',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
				inboxEmail: 'hi@acme.com',
			}),
		)
		await expect(runUpdate({})).rejects.toThrow(/client ID is missing/)

		vi.mocked(pickExistingProject).mockResolvedValueOnce(
			makeProject({
				hostingProvider: 'vercel',
				vercelProjectId: 'prj_1',
				vercelOrgId: 'team_1',
				applicationId: 'app_1',
			}),
		)
		await expect(runUpdate({})).rejects.toThrow(/Inbox email is missing/)
		expect(deployVercel).not.toHaveBeenCalled()
	})

	it('stops the provider spinner on a failed redeploy', async () => {
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({
				hostingProvider: 'netlify',
				applicationId: 'app_1',
				inboxEmail: 'hi@acme.com',
				netlifySiteId: '123e4567-e89b-42d3-a456-426614174000',
			}),
		)
		vi.mocked(deployNetlify).mockRejectedValueOnce(new Error('failed'))
		await expect(runUpdate({})).rejects.toThrow('failed')
	})

	it('restarts a stopped local server with keyring secrets', async () => {
		vi.mocked(deployedApiBaseUrl).mockReturnValue('https://api-staging.us.nylas.com')
		const project = makeProject({
			hostingProvider: 'local',
			applicationId: 'app_1',
			inboxEmail: 'hello@example.com',
			localAppUrl: 'http://localhost:3000',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)
		await runUpdate({})
		expect(startLocalServer).toHaveBeenCalledWith(
			expect.objectContaining({
				environment: expect.objectContaining({
					NYLAS_API_KEY: 'nyk_secret',
					NYLAS_API_BASE_URL: 'https://api-staging.us.nylas.com',
				}),
			}),
		)
		expect(project.templateVersion).toBe('1.2.0')
	})

	it('requires the existing local server to stop before updating', async () => {
		vi.mocked(checkAppHealth).mockResolvedValueOnce(true)
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'local', localAppUrl: 'http://localhost:3000' }),
		)
		await expect(runUpdate({})).rejects.toThrow(/Stop it with Ctrl\+C/)
	})

	it('restarts a stopped local server without an API base override', async () => {
		const project = makeProject({
			hostingProvider: 'local',
			applicationId: 'app_1',
			inboxEmail: 'hello@example.com',
		})
		vi.mocked(pickExistingProject).mockResolvedValue(project)
		await runUpdate({})
		expect(vi.mocked(startLocalServer).mock.calls.at(-1)?.[0].environment).not.toHaveProperty(
			'NYLAS_API_BASE_URL',
		)
	})

	it('fails when local runtime secrets or required settings are missing', async () => {
		vi.mocked(readPendingSecret).mockReturnValue(null)
		vi.mocked(pickExistingProject).mockResolvedValue(makeProject({ hostingProvider: 'local' }))
		await expect(runUpdate({})).rejects.toThrow(/secrets are unavailable/)

		vi.mocked(readPendingSecret).mockImplementation((_project, name) =>
			name === 'apiKey' ? 'key' : 'session',
		)
		vi.mocked(pickExistingProject).mockResolvedValue(
			makeProject({ hostingProvider: 'local', applicationId: 'app_1' }),
		)
		await expect(runUpdate({})).rejects.toThrow(/Inbox email is missing/)
	})
})
