import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectState } from '../state/schema.js'
import { runCreate } from './create.js'

const CANCEL = Symbol('cancel')

vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	note: vi.fn(),
	cancel: vi.fn(),
	log: { error: vi.fn(), info: vi.fn(), step: vi.fn() },
	select: vi.fn(),
	text: vi.fn(),
	isCancel: vi.fn((v: unknown) => v === CANCEL),
}))

vi.mock('../nylas-env.js', () => ({
	defaultProjectRegion: vi.fn((r: 'us' | 'eu') => r),
	ownmailNylasEnvironment: vi.fn(() => 'production'),
}))

vi.mock('../state/store.js', () => ({
	listProjects: vi.fn(() => [] as ProjectState[]),
	loadProject: vi.fn(),
	newProject: vi.fn(),
	saveProject: vi.fn(),
}))

vi.mock('../steps/context.js', () => ({
	createContext: vi.fn(async () => ({}) as never),
}))

vi.mock('../steps/deploy.js', () => ({
	stepHostingProvider: vi.fn(),
	stepCfAuth: vi.fn(),
	stepCfResources: vi.fn(),
	stepDeploy: vi.fn(),
	stepWebhook: vi.fn(),
	stepRedirectUris: vi.fn(),
	stepVerify: vi.fn(),
}))

vi.mock('../steps/provision.js', () => {
	class CancelledError extends Error {
		constructor() {
			super('Cancelled')
			this.name = 'CancelledError'
		}
	}
	return {
		CancelledError,
		stepDashboardAuth: vi.fn(),
		stepOrg: vi.fn(),
		stepApp: vi.fn(),
		stepApiKey: vi.fn(),
		stepConnector: vi.fn(),
		stepDomain: vi.fn(),
		stepGrant: vi.fn(),
	}
})

import * as p from '@clack/prompts'
import { ownmailNylasEnvironment } from '../nylas-env.js'
import { listProjects, loadProject, newProject, saveProject } from '../state/store.js'
import { CancelledError, stepDashboardAuth, stepGrant } from '../steps/provision.js'

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

let savedExitCode: typeof process.exitCode

beforeEach(() => {
	vi.clearAllMocks()
	savedExitCode = process.exitCode
	process.exitCode = undefined
	vi.mocked(ownmailNylasEnvironment).mockReturnValue('production')
	vi.mocked(listProjects).mockReturnValue([])
})

afterEach(() => {
	process.exitCode = savedExitCode
})

describe('runCreate — resolveProject', () => {
	it('loads a named project when one exists', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(loadProject).toHaveBeenCalledWith('acme')
		expect(newProject).not.toHaveBeenCalled()
		expect(p.outro).toHaveBeenCalled()
	})

	it('creates a new named project when none exists', async () => {
		vi.mocked(loadProject).mockReturnValue(null)
		const fresh = makeProject({ slug: 'newco', region: 'eu' })
		vi.mocked(newProject).mockReturnValue(fresh)

		await runCreate({ name: 'newco', region: 'eu' })

		expect(newProject).toHaveBeenCalledWith('newco', 'eu')
		expect(p.outro).toHaveBeenCalled()
	})

	it('uses the single existing (non-ejected) project when no name is given', async () => {
		const proj = makeProject({ slug: 'solo' })
		vi.mocked(listProjects).mockReturnValue([proj, makeProject({ slug: 'gone', ejected: true })])

		await runCreate({})

		expect(p.select).not.toHaveBeenCalled()
		expect(p.outro).toHaveBeenCalled()
	})

	it('prompts to pick an existing project when several exist', async () => {
		const a = makeProject({ slug: 'a', inboxEmail: 'a@x.com' })
		const b = makeProject({ slug: 'b' })
		vi.mocked(listProjects).mockReturnValue([a, b])
		vi.mocked(p.select).mockResolvedValue('a' as never)
		vi.mocked(loadProject).mockReturnValue(a)

		await runCreate({})

		expect(p.select).toHaveBeenCalled()
		expect(loadProject).toHaveBeenCalledWith('a')
		expect(p.outro).toHaveBeenCalled()
	})

	it('throws when the picked existing project can no longer be loaded', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'a' }), makeProject({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue('a' as never)
		vi.mocked(loadProject).mockReturnValue(null)

		await expect(runCreate({})).rejects.toThrow('No project named "a".')
	})

	it('falls through to a new-project prompt when the picker chooses __new__', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'a' }), makeProject({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue('__new__' as never)
		vi.mocked(p.text).mockResolvedValue('brandnew' as never)
		const fresh = makeProject({ slug: 'brandnew' })
		vi.mocked(newProject).mockReturnValue(fresh)

		await runCreate({})

		expect(newProject).toHaveBeenCalledWith('brandnew', 'us')
		expect(saveProject).toHaveBeenCalledWith(fresh)
		expect(p.outro).toHaveBeenCalled()
	})

	it('cancels when the project picker is cancelled', async () => {
		vi.mocked(listProjects).mockReturnValue([makeProject({ slug: 'a' }), makeProject({ slug: 'b' })])
		vi.mocked(p.select).mockResolvedValue(CANCEL as never)

		await expect(runCreate({})).rejects.toBeInstanceOf(CancelledError)
	})

	it('creates and saves a project from the text prompt when none exist', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		vi.mocked(p.text).mockResolvedValue('typedname' as never)
		const fresh = makeProject({ slug: 'typedname' })
		vi.mocked(newProject).mockReturnValue(fresh)

		await runCreate({})

		expect(p.text).toHaveBeenCalled()
		expect(saveProject).toHaveBeenCalledWith(fresh)
		expect(p.outro).toHaveBeenCalled()
	})

	it('exercises the name-prompt validate rule (accept + reject)', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		let validate: ((v: string | undefined) => string | undefined) | undefined
		vi.mocked(p.text).mockImplementation(async (opts: never) => {
			validate = (opts as { validate: typeof validate }).validate
			return 'ok' as never
		})
		vi.mocked(newProject).mockReturnValue(makeProject({ slug: 'ok' }))

		await runCreate({})

		expect(validate?.('acme')).toBeUndefined()
		expect(validate?.('BadName!')).toMatch(/Lowercase/)
		expect(validate?.(undefined)).toMatch(/Lowercase/)
	})

	it('cancels when the new-project text prompt is cancelled', async () => {
		vi.mocked(listProjects).mockReturnValue([])
		vi.mocked(p.text).mockResolvedValue(CANCEL as never)

		await expect(runCreate({})).rejects.toBeInstanceOf(CancelledError)
	})
})

describe('runCreate — normalizeProjectRegion', () => {
	it('returns the project unchanged when the region already matches', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme', region: 'us' })

		expect(saveProject).not.toHaveBeenCalled()
		expect(p.log.info).not.toHaveBeenCalledWith(expect.stringContaining('Using US'))
	})

	it('switches region when the project has no provisioned resources', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme', region: 'eu' })

		expect(proj.region).toBe('eu')
		expect(saveProject).toHaveBeenCalledWith(proj)
		expect(p.log.info).toHaveBeenCalled()
	})

	it('refuses to switch region once resources exist', async () => {
		const proj = makeProject({ slug: 'acme', region: 'us', applicationId: 'app_1' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await expect(runCreate({ name: 'acme', region: 'eu' })).rejects.toThrow(/was started in us/)
	})

	it('repairs the legacy EU staging default back to US', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'eu', completedSteps: ['dashboard-auth', 'org'] })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('us')
		expect(saveProject).toHaveBeenCalledWith(proj)
	})

	it('does not repair region when staging progressed past org', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'eu', completedSteps: ['dashboard-auth', 'org', 'app'] })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('eu')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('does not repair region outside staging (production, EU)', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('production')
		const proj = makeProject({ slug: 'acme', region: 'eu' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('eu')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('does not repair a non-EU staging project', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'us' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('us')
		expect(saveProject).not.toHaveBeenCalled()
	})

	it('does not repair a staging EU project that already has resources', async () => {
		vi.mocked(ownmailNylasEnvironment).mockReturnValue('staging')
		const proj = makeProject({ slug: 'acme', region: 'eu', grantId: 'grant_1' })
		vi.mocked(loadProject).mockReturnValue(proj)

		await runCreate({ name: 'acme' })

		expect(proj.region).toBe('eu')
		expect(saveProject).not.toHaveBeenCalled()
	})
})

describe('runCreate — step machine', () => {
	it('runs every step and shows the success outro', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))

		await runCreate({ name: 'acme' })

		expect(p.outro).toHaveBeenCalledWith('Enjoy your inbox — powered by Nylas.')
		expect(p.note).toHaveBeenCalledWith(expect.stringContaining('Nylas email address'), 'Before you start')
		expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining('Starting “acme” at [1/5]'))
		expect(p.log.step).toHaveBeenCalledTimes(5)
		expect(p.log.step).toHaveBeenNthCalledWith(1, '[1/5] Connect your Nylas account')
		expect(p.log.step).toHaveBeenNthCalledWith(5, '[5/5] Verify your app')
		expect(process.exitCode).toBeUndefined()
	})

	it('identifies the next user-facing phase when resuming', async () => {
		vi.mocked(loadProject).mockReturnValue(
			makeProject({
				slug: 'acme',
				completedSteps: ['dashboard-auth', 'org', 'app', 'api-key', 'connector', 'domain', 'grant'],
			}),
		)

		await runCreate({ name: 'acme' })

		expect(p.log.info).toHaveBeenCalledWith(
			expect.stringContaining('Resuming “acme” at [3/5] Connect your hosting account'),
		)
	})

	it('reports a completed project without exposing internal step IDs', async () => {
		const completedSteps = [
			'dashboard-auth',
			'org',
			'app',
			'api-key',
			'connector',
			'domain',
			'grant',
			'hosting',
			'cf-auth',
			'cf-resources',
			'deploy',
			'webhook',
			'redirect-uris',
			'verify',
		] as ProjectState['completedSteps']
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme', completedSteps }))

		await runCreate({ name: 'acme' })

		expect(p.log.info).toHaveBeenCalledWith('Checking completed project “acme” across 5 setup phases.')
	})

	it('pauses and sets exit code when a step cancels', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepDashboardAuth).mockRejectedValueOnce(new CancelledError())

		await runCreate({ name: 'acme' })

		expect(p.cancel).toHaveBeenCalledWith(expect.stringContaining('Paused'))
		expect(p.outro).not.toHaveBeenCalled()
		expect(process.exitCode).toBe(1)
	})

	it('reports an error and sets exit code when a step throws', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepGrant).mockRejectedValueOnce(new Error('boom'))

		await runCreate({ name: 'acme' })

		expect(p.log.error).toHaveBeenCalledWith('boom')
		expect(p.cancel).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'))
		expect(process.exitCode).toBe(1)
	})

	it('stringifies a non-Error thrown by a step', async () => {
		vi.mocked(loadProject).mockReturnValue(makeProject({ slug: 'acme' }))
		vi.mocked(stepGrant).mockRejectedValueOnce('plain string failure')

		await runCreate({ name: 'acme' })

		expect(p.log.error).toHaveBeenCalledWith('plain string failure')
		expect(process.exitCode).toBe(1)
	})
})
