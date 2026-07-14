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

vi.mock('../deploy/materialize.js', () => ({
	loadManifest: vi.fn(),
	materialize: vi.fn(),
}))

vi.mock('../deploy/wrangler.js', () => ({
	deploy: vi.fn(),
}))

vi.mock('../nylas-env.js', () => ({
	deployedApiBaseUrl: vi.fn(() => undefined),
}))

vi.mock('../state/store.js', () => ({
	saveProject: vi.fn(),
}))

vi.mock('../steps/deploy.js', () => ({
	ensureCloudflareAuth: vi.fn(),
}))

vi.mock('./shared.js', () => ({
	pickExistingProject: vi.fn(),
}))

import * as p from '@clack/prompts'
import { loadManifest, materialize } from '../deploy/materialize.js'
import { deploy } from '../deploy/wrangler.js'
import { deployedApiBaseUrl } from '../nylas-env.js'
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
			'Cloudflare update needs attention; retry `npx ownmail update` when ready.',
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
